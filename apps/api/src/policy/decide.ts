import type {
  InheritanceMode,
  OrganizationRole,
  PolicyDecision,
  PolicyEffect,
  ResourceAction,
  ResourceClassification,
  ResourceType,
  ScopeType,
} from '@harnessvault/domain';

/**
 * 정책 판정. IO가 없는 순수 함수다.
 * "판정하지 않음"이라는 상태를 남기지 않는다 — 반드시 세 값 중 하나가 나온다.
 */

export interface PolicyRow {
  id: string;
  name: string;
  effect: PolicyEffect;
  scopeType: ScopeType;
  scopeId: string;
  inheritanceMode: InheritanceMode;

  resourceId: string | null;
  resourceType: ResourceType | null;
  classification: ResourceClassification | null;
  actions: string[];
  subjectOrgRole: OrganizationRole | null;
  subjectGroupId: string | null;

  approvalPolicyId: string | null;
  enabled: boolean;
}

export interface PolicyContext {
  organizationId: string;
  userId: string;
  teamIds: string[];
  groupIds: string[];
  projectId: string | null;
  orgRole: OrganizationRole;

  resourceId: string;
  resourceType: ResourceType;
  classification: ResourceClassification;
  action: ResourceAction;
}

const SCOPE_SPECIFICITY: Record<ScopeType, number> = {
  COMPANY: 0,
  TEAM: 1,
  PROJECT: 2,
  PERSONAL: 3,
};

/** 심각한 것이 이긴다. 구체적인 스코프가 심각도를 이기지 않는다(§30). */
const EFFECT_SEVERITY: Record<PolicyEffect, number> = {
  ALLOW: 0,
  APPROVAL_REQUIRED: 1,
  DENY: 2,
};

/** 스코프 매칭은 Resolver와 같은 규약이다. */
function scopeMatches(policy: PolicyRow, context: PolicyContext): boolean {
  switch (policy.scopeType) {
    case 'COMPANY':
      return true;
    case 'TEAM':
      return context.teamIds.includes(policy.scopeId);
    case 'PROJECT':
      return context.projectId !== null && policy.scopeId === context.projectId;
    case 'PERSONAL':
      return policy.scopeId === context.userId;
  }
}

/** 선언하지 않은 조건은 "무엇이든"이다. Selector와 같은 규약을 쓴다. */
export function policyMatches(policy: PolicyRow, context: PolicyContext): boolean {
  if (!policy.enabled) return false;
  if (!scopeMatches(policy, context)) return false;

  if (policy.resourceId !== null && policy.resourceId !== context.resourceId) return false;
  if (policy.resourceType !== null && policy.resourceType !== context.resourceType) return false;
  if (policy.classification !== null && policy.classification !== context.classification) {
    return false;
  }
  if (!policy.actions.includes('*') && !policy.actions.includes(context.action)) return false;
  if (policy.subjectOrgRole !== null && policy.subjectOrgRole !== context.orgRole) return false;
  if (policy.subjectGroupId !== null && !context.groupIds.includes(policy.subjectGroupId)) {
    return false;
  }

  return true;
}

export interface DecisionResult {
  decision: PolicyDecision;
  /** 어떤 정책이 LOCKED 때문에 판정에서 빠졌는지. 콘솔이 사람에게 보여준다. */
  blockedByLocked: string[];
}

export function decidePolicy(policies: readonly PolicyRow[], context: PolicyContext): DecisionResult {
  const matched = policies.filter((policy) => policyMatches(policy, context));

  if (matched.length === 0) {
    // 거버넌스 제품에서 "규칙이 없으니 허용"은 사고의 지름길이다.
    return {
      decision: {
        decision: 'DENY',
        policyIds: [],
        reasonCode: 'NO_POLICY_MATCHED',
        reason: '이 Action에 적용되는 정책이 없습니다',
      },
      blockedByLocked: [],
    };
  }

  // LOCKED 정책이 있는 가장 덜 구체적인 스코프를 찾는다.
  // 그보다 구체적인 스코프의 정책은 "하위가 바꿀 수 없다"는 규칙에 따라 판정에서 빠진다(§10).
  const lockedLevels = matched
    .filter((policy) => policy.inheritanceMode === 'LOCKED')
    .map((policy) => SCOPE_SPECIFICITY[policy.scopeType]);

  let effective = matched;
  const blockedByLocked: string[] = [];

  if (lockedLevels.length > 0) {
    const lockLevel = Math.min(...lockedLevels);
    effective = [];
    for (const policy of matched) {
      if (SCOPE_SPECIFICITY[policy.scopeType] > lockLevel) blockedByLocked.push(policy.id);
      else effective.push(policy);
    }
  }

  // 심각도 우선순위 — DENY > APPROVAL_REQUIRED > ALLOW.
  let winner: PolicyEffect = 'ALLOW';
  for (const policy of effective) {
    if (EFFECT_SEVERITY[policy.effect] > EFFECT_SEVERITY[winner]) winner = policy.effect;
  }

  // 결정론을 위해 정렬한다. 같은 판정을 낸 정책이 여럿이면 id 오름차순.
  const deciding = effective
    .filter((policy) => policy.effect === winner)
    .sort((a, b) => a.id.localeCompare(b.id));
  const policyIds = deciding.map((policy) => policy.id);
  const names = deciding.map((policy) => policy.name).join(', ');

  if (winner === 'DENY') {
    return {
      decision: {
        decision: 'DENY',
        policyIds,
        reasonCode: 'EXPLICIT_DENY',
        reason: `정책이 거부했습니다: ${names}`,
      },
      blockedByLocked,
    };
  }

  if (winner === 'APPROVAL_REQUIRED') {
    return {
      decision: {
        decision: 'APPROVAL_REQUIRED',
        policyIds,
        // 승인자 해석은 Phase 8이다. 빈 배열을 주면 "승인자가 없다"는 거짓 진술이 된다.
        approvalPolicyId: deciding.find((policy) => policy.approvalPolicyId)?.approvalPolicyId ?? null,
        reason: `사람 승인이 필요합니다: ${names}`,
      },
      blockedByLocked,
    };
  }

  return {
    decision: {
      decision: 'ALLOW',
      policyIds,
      reason: `정책이 허용했습니다: ${names}`,
    },
    blockedByLocked,
  };
}
