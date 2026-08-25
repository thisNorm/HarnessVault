import type {
  CompileTarget,
  CompiledFile,
  CompiledHarness,
  ResolvedAssetRef,
  ResolvedHarnessManifest,
} from '@harnessvault/domain';
import { renderStructuredContent } from './render';

export interface CompilerAssetContent {
  versionId: string;
  structuredContent: unknown;
  renderedMarkdown: string | null;
  summary: string;
}

export interface CompileInput {
  target: CompileTarget;
  manifest: ResolvedHarnessManifest;
  /** versionId → 본문. Manifest는 참조만 담으므로 service가 함께 넘긴다. */
  contents: Map<string, CompilerAssetContent>;
  /** Variant를 core Skill 문서에 합치기 위한 관계. variantAssetId → coreAssetId */
  variantOf: Map<string, string>;
  generatedAt: Date;
}

interface TargetLayout {
  entryFile: string;
  /** Skill을 어디에 어떤 형식으로 놓을지. 두 타깃의 실질적인 차이는 이것뿐이다. */
  skillPath: (ref: ResolvedAssetRef) => string;
  skillFrontmatter: boolean;
}

const LAYOUTS: Record<CompileTarget, TargetLayout> = {
  CODEX: {
    entryFile: 'AGENTS.md',
    skillPath: (ref) => `.harness/skills/${ref.key}.md`,
    skillFrontmatter: false,
  },
  CLAUDE_CODE: {
    entryFile: 'CLAUDE.md',
    // Claude Code는 디렉터리 이름을 skill 이름으로 쓴다.
    skillPath: (ref) => `.claude/skills/${ref.key.replace(/\./g, '-')}/SKILL.md`,
    skillFrontmatter: true,
  },
};

/** 명세 §23. 작은 라우터만 넣는다. 회사 규칙 전체를 여기 복사하지 않는다. */
function bootstrap(manifest: ResolvedHarnessManifest): string {
  return [
    '## Company Harness',
    '',
    '이 프로젝트는 Company Harness를 사용한다.',
    '',
    '회사 프로젝트 작업 시작 시:',
    '',
    '1. `company.resolve_task`를 호출한다.',
    '2. 반환된 회사 Harness를 우선 적용한다.',
    '3. 회사 Resource는 `company.*` MCP Tool을 통해서만 접근한다.',
    '4. 위험 Action은 Approval 결과를 기다린다. 승인받았다고 스스로 판단하지 않는다.',
    '5. 작업 종료 전 output contract를 확인한다.',
    '6. contribution check를 수행한다.',
    '',
    '> 이 파일은 아래 해석 결과로 생성됐다. 직접 고치지 말고 자산을 고친다.',
    '>',
    `> organization \`${manifest.organizationId}\` · trace \`${manifest.traceId}\``,
  ].join('\n');
}

function heading(ref: ResolvedAssetRef): string {
  return `${ref.name} \`${ref.key}\``;
}

function meta(ref: ResolvedAssetRef): string {
  const parts = [`type ${ref.type}`, `scope ${ref.scope}`, `v${ref.version}`, ref.inheritanceMode];
  if (ref.mandatory) parts.push('필수');
  return `_${parts.join(' · ')}_`;
}

function body(ref: ResolvedAssetRef, contents: CompileInput['contents']): string {
  const content = contents.get(ref.versionId);
  if (!content) return '_본문을 불러오지 못했습니다._';
  const rendered = content.renderedMarkdown?.trim();
  return rendered && rendered.length > 0
    ? rendered
    : renderStructuredContent(content.structuredContent);
}

function section(ref: ResolvedAssetRef, contents: CompileInput['contents']): string {
  return [`### ${heading(ref)}`, '', meta(ref), '', body(ref, contents)].join('\n');
}

/** 자산 하나를 독립 문서로 만든다. */
function document(
  ref: ResolvedAssetRef,
  input: CompileInput,
  extraSections: string[] = [],
  frontmatter = false,
): string {
  const parts: string[] = [];
  if (frontmatter) {
    parts.push(
      [
        '---',
        `name: ${ref.key.replace(/\./g, '-')}`,
        `description: ${(input.contents.get(ref.versionId)?.summary || ref.name).replace(/\n/g, ' ')}`,
        '---',
      ].join('\n'),
    );
  }
  parts.push(`# ${heading(ref)}`, meta(ref), body(ref, input.contents));
  parts.push(...extraSections);
  return `${parts.join('\n\n')}\n`;
}

