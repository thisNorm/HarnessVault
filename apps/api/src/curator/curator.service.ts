import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  assessComplexity,
  contextLevelForRound,
  maxRounds,
  type CuratorComplexity,
  type CuratorRoundResult,
  type CuratorRunView,
  type SimilarCandidate,
} from '@harnessvault/domain';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import {
  assetRelations,
  assetVersions,
  curatorRuns,
  harnessAssets,
} from '../db/schema';
import { renderStructuredContent } from '../compiler/render';
import { ContributionService } from '../contribution/contribution.service';
import { EmbeddingService } from '../contribution/embedding.service';
import { getEnv } from '../env';
import {
  CuratorUnavailableError,
  MockCuratorProvider,
  OllamaCuratorProvider,
  type CuratorModelProvider,
  type CuratorPrompt,
} from './provider';

@Injectable()
export class CuratorService {
  private readonly logger = new Logger(CuratorService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly contributions: ContributionService,
    private readonly mock: MockCuratorProvider,
    private readonly ollama: OllamaCuratorProvider,
  ) {}

  /** `CURATOR_URL`이 없으면 대역이다. 무엇이 돌았는지는 결과에 반드시 남는다(§72). */
  private provider(candidates: SimilarCandidate[]): CuratorModelProvider {
    return getEnv().CURATOR_URL ? this.ollama : this.mock.withCandidates(candidates);
  }

  async listRuns(organizationId: string, contributionId: string): Promise<CuratorRunView[]> {
    const rows = await this.database.db
      .select()
      .from(curatorRuns)
      .where(
        and(
          eq(curatorRuns.organizationId, organizationId),
          eq(curatorRuns.contributionId, contributionId),
        ),
      )
      .orderBy(desc(curatorRuns.createdAt));
    return rows.map((row) => this.toView(row));
  }

