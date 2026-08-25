// Phase 3 완료 조건 검증: user + project + task + environment → 결정론적 Manifest.
// 순수 함수 단위 테스트(resolve.test.ts)가 §63 케이스를 덮고,
// 여기서는 실제 DB 로딩과 붙였을 때 같은 결과가 나오는지 확인한다.
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';

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

const stamp = Date.now();
const secret = randomBytes(18).toString('base64url');
const admin = { email: `r-admin-${stamp}@example.com`, password: secret, displayName: 'Resolver 관리자' };
const outsider = { email: `r-out-${stamp}@example.com`, password: secret, displayName: '외부인' };

await call('POST', '/auth/register', admin);
await call('POST', '/auth/register', outsider);
await call('POST', '/auth/login', { email: admin.email, password: admin.password });

const { body: orgBody } = await call('POST', '/organizations', {
  name: 'Resolver Org',
  slug: `resolver-${stamp}`,
});
const orgId = orgBody.organization.id;
const me = await call('GET', '/auth/me');
const userId = me.body.user.id;

const { body: teamBody } = await call('POST', `/organizations/${orgId}/teams`, {
  name: 'DBA',
  slug: 'dba',
});
const teamId = teamBody.team.id;
await call('POST', `/organizations/${orgId}/teams/${teamId}/members`, { userId });

const { body: projBody } = await call('POST', `/organizations/${orgId}/projects`, {
  name: 'Edge',
  slug: 'edge',
  teamId,
});
const projectId = projBody.project.id;
await call('POST', `/organizations/${orgId}/projects/${projectId}/members`, {
  userId,
  role: 'PROJECT_OWNER',
});

