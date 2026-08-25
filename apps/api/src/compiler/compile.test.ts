import { describe, expect, it } from 'vitest';
import type {
  HarnessAssetType,
  ResolvedAssetRef,
  ResolvedHarnessManifest,
  ScopeType,
} from '@harnessvault/domain';
import { type CompileInput, type CompilerAssetContent, compileHarness } from './compile';
import { renderStructuredContent } from './render';

function ref(
  key: string,
  type: HarnessAssetType,
  scope: ScopeType = 'COMPANY',
  overrides: Partial<ResolvedAssetRef> = {},
): ResolvedAssetRef {
  return {
    assetId: `asset-${key}`,
    versionId: `ver-${key}`,
    key,
    name: `${key} 자산`,
    type,
    version: '1.0',
    scope,
    inheritanceMode: 'DEFAULT',
    reasonCode: 'SCOPE_MATCH',
    reason: '조건에 맞습니다',
    mandatory: type === 'RULE' || type === 'POLICY',
    estimatedTokens: 10,
    ...overrides,
  };
}

function manifest(overrides: Partial<ResolvedHarnessManifest> = {}): ResolvedHarnessManifest {
  return {
    traceId: 'trace-1',
    organizationId: 'org-1',
    userId: 'user-1',
    projectId: null,
    rules: [],
    policies: [],
    validations: [],
    workflows: [],
    skills: [],
    variants: [],
    scripts: [],
    templates: [],
    knowledge: [],
    outputContract: null,
    excluded: [],
    resolution: {
      candidateCount: 0,
      selectedCount: 0,
      excludedCount: 0,
      estimatedAvailableTokens: null,
      estimatedInjectedTokens: 0,
      budgetExceededByMandatory: false,
    },
    ...overrides,
  };
}

function content(structuredContent: unknown, summary = '요약'): CompilerAssetContent {
  return { versionId: '', structuredContent, renderedMarkdown: null, summary };
}

function build(
  target: CompileInput['target'],
  m: ResolvedHarnessManifest,
  contents: Record<string, CompilerAssetContent> = {},
  variantOf: Record<string, string> = {},
) {
  return compileHarness({
    target,
    manifest: m,
    contents: new Map(Object.entries(contents)),
    variantOf: new Map(Object.entries(variantOf)),
    generatedAt: new Date('2026-01-01T00:00:00Z'),
  });
}

function fileAt(result: ReturnType<typeof build>, path: string): string {
  const found = result.files.find((file) => file.path === path);
  if (!found) throw new Error(`파일 없음: ${path} (있는 것: ${result.files.map((f) => f.path).join(', ')})`);
  return found.content;
}

describe('renderStructuredContent', () => {
  it('instructions를 번호 목록으로 만든다', () => {
    expect(renderStructuredContent({ instructions: ['첫째', '둘째'] })).toContain('1. 첫째');
    expect(renderStructuredContent({ instructions: ['첫째', '둘째'] })).toContain('2. 둘째');
  });

  it('checks를 체크박스로 만든다', () => {
    expect(renderStructuredContent({ checks: ['커넥션 확인'] })).toContain('- [ ] 커넥션 확인');
  });

  it('rule은 문단으로 낸다', () => {
    expect(renderStructuredContent({ rule: '검증 없이 완료하지 않는다' })).toBe(
      '검증 없이 완료하지 않는다',
    );
  });

  it('알 수 없는 형태를 버리지 않고 JSON으로 싣는다', () => {
    const rendered = renderStructuredContent({ weirdKey: { nested: 1 } });
    expect(rendered).toContain('```json');
    expect(rendered).toContain('weirdKey');
  });

  it('알려진 키와 모르는 키가 섞여도 둘 다 남는다', () => {
    const rendered = renderStructuredContent({ steps: ['하나'], extra: [1, 2] });
    expect(rendered).toContain('1. 하나');
    expect(rendered).toContain('extra');
  });

  it('빈 값에도 무언가를 남긴다', () => {
    expect(renderStructuredContent(null)).toBe('_내용이 없습니다._');
    expect(renderStructuredContent({})).toBe('_내용이 없습니다._');
  });

  it('문자열은 그대로 쓴다', () => {
    expect(renderStructuredContent('  그냥 텍스트  ')).toBe('그냥 텍스트');
  });
});

