import { describe, expect, it } from 'vitest';
import type { AssetSelector, HarnessAssetType, InheritanceMode, ScopeType } from '@harnessvault/domain';
import {
  type CandidateAsset,
  type CandidateRelation,
  type ResolveContext,
  ResolutionConflictError,
  resolveHarness,
} from './resolve';

const ORG = 'org-1';
const USER = 'user-1';
const TEAM = 'team-1';
const PROJECT = 'project-1';

let seq = 0;

function asset(
  key: string,
  type: HarnessAssetType,
  scopeType: ScopeType,
  options: {
    inheritanceMode?: InheritanceMode;
    selector?: AssetSelector;
    scopeId?: string;
    activeVersions?: number;
    tokens?: number;
    id?: string;
  } = {},
): CandidateAsset {
  const scopeId =
    options.scopeId ??
    { COMPANY: ORG, TEAM, PROJECT, PERSONAL: USER }[scopeType];
  const count = options.activeVersions ?? 1;
  seq++;
  const id = options.id ?? `asset-${seq}`;
  return {
    id,
    key,
    name: `${key} (${scopeType})`,
    type,
    scopeType,
    scopeId,
    inheritanceMode: options.inheritanceMode ?? 'DEFAULT',
    selector: options.selector ?? {},
    activeVersions: Array.from({ length: count }, (_, index) => ({
      id: `${id}-v${index}`,
      version: `1.${index}`,
      estimatedTokens: options.tokens ?? 100,
    })),
  };
}

function context(overrides: Partial<ResolveContext> = {}): ResolveContext {
  return {
    organizationId: ORG,
    userId: USER,
    projectId: PROJECT,
    teamIds: [TEAM],
    task: { description: 'DB 장애 분석', domain: ['database'], type: ['troubleshoot'] },
    environment: {},
    contextBudget: null,
    ...overrides,
  };
}

function run(candidates: CandidateAsset[], relations: CandidateRelation[] = [], ctx = context()) {
  return resolveHarness({ traceId: 'trace-1', context: ctx, candidates, relations });
}

function selectedKeys(manifest: ReturnType<typeof run>): string[] {
  return [
    ...manifest.rules,
    ...manifest.policies,
    ...manifest.validations,
    ...manifest.workflows,
    ...manifest.skills,
    ...manifest.variants,
    ...manifest.scripts,
    ...manifest.templates,
    ...manifest.knowledge,
  ].map((ref) => `${ref.key}@${ref.scope}`);
}

/* ================= §63 필수 케이스 ================= */

describe('§63 Case 1 — Company LOCKED Rule + Project override', () => {
  const company = asset('verify-before-completion', 'RULE', 'COMPANY', {
    inheritanceMode: 'LOCKED',
  });
  const project = asset('verify-before-completion', 'RULE', 'PROJECT', {
    inheritanceMode: 'OVERRIDABLE',
  });

  it('Company Rule이 유지된다', () => {
    const manifest = run([company, project]);
    expect(selectedKeys(manifest)).toContain('verify-before-completion@COMPANY');
  });

  it('Project override는 제외된다', () => {
    const manifest = run([company, project]);
    expect(selectedKeys(manifest)).not.toContain('verify-before-completion@PROJECT');
    const reason = manifest.excluded.find((item) => item.scope === 'PROJECT');
    expect(reason?.reasonCode).toBe('LOCKED_BY_PARENT');
  });

  it('후보 순서를 바꿔도 결과가 같다 — 결정론', () => {
    expect(selectedKeys(run([company, project]))).toEqual(selectedKeys(run([project, company])));
  });
});

describe('§63 Case 2 — Company EXTENDABLE validation + Team + Project', () => {
  const candidates = [
    asset('db.checklist', 'VALIDATION', 'COMPANY', { inheritanceMode: 'EXTENDABLE' }),
    asset('db.checklist', 'VALIDATION', 'TEAM', { inheritanceMode: 'EXTENDABLE' }),
    asset('db.checklist', 'VALIDATION', 'PROJECT', { inheritanceMode: 'EXTENDABLE' }),
  ];

  it('세 스코프가 모두 포함된다', () => {
    const keys = selectedKeys(run(candidates));
    expect(keys).toContain('db.checklist@COMPANY');
    expect(keys).toContain('db.checklist@TEAM');
    expect(keys).toContain('db.checklist@PROJECT');
  });

  it('상속을 이유로 제외된 자산이 없다', () => {
    const manifest = run(candidates);
    const inheritanceExclusions = manifest.excluded.filter((item) =>
      ['LOCKED_BY_PARENT', 'OVERRIDDEN_BY_CHILD', 'DEFAULT_SUPERSEDED'].includes(item.reasonCode),
    );
    expect(inheritanceExclusions).toEqual([]);
  });
});