/** 응답이 실패면 그 자리에서 드러나게 한다. 뒤에서 undefined로 터지면 원인을 찾기 어렵다. */
function expectOk(label, res) {
  if (res.status >= 400) {
    throw new Error(`${label} 실패: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

/** 자산을 만들고 ACTIVE로 올린다. tokens는 대략적인 크기 조절용이다. */
async function makeAsset(asset, tokens = 100) {
  const created = expectOk('자산 생성', await call('POST', `/organizations/${orgId}/assets`, asset));
  const id = created.asset.id;
  const version = expectOk(
    '버전 생성',
    await call('POST', `/organizations/${orgId}/assets/${id}/versions`, {
      version: '1.0',
      summary: asset.name,
      // summary는 2000자 제한이 있다. 크기는 본문으로 만든다.
      structuredContent: { body: 'x'.repeat(tokens * 4) },
      status: 'CANDIDATE',
    }),
  );
  await call('POST', `/organizations/${orgId}/assets/${id}/versions/${version.version.id}/promote`);
  await call('PATCH', `/organizations/${orgId}/assets/${id}`, { status: 'ACTIVE' });
  return id;
}

const coreId = await makeAsset({
  type: 'SKILL',
  key: 'db.troubleshoot.core',
  name: 'DB 진단 핵심',
  scopeType: 'COMPANY',
  inheritanceMode: 'EXTENDABLE',
  ownerType: 'TEAM',
  ownerId: teamId,
  selector: { domains: ['database'], tasks: ['troubleshoot'] },
});
const sqliteId = await makeAsset({
  type: 'VARIANT',
  key: 'db.variant.sqlite',
  name: 'SQLite Variant',
  scopeType: 'COMPANY',
  ownerType: 'TEAM',
  ownerId: teamId,
  selector: { databases: ['sqlite'] },
});
const pgId = await makeAsset({
  type: 'VARIANT',
  key: 'db.variant.postgresql',
  name: 'PostgreSQL Variant',
  scopeType: 'COMPANY',
  ownerType: 'TEAM',
  ownerId: teamId,
  selector: { databases: ['postgresql'] },
});
await makeAsset({
  type: 'RULE',
  key: 'verify-before-completion',
  name: '완료 전 검증 필수',
  scopeType: 'COMPANY',
  inheritanceMode: 'LOCKED',
  ownerType: 'TEAM',
  ownerId: teamId,
});
await makeAsset({
  type: 'RULE',
  key: 'verify-before-completion',
  name: '완료 전 검증 — 프로젝트 완화',
  scopeType: 'PROJECT',
  scopeId: projectId,
  inheritanceMode: 'OVERRIDABLE',
  ownerType: 'PROJECT',
  ownerId: projectId,
});
await makeAsset({
  type: 'VALIDATION',
  key: 'db.checklist',
  name: 'DB 체크리스트 — 회사',
  scopeType: 'COMPANY',
  inheritanceMode: 'EXTENDABLE',
  ownerType: 'TEAM',
  ownerId: teamId,
});
await makeAsset({
  type: 'VALIDATION',
  key: 'db.checklist',
  name: 'DB 체크리스트 — 팀',
  scopeType: 'TEAM',
  scopeId: teamId,
  inheritanceMode: 'EXTENDABLE',
  ownerType: 'TEAM',
  ownerId: teamId,
});
await makeAsset(
  {
    type: 'KNOWLEDGE',
    key: 'db.reference.notes',
    name: '참고 자료',
    scopeType: 'COMPANY',
    ownerType: 'TEAM',
    ownerId: teamId,
  },
  2000,
);

for (const variantId of [sqliteId, pgId]) {
  await call('POST', `/organizations/${orgId}/assets/${variantId}/relations`, {
    toAssetId: coreId,
    type: 'VARIANT_OF',
  });
}

const baseRequest = {
  projectId,
  task: { description: 'DB 장애 분석', domain: ['database'], type: ['troubleshoot'] },
  environment: { database: 'sqlite', os: 'linux' },
  client: { name: 'Codex CLI', version: '0.20.1', model: 'gpt-5' },
};

function keysOf(manifest) {
  return [
    ...manifest.rules,
    ...manifest.policies,
    ...manifest.validations,
    ...manifest.workflows,
    ...manifest.skills,
    ...manifest.variants,
    ...manifest.knowledge,
  ].map((ref) => `${ref.key}@${ref.scope}`);
}

console.log('\n── 기본 해석 ──');
const first = await call('POST', `/organizations/${orgId}/resolve`, baseRequest);
check('resolve 성공', first.status, 200);
const manifest = first.body.manifest;
check('traceId 발급', typeof manifest.traceId, 'string');
// Phase 10부터 계약이 실린다. 계약이 하나도 없으면 빈 배열이지 null이 아니다.
check('outputContract가 실린다', Array.isArray(manifest.outputContract?.requiredFields), true);
check('계약이 없으면 빈 배열', manifest.outputContract.requiredFields.length, 0);

const keys = keysOf(manifest);
console.log(`  선택: ${keys.join(', ')}`);

console.log('\n── §63 Case 1: LOCKED 상위 유지 ──');
check('Company LOCKED Rule 포함', keys.includes('verify-before-completion@COMPANY'), true);
check('Project override 제외', keys.includes('verify-before-completion@PROJECT'), false);
check(
  '제외 사유가 LOCKED_BY_PARENT',
  manifest.excluded.find((e) => e.key === 'verify-before-completion' && e.scope === 'PROJECT')
    ?.reasonCode,
  'LOCKED_BY_PARENT',
);

console.log('\n── §63 Case 2: EXTENDABLE 누적 ──');
check('Company validation 포함', keys.includes('db.checklist@COMPANY'), true);
check('Team validation 포함', keys.includes('db.checklist@TEAM'), true);

console.log('\n── §63 Case 4: 환경에 맞는 Variant만 ──');
check('SQLite Variant 포함', keys.includes('db.variant.sqlite@COMPANY'), true);
check('PostgreSQL Variant 제외', keys.includes('db.variant.postgresql@COMPANY'), false);
check(
  '제외 사유가 SELECTOR_MISMATCH',
  manifest.excluded.find((e) => e.key === 'db.variant.postgresql')?.reasonCode,
  'SELECTOR_MISMATCH',
);

console.log('\n── 결정론 ──');
const second = await call('POST', `/organizations/${orgId}/resolve`, baseRequest);
check('같은 입력 → 같은 선택', JSON.stringify(keysOf(second.body.manifest)), JSON.stringify(keys));
check(
  '같은 입력 → 같은 제외',
  JSON.stringify(second.body.manifest.excluded.map((e) => e.key).sort()),
  JSON.stringify(manifest.excluded.map((e) => e.key).sort()),
);
check('traceId는 매번 새로 발급', second.body.manifest.traceId !== manifest.traceId, true);

console.log('\n── §63 Case 5: Context budget ──');
const budgeted = await call('POST', `/organizations/${orgId}/resolve`, {
  ...baseRequest,
  contextBudget: 600,
});
const budgetKeys = keysOf(budgeted.body.manifest);
check('mandatory RULE 유지', budgetKeys.includes('verify-before-completion@COMPANY'), true);
check('큰 KNOWLEDGE 제외', budgetKeys.includes('db.reference.notes@COMPANY'), false);
check(
  '제외 사유가 CONTEXT_BUDGET_EXCEEDED',
  budgeted.body.manifest.excluded.find((e) => e.key === 'db.reference.notes')?.reasonCode,
  'CONTEXT_BUDGET_EXCEEDED',
);
check('예산이 응답에 그대로 보고됨', budgeted.body.manifest.resolution.estimatedAvailableTokens, 600);

console.log('\n── §63 Case 3: ACTIVE 버전 2개 ──');
const { body: extra } = await call('POST', `/organizations/${orgId}/assets/${coreId}/versions`, {
  version: '1.1',
  structuredContent: {},
  status: 'CANDIDATE',
});
await call('POST', `/organizations/${orgId}/assets/${coreId}/versions/${extra.version.id}/promote`);
// 승격은 기존 ACTIVE를 SUPERSEDED로 내리므로, 충돌을 만들려면 되살려야 한다.
const versions = await call('GET', `/organizations/${orgId}/assets/${coreId}`);
const superseded = versions.body.versions.find((v) => v.status === 'SUPERSEDED');
check('승격이 기존 ACTIVE를 내렸다', Boolean(superseded), true);

// 승격 경로는 ACTIVE를 하나로 유지한다. 충돌 상태는 직접 만들어야 한다.
const sql = postgres(
  process.env.DATABASE_URL ?? 'postgresql://harness:harness@localhost:5432/harnessvault',
);
try {
  await sql`update asset_versions set status = 'ACTIVE' where id = ${superseded.id}`;

  const conflicted = await call('POST', `/organizations/${orgId}/resolve`, baseRequest);
  check('ACTIVE 2개면 409로 실패', conflicted.status, 409);
  check('실패 코드가 RESOLUTION_CONFLICT', conflicted.body.code, 'RESOLUTION_CONFLICT');
  check('어느 자산이 충돌인지 알려준다', conflicted.body.conflicts?.[0]?.key, 'db.troubleshoot.core');
  check('충돌 종류를 알려준다', conflicted.body.conflicts?.[0]?.kind, 'MULTIPLE_ACTIVE_VERSIONS');
  check('충돌해도 traceId는 남는다', typeof conflicted.body.traceId, 'string');

  const conflictEvents = await sql`
    select count(*)::int as count from audit_events
    where organization_id = ${orgId} and event_type = 'harness.resolution_conflict'
  `;
  check('충돌도 감사 로그에 남는다', conflictEvents[0].count >= 1, true);

  await sql`update asset_versions set status = 'SUPERSEDED' where id = ${superseded.id}`;
  const recovered = await call('POST', `/organizations/${orgId}/resolve`, baseRequest);
  check('충돌을 해소하면 다시 성공', recovered.status, 200);
} finally {
  await sql.end();
}

console.log('\n── 프로젝트 접근 ──');
check(
  '조직 밖 프로젝트 id는 404',
  (await call('POST', `/organizations/${orgId}/resolve`, {
    ...baseRequest,
    projectId: '00000000-0000-0000-0000-000000000000',
  })).status,
  404,
);

const adminCookie = cookie;
await call('POST', '/auth/login', { email: outsider.email, password: outsider.password });
check(
  '비멤버는 조직 자체가 404',
  (await call('POST', `/organizations/${orgId}/resolve`, baseRequest)).status,
  404,
);
cookie = adminCookie;

console.log('\n── 입력 검증 ──');
check(
  '작업 설명 없으면 400',
  (await call('POST', `/organizations/${orgId}/resolve`, { task: { description: '' } })).status,
  400,
);
check(
  '음수 예산은 400',
  (await call('POST', `/organizations/${orgId}/resolve`, { ...baseRequest, contextBudget: -1 }))
    .status,
  400,
);

console.log(`\n결과: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
