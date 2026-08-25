import { z } from 'zod';
import { assetKeySchema, harnessAssetTypeSchema, scopeTypeSchema } from './harness';

export const contributionStatuses = [
  'CANDIDATE',
  'PROMOTED',
  'REJECTED',
  'WITHDRAWN',
] as const;
export const contributionStatusSchema = z.enum(contributionStatuses);
export type ContributionStatus = z.infer<typeof contributionStatusSchema>;

/** 중복 탐색이 실제로 무엇으로 돌았는지. 의미 검색인 척하지 않기 위해 응답에 싣는다. */
export const similarityMethods = ['VECTOR', 'LEXICAL'] as const;
export const similarityMethodSchema = z.enum(similarityMethods);
export type SimilarityMethod = z.infer<typeof similarityMethodSchema>;

export const embeddingStatuses = ['NOT_CONFIGURED', 'OK', 'FAILED'] as const;
export const embeddingStatusSchema = z.enum(embeddingStatuses);
export type EmbeddingStatus = z.infer<typeof embeddingStatusSchema>;

/**
 * 임베딩 차원. 컬럼 DDL이 차원을 요구하므로 코드와 스키마가 같이 움직여야 한다.
 * 다른 차원의 모델을 붙이면 저장을 거부한다 — 잘라 넣으면 유사도가 조용히 망가진다.
 */
export const EMBEDDING_DIMENSIONS = 768;

/** 이 점수 이상이면 "같은 것을 또 만들고 있다"고 본다. */
export const DUPLICATE_THRESHOLD = 0.75;
/** 이 점수 미만은 후보로 보여 주지 않는다. 소음이 된다. */
export const RELATED_THRESHOLD = 0.2;

export const contributeInputSchema = z.object({
  type: harnessAssetTypeSchema,
  proposedKey: assetKeySchema,
  name: z.string().min(1).max(200),
  description: z.string().max(4000).default(''),
  summary: z.string().max(1000).default(''),
  /** Source of Truth. 렌더링 결과가 아니라 구조화된 본문을 받는다(§11). */
  structuredContent: z.record(z.string(), z.unknown()),
  capabilityId: z.uuid().optional(),
  proposedScopeType: scopeTypeSchema.default('PERSONAL'),
  proposedScopeId: z.uuid().optional(),
  /** 어느 작업에서 나온 지식인지. 없으면 흐름에 묶이지 않는다 — 서버가 추측하지 않는다. */
  traceId: z.uuid().optional(),
  rationale: z.string().max(2000).default(''),
});
export type ContributeInput = z.infer<typeof contributeInputSchema>;

export const promoteContributionInputSchema = z.object({
  /** 주면 그 자산의 새 버전이 된다. 없으면 새 자산을 만든다. */
  targetAssetId: z.uuid().optional(),
  /** 제출자가 제안한 범위를 검토자가 덮어쓴다. */
  scopeType: scopeTypeSchema.optional(),
  scopeId: z.uuid().optional(),
  key: assetKeySchema.optional(),
  note: z.string().max(2000).default(''),
});
export type PromoteContributionInput = z.infer<typeof promoteContributionInputSchema>;

export const rejectContributionInputSchema = z.object({
  /** 거절에는 이유가 필요하다. 이유 없는 거절은 같은 기여를 다시 부른다. */
  note: z.string().min(1).max(2000),
});

export interface SimilarCandidate {
  assetId: string;
  key: string;
  name: string;
  score: number;
  relationHint: 'DUPLICATE_CANDIDATE' | 'RELATED';
}

export interface ContributionSummary {
  id: string;
  status: ContributionStatus;
  type: string;
  proposedKey: string;
  name: string;
  description: string;
  summary: string;
  rationale: string;
  proposedScopeType: string;
  proposedScopeId: string | null;
  capabilityId: string | null;
  submittedByUserId: string;
  submittedByDisplayName: string;
  traceId: string | null;
  duplicateOfAssetId: string | null;
  duplicateScore: number | null;
  similarityMethod: SimilarityMethod;
  embeddingStatus: EmbeddingStatus;
  reviewedByUserId: string | null;
  reviewedByDisplayName: string | null;
  reviewedAt: string | null;
  reviewNote: string;
  promotedAssetId: string | null;
  promotedVersionId: string | null;
  createdAt: string;
}

const TRANSITIONS: Record<ContributionStatus, readonly ContributionStatus[]> = {
  CANDIDATE: ['PROMOTED', 'REJECTED', 'WITHDRAWN'],
  // 터미널에서 나가는 길은 없다. 승격을 되돌리려면 자산 쪽에서 폐기한다.
  PROMOTED: [],
  REJECTED: [],
  WITHDRAWN: [],
};

export function canTransitionContribution(
  from: ContributionStatus,
  to: ContributionStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * 코사인 유사도. 길이가 다르면 0을 주지 않고 던진다 —
 * 모델을 바꿨을 때 "닮은 게 없다"로 위장되면 원인을 찾을 수 없다.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new Error(`벡터 차원이 다릅니다: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const left = a[i] as number;
    const right = b[i] as number;
    dot += left * right;
    normA += left * left;
    normB += right * right;
  }
  if (normA === 0 || normB === 0) return 0;
  const value = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  // 부동소수 오차로 1을 넘길 수 있다. 점수 범위를 벗어나면 임계값 비교가 흔들린다.
  return Math.round(Math.min(1, Math.max(-1, value)) * 1000) / 1000;
}

export interface ScoredAsset {
  assetId: string;
  key: string;
  name: string;
  score: number;
}

/** 점수를 후보 목록으로 바꾼다. 임계값 미만은 아예 내보내지 않는다. */
export function classifyDuplicates(
  scored: readonly ScoredAsset[],
  limit = 10,
): SimilarCandidate[] {
  return scored
    .filter((item) => item.score >= RELATED_THRESHOLD)
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
    .slice(0, limit)
    .map((item) => ({
      assetId: item.assetId,
      key: item.key,
      name: item.name,
      score: item.score,
      relationHint:
        item.score >= DUPLICATE_THRESHOLD
          ? ('DUPLICATE_CANDIDATE' as const)
          : ('RELATED' as const),
    }));
}

/**
 * 기존 버전 목록에서 다음 라벨을 만든다. `1.0.0` 형태만 다룬다.
 * 형식을 벗어난 라벨이 섞여 있으면 무시한다 — 손으로 붙인 이름을 근거로 자동 증가시키면
 * 예측할 수 없는 버전이 생긴다.
 */
export function nextVersionLabel(existing: readonly string[]): string {
  let maxMajor = 0;
  for (const label of existing) {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(label);
    if (match) maxMajor = Math.max(maxMajor, Number(match[1]));
  }
  return `${maxMajor + 1}.0.0`;
}
