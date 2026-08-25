import { describe, expect, it } from 'vitest';
import type { InheritanceMode, PolicyEffect, ScopeType } from '@harnessvault/domain';
import { type PolicyContext, type PolicyRow, decidePolicy, policyMatches } from './decide';

const ORG = 'org-1';
const USER = 'user-1';
const TEAM = 'team-1';
const PROJECT = 'project-1';
const GROUP = 'group-1';
const RESOURCE = 'resource-1';

let seq = 0;

function policy(
  effect: PolicyEffect,
  scopeType: ScopeType,
  overrides: Partial<PolicyRow> = {},
): PolicyRow {
  seq++;
  const scopeId =
    overrides.scopeId ?? { COMPANY: ORG, TEAM, PROJECT, PERSONAL: USER }[scopeType];
  return {
    id: overrides.id ?? `policy-${String(seq).padStart(2, '0')}`,
    name: `${effect}@${scopeType}`,
    effect,
    scopeType,
    scopeId,
    inheritanceMode: (overrides.inheritanceMode ?? 'DEFAULT') as InheritanceMode,
    resourceId: null,
    resourceType: null,
    classification: null,
    actions: ['*'],
    subjectOrgRole: null,
    subjectGroupId: null,
    approvalPolicyId: null,
    enabled: true,
    ...overrides,
  };
}

function context(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    organizationId: ORG,
    userId: USER,
    teamIds: [TEAM],
    groupIds: [GROUP],
    projectId: PROJECT,
    orgRole: 'ORG_MEMBER',
    resourceId: RESOURCE,
    resourceType: 'DATABASE',
    classification: 'RESTRICTED',
    action: 'db.query',
    ...overrides,
  };
}

/* ================= §64 필수 케이스 ================= */

describe('§64 — Company LOCKED DENY + Project ALLOW', () => {
  const policies = [
    policy('DENY', 'COMPANY', { inheritanceMode: 'LOCKED' }),
    policy('ALLOW', 'PROJECT'),
  ];

  it('DENY가 된다', () => {
    expect(decidePolicy(policies, context()).decision.decision).toBe('DENY');
  });

  it('Project 정책이 LOCKED 때문에 빠졌음을 알려준다', () => {
    const result = decidePolicy(policies, context());
    expect(result.blockedByLocked).toHaveLength(1);
  });

  it('어떤 정책이 거부했는지 밝힌다', () => {
    const decision = decidePolicy(policies, context()).decision;
    expect(decision.policyIds).toHaveLength(1);
    if (decision.decision !== 'DENY') expect.unreachable('DENY가 아니다');
    expect(decision.reasonCode).toBe('EXPLICIT_DENY');
  });
});

describe('§64 — ALLOW + APPROVAL_REQUIRED', () => {
  it('APPROVAL_REQUIRED가 된다', () => {
    const policies = [policy('ALLOW', 'COMPANY'), policy('APPROVAL_REQUIRED', 'PROJECT')];
    expect(decidePolicy(policies, context()).decision.decision).toBe('APPROVAL_REQUIRED');
  });

  it('스코프 순서를 바꿔도 같다 — 심각도가 이긴다', () => {
    const policies = [policy('APPROVAL_REQUIRED', 'COMPANY'), policy('ALLOW', 'PROJECT')];
    expect(decidePolicy(policies, context()).decision.decision).toBe('APPROVAL_REQUIRED');
  });

  it('approvalPolicyId를 전달한다', () => {
    const policies = [
      policy('ALLOW', 'COMPANY'),
      policy('APPROVAL_REQUIRED', 'PROJECT', { approvalPolicyId: 'approval-1' }),
    ];
    const decision = decidePolicy(policies, context()).decision;
    if (decision.decision !== 'APPROVAL_REQUIRED') expect.unreachable('APPROVAL이 아니다');
    expect(decision.approvalPolicyId).toBe('approval-1');
  });

  it('승인 계약이 없으면 null이다 — 빈 배열로 거짓 진술하지 않는다', () => {
    const policies = [policy('APPROVAL_REQUIRED', 'COMPANY')];
    const decision = decidePolicy(policies, context()).decision;
    if (decision.decision !== 'APPROVAL_REQUIRED') expect.unreachable('APPROVAL이 아니다');
    expect(decision.approvalPolicyId).toBeNull();
  });
});

describe('§64 — ALLOW + DENY', () => {
  it('DENY가 된다', () => {
    const policies = [policy('ALLOW', 'COMPANY'), policy('DENY', 'PROJECT')];
    expect(decidePolicy(policies, context()).decision.decision).toBe('DENY');
  });

  it('구체적인 스코프가 ALLOW여도 DENY가 이긴다', () => {
    const policies = [policy('DENY', 'COMPANY'), policy('ALLOW', 'PERSONAL')];
    expect(decidePolicy(policies, context()).decision.decision).toBe('DENY');
  });
});

/* ================= 그 밖의 규칙 ================= */

describe('매칭이 없으면 fail closed', () => {
  it('DENY와 NO_POLICY_MATCHED를 낸다', () => {
    const result = decidePolicy([], context());
    if (result.decision.decision !== 'DENY') expect.unreachable('DENY가 아니다');
    expect(result.decision.reasonCode).toBe('NO_POLICY_MATCHED');
    expect(result.decision.policyIds).toEqual([]);
  });

  it('비활성 정책만 있으면 매칭이 없는 것과 같다', () => {
    const result = decidePolicy([policy('ALLOW', 'COMPANY', { enabled: false })], context());
    expect(result.decision.decision).toBe('DENY');
  });
});