describe('타깃별 진입 파일', () => {
  const m = manifest({ skills: [ref('db.core', 'SKILL')] });
  const contents = { 'ver-db.core': content({ instructions: ['확인한다'] }) };

  it('CODEX는 AGENTS.md를 만든다', () => {
    const paths = build('CODEX', m, contents).files.map((file) => file.path);
    expect(paths).toContain('AGENTS.md');
    expect(paths).not.toContain('CLAUDE.md');
  });

  it('CLAUDE_CODE는 CLAUDE.md를 만든다', () => {
    const paths = build('CLAUDE_CODE', m, contents).files.map((file) => file.path);
    expect(paths).toContain('CLAUDE.md');
    expect(paths).not.toContain('AGENTS.md');
  });

  it('두 타깃 모두 bootstrap 라우터를 넣는다', () => {
    expect(fileAt(build('CODEX', m, contents), 'AGENTS.md')).toContain('company.resolve_task');
    expect(fileAt(build('CLAUDE_CODE', m, contents), 'CLAUDE.md')).toContain('company.resolve_task');
  });

  it('bootstrap에 회사 규칙 본문을 복사하지 않는다', () => {
    // §23 — bootstrap은 작은 라우터다. 6단계 안내만 있으면 된다.
    const entry = fileAt(build('CODEX', m, contents), 'AGENTS.md');
    const bootstrapPart = entry.split('## 필수 규칙')[0] ?? '';
    expect(bootstrapPart.split('\n').length).toBeLessThan(30);
  });
});

describe('Skill 배치', () => {
  const m = manifest({ skills: [ref('db.troubleshoot.core', 'SKILL')] });
  const contents = { 'ver-db.troubleshoot.core': content({ instructions: ['확인'] }, '핵심 절차') };

  it('CODEX는 .harness/skills 아래 둔다', () => {
    const paths = build('CODEX', m, contents).files.map((file) => file.path);
    expect(paths).toContain('.harness/skills/db.troubleshoot.core.md');
  });

  it('CLAUDE_CODE는 .claude/skills/<name>/SKILL.md에 둔다', () => {
    const paths = build('CLAUDE_CODE', m, contents).files.map((file) => file.path);
    expect(paths).toContain('.claude/skills/db-troubleshoot-core/SKILL.md');
  });

  it('Claude Code SKILL.md에 frontmatter가 있다', () => {
    const file = fileAt(build('CLAUDE_CODE', m, contents), '.claude/skills/db-troubleshoot-core/SKILL.md');
    expect(file.startsWith('---\n')).toBe(true);
    expect(file).toContain('name: db-troubleshoot-core');
    expect(file).toContain('description: 핵심 절차');
  });

  it('Codex skill 파일에는 frontmatter를 넣지 않는다', () => {
    const file = fileAt(build('CODEX', m, contents), '.harness/skills/db.troubleshoot.core.md');
    expect(file.startsWith('---\n')).toBe(false);
  });
});

describe('필수 규칙은 진입 파일 본문에 들어간다', () => {
  const m = manifest({ rules: [ref('verify', 'RULE')] });
  const contents = { 'ver-verify': content({ rule: '검증 없이 완료하지 않는다' }) };

  it('규칙 본문이 진입 파일에 그대로 있다', () => {
    const entry = fileAt(build('CODEX', m, contents), 'AGENTS.md');
    expect(entry).toContain('검증 없이 완료하지 않는다');
    expect(entry).toContain('생략하거나 완화할 수 없다');
  });

  it('규칙을 별도 파일로 흩지 않는다', () => {
    const paths = build('CODEX', m, contents).files.map((file) => file.path);
    expect(paths.some((path) => path.includes('rules/'))).toBe(false);
  });
});

describe('Variant는 core Skill 문서에 합쳐진다', () => {
  const core = ref('db.core', 'SKILL');
  const variant = ref('db.variant.sqlite', 'VARIANT');
  const m = manifest({ skills: [core], variants: [variant] });
  const contents = {
    'ver-db.core': content({ instructions: ['공통 절차'] }),
    'ver-db.variant.sqlite': content({ instructions: ['WAL 모드 확인'] }),
  };
  const variantOf = { 'asset-db.variant.sqlite': 'asset-db.core' };

  it('core 문서 안에 Variant 절이 생긴다', () => {
    const file = fileAt(build('CODEX', m, contents, variantOf), '.harness/skills/db.core.md');
    expect(file).toContain('## Variants');
    expect(file).toContain('WAL 모드 확인');
  });

  it('Variant를 별도 파일로 만들지 않는다', () => {
    const paths = build('CODEX', m, contents, variantOf).files.map((file) => file.path);
    expect(paths).not.toContain('.harness/variants/db.variant.sqlite.md');
  });

  it('core가 없는 Variant는 자기 파일로 남는다 — 조용히 사라지지 않는다', () => {
    const paths = build('CODEX', m, contents, {}).files.map((file) => file.path);
    expect(paths).toContain('.harness/variants/db.variant.sqlite.md');
  });
});