export function compileHarness(input: CompileInput): CompiledHarness {
  const { manifest, target } = input;
  const layout = LAYOUTS[target];
  const files: CompiledFile[] = [];

  // VARIANT는 붙는 core Skill 문서 안으로 합친다.
  // 별도 파일로 흩으면 "조합마다 파일을 만들지 않는다"는 §17 원칙이 레이아웃에서 깨진다.
  const variantsByCore = new Map<string, ResolvedAssetRef[]>();
  const orphanVariants: ResolvedAssetRef[] = [];
  for (const variant of manifest.variants) {
    const coreId = input.variantOf.get(variant.assetId);
    if (!coreId) {
      orphanVariants.push(variant);
      continue;
    }
    const list = variantsByCore.get(coreId) ?? [];
    list.push(variant);
    variantsByCore.set(coreId, list);
  }

  // 선택된 모든 자산이 어디에 놓였는지 추적한다.
  // manifest.json이 일부만 담으면 resolution.selectedCount와 어긋나 기록이 스스로 모순된다.
  const placements: Array<{ ref: ResolvedAssetRef; path: string; indexed: boolean }> = [];

  const skillFiles = new Map<string, string>();
  for (const skill of manifest.skills) {
    const variants = variantsByCore.get(skill.assetId) ?? [];
    const extras = variants.map((variant) => section(variant, input.contents));
    if (extras.length > 0) extras.unshift('## Variants');
    const path = layout.skillPath(skill);
    skillFiles.set(skill.key, path);
    files.push({
      path,
      content: document(skill, input, extras, layout.skillFrontmatter),
    });
    placements.push({ ref: skill, path, indexed: true });
    for (const variant of variants) {
      placements.push({ ref: variant, path, indexed: false });
    }
  }

  // core가 없는 Variant도 문서를 남긴다. 조용히 사라지면 안 된다.
  for (const variant of orphanVariants) {
    const path = `.harness/variants/${variant.key}.md`;
    files.push({ path, content: document(variant, input) });
    placements.push({ ref: variant, path, indexed: true });
  }

  const plainGroups: Array<[ResolvedAssetRef[], string]> = [
    [manifest.workflows, 'workflows'],
    [manifest.validations, 'validations'],
    [manifest.knowledge, 'knowledge'],
    [manifest.scripts, 'scripts'],
    [manifest.templates, 'templates'],
  ];
  for (const [refs, folder] of plainGroups) {
    for (const ref of refs) {
      const path = `.harness/${folder}/${ref.key}.md`;
      files.push({ path, content: document(ref, input) });
      placements.push({ ref, path, indexed: true });
    }
  }

  const indexed = placements.filter((item) => item.indexed);

  // 진입 파일 — RULE·POLICY는 본문을 그대로 넣는다.
  // 필수 자산이 별도 파일에 있으면 에이전트가 읽지 않고 지나갈 수 있다.
  const entry: string[] = [bootstrap(manifest)];

  const mandatory = [...manifest.rules, ...manifest.policies];
  if (mandatory.length > 0) {
    entry.push('## 필수 규칙 · 정책', '아래는 생략하거나 완화할 수 없다.');
    for (const ref of mandatory) {
      entry.push(section(ref, input.contents));
      placements.push({ ref, path: layout.entryFile, indexed: false });
    }
  }

  if (indexed.length > 0) {
    entry.push('## 적용된 자산');
    entry.push(
      [
        '| 자산 | Type | Scope | 파일 |',
        '| --- | --- | --- | --- |',
        ...indexed
          .slice()
          .sort((a, b) => a.ref.key.localeCompare(b.ref.key))
          .map((item) => `| \`${item.ref.key}\` | ${item.ref.type} | ${item.ref.scope} | \`${item.path}\` |`),
      ].join('\n'),
    );
  }

  // 작업을 마칠 때 무엇을 남겨야 하는지 진입 파일에 적는다(§35).
  const contract = manifest.outputContract;
  if (contract && contract.requiredFields.length > 0) {
    entry.push('## 산출물 계약');
    entry.push('작업을 마칠 때 아래 항목을 반드시 남긴다.');
    entry.push(
      [
        '| 항목 | 요구한 곳 |',
        '| --- | --- |',
        ...contract.requiredFields.map(
          (field) =>
            `| \`${field}\` | ${contract.sourceMap[field]?.scope ?? '—'} · ${contract.sourceMap[field]?.sourceName ?? '—'} |`,
        ),
      ].join('\n'),
    );
  }

  if (manifest.excluded.length > 0) {
    entry.push('## 적용되지 않은 자산');
    entry.push(
      [
        '| 자산 | 제외 이유 |',
        '| --- | --- |',
        ...manifest.excluded
          .slice()
          .sort((a, b) => a.key.localeCompare(b.key))
          .map((item) => `| \`${item.key}\` (${item.scope}) | ${item.reason} |`),
      ].join('\n'),
    );
  }

  files.push({ path: layout.entryFile, content: `${entry.join('\n\n')}\n` });

  // 어떤 해석 결과로 만들어졌는지 남긴다. generatedAt은 본문에 넣지 않는다 — 결정론이 깨진다.
  files.push({
    path: '.harness/manifest.json',
    content: `${JSON.stringify(
      {
        traceId: manifest.traceId,
        organizationId: manifest.organizationId,
        projectId: manifest.projectId,
        target,
        resolution: manifest.resolution,
        outputContract: manifest.outputContract,
        selected: placements
          .slice()
          .sort((a, b) => a.ref.key.localeCompare(b.ref.key))
          .map((item) => ({
            key: item.ref.key,
            type: item.ref.type,
            scope: item.ref.scope,
            version: item.ref.version,
            reasonCode: item.ref.reasonCode,
            file: item.path,
          })),
        excluded: manifest.excluded
          .slice()
          .sort((a, b) => a.key.localeCompare(b.key))
          .map((item) => ({ key: item.key, scope: item.scope, reasonCode: item.reasonCode })),
      },
      null,
      2,
    )}\n`,
  });

  files.sort((a, b) => a.path.localeCompare(b.path));

  return {
    files,
    metadata: {
      target,
      generatedAt: input.generatedAt.toISOString(),
      manifestTraceId: manifest.traceId,
    },
  };
}
