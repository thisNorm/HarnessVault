import type {
  AssetRelationType,
  AssetSelector,
  ExcludedAssetRef,
  HarnessAssetType,
  InheritanceMode,
  ResolutionConflict,
  ResolutionReasonCode,
  ResolvedAssetRef,
  ResolvedHarnessManifest,
  ResolvedOutputContract,
  ScopeType,
} from '@harnessvault/domain';

/**
 * 명세 §19의 16단계 중 5~15단계. IO가 없는 순수 함수다.
 * DB 로딩(1~4)과 Audit 기록(16)은 service가 맡는다.
 */

export interface CandidateVersion {
  id: string;
  version: string;
  estimatedTokens: number | null;
}

export interface CandidateAsset {
  id: string;
  key: string;
  name: string;
  type: HarnessAssetType;
  scopeType: ScopeType;
  scopeId: string;
  inheritanceMode: InheritanceMode;
  selector: AssetSelector;
  /** status가 ACTIVE인 버전만 담는다. 2개 이상이면 충돌이다. */
  activeVersions: CandidateVersion[];
}

export interface CandidateRelation {
  fromAssetId: string;
  toAssetId: string;
  type: AssetRelationType;
}

export interface ResolveContext {
  organizationId: string;
  userId: string;
  projectId: string | null;
  teamIds: string[];
  task: { description: string; domain: string[]; type: string[] };
  environment: {
    os?: string | null;
    runtime?: string | null;
    database?: string | null;
    environment?: string | null;
  };
  contextBudget: number | null;
}

export interface ResolveArgs {
  traceId: string;
  context: ResolveContext;
  candidates: CandidateAsset[];
  relations: CandidateRelation[];
  /** 산출물 계약은 자산 해석과 무관하다. 이미 병합된 값을 받아 그대로 싣는다. */
  outputContract?: ResolvedOutputContract | null;
}

export class ResolutionConflictError extends Error {
  readonly code = 'RESOLUTION_CONFLICT';

  constructor(readonly conflicts: ResolutionConflict[]) {
    super('Harness 해석 중 충돌이 발견되어 자동으로 선택하지 않습니다');
    this.name = 'ResolutionConflictError';
  }
}

const SCOPE_SPECIFICITY: Record<ScopeType, number> = {
  COMPANY: 0,
  TEAM: 1,
  PROJECT: 2,
  PERSONAL: 3,
};

/** 낮을수록 먼저 주입된다. */
const TYPE_WEIGHT: Record<HarnessAssetType, number> = {
  RULE: 0,
  POLICY: 1,
  VALIDATION: 2,
  WORKFLOW: 3,
  SKILL: 4,
  VARIANT: 5,
  SCRIPT: 6,
  TEMPLATE: 7,
  KNOWLEDGE: 8,
};

/** 예산을 이유로 빼면 안 되는 자산. */
function isMandatory(asset: CandidateAsset): boolean {
  return asset.inheritanceMode === 'LOCKED' || asset.type === 'RULE' || asset.type === 'POLICY';
}

interface Working {
  asset: CandidateAsset;
  reasonCode: ResolutionReasonCode;
  reason: string;
  /** selector가 실제로 맞춘 축의 수. 관련도 정렬에 쓴다. */
  matchCount: number;
}

function exclude(
  asset: CandidateAsset,
  reasonCode: ResolutionReasonCode,
  reason: string,
): ExcludedAssetRef {
  return {
    assetId: asset.id,
    key: asset.key,
    name: asset.name,
    type: asset.type,
    scope: asset.scopeType,
    reasonCode,
    reason,
  };
}

/* ---------------- 5단계: Scope 일치 ---------------- */

function scopeMatches(asset: CandidateAsset, context: ResolveContext): boolean {
  switch (asset.scopeType) {
    case 'COMPANY':
      return true;
    case 'TEAM':
      return context.teamIds.includes(asset.scopeId);
    case 'PROJECT':
      return context.projectId !== null && asset.scopeId === context.projectId;
    case 'PERSONAL':
      return asset.scopeId === context.userId;
  }
}

/* ---------------- 6단계: Selector 필터 ---------------- */

interface SelectorResult {
  matched: boolean;
  matchCount: number;
  failedAxis?: string;
}

function normalize(values: readonly string[]): string[] {
  return values.map((value) => value.trim().toLowerCase()).filter(Boolean);
}

/**
 * 선언된 축만 검사한다. 선언하지 않은 축은 조건 없음이다.
 *
 * 선언은 했는데 요청에 비교 대상이 없으면 **제외**한다.
 * "조건을 걸어 뒀는데 확인할 방법이 없다"를 통과로 처리하면
 * DB=SQLite 요청에 PostgreSQL Variant가 딸려 들어간다(§63 Case 4).
 */
