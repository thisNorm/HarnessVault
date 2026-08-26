// Phase 4 완료 조건 검증: 동일 Manifest에서 Codex / Claude Code 타깃 파일을 생성한다.
import { randomBytes } from 'node:crypto';

const BASE = 'http://localhost:3000';

let cookie = '';
let pass = 0;
let fail = 0;

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json; charset=utf-8' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    if (c.startsWith('harness_session=')) cookie = c.split(';')[0];
  }
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function check(label, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (${actual}${ok ? '' : ` != ${expected}`})`);
  if (ok) pass++;
  else fail++;
}

function expectOk(label, res) {
  if (res.status >= 400) throw new Error(`${label} 실패: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

const stamp = Date.now();
const secret = randomBytes(18).toString('base64url');
const admin = { email: `c-admin-${stamp}@example.com`, password: secret, displayName: '컴파일 관리자' };

await call('POST', '/auth/register', admin);
await call('POST', '/auth/login', { email: admin.email, password: admin.password });

const orgId = expectOk('조직 생성', await call('POST', '/organizations', {
  name: 'Compiler Org',
  slug: `compiler-${stamp}`,
})).organization.id;
const userId = (await call('GET', '/auth/me')).body.user.id;

const teamId = expectOk('팀 생성', await call('POST', `/organizations/${orgId}/teams`, {
  name: 'DBA',
  slug: 'dba',
})).team.id;
await call('POST', `/organizations/${orgId}/teams/${teamId}/members`, { userId });

async function makeAsset(asset, structuredContent) {
  const created = expectOk('자산 생성', await call('POST', `/organizations/${orgId}/assets`, asset));
  const id = created.asset.id;
  const version = expectOk(
    '버전 생성',
    await call('POST', `/organizations/${orgId}/assets/${id}/versions`, {
      version: '1.0',
      summary: `${asset.name} 요약`,
      structuredContent,
      status: 'CANDIDATE',
    }),
  );
  await call('POST', `/organizations/${orgId}/assets/${id}/versions/${version.version.id}/promote`);
  await call('PATCH', `/organizations/${orgId}/assets/${id}`, { status: 'ACTIVE' });
  return id;
}

const coreId = await makeAsset(
  {
    type: 'SKILL',
    key: 'db.troubleshoot.core',
    name: 'DB 진단 핵심',
    scopeType: 'COMPANY',
    inheritanceMode: 'EXTENDABLE',
    ownerType: 'TEAM',
    ownerId: teamId,
    selector: { domains: ['database'] },
  },
  { instructions: ['연결 확인', '슬로우 쿼리 확인'] },
);
const variantId = await makeAsset(
  {
    type: 'VARIANT',
    key: 'db.variant.sqlite',
    name: 'SQLite Variant',
    scopeType: 'COMPANY',
    ownerType: 'TEAM',
    ownerId: teamId,
    selector: { databases: ['sqlite'] },
  },
  { instructions: ['WAL 모드 확인'] },
);
await makeAsset(
  {
    type: 'RULE',
    key: 'verify-before-completion',
    name: '완료 전 검증 필수',
    scopeType: 'COMPANY',
    inheritanceMode: 'LOCKED',
    ownerType: 'TEAM',
    ownerId: teamId,
  },
  { rule: '검증 없이 완료로 보고하지 않는다' },
);
await makeAsset(
  {
    type: 'KNOWLEDGE',
    key: 'db.odd.shape',
    name: '형식이 다른 자산',
    scopeType: 'COMPANY',
    ownerType: 'TEAM',
    ownerId: teamId,
    selector: { domains: ['database'] },
  },
  { unknownShape: { nested: ['값1', '값2'] } },
);
// 반드시 제외되는 자산을 하나 둔다. 제외 기록이 실제로 남는지 확인해야 하기 때문이다.
const pgId = await makeAsset(
  {
    type: 'VARIANT',
    key: 'db.variant.postgresql',
    name: 'PostgreSQL Variant',
    scopeType: 'COMPANY',
    ownerType: 'TEAM',
    ownerId: teamId,
    selector: { databases: ['postgresql'] },
  },
  { instructions: ['pg_stat_activity 확인'] },
);
for (const id of [variantId, pgId]) {
  await call('POST', `/organizations/${orgId}/assets/${id}/relations`, {
    toAssetId: coreId,
    type: 'VARIANT_OF',
  });
}

const request = {
  task: { description: 'DB 장애 분석', domain: ['database'], type: ['troubleshoot'] },
  environment: { database: 'sqlite' },
};

function pathsOf(result) {
  return result.compiled.files.map((file) => file.path);
}
function fileAt(result, path) {
  return result.compiled.files.find((file) => file.path === path)?.content ?? '';
}

console.log('\n── CODEX ──');
const codex = expectOk(
  'CODEX 컴파일',
  await call('POST', `/organizations/${orgId}/compile`, { ...request, target: 'CODEX' }),
);
const codexPaths = pathsOf(codex);
console.log(`  ${codexPaths.join(', ')}`);
check('AGENTS.md 생성', codexPaths.includes('AGENTS.md'), true);
check('CLAUDE.md 없음', codexPaths.includes('CLAUDE.md'), false);
check('skill 파일 생성', codexPaths.includes('.harness/skills/db.troubleshoot.core.md'), true);
check('metadata.target', codex.compiled.metadata.target, 'CODEX');
check('metadata에 traceId', codex.compiled.metadata.manifestTraceId, codex.manifest.traceId);

const agents = fileAt(codex, 'AGENTS.md');
check('bootstrap 라우터 포함', agents.includes('company.resolve_task'), true);
check('LOCKED 규칙 본문이 진입 파일에', agents.includes('검증 없이 완료로 보고하지 않는다'), true);
check('제외 사유도 기록', agents.includes('적용되지 않은 자산'), true);
check('어느 자산이 왜 빠졌는지 적힘', agents.includes('db.variant.postgresql'), true);

const skill = fileAt(codex, '.harness/skills/db.troubleshoot.core.md');
check('Variant가 core 문서에 합쳐짐', skill.includes('WAL 모드 확인'), true);
check('Variant 별도 파일 없음', codexPaths.includes('.harness/variants/db.variant.sqlite.md'), false);

const knowledge = fileAt(codex, '.harness/knowledge/db.odd.shape.md');
check('알 수 없는 형태를 버리지 않음', knowledge.includes('unknownShape'), true);

console.log('\n── CLAUDE_CODE ──');
const claude = expectOk(
  'CLAUDE_CODE 컴파일',
  await call('POST', `/organizations/${orgId}/compile`, { ...request, target: 'CLAUDE_CODE' }),
);
const claudePaths = pathsOf(claude);
console.log(`  ${claudePaths.join(', ')}`);
check('CLAUDE.md 생성', claudePaths.includes('CLAUDE.md'), true);
check('AGENTS.md 없음', claudePaths.includes('AGENTS.md'), false);
check(
  'skill이 .claude/skills 아래',
  claudePaths.includes('.claude/skills/db-troubleshoot-core/SKILL.md'),
  true,
);
const skillMd = fileAt(claude, '.claude/skills/db-troubleshoot-core/SKILL.md');
check('SKILL.md frontmatter', skillMd.startsWith('---\n'), true);
check('frontmatter에 name', skillMd.includes('name: db-troubleshoot-core'), true);

console.log('\n── 두 타깃 일관성 ──');
check(
  '같은 자산이 선택됨',
  JSON.stringify(codex.manifest.skills.map((r) => r.key)),
  JSON.stringify(claude.manifest.skills.map((r) => r.key)),
);
const codexManifest = JSON.parse(fileAt(codex, '.harness/manifest.json'));
const claudeManifest = JSON.parse(fileAt(claude, '.harness/manifest.json'));
check(
  'manifest.json이 선택 수와 일치',
  codexManifest.selected.length,
  codexManifest.resolution.selectedCount,
);
check(
  '두 타깃의 선택 자산이 동일',
  JSON.stringify(codexManifest.selected.map((s) => s.key).sort()),
  JSON.stringify(claudeManifest.selected.map((s) => s.key).sort()),
);
check(
  '배치 경로는 타깃마다 다름',
  codexManifest.selected.find((s) => s.key === 'db.troubleshoot.core').file !==
    claudeManifest.selected.find((s) => s.key === 'db.troubleshoot.core').file,
  true,
);

console.log('\n── 결정론 ──');
const again = expectOk(
  '재컴파일',
  await call('POST', `/organizations/${orgId}/compile`, { ...request, target: 'CODEX' }),
);
// traceId는 매번 새로 발급되므로 그 부분만 빼고 비교한다.
const strip = (result) =>
  result.compiled.files
    .filter((file) => file.path !== '.harness/manifest.json')
    .map((file) => ({ path: file.path, content: file.content.replace(/trace `[^`]+`/g, 'trace X') }));
check('같은 입력 → 같은 파일', JSON.stringify(strip(again)), JSON.stringify(strip(codex)));

console.log('\n── 입력 검증 ──');
check(
  '알 수 없는 target은 400',
  (await call('POST', `/organizations/${orgId}/compile`, { ...request, target: 'CURSOR' })).status,
  400,
);
check(
  'target 누락은 400',
  (await call('POST', `/organizations/${orgId}/compile`, request)).status,
  400,
);

console.log('\n── 컴파일이 흐름에 묶인다 ──');
const compiledTraceId = codex.compiled.metadata.manifestTraceId;
const postgresModule = await import('postgres');
const sql = postgresModule.default(
  process.env.DATABASE_URL ?? 'postgresql://harness:harness@localhost:5432/harnessvault',
);
try {
  const linked = await sql`
    select count(*)::int as c from audit_events
    where event_type = 'harness.compiled' and trace_id = ${compiledTraceId}
  `;
  // trace_id를 안 넘기면 targetId가 있어도 타임라인이 이어지지 않고
  // /traces의 "흐름 없는 이벤트"로 떨어진다.
  check('harness.compiled가 흐름에 묶인다', linked[0].c > 0, true);

  const timeline = expectOk(
    '흐름 상세',
    await call('GET', `/organizations/${orgId}/traces/${compiledTraceId}`),
  );
  check(
    '타임라인에 컴파일이 보인다',
    timeline.trace.events.some((event) => event.eventType === 'harness.compiled'),
    true,
  );
} finally {
  await sql.end();
}

console.log(`\n결과: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
