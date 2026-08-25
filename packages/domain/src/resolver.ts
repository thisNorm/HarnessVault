import { z } from 'zod';
import type { HarnessAssetType, InheritanceMode, ScopeType } from './harness';
import type { ResolvedOutputContract } from './output-contract';

export const resolveTaskInputSchema = z.object({
  projectId: z.uuid().nullish(),
  task: z.object({
    description: z.string().min(1).max(4000),
    domain: z.array(z.string().min(1)).default([]),
    type: z.array(z.string().min(1)).default([]),
  }),
  environment: z
    .object({
      os: z.string().min(1).nullish(),
      runtime: z.string().min(1).nullish(),
      database: z.string().min(1).nullish(),
      environment: z.string().min(1).nullish(),
    })
    .default({}),
  client: z
    .object({
      name: z.string().min(1).max(100),
      version: z.string().max(50).nullish(),
      /** 클라이언트가 스스로 보고한 값이다. 신뢰하지 않고 기록만 한다. */
      model: z.string().max(100).nullish(),
    })
    .nullish(),
  contextBudget: z.coerce.number().int().positive().max(2_000_000).nullish(),
});

export type ResolveTaskInput = z.infer<typeof resolveTaskInputSchema>;

/** 자산이 선택되거나 제외된 이유. 사람이 읽는 문구는 서버가 만든다. */
export type ResolutionReasonCode =
  | 'SCOPE_MATCH'
  | 'MANDATORY_LOCKED'
  | 'DEPENDENCY'
  | 'VARIANT_MATCH'
  | 'SCOPE_MISMATCH'
  | 'SELECTOR_MISMATCH'
  | 'NO_ACTIVE_VERSION'
  | 'LOCKED_BY_PARENT'
  | 'OVERRIDDEN_BY_CHILD'
  | 'DEFAULT_SUPERSEDED'
  | 'VARIANT_CORE_NOT_SELECTED'
  | 'CONTEXT_BUDGET_EXCEEDED';

export interface ResolvedAssetRef {
  assetId: string;
  versionId: string;
  key: string;
  name: string;
  type: HarnessAssetType;
  version: string;
  scope: ScopeType;
  inheritanceMode: InheritanceMode;
  reasonCode: ResolutionReasonCode;
  reason: string;
  mandatory: boolean;
  /** 추정치다. 실측 토큰 사용량이 아니다. */
  estimatedTokens: number;
}

export interface ExcludedAssetRef {
  assetId: string;
  key: string;
  name: string;
  type: HarnessAssetType;
  scope: ScopeType;
  reasonCode: ResolutionReasonCode;
  reason: string;
}

export interface ResolutionStats {
  candidateCount: number;
  selectedCount: number;
  excludedCount: number;
  estimatedAvailableTokens: number | null;
  estimatedInjectedTokens: number;
  /** mandatory만으로 예산을 넘긴 경우. 사실을 숨기지 않고 그대로 알린다. */
  budgetExceededByMandatory: boolean;
}

export interface ResolvedHarnessManifest {
  traceId: string;
  organizationId: string;
  userId: string;
  projectId: string | null;

  rules: ResolvedAssetRef[];
  policies: ResolvedAssetRef[];
  validations: ResolvedAssetRef[];
  workflows: ResolvedAssetRef[];
  skills: ResolvedAssetRef[];
  /** §20에 자리가 없지만 §11.1이 정의한 타입이다. 빠뜨리면 선택된 자산이 사라진다. */
  variants: ResolvedAssetRef[];
  scripts: ResolvedAssetRef[];
  templates: ResolvedAssetRef[];
  knowledge: ResolvedAssetRef[];

  /**
   * 적용되는 산출물 계약(§36). 계약이 하나도 없으면 `requiredFields: []`다.
   * 해석하지 못한 경우에만 null이다 — 빈 계약과 "모른다"를 구분한다.
   */
  outputContract: ResolvedOutputContract | null;

  excluded: ExcludedAssetRef[];
  resolution: ResolutionStats;
}

export interface ResolutionConflict {
  kind: 'MULTIPLE_ACTIVE_VERSIONS' | 'CONFLICTS_WITH';
  assetId: string;
  key: string;
  detail: string;
}