describe('§63 Case 3 — 동일 Asset에 ACTIVE Version 2개', () => {
  const conflicted = asset('db.troubleshoot.core', 'SKILL', 'COMPANY', { activeVersions: 2 });

  it('RESOLUTION_CONFLICT로 실패한다', () => {
    expect(() => run([conflicted])).toThrow(ResolutionConflictError);
  });

  it('자동으로 한 버전을 고르지 않는다', () => {
    try {
      run([conflicted]);
      expect.unreachable('충돌인데 통과했다');
    } catch (error) {
      expect(error).toBeInstanceOf(ResolutionConflictError);
      const conflict = (error as ResolutionConflictError).conflicts[0];
      expect(conflict?.kind).toBe('MULTIPLE_ACTIVE_VERSIONS');
      expect(conflict?.key).toBe('db.troubleshoot.core');
      expect(conflict?.detail).toContain('1.0');
      expect(conflict?.detail).toContain('1.1');
    }
  });

  it('선택되지 않은 자산의 ACTIVE 2개는 충돌이 아니다', () => {
    // 스코프가 맞지 않아 후보에서 빠진 자산까지 실패시키면 무관한 조직 상태로 요청이 막힌다.
    const unrelated = asset('other', 'SKILL', 'PROJECT', {
      activeVersions: 2,
      scopeId: 'other-project',
    });
    expect(() => run([unrelated])).not.toThrow();
  });
});

describe('§63 Case 4 — PostgreSQL Variant인데 DB=SQLite', () => {
  const core = asset('db.troubleshoot.core', 'SKILL', 'COMPANY', { id: 'core' });
  const pg = asset('db.variant.postgresql', 'VARIANT', 'COMPANY', {
    id: 'pg',
    selector: { databases: ['postgresql'] },
  });
  const sqlite = asset('db.variant.sqlite', 'VARIANT', 'COMPANY', {
    id: 'sqlite',
    selector: { databases: ['sqlite'] },
  });
  const relations: CandidateRelation[] = [
    { fromAssetId: 'pg', toAssetId: 'core', type: 'VARIANT_OF' },
    { fromAssetId: 'sqlite', toAssetId: 'core', type: 'VARIANT_OF' },
  ];
  const ctx = context({ environment: { database: 'sqlite' } });

  it('PostgreSQL Variant가 제외된다', () => {
    const manifest = run([core, pg, sqlite], relations, ctx);
    expect(selectedKeys(manifest)).not.toContain('db.variant.postgresql@COMPANY');
  });

  it('SQLite Variant는 포함된다', () => {
    const manifest = run([core, pg, sqlite], relations, ctx);
    expect(selectedKeys(manifest)).toContain('db.variant.sqlite@COMPANY');
  });

  it('제외 사유가 selector 불일치로 기록된다', () => {
    const manifest = run([core, pg, sqlite], relations, ctx);
    const excluded = manifest.excluded.find((item) => item.key === 'db.variant.postgresql');
    expect(excluded?.reasonCode).toBe('SELECTOR_MISMATCH');
    expect(excluded?.reason).toContain('databases');
  });

  it('DB를 지정하지 않으면 두 Variant 모두 제외된다', () => {
    // 조건을 걸어 뒀는데 확인할 방법이 없으면 통과가 아니라 제외다.
    const manifest = run([core, pg, sqlite], relations, context());
    expect(selectedKeys(manifest)).not.toContain('db.variant.sqlite@COMPANY');
    expect(selectedKeys(manifest)).not.toContain('db.variant.postgresql@COMPANY');
  });

  it('core가 빠지면 매칭된 Variant도 빠진다', () => {
    const orphanCtx = context({ environment: { database: 'sqlite' }, teamIds: [] });
    const teamCore = asset('db.troubleshoot.core', 'SKILL', 'TEAM', { id: 'core-team' });
    const manifest = run(
      [teamCore, sqlite],
      [{ fromAssetId: 'sqlite', toAssetId: 'core-team', type: 'VARIANT_OF' }],
      orphanCtx,
    );
    expect(selectedKeys(manifest)).not.toContain('db.variant.sqlite@COMPANY');
    expect(
      manifest.excluded.find((item) => item.key === 'db.variant.sqlite')?.reasonCode,
    ).toBe('VARIANT_CORE_NOT_SELECTED');
  });
});

