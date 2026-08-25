// Phase 7 완료 조건 검증: 모든 Resource Action이 ALLOW / APPROVAL_REQUIRED / DENY 중 하나로 결정된다.
import { randomBytes } from 'node:crypto';

const BASE = 'http://localhost:3000';
const MCP = `${BASE}/mcp`;
const ROOT = process.env.HARNESS_TEST_ROOT ?? 'C:/Users/invako/AppData/Local/Temp/harness-resources';

let cookie = '';
let pass = 0;
let fail = 0;

async function rest(method, path, body) {
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

function expectOk(label, res) {
  if (res.status >= 400) throw new Error(`${label} 실패: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

function check(label, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (${actual}${ok ? '' : ` != ${expected}`})`);
  if (ok) pass++;
  else fail++;
}

let seq = 0;
async function rpc(name, args, token, orgId) {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
      'x-harness-organization': orgId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++seq,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  return res.json();
}

function unwrap(body) {
  if (body.error) return { isError: true, text: JSON.stringify(body.error) };
  if (body.result?.isError) return { isError: true, text: body.result.content?.[0]?.text ?? '' };
  return { isError: false, data: JSON.parse(body.result.content[0].text) };
}

const stamp = Date.now();
const secret = randomBytes(18).toString('base64url');
const admin = { email: `pol-${stamp}@example.com`, password: secret, displayName: 'Policy 관리자' };

await rest('POST', '/auth/register', admin);
const loginRes = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: admin.email, password: admin.password }),
});
const rawCookie = (loginRes.headers.getSetCookie?.() ?? []).find((c) =>
  c.startsWith('harness_session='),
);
cookie = rawCookie?.split(';')[0] ?? '';
const token = rawCookie?.split('=')[1]?.split(';')[0] ?? '';

const orgId = expectOk('조직 생성', await rest('POST', '/organizations', {
  name: 'Policy Org',
  slug: `pol-${stamp}`,
})).organization.id;
const teamId = expectOk('팀', await rest('POST', `/organizations/${orgId}/teams`, {
  name: 'Ops',
  slug: 'ops',
})).team.id;

console.log('\n── 조직 생성 시 기본 정책 ──');
const initial = expectOk('정책 목록', await rest('GET', `/organizations/${orgId}/policies`));
check('기본 정책이 함께 만들어짐', initial.policies.length, 1);
check('기본 정책은 ALLOW', initial.policies[0]?.effect, 'ALLOW');
check('읽기 Action만 포함', initial.policies[0]?.actions.includes('files.read'), true);
// 쓰기를 기본 허용하면 정책 게이트의 의미가 없다.
check('쓰기 Action은 미포함', initial.policies[0]?.actions.includes('db.update'), false);
check('기본 정책은 OVERRIDABLE', initial.policies[0]?.inheritanceMode, 'OVERRIDABLE');
const defaultPolicyId = initial.policies[0].id;

const fsId = expectOk('FS Resource', await rest('POST', `/organizations/${orgId}/resources`, {
  type: 'FILE_SYSTEM',
  name: '운영 문서',
  classification: 'INTERNAL',
  ownerType: 'TEAM',
  ownerId: teamId,
  adapterType: 'filesystem',
  config: { root: `${ROOT}/docs` },
})).resource.id;

const dbId = expectOk('DB Resource', await rest('POST', `/organizations/${orgId}/resources`, {
  type: 'DATABASE',
  name: '데모 DB',
  classification: 'RESTRICTED',
  ownerType: 'TEAM',
  ownerId: teamId,
  adapterType: 'postgres',
  credentialRef: 'HARNESS_RESOURCE_DEMO_DB',
})).resource.id;

console.log('\n── 기본 정책으로 읽기가 동작한다 ──');
const read = unwrap(
  await rpc('company.files.read', { resourceId: fsId, path: 'README.md', purpose: '정책 확인' }, token, orgId),
);
check('기본 정책 하에 파일 읽기 성공', read.isError, false);

console.log('\n── dry-run 판정 ──');
const evaluate = async (resourceId, action) =>
  (await rest('POST', `/organizations/${orgId}/policies/evaluate`, { resourceId, action })).body
    .decision;

check('files.read → ALLOW', (await evaluate(fsId, 'files.read')).decision, 'ALLOW');
// 기본 정책에 쓰기가 없으므로 매칭이 없다 → fail closed.
const writeDecision = await evaluate(fsId, 'files.write');
check('files.write → DENY', writeDecision.decision, 'DENY');
check('사유가 NO_POLICY_MATCHED', writeDecision.reasonCode, 'NO_POLICY_MATCHED');
check('어떤 정책이 허용했는지 밝힘', (await evaluate(fsId, 'files.read')).policyIds[0], defaultPolicyId);