describe('LOCKED는 반대 방향에서 의미가 생긴다', () => {
  it('Company LOCKED ALLOW + Project DENY → ALLOW', () => {
    // 회사가 "이건 막지 마라"를 잠근 경우다. 하위가 못 바꾼다.
    const policies = [
      policy('ALLOW', 'COMPANY', { inheritanceMode: 'LOCKED' }),
      policy('DENY', 'PROJECT'),
    ];
    expect(decidePolicy(policies, context()).decision.decision).toBe('ALLOW');
  });

  it('잠그지 않았으면 Project DENY가 이긴다', () => {
    const policies = [
      policy('ALLOW', 'COMPANY', { inheritanceMode: 'OVERRIDABLE' }),
      policy('DENY', 'PROJECT'),
    ];
    expect(decidePolicy(policies, context()).decision.decision).toBe('DENY');
  });

  it('같은 스코프의 LOCKED는 서로를 막지 않는다', () => {
    const policies = [
      policy('ALLOW', 'COMPANY', { inheritanceMode: 'LOCKED' }),
      policy('DENY', 'COMPANY'),
    ];
    // 둘 다 COMPANY이므로 판정에 함께 참여하고, 심각도로 DENY가 이긴다.
    expect(decidePolicy(policies, context()).decision.decision).toBe('DENY');
  });

  it('TEAM LOCKED는 PROJECT를 막지만 COMPANY는 못 막는다', () => {
    const policies = [
      policy('DENY', 'COMPANY'),
      policy('ALLOW', 'TEAM', { inheritanceMode: 'LOCKED' }),
      policy('ALLOW', 'PROJECT'),
    ];
    // COMPANY는 TEAM보다 덜 구체적이라 남는다. 심각도로 DENY.
    expect(decidePolicy(policies, context()).decision.decision).toBe('DENY');
  });
});

describe('매칭 조건', () => {
  const base = context();

  it('선언하지 않은 조건은 무엇이든 매칭한다', () => {
    expect(policyMatches(policy('ALLOW', 'COMPANY'), base)).toBe(true);
  });

  it('resourceId가 다르면 매칭하지 않는다', () => {
    expect(policyMatches(policy('ALLOW', 'COMPANY', { resourceId: 'other' }), base)).toBe(false);
    expect(policyMatches(policy('ALLOW', 'COMPANY', { resourceId: RESOURCE }), base)).toBe(true);
  });

  it('resourceType으로 거를 수 있다', () => {
    expect(policyMatches(policy('ALLOW', 'COMPANY', { resourceType: 'GIT' }), base)).toBe(false);
    expect(policyMatches(policy('ALLOW', 'COMPANY', { resourceType: 'DATABASE' }), base)).toBe(true);
  });

  it('classification으로 거를 수 있다', () => {
    expect(policyMatches(policy('ALLOW', 'COMPANY', { classification: 'PUBLIC' }), base)).toBe(false);
    expect(policyMatches(policy('ALLOW', 'COMPANY', { classification: 'RESTRICTED' }), base)).toBe(
      true,
    );
  });

  it('actions가 `*`면 모든 Action에 매칭한다', () => {
    expect(policyMatches(policy('ALLOW', 'COMPANY', { actions: ['*'] }), base)).toBe(true);
  });

  it('actions 목록에 없으면 매칭하지 않는다', () => {
    expect(policyMatches(policy('ALLOW', 'COMPANY', { actions: ['files.read'] }), base)).toBe(false);
    expect(policyMatches(policy('ALLOW', 'COMPANY', { actions: ['db.query'] }), base)).toBe(true);
  });

  it('조직 역할로 대상을 좁힐 수 있다', () => {
    expect(policyMatches(policy('ALLOW', 'COMPANY', { subjectOrgRole: 'ORG_ADMIN' }), base)).toBe(
      false,
    );
    expect(policyMatches(policy('ALLOW', 'COMPANY', { subjectOrgRole: 'ORG_MEMBER' }), base)).toBe(
      true,
    );
  });

  it('그룹 멤버십으로 대상을 좁힐 수 있다', () => {
    expect(policyMatches(policy('ALLOW', 'COMPANY', { subjectGroupId: 'other-group' }), base)).toBe(
      false,
    );
    expect(policyMatches(policy('ALLOW', 'COMPANY', { subjectGroupId: GROUP }), base)).toBe(true);
  });

  it('다른 팀 스코프 정책은 매칭하지 않는다', () => {
    expect(policyMatches(policy('ALLOW', 'TEAM', { scopeId: 'team-other' }), base)).toBe(false);
  });

  it('프로젝트가 없으면 PROJECT 정책은 매칭하지 않는다', () => {
    expect(policyMatches(policy('ALLOW', 'PROJECT'), context({ projectId: null }))).toBe(false);
  });

  it('남의 PERSONAL 정책은 매칭하지 않는다', () => {
    expect(policyMatches(policy('ALLOW', 'PERSONAL', { scopeId: 'user-other' }), base)).toBe(false);
  });
});

describe('결정론', () => {
  it('정책 순서를 바꿔도 결과가 같다', () => {
    const a = policy('ALLOW', 'COMPANY', { id: 'p-a' });
    const b = policy('DENY', 'PROJECT', { id: 'p-b' });
    expect(JSON.stringify(decidePolicy([a, b], context()).decision)).toBe(
      JSON.stringify(decidePolicy([b, a], context()).decision),
    );
  });

  it('같은 판정을 낸 정책이 여럿이면 id 오름차순으로 담는다', () => {
    const policies = [
      policy('DENY', 'COMPANY', { id: 'p-z' }),
      policy('DENY', 'COMPANY', { id: 'p-a' }),
    ];
    expect(decidePolicy(policies, context()).decision.policyIds).toEqual(['p-a', 'p-z']);
  });
});
