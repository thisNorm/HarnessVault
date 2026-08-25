// Phase 6 완료 조건 검증: 외부 AI가 raw credential 없이 Resource에 접근할 수 있다.
//
// 사전 준비 — test/setup-resources.mjs가 만든 디렉터리·저장소·DB가 필요하다.
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
  const body = await res.json();
  return body;
}

/** 툴 결과를 꺼낸다. 오류면 그 사실을 그대로 돌려준다 — 성공처럼 감싸지 않는다. */
function unwrap(body) {
  if (body.error) return { isError: true, text: JSON.stringify(body.error) };
  if (body.result?.isError) {
    return { isError: true, text: body.result.content?.[0]?.text ?? '' };
  }
  return { isError: false, data: JSON.parse(body.result.content[0].text) };
}

const stamp = Date.now();
const secret = randomBytes(18).toString('base64url');
const admin = { email: `res-${stamp}@example.com`, password: secret, displayName: 'Resource 관리자' };

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
  name: 'Resource Org',
  slug: `res-${stamp}`,
})).organization.id;
await rest("GET", "/auth/me");
const teamId = expectOk('팀', await rest('POST', `/organizations/${orgId}/teams`, {
  name: 'Ops',
  slug: 'ops',
})).team.id;

console.log('\n── Resource 등록 ──');
const fsRes = await rest('POST', `/organizations/${orgId}/resources`, {
  type: 'FILE_SYSTEM',
  name: '운영 문서',
  classification: 'INTERNAL',
  ownerType: 'TEAM',
  ownerId: teamId,
  adapterType: 'filesystem',
  config: { root: `${ROOT}/docs`, maxBytes: 100000 },
});
check('FILE_SYSTEM 등록', fsRes.status, 201);
const fsId = fsRes.body.resource.id;

const dbRes = await rest('POST', `/organizations/${orgId}/resources`, {
  type: 'DATABASE',
  name: '데모 DB',
  classification: 'RESTRICTED',
  ownerType: 'TEAM',
  ownerId: teamId,
  adapterType: 'postgres',
  config: { maxRows: 50 },
  credentialRef: 'HARNESS_RESOURCE_DEMO_DB',
});
check('DATABASE 등록', dbRes.status, 201);
const dbId = dbRes.body.resource.id;

const gitRes = await rest('POST', `/organizations/${orgId}/resources`, {
  type: 'GIT',
  name: '문서 저장소',
  ownerType: 'TEAM',
  ownerId: teamId,
  adapterType: 'git',
  config: { root: `${ROOT}/docs` },
});
check('GIT 등록', gitRes.status, 201);
const gitId = gitRes.body.resource.id;

console.log('\n── credential 접두사 제약 ──');
// 이 제약이 없으면 ORG_ADMIN이 이 앱 자신의 DB를 Resource로 등록할 수 있다.
check(
  '앱 자신의 DATABASE_URL 참조 거부',
  (await rest('POST', `/organizations/${orgId}/resources`, {
    type: 'DATABASE',
    name: '탈취 시도',
    ownerType: 'TEAM',
    ownerId: teamId,
    adapterType: 'postgres',
    credentialRef: 'DATABASE_URL',
  })).status,
  400,
);
check(
  '소문자 이름 거부',
  (await rest('POST', `/organizations/${orgId}/resources`, {
    type: 'DATABASE',
    name: '탈취 시도2',
    ownerType: 'TEAM',
    ownerId: teamId,
    adapterType: 'postgres',
    credentialRef: 'harness_resource_x',
  })).status,
  400,
);

console.log('\n── credential 비노출 (§60) ──');
const listed = expectOk('목록', await rest('GET', `/organizations/${orgId}/resources`));
const listedJson = JSON.stringify(listed);
check('접속 문자열이 응답에 없음', listedJson.includes('postgresql://'), false);
check('비밀번호가 응답에 없음', listedJson.includes('harness:harness'), false);
check('환경변수 이름은 노출됨', listedJson.includes('HARNESS_RESOURCE_DEMO_DB'), true);
check(
  'credential 설정 여부만 알림',
  listed.resources.find((r) => r.id === dbId)?.credentialConfigured,
  true,
);

console.log('\n── MCP: company.resources ──');
const resources = unwrap(await rpc('company.resources', {}, token, orgId));
check('MCP로 목록 조회', resources.data.resources.length, 3);
check(
  'MCP 응답에도 credential 값 없음',
  JSON.stringify(resources.data).includes('postgresql://'),
  false,
);

console.log('\n── MCP: files ──');
const search = unwrap(
  await rpc(
    'company.files.search',
    { resourceId: fsId, query: '커넥션', purpose: 'DB 장애 원인 조사' },
    token,
    orgId,
  ),
);
check('파일 내용 검색', search.data.matches.length > 0, true);
check('검색 결과에 경로', search.data.matches[0]?.path, 'README.md');

const read = unwrap(
  await rpc(
    'company.files.read',
    { resourceId: fsId, path: 'runbooks/db-incident.md', purpose: '런북 확인' },
    token,
    orgId,
  ),
);
check('파일 읽기', read.data.content.includes('pg_stat_activity'), true);

const ranged = unwrap(
  await rpc(
    'company.files.read',
    { resourceId: fsId, path: 'runbooks/db-incident.md', range: { start: 2, end: 2 }, purpose: '범위 확인' },
    token,
    orgId,
  ),
);
check('줄 범위 적용', ranged.data.content.trim(), '1. pg_stat_activity 확인');