function selectorMatches(asset: CandidateAsset, context: ResolveContext): SelectorResult {
  const selector = asset.selector ?? {};
  let matchCount = 0;

  const axes: Array<{ name: string; declared?: string[]; actual: string[] }> = [
    { name: 'domains', declared: selector.domains, actual: context.task.domain },
    { name: 'tasks', declared: selector.tasks, actual: context.task.type },
    { name: 'os', declared: selector.os, actual: [context.environment.os ?? ''] },
    { name: 'runtimes', declared: selector.runtimes, actual: [context.environment.runtime ?? ''] },
    {
      name: 'databases',
      declared: selector.databases,
      actual: [context.environment.database ?? ''],
    },
    {
      name: 'environments',
      declared: selector.environments,
      actual: [context.environment.environment ?? ''],
    },
    { name: 'projects', declared: selector.projects, actual: [context.projectId ?? ''] },
  ];

  for (const axis of axes) {
    if (!axis.declared || axis.declared.length === 0) continue;

    const declared = normalize(axis.declared);
    const actual = normalize(axis.actual);
    if (actual.length === 0) {
      return { matched: false, matchCount, failedAxis: axis.name };
    }
    if (!declared.some((value) => actual.includes(value))) {
      return { matched: false, matchCount, failedAxis: axis.name };
    }
    matchCount++;
  }

  // tags는 요청에 비교 대상이 없다. 명세에 입력 필드가 없으므로 검사하지 않는다.
  return { matched: true, matchCount };
}

/* ---------------- 11단계: 상속 semantics ---------------- */

interface InheritanceOutcome {
  kept: Working[];
  excluded: ExcludedAssetRef[];
}

function applyInheritance(working: Working[]): InheritanceOutcome {
  const groups = new Map<string, Working[]>();
  for (const item of working) {
    const group = groups.get(item.asset.key);
    if (group) group.push(item);
    else groups.set(item.asset.key, [item]);
  }

  const kept: Working[] = [];
  const excluded: ExcludedAssetRef[] = [];

  for (const [, group] of groups) {
    if (group.length === 1) {
      kept.push(...group);
      continue;
    }

    // 덜 구체적인 것부터 처리한다. 같은 스코프면 key로 안정 정렬한다.
    const ordered = [...group].sort(
      (a, b) =>
        SCOPE_SPECIFICITY[a.asset.scopeType] - SCOPE_SPECIFICITY[b.asset.scopeType] ||
        a.asset.id.localeCompare(b.asset.id),
    );

    const survivors: Working[] = [];
    for (const candidate of ordered) {
      const blocker = survivors.find(
        (existing) =>
          existing.asset.inheritanceMode === 'LOCKED' &&
          SCOPE_SPECIFICITY[existing.asset.scopeType] <
            SCOPE_SPECIFICITY[candidate.asset.scopeType],
      );

      if (blocker) {
        excluded.push(
          exclude(
            candidate.asset,
            'LOCKED_BY_PARENT',
            `${blocker.asset.scopeType} 스코프의 LOCKED 자산이 있어 하위 스코프가 대체할 수 없습니다`,
          ),
        );
        continue;
      }

      // 덜 구체적인 자산 중 OVERRIDABLE·DEFAULT는 이 자산에 자리를 내준다.
      for (let index = survivors.length - 1; index >= 0; index--) {
        const existing = survivors[index];
        if (!existing) continue;
        if (
          SCOPE_SPECIFICITY[existing.asset.scopeType] >=
          SCOPE_SPECIFICITY[candidate.asset.scopeType]
        ) {
          continue;
        }
        if (existing.asset.inheritanceMode === 'EXTENDABLE') continue;

        survivors.splice(index, 1);
        excluded.push(
          exclude(
            existing.asset,
            existing.asset.inheritanceMode === 'OVERRIDABLE'
              ? 'OVERRIDDEN_BY_CHILD'
              : 'DEFAULT_SUPERSEDED',
            existing.asset.inheritanceMode === 'OVERRIDABLE'
              ? `${candidate.asset.scopeType} 스코프 자산이 대체했습니다`
              : `기본값이므로 ${candidate.asset.scopeType} 스코프 자산이 우선합니다`,
          ),
        );
      }

      survivors.push(candidate);
    }

    kept.push(...survivors);
  }

  return { kept, excluded };
}

/* ---------------- 13단계: Priority ---------------- */

