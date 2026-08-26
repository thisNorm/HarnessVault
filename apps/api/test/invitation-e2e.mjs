// 조직 초대 검증. 핵심은 "아직 가입하지 않은 사람도 들일 수 있는가"와
// "토큰 원문이 생성 응답 밖으로 새지 않는가"다.
import { randomBytes } from 'node:crypto';

const BASE = 'http://localhost:3000';

let pass = 0;
let fail = 0;

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

function person(displayName) {
  const suffix = randomBytes(6).toString('hex');
  return {
    displayName,
    email: `invite-${suffix}@example.com`,
    password: randomBytes(18).toString('base64url'),
    cookie: '',
    async rest(method, path, body) {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
          ...(body ? { 'content-type': 'application/json; charset=utf-8' } : {}),
          ...(this.cookie ? { cookie: this.cookie } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    },
  };
}

async function register(actor) {
  await actor.rest('POST', '/auth/register', {
    email: actor.email,
    password: actor.password,
    displayName: actor.displayName,
  });
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: actor.email, password: actor.password }),
  });
  const raw = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('harness_session='));
  actor.cookie = raw?.split(';')[0] ?? '';
  actor.id = (await actor.rest('GET', '/auth/me')).body.user.id;
  return actor;
}

const stamp = Date.now();
const admin = await register(person('조직 관리자'));
const orgId = expectOk(
  '조직',
  await admin.rest('POST', '/organizations', { name: '초대 회사', slug: `invite-${stamp}` }),
).organization.id;

console.log('\n── 가입하지 않은 사람은 직접 추가할 수 없다 ──');
const newcomerEmail = `newcomer-${stamp}@example.com`;
check(
  '미가입 이메일 직접 추가 거부',
  (await admin.rest('POST', `/organizations/${orgId}/members`, { email: newcomerEmail })).status,
  404,
);

console.log('\n── 초대 생성 ──');
const issued = expectOk(
  '초대',
  await admin.rest('POST', `/organizations/${orgId}/invitations`, {
    email: newcomerEmail,
    role: 'ORG_MEMBER',
    note: '플랫폼 팀에 합류합니다',
  }),
).invitation;
check('PENDING으로 생성', issued.status, 'PENDING');
check('토큰이 한 번 나온다', typeof issued.token, 'string');
check('토큰 길이', issued.token.length >= 32, true);
check('초대한 사람이 남는다', issued.invitedByDisplayName, '조직 관리자');

console.log('\n── 토큰은 다시 나오지 않는다 ──');
const listed = expectOk(
  '목록',
  await admin.rest('GET', `/organizations/${orgId}/invitations`),
).invitations;
check('목록에 보인다', listed.length, 1);
// 원문을 저장하면 DB 유출로 링크가 재구성된다. 세션 토큰과 같은 태도다.
check('목록에 토큰이 없다', 'token' in listed[0], false);
check('응답 어디에도 토큰이 없다', JSON.stringify(listed).includes(issued.token), false);

console.log('\n── 초대받은 사람이 가입 후 수락 ──');
const newcomer = person('새 구성원');
newcomer.email = newcomerEmail;
await register(newcomer);

const preview = expectOk('미리보기', await newcomer.rest('GET', `/invitations/${issued.token}`))
  .invitation;
check('조직 이름이 보인다', preview.organizationName, '초대 회사');
check('역할이 보인다', preview.role, 'ORG_MEMBER');
// 멤버가 아닌 사람이 보는 화면이다. 조직 내부 정보를 담지 않는다.
check('멤버 목록은 안 보인다', 'members' in preview, false);
check('조직 id도 안 보인다', 'organizationId' in preview, false);

const accepted = expectOk(
  '수락',
  await newcomer.rest('POST', `/invitations/${issued.token}/accept`),
);
check('조직에 들어간다', accepted.organizationId, orgId);
check('역할이 부여된다', accepted.role, 'ORG_MEMBER');
check(
  '조직 리소스에 접근된다',
  (await newcomer.rest('GET', `/organizations/${orgId}/assets`)).status,
  200,
);

const afterAccept = expectOk(
  '수락 후 목록',
  await admin.rest('GET', `/organizations/${orgId}/invitations`),
).invitations[0];
check('ACCEPTED로 바뀐다', afterAccept.status, 'ACCEPTED');
check('누가 수락했는지 남는다', afterAccept.acceptedByDisplayName, '새 구성원');

console.log('\n── 같은 링크를 두 번 쓸 수 없다 ──');
const twice = await newcomer.rest('POST', `/invitations/${issued.token}/accept`);
check('재사용 거부', twice.status, 409);
check('이유가 명확하다', twice.body.code, 'INVITATION_NOT_ACCEPTABLE');