console.log('\n── §64 Case 3: ALLOW + DENY → DENY ──');
const denyPolicy = expectOk('DENY 정책', await rest('POST', `/organizations/${orgId}/policies`, {
  name: 'RESTRICTED 조회 금지',
  effect: 'DENY',
  scopeType: 'COMPANY',
  classification: 'RESTRICTED',
  actions: ['db.query'],
})).policy;
check('DB 조회가 DENY로 바뀜', (await evaluate(dbId, 'db.query')).decision, 'DENY');
check('INTERNAL 자원은 영향 없음', (await evaluate(fsId, 'files.read')).decision, 'ALLOW');

const blocked = unwrap(
  await rpc('company.db.query', { resourceId: dbId, query: 'select 1', purpose: '정책 거부 확인' }, token, orgId),
);
check('MCP 실행도 막힌다', blocked.isError, true);
check('POLICY_DENIED로 알린다', blocked.text.includes('POLICY_DENIED'), true);

console.log('\n── §64 Case 2: ALLOW + APPROVAL_REQUIRED ──');
await rest('PATCH', `/organizations/${orgId}/policies/${denyPolicy.id}`, {
  effect: 'APPROVAL_REQUIRED',
});
const approval = await evaluate(dbId, 'db.query');
check('APPROVAL_REQUIRED로 판정', approval.decision, 'APPROVAL_REQUIRED');
check('승인 계약이 없으면 null', approval.approvalPolicyId, null);

const pending = unwrap(
  await rpc('company.db.query', { resourceId: dbId, query: 'select 1', purpose: '승인 필요 확인' }, token, orgId),
);
// 승인 없이 실행하면 §34를 정면으로 어긴다.
check('승인 없이 실행하지 않는다', pending.isError, true);
check('APPROVAL_REQUIRED로 알린다', pending.text.includes('APPROVAL_REQUIRED'), true);

console.log('\n── §64 Case 1: Company LOCKED DENY + Project ALLOW ──');
const projectId = expectOk('프로젝트', await rest('POST', `/organizations/${orgId}/projects`, {
  name: 'Edge',
  slug: 'edge',
})).project.id;
const me = (await rest('GET', '/auth/me')).body.user.id;
await rest('POST', `/organizations/${orgId}/projects/${projectId}/members`, {
  userId: me,
  role: 'PROJECT_OWNER',
});

await rest('POST', `/organizations/${orgId}/policies`, {
  name: '회사 잠금 거부',
  effect: 'DENY',
  scopeType: 'COMPANY',
  inheritanceMode: 'LOCKED',
  resourceId: fsId,
  actions: ['files.read'],
});
await rest('POST', `/organizations/${orgId}/policies`, {
  name: '프로젝트 허용 시도',
  effect: 'ALLOW',
  scopeType: 'PROJECT',
  scopeId: projectId,
  resourceId: fsId,
  actions: ['files.read'],
});

const locked = (
  await rest('POST', `/organizations/${orgId}/policies/evaluate`, {
    resourceId: fsId,
    action: 'files.read',
    projectId,
  })
).body.decision;
check('Company LOCKED DENY가 이긴다', locked.decision, 'DENY');
check('사유가 EXPLICIT_DENY', locked.reasonCode, 'EXPLICIT_DENY');

console.log('\n── 정책 비활성화 ──');
const policies = expectOk('목록', await rest('GET', `/organizations/${orgId}/policies`));
const lockedPolicy = policies.policies.find((p) => p.name === '회사 잠금 거부');
await rest('PATCH', `/organizations/${orgId}/policies/${lockedPolicy.id}`, { enabled: false });
const afterDisable = (
  await rest('POST', `/organizations/${orgId}/policies/evaluate`, {
    resourceId: fsId,
    action: 'files.read',
    projectId,
  })
).body.decision;
check('비활성 정책은 판정에서 빠진다', afterDisable.decision, 'ALLOW');

console.log('\n── 권한 ──');
check(
  '정책 목록은 멤버면 조회 가능',
  (await rest('GET', `/organizations/${orgId}/policies`)).status,
  200,
);
check(
  '잘못된 Action은 400',
  (await rest('POST', `/organizations/${orgId}/policies/evaluate`, {
    resourceId: fsId,
    action: 'not.an.action',
  })).status,
  400,
);

console.log('\n── 감사 기록 ──');
const postgresModule = await import('postgres');
const sql = postgresModule.default(
  process.env.DATABASE_URL ?? 'postgresql://harness:harness@localhost:5432/harnessvault',
);
try {
  const rows = await sql`
    select metadata from audit_events
    where organization_id = ${orgId} and event_type = 'policy.evaluated'
  `;
  check('판정이 감사에 남는다', rows.length > 0, true);
  check('거부된 판정도 남는다', rows.some((r) => r.metadata?.decision === 'DENY'), true);
  check('어떤 정책이 판정했는지 남는다', Array.isArray(rows[0]?.metadata?.policyIds), true);
  check(
    'LOCKED로 빠진 정책도 남는다',
    rows.some((r) => (r.metadata?.blockedByLocked ?? []).length > 0),
    true,
  );
} finally {
  await sql.end();
}

console.log(`\n결과: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
