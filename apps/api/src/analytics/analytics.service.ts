import { Injectable } from '@nestjs/common';
import {
  averageOf,
  contextReductionRatio,
  safeRatio,
  topBuckets,
  type AnalyticsBundle,
  type AssetUsageRow,
  type CountBucket,
} from '@harnessvault/domain';
import { and, count, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service';
import {
  approvalRequests,
  capabilities,
  contributions,
  curatorRuns,
  harnessAssets,
  taskTraces,
  traceAssetUsage,
} from '../db/schema';

/**
 * 읽기 전용 집계. 새 테이블을 만들지 않고 이미 남아 있는 기록에서 뽑는다.
 *
 * **어떤 집계도 사용자로 그룹핑하지 않는다(§57).**
 * 개인별 생산성 점수를 만들지 않기 위해서다. 이 파일에 `userId`로 group by 하는
 * 쿼리가 생기면 그 원칙이 깨진 것이다.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly database: DatabaseService) {}

  /** 화면이 한 장이므로 요청도 한 번이면 된다. 섹션마다 엔드포인트를 만들지 않는다. */
  async bundle(organizationId: string, days: number | null): Promise<AnalyticsBundle> {
    const since = days === null ? null : new Date(Date.now() - days * 86_400_000);

    const [
      overview,
      assetUsage,
      unusedAssets,
      capabilityBuckets,
      contextEfficiency,
      outputContract,
      approvals,
      contributionStats,
      curator,
    ] = await Promise.all([
      this.overview(organizationId, days, since),
      this.assetUsage(organizationId, since),
      this.unusedAssets(organizationId, since),
      this.capabilities(organizationId),
      this.contextEfficiency(organizationId, since),
      this.outputContract(organizationId, since),
      this.approvals(organizationId, since),
      this.contributions(organizationId, since),
      this.curator(organizationId, since),
    ]);

    return {
      overview,
      assetUsage,
      unusedAssets,
      capabilities: capabilityBuckets,
      contextEfficiency,
      outputContract,
      approvals,
      contributions: contributionStats,
      curator,
    };
  }

  private async overview(organizationId: string, days: number | null, since: Date | null) {
    const assets = await this.database.db
      .select({
        type: harnessAssets.type,
        scopeType: harnessAssets.scopeType,
        status: harnessAssets.status,
      })
      .from(harnessAssets)
      .where(eq(harnessAssets.organizationId, organizationId));

    const traceRows = await this.database.db
      .select({ value: count() })
      .from(taskTraces)
      .where(this.scoped(taskTraces.organizationId, organizationId, taskTraces.startedAt, since));

    const contributionRows = await this.database.db
      .select({ value: count() })
      .from(contributions)
      .where(
        this.scoped(contributions.organizationId, organizationId, contributions.createdAt, since),
      );

    return {
      days,
      assetsByType: tally(assets.map((asset) => asset.type)),
      assetsByScope: tally(assets.map((asset) => asset.scopeType)),
      assetsByStatus: tally(assets.map((asset) => asset.status)),
      totalAssets: assets.length,
      totalTraces: traceRows[0]?.value ?? 0,
      totalContributions: contributionRows[0]?.value ?? 0,
    };
  }

  /** 무엇이 실제로 주입되는가 — 그리고 무엇이 계속 제외되는가. */
  private async assetUsage(organizationId: string, since: Date | null): Promise<AssetUsageRow[]> {
    const rows = await this.database.db
      .select({
        assetId: traceAssetUsage.assetId,
        key: harnessAssets.key,
        name: harnessAssets.name,
        type: traceAssetUsage.assetType,
        scope: traceAssetUsage.scopeType,
        selected: traceAssetUsage.selected,
        reasonCode: traceAssetUsage.reasonCode,
      })
      .from(traceAssetUsage)
      .innerJoin(harnessAssets, eq(harnessAssets.id, traceAssetUsage.assetId))
      .where(
        this.scoped(
          harnessAssets.organizationId,
          organizationId,
          traceAssetUsage.createdAt,
          since,
        ),
      );

    const byAsset = new Map<string, AssetUsageRow & { exclusionReasons: Map<string, number> }>();
    for (const row of rows) {
      let entry = byAsset.get(row.assetId);
      if (!entry) {
        entry = {
          assetId: row.assetId,
          key: row.key,
          name: row.name,
          type: row.type,
          scope: row.scope,
          selectedCount: 0,
          excludedCount: 0,
          selectionRate: null,
          topExclusionReason: null,
          exclusionReasons: new Map(),
        };
        byAsset.set(row.assetId, entry);
      }
      if (row.selected) {
        entry.selectedCount++;
      } else {
        entry.excludedCount++;
        entry.exclusionReasons.set(
          row.reasonCode,
          (entry.exclusionReasons.get(row.reasonCode) ?? 0) + 1,
        );
      }
    }

    return [...byAsset.values()]
      .map(({ exclusionReasons, ...entry }) => ({
        ...entry,
        selectionRate: safeRatio(entry.selectedCount, entry.selectedCount + entry.excludedCount),
        topExclusionReason:
          [...exclusionReasons.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ??
          null,
      }))
      .sort(
        (a, b) =>
          b.selectedCount - a.selectedCount ||
          b.excludedCount - a.excludedCount ||
          a.key.localeCompare(b.key),
      )
      .slice(0, 50);
  }

  /**
   * 한 번도 **주입되지 않은** ACTIVE 자산.
   *
   * "후보에 오르지 않은 것"으로 정의하지 않는다 — Resolver는 모든 ACTIVE 자산을
   * 후보에 올린 뒤 거르므로 그런 자산은 사실상 없다. 매번 후보에 올랐다가 매번
   * 밀려나는 자산이야말로 "쌓기만 하고 안 쓰는 것"이고, 이 화면의 존재 이유다.
   */
  private async unusedAssets(organizationId: string, since: Date | null) {
    const injected = this.database.db
      .select({ assetId: traceAssetUsage.assetId })
      .from(traceAssetUsage)
      .where(
        since
          ? and(eq(traceAssetUsage.selected, true), gte(traceAssetUsage.createdAt, since))
          : eq(traceAssetUsage.selected, true),
      );

    const rows = await this.database.db
      .select({
        assetId: harnessAssets.id,
        key: harnessAssets.key,
        name: harnessAssets.name,
        type: harnessAssets.type,
      })
      .from(harnessAssets)
      .where(
        and(
          eq(harnessAssets.organizationId, organizationId),
          eq(harnessAssets.status, 'ACTIVE'),
          sql`${harnessAssets.id} not in ${injected}`,
        ),
      )
      .limit(50);
    return rows;
  }

  private async capabilities(organizationId: string): Promise<CountBucket[]> {
    const rows = await this.database.db
      .select({ key: capabilities.key, name: capabilities.name, value: count(harnessAssets.id) })
      .from(capabilities)
      .leftJoin(harnessAssets, eq(harnessAssets.capabilityId, capabilities.id))
      .where(eq(capabilities.organizationId, organizationId))
      .groupBy(capabilities.key, capabilities.name);

    return topBuckets(
      rows.map((row) => ({ key: row.key, label: row.name, count: row.value })),
      20,
    );
  }

  /** §41. 갈래마다 신뢰도가 달라 한 숫자로 합치지 않는다. */
  private async contextEfficiency(organizationId: string, since: Date | null) {
    const rows = await this.database.db
      .select({
        candidateAssetCount: taskTraces.candidateAssetCount,
        selectedAssetCount: taskTraces.selectedAssetCount,
        estimatedInjectedTokens: taskTraces.estimatedInjectedTokens,
        clientReportedInputTokens: taskTraces.clientReportedInputTokens,
      })
      .from(taskTraces)
      .where(this.scoped(taskTraces.organizationId, organizationId, taskTraces.startedAt, since));

    return {
      averageCandidates: averageOf(rows.map((row) => row.candidateAssetCount)),
      averageSelected: averageOf(rows.map((row) => row.selectedAssetCount)),
      // 분모가 0인 흐름은 감축률을 만들지 않는다. 0%로 채우면 거짓 평균이 된다.
      averageReductionPercent: averageOf(
        rows.map((row) => contextReductionRatio(row.candidateAssetCount, row.selectedAssetCount)),
      ),
      averageInjectedTokens: averageOf(rows.map((row) => row.estimatedInjectedTokens)),
      // 모르는 흐름은 분모에서도 뺀다(§40).
      averageClientReportedInputTokens: averageOf(
        rows.map((row) => row.clientReportedInputTokens),
      ),
    };
  }

  private async outputContract(organizationId: string, since: Date | null) {
    const rows = await this.database.db
      .select({
        satisfied: taskTraces.outputContractSatisfied,
        missing: taskTraces.missingOutputFields,
      })
      .from(taskTraces)
      .where(
        and(
          this.scoped(taskTraces.organizationId, organizationId, taskTraces.startedAt, since),
          isNotNull(taskTraces.outputContractSatisfied),
        ),
      );

    const missed: string[] = [];
    for (const row of rows) {
      for (const field of row.missing ?? []) missed.push(field);
    }
    const satisfiedCount = rows.filter((row) => row.satisfied === true).length;

    return {
      completedTraces: rows.length,
      satisfiedCount,
      satisfiedRate: safeRatio(satisfiedCount, rows.length),
      mostMissedFields: topBuckets(tally(missed), 10),
    };
  }

  private async approvals(organizationId: string, since: Date | null) {
    const rows = await this.database.db
      .select({
        status: approvalRequests.status,
        requestedAt: approvalRequests.createdAt,
        decidedAt: approvalRequests.decidedAt,
      })
      .from(approvalRequests)
      .where(
        this.scoped(
          approvalRequests.organizationId,
          organizationId,
          approvalRequests.createdAt,
          since,
        ),
      );

    return {
      byStatus: tally(rows.map((row) => row.status)),
      // 판단되지 않은 요청은 분모에서 뺀다. 0초로 치면 평균이 무의미해진다.
      averageDecisionSeconds: averageOf(
        rows.map((row) =>
          row.decidedAt
            ? Math.round((row.decidedAt.getTime() - row.requestedAt.getTime()) / 1000)
            : null,
        ),
      ),
    };
  }

  private async contributions(organizationId: string, since: Date | null) {
    const rows = await this.database.db
      .select({
        status: contributions.status,
        duplicateOfAssetId: contributions.duplicateOfAssetId,
      })
      .from(contributions)
      .where(
        this.scoped(contributions.organizationId, organizationId, contributions.createdAt, since),
      );

    const promoted = rows.filter((row) => row.status === 'PROMOTED').length;
    return {
      byStatus: tally(rows.map((row) => row.status)),
      promotedRate: safeRatio(promoted, rows.length),
      duplicateFlaggedCount: rows.filter((row) => row.duplicateOfAssetId !== null).length,
    };
  }

  private async curator(organizationId: string, since: Date | null) {
    const rows = await this.database.db
      .select({
        status: curatorRuns.status,
        provider: curatorRuns.provider,
        verdict: curatorRuns.verdict,
        complexity: curatorRuns.complexity,
        durationMs: curatorRuns.durationMs,
      })
      .from(curatorRuns)
      .where(
        this.scoped(curatorRuns.organizationId, organizationId, curatorRuns.createdAt, since),
      );

    return {
      // 실패한 실행은 판정이 없다. null을 'UNKNOWN'으로 바꾸면 모델이 모른다고 한 것과 섞인다.
      byVerdict: tally(rows.flatMap((row) => (row.verdict === null ? [] : [row.verdict]))),
      // MOCK 비율을 숨기지 않는다(§72). 실제 모델이 얼마나 돌았는지가 보여야 한다.
      byProvider: tally(rows.map((row) => row.provider)),
      byComplexity: tally(rows.map((row) => row.complexity)),
      failedCount: rows.filter((row) => row.status === 'FAILED').length,
      totalRuns: rows.length,
      averageDurationMs: averageOf(rows.map((row) => row.durationMs)),
    };
  }

  /** 조직 한정 + 기간 한정. `days=0`이면 기간 제한이 없다. */
  private scoped(
    orgColumn: Parameters<typeof eq>[0],
    organizationId: string,
    timeColumn: Parameters<typeof gte>[0],
    since: Date | null,
  ) {
    return since
      ? and(eq(orgColumn, organizationId), gte(timeColumn, since))
      : eq(orgColumn, organizationId);
  }
}

/** 값 목록을 개수 버킷으로 바꾼다. 라벨은 값 그대로 — 번역은 화면이 한다. */
function tally(values: readonly string[]): CountBucket[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([key, value]) => ({ key, label: key, count: value }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}