function comparePriority(a: Working, b: Working): number {
  const mandatoryDiff = Number(isMandatory(b.asset)) - Number(isMandatory(a.asset));
  if (mandatoryDiff !== 0) return mandatoryDiff;

  const typeDiff = TYPE_WEIGHT[a.asset.type] - TYPE_WEIGHT[b.asset.type];
  if (typeDiff !== 0) return typeDiff;

  const scopeDiff =
    SCOPE_SPECIFICITY[b.asset.scopeType] - SCOPE_SPECIFICITY[a.asset.scopeType];
  if (scopeDiff !== 0) return scopeDiff;

  const matchDiff = b.matchCount - a.matchCount;
  if (matchDiff !== 0) return matchDiff;

  return a.asset.key.localeCompare(b.asset.key);
}

/* ---------------- 본체 ---------------- */

export function resolveHarness(args: ResolveArgs): ResolvedHarnessManifest {
  const { context, candidates, relations, traceId } = args;
  const excluded: ExcludedAssetRef[] = [];
  const byId = new Map(candidates.map((asset) => [asset.id, asset]));

  // 5 · 6단계
  let working: Working[] = [];
  for (const asset of candidates) {
    if (!scopeMatches(asset, context)) {
      excluded.push(
        exclude(asset, 'SCOPE_MISMATCH', `${asset.scopeType} 스코프가 현재 컨텍스트와 맞지 않습니다`),
      );
      continue;
    }
    if (asset.activeVersions.length === 0) {
      excluded.push(exclude(asset, 'NO_ACTIVE_VERSION', 'ACTIVE 버전이 없습니다'));
      continue;
    }

    const selector = selectorMatches(asset, context);
    if (!selector.matched) {
      // 7단계 — LOCKED은 selector와 무관하게 유지한다. 회사 필수 규칙은 빠질 수 없다.
      if (asset.inheritanceMode === 'LOCKED') {
        working.push({
          asset,
          reasonCode: 'MANDATORY_LOCKED',
          reason: 'LOCKED 자산이라 조건과 무관하게 포함됩니다',
          matchCount: selector.matchCount,
        });
        continue;
      }
      excluded.push(
        exclude(
          asset,
          'SELECTOR_MISMATCH',
          `selector의 ${selector.failedAxis} 조건이 현재 컨텍스트와 맞지 않습니다`,
        ),
      );
      continue;
    }

    working.push({
      asset,
      reasonCode: isMandatory(asset) ? 'MANDATORY_LOCKED' : 'SCOPE_MATCH',
      reason: isMandatory(asset)
        ? '필수 자산입니다'
        : `${asset.scopeType} 스코프와 작업 조건에 맞습니다`,
      matchCount: selector.matchCount,
    });
  }

  // 8단계 — 명시적 의존성은 selector 추론보다 강한 신호다.
  const selectedIds = new Set(working.map((item) => item.asset.id));
  for (const relation of relations) {
    if (relation.type !== 'DEPENDS_ON') continue;
    if (!selectedIds.has(relation.fromAssetId)) continue;
    if (selectedIds.has(relation.toAssetId)) continue;

    const target = byId.get(relation.toAssetId);
    if (!target || target.activeVersions.length === 0) continue;
    if (!scopeMatches(target, context)) continue;

    const source = byId.get(relation.fromAssetId);
    working.push({
      asset: target,
      reasonCode: 'DEPENDENCY',
      reason: `${source?.key ?? '선택된 자산'}이(가) 의존하므로 포함됩니다`,
      matchCount: 0,
    });
    selectedIds.add(target.id);
    // 제외 목록에 먼저 올라갔다면 되돌린다.
    const staleIndex = excluded.findIndex((item) => item.assetId === target.id);
    if (staleIndex >= 0) excluded.splice(staleIndex, 1);
  }

  // 11단계
  const inheritance = applyInheritance(working);
  working = inheritance.kept;
  excluded.push(...inheritance.excluded);

  // 9단계 — core가 빠졌으면 Variant도 붙을 곳이 없다.
  const keptIds = new Set(working.map((item) => item.asset.id));
  const variantTargets = new Map<string, string>();
  for (const relation of relations) {
    if (relation.type === 'VARIANT_OF') variantTargets.set(relation.fromAssetId, relation.toAssetId);
  }
  working = working.filter((item) => {
    const coreId = variantTargets.get(item.asset.id);
    if (!coreId || keptIds.has(coreId)) {
      if (coreId) item.reasonCode = 'VARIANT_MATCH';
      return true;
    }
    excluded.push(
      exclude(
        item.asset,
        'VARIANT_CORE_NOT_SELECTED',
        `기반 자산 ${byId.get(coreId)?.key ?? coreId}이(가) 선택되지 않았습니다`,
      ),
    );
    return false;
  });

  // 10단계 — 자동 선택하지 않고 실패한다.
  const conflicts: ResolutionConflict[] = [];
  const finalIds = new Set(working.map((item) => item.asset.id));
  for (const item of working) {
    if (item.asset.activeVersions.length > 1) {
      conflicts.push({
        kind: 'MULTIPLE_ACTIVE_VERSIONS',
        assetId: item.asset.id,
        key: item.asset.key,
        detail: `ACTIVE 버전이 ${item.asset.activeVersions.length}개입니다: ${item.asset.activeVersions
          .map((version) => version.version)
          .join(', ')}`,
      });
    }
  }
  for (const relation of relations) {
    if (relation.type !== 'CONFLICTS_WITH') continue;
    if (!finalIds.has(relation.fromAssetId) || !finalIds.has(relation.toAssetId)) continue;
    const from = byId.get(relation.fromAssetId);
    const to = byId.get(relation.toAssetId);
    conflicts.push({
      kind: 'CONFLICTS_WITH',
      assetId: relation.fromAssetId,
      key: from?.key ?? relation.fromAssetId,
      detail: `${from?.key ?? relation.fromAssetId}와(과) ${to?.key ?? relation.toAssetId}는 함께 쓸 수 없습니다`,
    });
  }
  if (conflicts.length > 0) throw new ResolutionConflictError(conflicts);

  // 12 · 13단계
  working.sort(comparePriority);
  const refs: ResolvedAssetRef[] = working.map((item) => {
    const version = item.asset.activeVersions[0];
    if (!version) throw new Error(`ACTIVE 버전 없이 선택된 자산: ${item.asset.key}`);
    return {
      assetId: item.asset.id,
      versionId: version.id,
      key: item.asset.key,
      name: item.asset.name,
      type: item.asset.type,
      version: version.version,
      scope: item.asset.scopeType,
      inheritanceMode: item.asset.inheritanceMode,
      reasonCode: item.reasonCode,
      reason: item.reason,
      mandatory: isMandatory(item.asset),
      estimatedTokens: version.estimatedTokens ?? 0,
    };
  });

  // 14단계 — mandatory는 예산을 이유로 빼지 않는다.
  const budget = context.contextBudget ?? null;
  const mandatory = refs.filter((ref) => ref.mandatory);
  const optional = refs.filter((ref) => !ref.mandatory);

  let selected = refs;
  let budgetExceededByMandatory = false;

  if (budget !== null) {
    const mandatoryTokens = mandatory.reduce((sum, ref) => sum + ref.estimatedTokens, 0);
    budgetExceededByMandatory = mandatoryTokens > budget;

    const fitted = [...mandatory];
    let used = mandatoryTokens;
    for (const ref of optional) {
      if (used + ref.estimatedTokens <= budget) {
        fitted.push(ref);
        used += ref.estimatedTokens;
        continue;
      }
      excluded.push({
        assetId: ref.assetId,
        key: ref.key,
        name: ref.name,
        type: ref.type,
        scope: ref.scope,
        reasonCode: 'CONTEXT_BUDGET_EXCEEDED',
        reason: `추정 ${ref.estimatedTokens} 토큰이 남은 예산을 넘습니다`,
      });
    }
    fitted.sort(comparePriorityRefs);
    selected = fitted;
  }

  const injected = selected.reduce((sum, ref) => sum + ref.estimatedTokens, 0);
  const pick = (type: HarnessAssetType) => selected.filter((ref) => ref.type === type);

  return {
    traceId,
    organizationId: context.organizationId,
    userId: context.userId,
    projectId: context.projectId,

    rules: pick('RULE'),
    policies: pick('POLICY'),
    validations: pick('VALIDATION'),
    workflows: pick('WORKFLOW'),
    skills: pick('SKILL'),
    variants: pick('VARIANT'),
    scripts: pick('SCRIPT'),
    templates: pick('TEMPLATE'),
    knowledge: pick('KNOWLEDGE'),

    outputContract: args.outputContract ?? null,

    excluded,
    resolution: {
      candidateCount: candidates.length,
      selectedCount: selected.length,
      excludedCount: excluded.length,
      estimatedAvailableTokens: budget,
      estimatedInjectedTokens: injected,
      budgetExceededByMandatory,
    },
  };
}

/** 예산 적용 후 다시 정렬할 때 쓴다. 이미 ref로 변환된 뒤라 별도 비교자가 필요하다. */
function comparePriorityRefs(a: ResolvedAssetRef, b: ResolvedAssetRef): number {
  const mandatoryDiff = Number(b.mandatory) - Number(a.mandatory);
  if (mandatoryDiff !== 0) return mandatoryDiff;
  const typeDiff = TYPE_WEIGHT[a.type] - TYPE_WEIGHT[b.type];
  if (typeDiff !== 0) return typeDiff;
  const scopeDiff = SCOPE_SPECIFICITY[b.scope] - SCOPE_SPECIFICITY[a.scope];
  if (scopeDiff !== 0) return scopeDiff;
  return a.key.localeCompare(b.key);
}