console.log('\n── 초대한 이메일과 다른 사람이 수락할 수 있다 ──');
// 강제하면 "회사 메일로 초대했는데 개인 메일로 가입한" 흔한 경우가 막힌다.
// 대신 누가 수락했는지를 반드시 남긴다.
const other = await register(person('다른 사람'));
const forSomeoneElse = expectOk(
  '두 번째 초대',
  await admin.rest('POST', `/organizations/${orgId}/invitations`, {
    email: `never-registers-${stamp}@example.com`,
    role: 'ORG_MEMBER',
  }),
).invitation;
expectOk('타인 수락', await other.rest('POST', `/invitations/${forSomeoneElse.token}/accept`));
const secondView = expectOk(
  '목록',
  await admin.rest('GET', `/organizations/${orgId}/invitations`),
).invitations.find((item) => item.id === forSomeoneElse.id);
check('초대한 이메일은 그대로', secondView.email.startsWith('never-registers'), true);
// 감추면 나중에 "이 사람이 왜 들어와 있지"를 설명할 수 없다.
check('실제 수락자가 드러난다', secondView.acceptedByEmail, other.email);

console.log('\n── 만료 ──');
const expiring = expectOk(
  '만료 초대',
  await admin.rest('POST', `/organizations/${orgId}/invitations`, {
    email: `expired-${stamp}@example.com`,
    expiresInHours: 1,
  }),
).invitation;

const postgresModule = await import('postgres');
const sql = postgresModule.default(
  process.env.DATABASE_URL ?? 'postgresql://harness:harness@localhost:5432/harnessvault',
);
try {
  await sql`update invitations set expires_at = now() - interval '1 hour' where id = ${expiring.id}`;
  const stored = await sql`select status from invitations where id = ${expiring.id}`;
  // 만료는 저장된 상태가 아니다. 갱신 작업 없이 읽는 시점에 계산된다.
  check('저장된 상태는 여전히 PENDING', stored[0].status, 'PENDING');

  const expiredView = expectOk(
    '목록',
    await admin.rest('GET', `/organizations/${orgId}/invitations`),
  ).invitations.find((item) => item.id === expiring.id);
  check('읽을 때 EXPIRED로 계산된다', expiredView.status, 'EXPIRED');

  const lateAccept = await other.rest('POST', `/invitations/${expiring.token}/accept`);
  check('만료된 링크는 거부', lateAccept.status, 409);
  check('만료라고 알려준다', lateAccept.body.message.includes('만료'), true);

  // 토큰 해시만 저장한다.
  const hashes = await sql`select token_hash from invitations where organization_id = ${orgId}`;
  check(
    'DB에 토큰 원문이 없다',
    hashes.some((row) => row.token_hash === issued.token),
    false,
  );
  const audited = await sql`
    select count(*)::int as c from audit_events
    where organization_id = ${orgId} and metadata::text like ${'%' + issued.token + '%'}
  `;
  // 감사 로그를 읽을 수 있으면 초대를 가로챌 수 있게 된다.
  check('감사에도 토큰이 없다', audited[0].c, 0);
} finally {
  await sql.end();
}

console.log('\n── 철회 ──');
const toRevoke = expectOk(
  '철회할 초대',
  await admin.rest('POST', `/organizations/${orgId}/invitations`, {
    email: `revoked-${stamp}@example.com`,
  }),
).invitation;
const revoked = expectOk(
  '철회',
  await admin.rest('DELETE', `/organizations/${orgId}/invitations/${toRevoke.id}`),
).invitation;
check('REVOKED로 바뀐다', revoked.status, 'REVOKED');
check(
  '철회된 링크는 거부',
  (await other.rest('POST', `/invitations/${toRevoke.token}/accept`)).status,
  409,
);
// 이미 들어온 사람을 초대 철회로 내보내지 않는다. 그건 멤버십 해제다.
check(
  '수락된 초대는 철회할 수 없다',
  (await admin.rest('DELETE', `/organizations/${orgId}/invitations/${issued.id}`)).status,
  409,
);

console.log('\n── 권한 ──');
check(
  '일반 멤버는 초대할 수 없다',
  (await newcomer.rest('POST', `/organizations/${orgId}/invitations`, {
    email: `nope-${stamp}@example.com`,
  })).status,
  403,
);
check(
  '일반 멤버는 목록도 못 본다',
  (await newcomer.rest('GET', `/organizations/${orgId}/invitations`)).status,
  403,
);

console.log('\n── 로그인 없이는 수락할 수 없다 ──');
const anonymous = await fetch(`${BASE}/invitations/${toRevoke.token}`);
// 초대 링크가 가입 절차를 대신하지 않는다.
check('비로그인 미리보기 거부', anonymous.status, 401);

console.log('\n── 잘못된 토큰 ──');
check(
  '없는 토큰은 404',
  (await other.rest('GET', `/invitations/${randomBytes(32).toString('base64url')}`)).status,
  404,
);

console.log(`\n결과: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