  /**
   * 검토자가 요청할 때만 돈다. 제출 경로에서 부르지 않는다 —
   * 로컬 모델은 수십 초가 걸리고, 결과는 제출자가 아니라 검토자를 위한 것이다.
   *
   * **실패해도 Candidate는 그대로 유지된다(§61).** 실패한 실행도 한 줄로 남는다.
   */
  async review(
    organizationId: string,
    actorUserId: string,
    contributionId: string,
  ): Promise<CuratorRunView> {
    const contribution = await this.contributions.detail(organizationId, contributionId);

    const text = EmbeddingService.describe({
      key: contribution.proposedKey,
      name: contribution.name,
      description: contribution.description,
      summary: contribution.summary,
    });
    const { candidates } = await this.contributions.findSimilar(organizationId, { text });

    const detailed = await this.loadCandidates(organizationId, candidates);
    // 점수는 높은데 타입이 다르면 신호가 엇갈린 것이다. 복잡도 판정에 넘긴다.
    const hasTypeMismatch = detailed.some(
      (item) => item.score >= 0.75 && item.type !== contribution.type,
    );
    const complexity = assessComplexity(candidates, { hasTypeMismatch });
    const limit = maxRounds(complexity);

    const provider = this.provider(candidates);
    const startedAt = Date.now();

    let result: CuratorRoundResult | null = null;
    let round = 0;
    try {
      while (round < limit) {
        round++;
        const level = contextLevelForRound(round);
        result = await provider.review(
          this.buildPrompt(contribution, detailed, round, limit, level),
        );
        // 더 볼 게 없다고 하면 그만 돈다. 예산을 다 쓰는 것이 목적이 아니다.
        if (!result.needMoreContext) break;
      }
    } catch (error) {
      const code = error instanceof CuratorUnavailableError ? error.code : 'CURATOR_UNAVAILABLE';
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Curator 실행 실패 — Candidate는 유지됩니다: ${message}`);
      return this.persist({
        organizationId,
        actorUserId,
        contributionId,
        status: 'FAILED',
        provider: provider.kind,
        model: provider.model,
        complexity,
        roundsUsed: round,
        result: null,
        relatedAssetId: null,
        failureCode: code,
        failureMessage: message,
        durationMs: Date.now() - startedAt,
      });
    }

    // 라운드를 다 쓰고도 더 필요하다고 하면 모른다고 말한다. 지어내지 않는다.
    const exhausted = result?.needMoreContext === true;
    const final: CuratorRoundResult =
      result && !exhausted
        ? result
        : {
            verdict: 'UNKNOWN',
            relatedAssetKey: null,
            confidence: 0,
            reasoning: exhausted
              ? `${limit}라운드를 모두 썼지만 판단에 필요한 정보가 부족했습니다.`
              : '판정을 얻지 못했습니다.',
            suggestedValidations: [],
            needMoreContext: false,
          };

    // 모델이 답한 key가 실제 후보에 있을 때만 자산에 연결한다.
    const related = final.relatedAssetKey
      ? (detailed.find((item) => item.key === final.relatedAssetKey) ?? null)
      : null;

    return this.persist({
      organizationId,
      actorUserId,
      contributionId,
      status: 'SUCCEEDED',
      provider: provider.kind,
      model: provider.model,
      complexity,
      roundsUsed: round,
      result: final,
      relatedAssetId: related?.assetId ?? null,
      failureCode: null,
      failureMessage: '',
      durationMs: Date.now() - startedAt,
    });
  }

  private buildPrompt(
    contribution: Awaited<ReturnType<ContributionService['detail']>>,
    candidates: LoadedCandidate[],
    round: number,
    limit: number,
    level: 1 | 2 | 3,
  ): CuratorPrompt {
    return {
      round,
      maxRounds: limit,
      contribution: {
        type: contribution.type,
        key: contribution.proposedKey,
        name: contribution.name,
        description: contribution.description,
        summary: contribution.summary,
        rationale: contribution.rationale,
        // 1라운드에는 본문을 주지 않는다. 요약으로 되는 판단에 토큰을 쓰지 않는다(§21).
        content: level >= 2 ? contribution.summary || contribution.description : null,
      },
      candidates: candidates.map((item) => ({
        key: item.key,
        name: item.name,
        type: item.type,
        score: item.score,
        body: level >= 2 ? item.body : null,
        relations: level >= 3 ? item.relations : null,
      })),
    };
  }

  /** 후보의 본문·관계를 미리 읽어 둔다. 라운드마다 DB를 다시 때리지 않는다. */
  private async loadCandidates(
    organizationId: string,
    candidates: readonly SimilarCandidate[],
  ): Promise<LoadedCandidate[]> {
    if (candidates.length === 0) return [];
    const ids = candidates.map((item) => item.assetId);

    const assets = await this.database.db
      .select({ id: harnessAssets.id, type: harnessAssets.type })
      .from(harnessAssets)
      .where(and(eq(harnessAssets.organizationId, organizationId), inArray(harnessAssets.id, ids)));
    const typeById = new Map(assets.map((asset) => [asset.id, asset.type]));

    const versions = await this.database.db
      .select({
        assetId: assetVersions.assetId,
        summary: assetVersions.summary,
        structuredContent: assetVersions.structuredContent,
      })
      .from(assetVersions)
      .where(and(inArray(assetVersions.assetId, ids), eq(assetVersions.status, 'ACTIVE')));
    const bodyByAsset = new Map(
      versions.map((version) => [
        version.assetId,
        version.summary || renderStructuredContent(version.structuredContent),
      ]),
    );

    const relations = await this.database.db
      .select({
        fromAssetId: assetRelations.fromAssetId,
        toAssetId: assetRelations.toAssetId,
        type: assetRelations.type,
      })
      .from(assetRelations)
      .where(inArray(assetRelations.fromAssetId, ids));
    const relationsByAsset = new Map<string, string[]>();
    for (const relation of relations) {
      const list = relationsByAsset.get(relation.fromAssetId) ?? [];
      list.push(`${relation.type} → ${relation.toAssetId}`);
      relationsByAsset.set(relation.fromAssetId, list);
    }

    return candidates.map((candidate) => ({
      assetId: candidate.assetId,
      key: candidate.key,
      name: candidate.name,
      score: candidate.score,
      type: typeById.get(candidate.assetId) ?? 'UNKNOWN',
      body: bodyByAsset.get(candidate.assetId) ?? null,
      relations: relationsByAsset.get(candidate.assetId) ?? [],
    }));
  }

  private async persist(input: PersistInput): Promise<CuratorRunView> {
    const [row] = await this.database.db
      .insert(curatorRuns)
      .values({
        organizationId: input.organizationId,
        contributionId: input.contributionId,
        status: input.status,
        provider: input.provider,
        model: input.model,
        complexity: input.complexity,
        roundsUsed: input.roundsUsed,
        verdict: input.result?.verdict ?? null,
        relatedAssetId: input.relatedAssetId,
        relatedAssetKey: input.result?.relatedAssetKey ?? null,
        confidence: input.result?.confidence ?? null,
        reasoning: input.result?.reasoning ?? '',
        suggestedValidations: input.result?.suggestedValidations ?? [],
        failureCode: input.failureCode,
        failureMessage: input.failureMessage,
        durationMs: input.durationMs,
      })
      .returning();
    if (!row) throw new NotFoundException('Curator 실행을 저장하지 못했습니다');

    await this.audit.record({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      eventType: 'curator.reviewed',
      targetType: 'contribution',
      targetId: input.contributionId,
      // 판정과 무엇이 판단했는지만 남긴다. 기여 본문은 남기지 않는다(§39).
      metadata: {
        status: input.status,
        provider: input.provider,
        model: input.model,
        complexity: input.complexity,
        roundsUsed: input.roundsUsed,
        verdict: input.result?.verdict ?? null,
        confidence: input.result?.confidence ?? null,
        failureCode: input.failureCode,
        durationMs: input.durationMs,
      },
    });

    return this.toView(row);
  }

  private toView(row: typeof curatorRuns.$inferSelect): CuratorRunView {
    return {
      id: row.id,
      contributionId: row.contributionId,
      status: row.status,
      provider: row.provider,
      model: row.model,
      complexity: row.complexity,
      roundsUsed: row.roundsUsed,
      verdict: row.verdict,
      relatedAssetId: row.relatedAssetId,
      relatedAssetKey: row.relatedAssetKey,
      confidence: row.confidence,
      reasoning: row.reasoning,
      suggestedValidations: row.suggestedValidations,
      failureCode: row.failureCode,
      failureMessage: row.failureMessage,
      durationMs: row.durationMs,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

interface LoadedCandidate {
  assetId: string;
  key: string;
  name: string;
  score: number;
  type: string;
  body: string | null;
  relations: string[];
}

interface PersistInput {
  organizationId: string;
  actorUserId: string;
  contributionId: string;
  status: 'SUCCEEDED' | 'FAILED';
  provider: 'MOCK' | 'OLLAMA';
  model: string;
  complexity: CuratorComplexity;
  roundsUsed: number;
  result: CuratorRoundResult | null;
  relatedAssetId: string | null;
  failureCode: string | null;
  failureMessage: string;
  durationMs: number;
}