describe('§63 Case 5 — Context budget 초과', () => {
  const rule = asset('verify-before-completion', 'RULE', 'COMPANY', {
    inheritanceMode: 'LOCKED',
    tokens: 300,
  });
  const skill = asset('db.troubleshoot.core', 'SKILL', 'COMPANY', { tokens: 200 });
  const knowledge = asset('db.reference.notes', 'KNOWLEDGE', 'COMPANY', { tokens: 5000 });

  it('mandatory는 예산을 이유로 빠지지 않는다', () => {
    const manifest = run([rule, skill, knowledge], [], context({ contextBudget: 100 }));
    expect(selectedKeys(manifest)).toContain('verify-before-completion@COMPANY');
  });

  it('관련도 낮은 Knowledge가 먼저 빠진다', () => {
    const manifest = run([rule, skill, knowledge], [], context({ contextBudget: 600 }));
    const keys = selectedKeys(manifest);
    expect(keys).toContain('db.troubleshoot.core@COMPANY');
    expect(keys).not.toContain('db.reference.notes@COMPANY');
  });

  it('제외 사유를 기록한다', () => {
    const manifest = run([rule, skill, knowledge], [], context({ contextBudget: 600 }));
    const excluded = manifest.excluded.find((item) => item.key === 'db.reference.notes');
    expect(excluded?.reasonCode).toBe('CONTEXT_BUDGET_EXCEEDED');
  });

  it('mandatory만으로 예산을 넘으면 그 사실을 숨기지 않는다', () => {
    const manifest = run([rule, skill], [], context({ contextBudget: 100 }));
    expect(manifest.resolution.budgetExceededByMandatory).toBe(true);
    expect(manifest.resolution.estimatedInjectedTokens).toBeGreaterThan(100);
    expect(manifest.resolution.estimatedAvailableTokens).toBe(100);
  });

  it('예산을 주지 않으면 아무것도 잘라내지 않는다', () => {
    const manifest = run([rule, skill, knowledge]);
    expect(manifest.resolution.selectedCount).toBe(3);
    expect(manifest.resolution.estimatedAvailableTokens).toBeNull();
  });
});

/* ================= 그 밖의 규칙 ================= */

describe('Scope 일치', () => {
  it('다른 팀의 TEAM 자산은 제외된다', () => {
    const other = asset('team.rule', 'SKILL', 'TEAM', { scopeId: 'team-other' });
    const manifest = run([other]);
    expect(manifest.excluded[0]?.reasonCode).toBe('SCOPE_MISMATCH');
  });

  it('projectId가 없으면 PROJECT 자산은 제외된다', () => {
    const projectAsset = asset('proj.flow', 'WORKFLOW', 'PROJECT');
    const manifest = run([projectAsset], [], context({ projectId: null }));
    expect(manifest.excluded[0]?.reasonCode).toBe('SCOPE_MISMATCH');
  });

  it('본인의 PERSONAL 자산은 포함된다', () => {
    const personal = asset('my.pref', 'KNOWLEDGE', 'PERSONAL');
    expect(selectedKeys(run([personal]))).toContain('my.pref@PERSONAL');
  });
});

describe('상속 모드', () => {
  it('OVERRIDABLE 상위는 하위에 자리를 내준다', () => {
    const manifest = run([
      asset('cmd.test', 'SCRIPT', 'COMPANY', { inheritanceMode: 'OVERRIDABLE' }),
      asset('cmd.test', 'SCRIPT', 'PROJECT'),
    ]);
    expect(selectedKeys(manifest)).toEqual(['cmd.test@PROJECT']);
    expect(manifest.excluded[0]?.reasonCode).toBe('OVERRIDDEN_BY_CHILD');
  });

  it('DEFAULT 상위도 하위가 있으면 물러난다', () => {
    const manifest = run([
      asset('style.pref', 'KNOWLEDGE', 'COMPANY', { inheritanceMode: 'DEFAULT' }),
      asset('style.pref', 'KNOWLEDGE', 'PERSONAL'),
    ]);
    expect(selectedKeys(manifest)).toEqual(['style.pref@PERSONAL']);
    expect(manifest.excluded[0]?.reasonCode).toBe('DEFAULT_SUPERSEDED');
  });

  it('LOCKED은 selector가 맞지 않아도 포함된다', () => {
    const locked = asset('secret.rule', 'RULE', 'COMPANY', {
      inheritanceMode: 'LOCKED',
      selector: { databases: ['oracle'] },
    });
    const manifest = run([locked], [], context({ environment: { database: 'sqlite' } }));
    expect(selectedKeys(manifest)).toContain('secret.rule@COMPANY');
    expect(manifest.rules[0]?.reasonCode).toBe('MANDATORY_LOCKED');
  });
});

