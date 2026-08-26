/**
 * §57 — 개인별 생산성 점수를 만들지 않는다.
 *
 * 원칙이 주석으로만 있으면 다음 사람이 "그냥 참고용인데" 하며 추가한다.
 * 그래서 집계를 사용자로 그룹핑하지 않는 것을 규칙으로 삼고, 응답 형태로 못 박는다 —
 * 아래 어떤 타입에도 사용자 식별자 필드가 없다.
 */

export interface CountBucket {
  key: string;
  label: string;
  count: number;
}

export interface AssetUsageRow {
  assetId: string;
  key: string;
  name: string;
  type: string;
  scope: string;
  selectedCount: number;
  excludedCount: number;
  /** 후보에 오른 횟수 대비 선택 비율. 분모가 0이면 null이다. */
  selectionRate: number | null;
  topExclusionReason: string | null;
}

/** 갈래마다 신뢰도가 다르므로 한 숫자로 합치지 않는다(§40). */
export interface AverageWithSampleSize {
  value: number | null;
  /** 몇 건이 실제로 집계에 들어갔는지. NULL인 흐름은 분모에서도 뺐다. */
  sampleSize: number;
  /** 대상이 될 수 있었던 전체 건수. sampleSize와 다르면 모르는 값이 있었다는 뜻이다. */
  totalCandidates: number;
}

export interface AnalyticsOverview {
  days: number | null;
  assetsByType: CountBucket[];
  assetsByScope: CountBucket[];
  assetsByStatus: CountBucket[];
  totalAssets: number;
  totalTraces: number;
  totalContributions: number;
}

export interface ContextEfficiency {
  /** 후보 → 선택 평균. 추정치 기반이다. */
  averageCandidates: AverageWithSampleSize;
  averageSelected: AverageWithSampleSize;
  averageReductionPercent: AverageWithSampleSize;
  /** 추정 주입 토큰. 실측이 아니다. */
  averageInjectedTokens: AverageWithSampleSize;
  /** 클라이언트 자가 보고. 모르는 흐름은 분모에서 뺐다(§40). */
  averageClientReportedInputTokens: AverageWithSampleSize;
}

export interface OutputContractStats {
  completedTraces: number;
  satisfiedCount: number;
  /** 분모가 0이면 null이다. 0%로 표시하면 거짓이다. */
  satisfiedRate: number | null;
  mostMissedFields: CountBucket[];
}

export interface ApprovalStats {
  byStatus: CountBucket[];
  /** 요청부터 판단까지. 판단되지 않은 요청은 분모에서 뺐다. */
  averageDecisionSeconds: AverageWithSampleSize;
}

export interface ContributionStats {
  byStatus: CountBucket[];
  promotedRate: number | null;
  duplicateFlaggedCount: number;
}

export interface CuratorStats {
  byVerdict: CountBucket[];
  /** MOCK 비율을 숨기지 않는다(§72). 실제 모델이 얼마나 돌았는지가 보여야 한다. */
  byProvider: CountBucket[];
  byComplexity: CountBucket[];
  failedCount: number;
  totalRuns: number;
  averageDurationMs: AverageWithSampleSize;
}

export interface AnalyticsBundle {
  overview: AnalyticsOverview;
  assetUsage: AssetUsageRow[];
  /** 기간 안에 한 번도 주입되지 않은 ACTIVE 자산. 후보에는 올랐어도 매번 밀린 것을 포함한다. */
  unusedAssets: Array<{ assetId: string; key: string; name: string; type: string }>;
  capabilities: CountBucket[];
  contextEfficiency: ContextEfficiency;
  outputContract: OutputContractStats;
  approvals: ApprovalStats;
  contributions: ContributionStats;
  curator: CuratorStats;
}

/** 분모가 0이면 비율을 내지 않는다. 0을 돌려주면 "전부 실패"와 구분되지 않는다. */
export function safeRatio(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 1000) / 1000;
}

/**
 * null을 건너뛰고 평균을 낸다. **0으로 치환하지 않는다** —
 * 모르는 값을 0으로 바꾸면 평균이 조용히 낮아진다(§40).
 * 몇 건이 실제로 들어갔는지 함께 돌려주어 호출자가 신뢰도를 알 수 있게 한다.
 */
export function averageOf(values: readonly (number | null | undefined)[]): AverageWithSampleSize {
  const known = values.filter((value): value is number => typeof value === 'number');
  if (known.length === 0) {
    return { value: null, sampleSize: 0, totalCandidates: values.length };
  }
  const sum = known.reduce((total, value) => total + value, 0);
  return {
    value: Math.round((sum / known.length) * 100) / 100,
    sampleSize: known.length,
    totalCandidates: values.length,
  };
}

/** 집계를 표시용으로 정렬하고 상위 N만 남긴다. 동점은 key로 갈라 결정론을 지킨다. */
export function topBuckets(buckets: readonly CountBucket[], limit: number): CountBucket[] {
  return buckets
    .slice()
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}
