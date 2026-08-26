import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  canTransitionContribution,
  classifyDuplicates,
  cosineSimilarity,
  estimateTokens,
  nextVersionLabel,
  type ContributeInput,
  type ContributionStatus,
  type ContributionSummary,
  type PromoteContributionInput,
  type ScopeType,
  type ScoredAsset,
  type SimilarCandidate,
  type SimilarityMethod,
} from '@harnessvault/domain';
import { and, count, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import {
  assetVersions,
  contributions,
  harnessAssets,
  projectMemberships,
  teamMemberships,
  users,
} from '../db/schema';
import { rankAssets } from '../mcp/similarity';
import { EmbeddingService } from './embedding.service';

export interface SubmitResult {
  contribution: ContributionSummary;
  similar: SimilarCandidate[];
  method: SimilarityMethod;
}

@Injectable()
export class ContributionService {
  private readonly logger = new Logger(ContributionService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly embeddings: EmbeddingService,
  ) {}

  /**
   * 스키마 검증 → 중복 탐색 → CANDIDATE 저장.
   * 중복이어도 거절하지 않는다 — 자동으로 막으면 "기존 자산이 틀렸다"는 기여가 들어오지 못한다.
   */
  async submit(
    organizationId: string,
    userId: string,
    input: ContributeInput,
  ): Promise<SubmitResult> {
    const scopeId = await this.resolveProposedScope(
      organizationId,
      userId,
      input.proposedScopeType,
      input.proposedScopeId ?? null,
    );

    const text = EmbeddingService.describe({
      key: input.proposedKey,
      name: input.name,
      description: input.description,
      summary: input.summary,
    });
    const embedded = await this.embeddings.embed(text);

    const { candidates, method } = await this.findSimilar(organizationId, {
      text,
      capabilityId: input.capabilityId ?? null,
      vector: embedded.vector,
    });

    const top = candidates[0];
    // 중복 후보로 표시된 것만 duplicateOf에 건다. RELATED까지 걸면 검토자가 잘못 읽는다.
    const duplicate = top?.relationHint === 'DUPLICATE_CANDIDATE' ? top : null;

    const [created] = await this.database.db
      .insert(contributions)
      .values({
        organizationId,
        submittedByUserId: userId,
        traceId: input.traceId ?? null,
        type: input.type,
        proposedKey: input.proposedKey,
        name: input.name,
        description: input.description,
        summary: input.summary,
        rationale: input.rationale,
        structuredContent: input.structuredContent,
        capabilityId: input.capabilityId ?? null,
        proposedScopeType: input.proposedScopeType,
        proposedScopeId: scopeId,
        duplicateOfAssetId: duplicate?.assetId ?? null,
        duplicateScore: duplicate?.score ?? null,
        similarityMethod: method,
        embeddingStatus: embedded.status,
        embedding: embedded.vector ?? null,
      })
      .returning({ id: contributions.id });

    if (!created) throw new ConflictException('기여를 저장하지 못했습니다');

    await this.audit.record({
      organizationId,
      traceId: input.traceId ?? null,
      actorUserId: userId,
      eventType: 'contribution.submitted',
      targetType: 'contribution',
      targetId: created.id,
      // 본문은 남기지 않는다(§39). 길이와 판정 결과만 남긴다.
      metadata: {
        type: input.type,
        proposedKey: input.proposedKey,
        proposedScopeType: input.proposedScopeType,
        contentLength: JSON.stringify(input.structuredContent).length,
        similarityMethod: method,
        duplicateOfAssetId: duplicate?.assetId ?? null,
        duplicateScore: duplicate?.score ?? null,
        embeddingStatus: embedded.status,
      },
    });

    return {
      contribution: await this.detail(organizationId, created.id),
      similar: candidates,
      method,
    };
  }

  /**
   * 임베딩이 있으면 pgvector로, 없으면 어휘로 찾는다.
   * 무엇으로 찾았는지 항상 함께 돌려준다 — 의미 검색인 척하지 않는다.
   */
  async findSimilar(
    organizationId: string,
    query: { text: string; capabilityId?: string | null; vector?: number[] | null },
  ): Promise<{
    candidates: SimilarCandidate[];
    method: SimilarityMethod;
    /** 임베딩이 없어 벡터 검색에서 빠진 자산 수. 0이 아니면 결과가 완전하지 않다. */
    unindexedCount: number;
  }> {
    if (query.vector) {
      const rows = await this.database.db
        .select({
          assetId: harnessAssets.id,
          key: harnessAssets.key,
          name: harnessAssets.name,
          embedding: harnessAssets.embedding,
        })
        .from(harnessAssets)
        .where(
          and(eq(harnessAssets.organizationId, organizationId), isNotNull(harnessAssets.embedding)),
        );

      if (rows.length > 0) {
        // 임베딩이 없는 자산은 점수를 매길 수 없어 조용히 빠진다.
        // 빠졌다는 사실을 숨기면 "닮은 게 없다"로 위장된다.
        const [total] = await this.database.db
          .select({ value: count() })
          .from(harnessAssets)
          .where(eq(harnessAssets.organizationId, organizationId));
        const unindexedCount = (total?.value ?? rows.length) - rows.length;
        if (unindexedCount > 0) {
          this.logger.warn(
            `임베딩이 없는 자산 ${unindexedCount}개가 벡터 검색에서 빠졌습니다. ` +
              `POST /organizations/${organizationId}/contributions/embeddings/backfill 로 채우세요`,
          );
        }
        const vector = query.vector;
        const scored: ScoredAsset[] = rows.map((row) => ({
          assetId: row.assetId,
          key: row.key,
          name: row.name,
          score: cosineSimilarity(vector, row.embedding ?? []),
        }));
        return { candidates: classifyDuplicates(scored), method: 'VECTOR', unindexedCount };
      }
      // 임베딩이 붙은 자산이 하나도 없으면 벡터 검색은 빈 결과다.
      // 그때 VECTOR라고 보고하면 "닮은 게 없다"로 위장된다. 어휘로 떨어진다.
    }

    const rows = await this.database.db
      .select({
        assetId: harnessAssets.id,
        key: harnessAssets.key,
        name: harnessAssets.name,
        description: harnessAssets.description,
        capabilityId: harnessAssets.capabilityId,
      })
      .from(harnessAssets)
      .where(eq(harnessAssets.organizationId, organizationId));

    const ranked = rankAssets(rows, { text: query.text, capabilityId: query.capabilityId }, 10);
    return {
      candidates: classifyDuplicates(
        ranked.map((item) => ({
          assetId: item.assetId,
          key: item.key,
          name: item.name,
          score: item.score,
        })),
      ),
      method: 'LEXICAL',
      // 어휘 검색은 모든 자산을 본다. 빠지는 것이 없다.
      unindexedCount: 0,
    };
  }

  /** 아직 제출하지 않은 지식으로 미리 찾아본다. 임베딩 계산까지 여기서 한다. */
  async similarTo(
    organizationId: string,
    input: { title: string; description: string; capabilityId?: string | null },
  ): Promise<{
    candidates: SimilarCandidate[];
    method: SimilarityMethod;
    unindexedCount: number;
  }> {
    const text = EmbeddingService.describe({
      key: '',
      name: input.title,
      description: input.description,
    });
    const { vector } = await this.embeddings.embed(text);
    return this.findSimilar(organizationId, {
      text,
      capabilityId: input.capabilityId ?? null,
      vector,
    });
  }

  async list(
    organizationId: string,
    filter: { status?: ContributionStatus; submittedBy?: string } = {},
  ): Promise<ContributionSummary[]> {
    const conditions = [eq(contributions.organizationId, organizationId)];
    if (filter.status) conditions.push(eq(contributions.status, filter.status));
    if (filter.submittedBy) conditions.push(eq(contributions.submittedByUserId, filter.submittedBy));

    const rows = await this.database.db
      .select()
      .from(contributions)
      .where(and(...conditions))
      .orderBy(desc(contributions.createdAt));

    return this.hydrate(rows);
  }

  async detail(organizationId: string, contributionId: string): Promise<ContributionSummary> {
    const [row] = await this.database.db
      .select()
      .from(contributions)
      .where(
        and(eq(contributions.id, contributionId), eq(contributions.organizationId, organizationId)),
      )
      .limit(1);
    if (!row) throw new NotFoundException('기여를 찾을 수 없습니다');
    const [summary] = await this.hydrate([row]);
    if (!summary) throw new NotFoundException('기여를 찾을 수 없습니다');
    return summary;
  }

  /**
   * 사람이 자산으로 올린다. 여기가 자동화되지 않는 유일한 이유다 —
   * 에이전트가 만든 것이 검토 없이 조직 규칙이 되면 잘못된 지식이 스스로를 근거로 증식한다.
   */
  async promote(
    organizationId: string,
    reviewerUserId: string,
    contributionId: string,
    input: PromoteContributionInput,
  ): Promise<ContributionSummary> {
    const current = await this.loadForTransition(organizationId, contributionId, 'PROMOTED');

    const scopeType = input.scopeType ?? current.proposedScopeType;
    const key = input.key ?? current.proposedKey;
    // 검토자가 범위를 바꿨는데 대상 id를 주지 않으면, 제안된 id를 재사용하지 않는다.
    // 팀 id를 프로젝트 범위에 그대로 꽂으면 아무 데도 걸리지 않는 자산이 생긴다.
    const scopeId =
      scopeType === 'COMPANY'
        ? organizationId
        : (input.scopeId ??
          (scopeType === current.proposedScopeType ? current.proposedScopeId : null));
    if (!scopeId) {
      throw new BadRequestException(`${scopeType} 스코프에는 scopeId가 필요합니다`);
    }

    const content = current.structuredContent;
    const estimatedTokens = estimateTokens(JSON.stringify(content));

    const result = await this.database.db.transaction(async (tx) => {
      if (input.targetAssetId) {
        const [target] = await tx
          .select({ id: harnessAssets.id })
          .from(harnessAssets)
          .where(
            and(
              eq(harnessAssets.id, input.targetAssetId),
              eq(harnessAssets.organizationId, organizationId),
            ),
          )
          .limit(1);
        if (!target) throw new NotFoundException('대상 자산을 찾을 수 없습니다');

        const existing = await tx
          .select({ version: assetVersions.version })
          .from(assetVersions)
          .where(eq(assetVersions.assetId, target.id));

        // 기존 자산의 새 버전은 CANDIDATE다. 바로 ACTIVE로 만들면 쓰이던 버전이
        // 조용히 내려간다 — 그 강등은 promoteVersion이라는 별도의 명시적 행위여야 한다.
        const [version] = await tx
          .insert(assetVersions)
          .values({
            assetId: target.id,
            version: nextVersionLabel(existing.map((row) => row.version)),
            status: 'CANDIDATE',
            structuredContent: content,
            summary: current.summary,
            estimatedTokens,
            createdBy: reviewerUserId,
          })
          .returning({ id: assetVersions.id });
        if (!version) throw new ConflictException('버전을 만들지 못했습니다');
        return { assetId: target.id, versionId: version.id, createdAsset: false };
      }

      const [asset] = await tx
        .insert(harnessAssets)
        .values({
          organizationId,
          capabilityId: current.capabilityId,
          type: current.type,
          key,
          name: current.name,
          description: current.description,
          scopeType,
          scopeId,
          inheritanceMode: 'DEFAULT',
          // 새 자산은 ACTIVE로 만든다. 승격이 아무것도 바꾸지 않으면 승격이 아니다.
          status: 'ACTIVE',
          ownerType: 'USER',
          ownerId: current.submittedByUserId,
          createdBy: reviewerUserId,
          embedding: current.embedding,
        })
        .onConflictDoNothing({
          target: [
            harnessAssets.organizationId,
            harnessAssets.key,
            harnessAssets.scopeType,
            harnessAssets.scopeId,
          ],
        })
        .returning({ id: harnessAssets.id });
      if (!asset) {
        throw new ConflictException(
          '같은 스코프에 같은 key의 자산이 이미 있습니다. targetAssetId로 새 버전을 만드세요',
        );
      }

      const [version] = await tx
        .insert(assetVersions)
        .values({
          assetId: asset.id,
          version: '1.0.0',
          status: 'ACTIVE',
          structuredContent: content,
          summary: current.summary,
          estimatedTokens,
          createdBy: reviewerUserId,
        })
        .returning({ id: assetVersions.id });
      if (!version) throw new ConflictException('버전을 만들지 못했습니다');
      return { assetId: asset.id, versionId: version.id, createdAsset: true };
    });

    await this.database.db
      .update(contributions)
      .set({
        status: 'PROMOTED',
        reviewedByUserId: reviewerUserId,
        reviewedAt: new Date(),
        reviewNote: input.note,
        promotedAssetId: result.assetId,
        promotedVersionId: result.versionId,
      })
      .where(eq(contributions.id, contributionId));

    await this.audit.record({
      organizationId,
      traceId: current.traceId,
      actorUserId: reviewerUserId,
      eventType: 'contribution.promoted',
      targetType: 'contribution',
      targetId: contributionId,
      metadata: {
        assetId: result.assetId,
        versionId: result.versionId,
        createdAsset: result.createdAsset,
        scopeType,
        key,
        submittedBy: current.submittedByUserId,
      },
    });

    return this.detail(organizationId, contributionId);
  }

  async reject(
    organizationId: string,
    reviewerUserId: string,
    contributionId: string,
    note: string,
  ): Promise<ContributionSummary> {
    const current = await this.loadForTransition(organizationId, contributionId, 'REJECTED');

    await this.database.db
      .update(contributions)
      .set({
        status: 'REJECTED',
        reviewedByUserId: reviewerUserId,
        reviewedAt: new Date(),
        reviewNote: note,
      })
      .where(eq(contributions.id, contributionId));

    await this.audit.record({
      organizationId,
      traceId: current.traceId,
      actorUserId: reviewerUserId,
      eventType: 'contribution.rejected',
      targetType: 'contribution',
      targetId: contributionId,
      // 이유는 남긴다. 이유 없는 거절은 같은 기여를 다시 부른다.
      metadata: { submittedBy: current.submittedByUserId, note },
    });

    return this.detail(organizationId, contributionId);
  }

  /** 제출자 본인만 취소할 수 있다. 검토자가 취소하는 것은 거절이지 취소가 아니다. */
  async withdraw(
    organizationId: string,
    userId: string,
    contributionId: string,
  ): Promise<ContributionSummary> {
    const current = await this.loadForTransition(organizationId, contributionId, 'WITHDRAWN');
    if (current.submittedByUserId !== userId) {
      throw new ForbiddenException('본인이 제출한 기여만 취소할 수 있습니다');
    }

    await this.database.db
      .update(contributions)
      .set({ status: 'WITHDRAWN', reviewedAt: new Date() })
      .where(eq(contributions.id, contributionId));

    await this.audit.record({
      organizationId,
      traceId: current.traceId,
      actorUserId: userId,
      eventType: 'contribution.withdrawn',
      targetType: 'contribution',
      targetId: contributionId,
      metadata: {},
    });

    return this.detail(organizationId, contributionId);
  }

  /**
   * 자산 임베딩을 다시 계산한다. 승격 이전에 만들어진 자산에도 의미 검색이 닿게 한다.
   *
   * **건너뛴 자산의 key를 함께 돌려준다.** 개수만 주면 어느 자산이 검색에서
   * 빠졌는지 알 수 없고, 그 자산은 아무도 모르게 영원히 안 잡힌다.
   */
  async backfillEmbeddings(
    organizationId: string,
  ): Promise<{ updated: number; skipped: number; skippedKeys: string[] }> {
    if (!this.embeddings.configured) return { updated: 0, skipped: 0, skippedKeys: [] };

    const rows = await this.database.db
      .select({
        id: harnessAssets.id,
        key: harnessAssets.key,
        name: harnessAssets.name,
        description: harnessAssets.description,
      })
      .from(harnessAssets)
      .where(eq(harnessAssets.organizationId, organizationId));

    let updated = 0;
    const skippedKeys: string[] = [];
    for (const row of rows) {
      const text = EmbeddingService.describe(row);
      let { vector } = await this.embeddings.embed(text);
      // 한 번 더 해 본다. 모델 첫 로드처럼 한 번만 느린 경우가 가장 흔한 실패다 —
      // 여기서 포기하면 그 자산만 의미 검색에서 영영 빠진다.
      if (!vector) ({ vector } = await this.embeddings.embed(text));
      if (!vector) {
        skippedKeys.push(row.key);
        continue;
      }
      await this.database.db
        .update(harnessAssets)
        .set({ embedding: vector })
        .where(eq(harnessAssets.id, row.id));
      updated++;
    }
    return { updated, skipped: skippedKeys.length, skippedKeys };
  }

  private async loadForTransition(
    organizationId: string,
    contributionId: string,
    to: ContributionStatus,
  ) {
    const [row] = await this.database.db
      .select()
      .from(contributions)
      .where(
        and(eq(contributions.id, contributionId), eq(contributions.organizationId, organizationId)),
      )
      .limit(1);
    if (!row) throw new NotFoundException('기여를 찾을 수 없습니다');
    if (!canTransitionContribution(row.status, to)) {
      throw new ConflictException({
        code: 'INVALID_CONTRIBUTION_TRANSITION',
        message: `${row.status} 상태의 기여는 ${to}로 바꿀 수 없습니다`,
      });
    }
    return row;
  }

  /** 제안 범위가 실제로 제출자가 속한 곳인지 확인한다. 남의 팀에 지식을 꽂지 못하게 한다. */
  private async resolveProposedScope(
    organizationId: string,
    userId: string,
    scopeType: ScopeType,
    scopeId: string | null,
  ): Promise<string> {
    if (scopeType === 'COMPANY') return organizationId;
    if (scopeType === 'PERSONAL') return userId;
    if (!scopeId) throw new BadRequestException(`${scopeType} 스코프에는 scopeId가 필요합니다`);

    const [membership] =
      scopeType === 'TEAM'
        ? await this.database.db
            .select({ id: teamMemberships.teamId })
            .from(teamMemberships)
            .where(
              and(eq(teamMemberships.teamId, scopeId), eq(teamMemberships.userId, userId)),
            )
            .limit(1)
        : await this.database.db
            .select({ id: projectMemberships.projectId })
            .from(projectMemberships)
            .where(
              and(
                eq(projectMemberships.projectId, scopeId),
                eq(projectMemberships.userId, userId),
              ),
            )
            .limit(1);

    if (!membership) {
      throw new BadRequestException('속하지 않은 범위에는 기여할 수 없습니다');
    }
    return scopeId;
  }

  private async hydrate(
    rows: Array<typeof contributions.$inferSelect>,
  ): Promise<ContributionSummary[]> {
    const userIds = [
      ...new Set(
        rows.flatMap((row) =>
          [row.submittedByUserId, row.reviewedByUserId].filter((id): id is string => Boolean(id)),
        ),
      ),
    ];
    const people =
      userIds.length === 0
        ? []
        : await this.database.db
            .select({ id: users.id, displayName: users.displayName })
            .from(users)
            .where(inArray(users.id, userIds));
    const nameById = new Map(people.map((person) => [person.id, person.displayName]));

    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      type: row.type,
      proposedKey: row.proposedKey,
      name: row.name,
      description: row.description,
      summary: row.summary,
      rationale: row.rationale,
      proposedScopeType: row.proposedScopeType,
      proposedScopeId: row.proposedScopeId,
      capabilityId: row.capabilityId,
      submittedByUserId: row.submittedByUserId,
      submittedByDisplayName: nameById.get(row.submittedByUserId) ?? '알 수 없음',
      traceId: row.traceId,
      duplicateOfAssetId: row.duplicateOfAssetId,
      duplicateScore: row.duplicateScore,
      similarityMethod: row.similarityMethod,
      embeddingStatus: row.embeddingStatus,
      reviewedByUserId: row.reviewedByUserId,
      reviewedByDisplayName: row.reviewedByUserId
        ? (nameById.get(row.reviewedByUserId) ?? '알 수 없음')
        : null,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      reviewNote: row.reviewNote,
      promotedAssetId: row.promotedAssetId,
      promotedVersionId: row.promotedVersionId,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