describe('Dependency 확장', () => {
  it('selector가 맞지 않아도 의존 대상은 끌어온다', () => {
    const skill = asset('skill.a', 'SKILL', 'COMPANY', { id: 'a' });
    const dep = asset('knowledge.b', 'KNOWLEDGE', 'COMPANY', {
      id: 'b',
      selector: { databases: ['oracle'] },
    });
    const manifest = run([skill, dep], [{ fromAssetId: 'a', toAssetId: 'b', type: 'DEPENDS_ON' }]);
    expect(selectedKeys(manifest)).toContain('knowledge.b@COMPANY');
    expect(manifest.knowledge[0]?.reasonCode).toBe('DEPENDENCY');
  });

  it('제외 목록에 중복으로 남지 않는다', () => {
    const skill = asset('skill.a', 'SKILL', 'COMPANY', { id: 'a2' });
    const dep = asset('knowledge.b', 'KNOWLEDGE', 'COMPANY', {
      id: 'b2',
      selector: { databases: ['oracle'] },
    });
    const manifest = run([skill, dep], [{ fromAssetId: 'a2', toAssetId: 'b2', type: 'DEPENDS_ON' }]);
    expect(manifest.excluded.find((item) => item.key === 'knowledge.b')).toBeUndefined();
  });

  it('스코프가 맞지 않는 대상은 끌어오지 않는다', () => {
    const skill = asset('skill.a', 'SKILL', 'COMPANY', { id: 'a3' });
    const dep = asset('knowledge.b', 'KNOWLEDGE', 'TEAM', { id: 'b3', scopeId: 'team-other' });
    const manifest = run([skill, dep], [{ fromAssetId: 'a3', toAssetId: 'b3', type: 'DEPENDS_ON' }]);
    expect(selectedKeys(manifest)).not.toContain('knowledge.b@TEAM');
  });
});

describe('CONFLICTS_WITH', () => {
  it('둘 다 선택되면 실패한다', () => {
    const a = asset('rule.a', 'RULE', 'COMPANY', { id: 'ca' });
    const b = asset('rule.b', 'RULE', 'COMPANY', { id: 'cb' });
    expect(() =>
      run([a, b], [{ fromAssetId: 'ca', toAssetId: 'cb', type: 'CONFLICTS_WITH' }]),
    ).toThrow(ResolutionConflictError);
  });

  it('한쪽만 선택되면 실패하지 않는다', () => {
    const a = asset('rule.a', 'RULE', 'COMPANY', { id: 'ca2' });
    const b = asset('rule.b', 'RULE', 'TEAM', { id: 'cb2', scopeId: 'team-other' });
    expect(() =>
      run([a, b], [{ fromAssetId: 'ca2', toAssetId: 'cb2', type: 'CONFLICTS_WITH' }]),
    ).not.toThrow();
  });
});

describe('Priority', () => {
  it('RULE이 SKILL보다 먼저 온다', () => {
    const manifest = run([
      asset('z.skill', 'SKILL', 'COMPANY'),
      asset('a.rule', 'RULE', 'COMPANY'),
    ]);
    expect(manifest.rules).toHaveLength(1);
    expect(manifest.skills).toHaveLength(1);
    expect(manifest.rules[0]?.mandatory).toBe(true);
    expect(manifest.skills[0]?.mandatory).toBe(false);
  });

  it('같은 타입이면 구체적인 스코프가 먼저다', () => {
    const manifest = run([
      asset('a.skill', 'SKILL', 'COMPANY'),
      asset('b.skill', 'SKILL', 'PROJECT'),
    ]);
    expect(manifest.skills[0]?.scope).toBe('PROJECT');
  });
});

describe('통계', () => {
  it('후보·선택·제외 수가 맞아떨어진다', () => {
    const manifest = run([
      asset('a.skill', 'SKILL', 'COMPANY'),
      asset('b.skill', 'SKILL', 'TEAM', { scopeId: 'team-other' }),
    ]);
    expect(manifest.resolution.candidateCount).toBe(2);
    expect(manifest.resolution.selectedCount).toBe(1);
    expect(manifest.resolution.excludedCount).toBe(1);
  });

  it('outputContract는 Phase 10까지 null이다', () => {
    expect(run([asset('a.skill', 'SKILL', 'COMPANY')]).outputContract).toBeNull();
  });
});