console.log('\n── 경로 탈출 차단 ──');
for (const bad of ['../secret-outside/secret.txt', '../../secret-outside/secret.txt']) {
  const escaped = unwrap(
    await rpc('company.files.read', { resourceId: fsId, path: bad, purpose: '탈출 시도' }, token, orgId),
  );
  check(`root 밖 접근 차단 (${bad})`, escaped.isError, true);
  check(`비밀 내용이 새지 않음 (${bad})`, JSON.stringify(escaped).includes('root 밖의 비밀'), false);
}

const missing = unwrap(
  await rpc('company.files.read', { resourceId: fsId, path: 'no-such-file.md', purpose: '없는 파일' }, token, orgId),
);
check('없는 파일은 빈 결과가 아니라 실패', missing.isError, true);

console.log('\n── MCP: db ──');
const schema = unwrap(
  await rpc('company.db.schema', { resourceId: dbId, purpose: '스키마 파악' }, token, orgId),
);
check('스키마 조회', schema.data.objects.some((o) => o.table === 'events_summary'), true);
check('컬럼 포함', schema.data.objects.find((o) => o.table === 'events_summary')?.columns.includes('topic'), true);

const query = unwrap(
  await rpc(
    'company.db.query',
    { resourceId: dbId, query: 'select topic, count from events_summary order by topic', purpose: 'MQTT 수집량 확인' },
    token,
    orgId,
  ),
);
check('SELECT 실행', query.data.rowCount, 2);
check('행 내용', query.data.rows[0]?.topic, 'sensor/humidity');

console.log('\n── 쓰기 차단 (Phase 6은 읽기 전용) ──');
for (const bad of [
  "insert into users_demo (email) values ('x@example.com')",
  'delete from users_demo',
  'drop table users_demo',
  "select 1; delete from users_demo",
  'with x as (insert into users_demo (email) values (1) returning *) select * from x',
]) {
  const blocked = unwrap(
    await rpc('company.db.query', { resourceId: dbId, query: bad, purpose: '쓰기 시도' }, token, orgId),
  );
  check(`쓰기 거부: ${bad.slice(0, 30)}`, blocked.isError, true);
}
const stillThere = unwrap(
  await rpc('company.db.query', { resourceId: dbId, query: 'select count(*) as c from users_demo', purpose: '무결성 확인' }, token, orgId),
);
check('데이터가 그대로다', String(stillThere.data.rows[0]?.c), '1');

console.log('\n── MCP: git ──');
const status = unwrap(
  await rpc('company.git.status', { resourceId: gitId, purpose: '작업 상태 확인' }, token, orgId),
);
check('브랜치 조회', status.data.branch, 'main');
check('미커밋 변경 감지', status.data.changes.length > 0, true);

const gitRead = unwrap(
  await rpc('company.git.read', { resourceId: gitId, path: 'README.md', purpose: 'HEAD 내용 확인' }, token, orgId),
);
check('HEAD 파일 읽기', gitRead.data.content.includes('커넥션 풀'), true);
check('작업 트리 변경은 안 보임', gitRead.data.content.includes('미커밋 변경'), false);

console.log('\n── purpose 필수 ──');
const noPurpose = unwrap(
  await rpc('company.files.read', { resourceId: fsId, path: 'README.md' }, token, orgId),
);
check('purpose 없으면 거부', noPurpose.isError, true);

console.log('\n── 비활성 Resource ──');
await rest('PATCH', `/organizations/${orgId}/resources/${fsId}`, { enabled: false });
const disabled = unwrap(
  await rpc('company.files.read', { resourceId: fsId, path: 'README.md', purpose: '비활성 확인' }, token, orgId),
);
check('비활성 Resource 접근 거부', disabled.isError, true);
await rest('PATCH', `/organizations/${orgId}/resources/${fsId}`, { enabled: true });

console.log('\n── 타입 불일치 ──');
const wrongType = unwrap(
  await rpc('company.db.query', { resourceId: fsId, query: 'select 1', purpose: '타입 확인' }, token, orgId),
);
check('FILE_SYSTEM에 db.query 거부', wrongType.isError, true);

console.log('\n── 감사 기록 (§39) ──');
const events = expectOk('감사 조회', await rest('GET', `/organizations/${orgId}/resources`));
void events;
const postgresModule = await import('postgres');
const sql = postgresModule.default(
  process.env.DATABASE_URL ?? 'postgresql://harness:harness@localhost:5432/harnessvault',
);
try {
  const rows = await sql`
    select event_type, metadata from audit_events
    where organization_id = ${orgId} and event_type in ('resource.accessed', 'resource.access_failed')
  `;
  check('접근이 감사에 남음', rows.length > 0, true);
  const accessed = rows.filter((r) => r.event_type === 'resource.accessed');
  check('실패도 감사에 남음', rows.some((r) => r.event_type === 'resource.access_failed'), true);
  check('purpose가 기록됨', typeof accessed[0]?.metadata?.purpose, 'string');
  const dbAccess = accessed.find((r) => r.metadata?.action === 'db.query');
  check('질의 지문이 기록됨', typeof dbAccess?.metadata?.queryFingerprint, 'string');

  const auditJson = JSON.stringify(rows);
  check('감사 로그에 접속 문자열 없음', auditJson.includes('postgresql://'), false);
  check('감사 로그에 응답 본문 없음', auditJson.includes('pg_stat_activity'), false);
} finally {
  await sql.end();
}

console.log(`\n결과: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
