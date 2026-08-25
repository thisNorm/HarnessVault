// Phase 1 완료 조건 검증: 가입 → 조직 생성 → 팀/프로젝트/그룹에 사용자 배치
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
  const setCookie = res.headers.getSetCookie?.() ?? [];
  for (const c of setCookie) {
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
// 리터럴을 두지 않는다. 저장소에 남는 비밀번호는 그 자체로 나쁜 선례다.
const secret = randomBytes(18).toString('base64url');
const admin = { email: `admin-${stamp}@example.com`, password: secret, displayName: '관리자 김수형' };
const member = { email: `member-${stamp}@example.com`, password: secret, displayName: '팀원 이하늘' };
const outsider = { email: `out-${stamp}@example.com`, password: secret, displayName: '외부인 박' };

console.log('\n── 가입 ──');
check('관리자 가입', (await call('POST', '/auth/register', admin)).status, 201);
const memberRes = await call('POST', '/auth/register', member);
check('멤버 가입', memberRes.status, 201);
const memberId = memberRes.body.user.id;
const outsiderRes = await call('POST', '/auth/register', outsider);
check('외부인 가입', outsiderRes.status, 201);
const outsiderId = outsiderRes.body.user.id;

console.log('\n── 로그인 ──');
check('관리자 로그인', (await call('POST', '/auth/login', { email: admin.email, password: admin.password })).status, 200);

console.log('\n── 조직 ──');
const orgRes = await call('POST', '/organizations', { name: 'Acme Corporation', slug: `acme-${stamp}` });
check('조직 생성', orgRes.status, 201);
const orgId = orgRes.body.organization.id;

const meRes = await call('GET', '/auth/me');
check('생성자가 ORG_ADMIN', meRes.body.organizations[0]?.role, 'ORG_ADMIN');
check('조직 상세 조회', (await call('GET', `/organizations/${orgId}`)).status, 200);
check('없는 조직은 404', (await call('GET', '/organizations/00000000-0000-0000-0000-000000000000')).status, 404);
check('잘못된 orgId 형식도 404', (await call('GET', '/organizations/not-a-uuid')).status, 404);

console.log('\n── 조직 멤버 ──');
check('멤버 추가', (await call('POST', `/organizations/${orgId}/members`, { email: member.email })).status, 201);
check('멤버 목록 2명', (await call('GET', `/organizations/${orgId}/members`)).body.members.length, 2);
check('미가입 이메일 추가는 404', (await call('POST', `/organizations/${orgId}/members`, { email: 'nobody@example.com' })).status, 404);
check('마지막 관리자 제거 차단', (await call('DELETE', `/organizations/${orgId}/members/${meRes.body.user.id}`)).status, 409);

console.log('\n── 팀 ──');
const teamRes = await call('POST', `/organizations/${orgId}/teams`, { name: 'Backend Team', slug: 'backend' });
check('팀 생성', teamRes.status, 201);
const teamId = teamRes.body.team.id;
check('중복 slug 거부', (await call('POST', `/organizations/${orgId}/teams`, { name: 'x', slug: 'backend' })).status, 409);
check('팀 멤버 배치', (await call('POST', `/organizations/${orgId}/teams/${teamId}/members`, { userId: memberId })).status, 201);
check('중복 배치는 멱등', (await call('POST', `/organizations/${orgId}/teams/${teamId}/members`, { userId: memberId })).status, 201);
check('팀 멤버 1명', (await call('GET', `/organizations/${orgId}/teams/${teamId}/members`)).body.members.length, 1);
check('조직 밖 사용자 배치 차단', (await call('POST', `/organizations/${orgId}/teams/${teamId}/members`, { userId: outsiderId })).status, 404);
check('팀 목록 memberCount', (await call('GET', `/organizations/${orgId}/teams`)).body.teams[0].memberCount, 1);

console.log('\n── 프로젝트 ──');
const projRes = await call('POST', `/organizations/${orgId}/projects`, { name: 'Edge Server', slug: 'edge-server', teamId });
check('프로젝트 생성(팀 연결)', projRes.status, 201);
const projectId = projRes.body.project.id;
check('teamId 연결됨', projRes.body.project.teamId, teamId);
check('프로젝트 멤버 배치(OWNER)', (await call('POST', `/organizations/${orgId}/projects/${projectId}/members`, { userId: memberId, role: 'PROJECT_OWNER' })).status, 201);
check('마지막 OWNER 제거 차단', (await call('DELETE', `/organizations/${orgId}/projects/${projectId}/members/${memberId}`)).status, 409);
check('잘못된 role 거부', (await call('POST', `/organizations/${orgId}/projects/${projectId}/members`, { userId: memberId, role: 'GOD' })).status, 400);

console.log('\n── 그룹 ──');
const groupRes = await call('POST', `/organizations/${orgId}/groups`, { name: 'Security Team', slug: 'security' });
check('그룹 생성', groupRes.status, 201);
const groupId = groupRes.body.group.id;
check('그룹 멤버 배치', (await call('POST', `/organizations/${orgId}/groups/${groupId}/members`, { userId: memberId })).status, 201);
check('그룹 멤버 제거', (await call('DELETE', `/organizations/${orgId}/groups/${groupId}/members/${memberId}`)).status, 204);

console.log('\n── 권한 ──');
const adminCookie = cookie;
await call('POST', '/auth/login', { email: member.email, password: member.password });
check('일반 멤버는 팀 생성 불가', (await call('POST', `/organizations/${orgId}/teams`, { name: 'x', slug: 'nope' })).status, 403);
check('일반 멤버도 팀 목록은 조회', (await call('GET', `/organizations/${orgId}/teams`)).status, 200);

await call('POST', '/auth/login', { email: outsider.email, password: outsider.password });
check('비멤버는 조직 자체가 404', (await call('GET', `/organizations/${orgId}/teams`)).status, 404);

cookie = adminCookie;
check('로그아웃', (await call('POST', '/auth/logout')).status, 204);
check('로그아웃 후 401', (await call('GET', '/auth/me')).status, 401);


// 구현원칙 #8 — 중요한 상태 변경은 Audit Event를 남긴다.
// 트랜잭션 안에서 다른 커넥션으로 감사를 쓰면 조용히 유실되므로 실제 행을 확인한다.
console.log('\n── 감사 로그 ──');
const dbUrl =
  process.env.DATABASE_URL ?? 'postgresql://harness:harness@localhost:5432/harnessvault';
const sql = postgres(dbUrl);
try {
  const rows = await sql`select event_type from audit_events where organization_id = ${orgId}`;
  const recorded = new Set(rows.map((row) => row.event_type));
  for (const expected of [
    'organization.created',
    'team.created',
    'project.created',
    'group.created',
    'membership.granted',
    'membership.revoked',
  ]) {
    check(`${expected} 기록됨`, recorded.has(expected), true);
  }
} finally {
  await sql.end();
}

console.log(`\n결과: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