describe('색인과 기록', () => {
  const m = manifest({
    skills: [ref('db.core', 'SKILL')],
    workflows: [ref('mqtt.flow', 'WORKFLOW', 'PROJECT')],
    excluded: [
      {
        assetId: 'asset-pg',
        key: 'db.variant.postgresql',
        name: 'PG',
        type: 'VARIANT',
        scope: 'COMPANY',
        reasonCode: 'SELECTOR_MISMATCH',
        reason: 'databases 조건 불일치',
      },
    ],
  });
  const contents = {
    'ver-db.core': content({ instructions: ['a'] }),
    'ver-mqtt.flow': content({ steps: ['b'] }),
  };

  it('진입 파일에 자산 색인이 있다', () => {
    const entry = fileAt(build('CODEX', m, contents), 'AGENTS.md');
    expect(entry).toContain('.harness/workflows/mqtt.flow.md');
    expect(entry).toContain('.harness/skills/db.core.md');
  });

  it('제외된 자산과 이유도 남긴다', () => {
    const entry = fileAt(build('CODEX', m, contents), 'AGENTS.md');
    expect(entry).toContain('db.variant.postgresql');
    expect(entry).toContain('databases 조건 불일치');
  });

  it('manifest.json에 trace와 선택·제외가 남는다', () => {
    const json = JSON.parse(fileAt(build('CODEX', m, contents), '.harness/manifest.json'));
    expect(json.traceId).toBe('trace-1');
    expect(json.selected.map((item: { key: string }) => item.key)).toContain('db.core');
    expect(json.excluded[0].reasonCode).toBe('SELECTOR_MISMATCH');
  });
});

describe('결정론', () => {
  const m = manifest({
    skills: [ref('z.skill', 'SKILL'), ref('a.skill', 'SKILL')],
    knowledge: [ref('m.note', 'KNOWLEDGE')],
  });
  const contents = {
    'ver-z.skill': content({ instructions: ['z'] }),
    'ver-a.skill': content({ instructions: ['a'] }),
    'ver-m.note': content({ body: 'note' }),
  };

  it('파일이 경로 오름차순으로 정렬된다', () => {
    const paths = build('CODEX', m, contents).files.map((file) => file.path);
    expect(paths).toEqual([...paths].sort((a, b) => a.localeCompare(b)));
  });

  it('생성 시각이 달라도 파일 본문은 같다', () => {
    const first = compileHarness({
      target: 'CODEX',
      manifest: m,
      contents: new Map(Object.entries(contents)),
      variantOf: new Map(),
      generatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    const second = compileHarness({
      target: 'CODEX',
      manifest: m,
      contents: new Map(Object.entries(contents)),
      variantOf: new Map(),
      generatedAt: new Date('2027-06-15T12:34:56Z'),
    });
    expect(first.files).toEqual(second.files);
    expect(first.metadata.generatedAt).not.toBe(second.metadata.generatedAt);
  });
});

describe('본문 누락', () => {
  it('내용을 못 찾으면 조용히 비우지 않고 그 사실을 적는다', () => {
    const m = manifest({ skills: [ref('missing', 'SKILL')] });
    const file = fileAt(build('CODEX', m, {}), '.harness/skills/missing.md');
    expect(file).toContain('본문을 불러오지 못했습니다');
  });
});

describe('manifest.json은 스스로 모순되지 않는다', () => {
  it('선택된 자산이 전부 담긴다 — 진입 파일에 인라인된 규칙과 병합된 Variant 포함', () => {
    const core = ref('db.core', 'SKILL');
    const variant = ref('db.variant.sqlite', 'VARIANT');
    const rule = ref('verify', 'RULE');
    const m = manifest({
      rules: [rule],
      skills: [core],
      variants: [variant],
      resolution: {
        candidateCount: 3,
        selectedCount: 3,
        excludedCount: 0,
        estimatedAvailableTokens: null,
        estimatedInjectedTokens: 30,
        budgetExceededByMandatory: false,
      },
    });
    const contents = {
      'ver-db.core': content({ instructions: ['a'] }),
      'ver-db.variant.sqlite': content({ instructions: ['b'] }),
      'ver-verify': content({ rule: 'c' }),
    };
    const result = build('CODEX', m, contents, { 'asset-db.variant.sqlite': 'asset-db.core' });
    const json = JSON.parse(fileAt(result, '.harness/manifest.json'));

    expect(json.selected).toHaveLength(json.resolution.selectedCount);
    const keys = json.selected.map((item: { key: string }) => item.key);
    expect(keys).toContain('verify');
    expect(keys).toContain('db.core');
    expect(keys).toContain('db.variant.sqlite');
  });

  it('각 자산이 어느 파일에 들어갔는지 기록한다', () => {
    const m = manifest({ rules: [ref('verify', 'RULE')] });
    const json = JSON.parse(
      fileAt(build('CODEX', m, { 'ver-verify': content({ rule: 'c' }) }), '.harness/manifest.json'),
    );
    expect(json.selected[0].file).toBe('AGENTS.md');
  });
});
