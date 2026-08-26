// 배포 전 준비 검증 — 로그인 시도 제한 · 세션 정리 · 쿠키 설정.
// 핵심은 "잠기는지 여부로 계정 존재가 새어 나가지 않는가"다.
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

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? JSON.parse(text) : null,
    cookies: res.headers.getSetCookie?.() ?? [],
  };
}

const postgresModule = await import('postgres');
const sql = postgresModule.default(
  process.env.DATABASE_URL ?? 'postgresql://harness:harness@localhost:5432/harnessvault',
);
// 스로틀 자체를 검증하는 스위트라 알려진 상태에서 시작해야 한다.
// 앞선 실행이 남긴 IP 통이 살아 있으면 임계 전 응답이 401이 아니라 429가 된다.
await sql`delete from login_attempts`;

const stamp = Date.now();
const real = {
  email: `hard-${stamp}@example.com`,
  password: randomBytes(18).toString('base64url'),
  displayName: '보안 검증 사용자',
};
// 일부러 틀리게 만드는 값이다. 실제 자격증명이 아니다. secret-scan:allow
const WRONG = 'not-the-password';
// 존재하지 않는 계정. 실재 계정과 똑같이 동작해야 한다.
const ghost = { email: `ghost-${stamp}@example.com` };

const registered = await post('/auth/register', real);
check('가입', registered.status, 201);

console.log('\n── 쿠키 속성 ──');
const login = await post('/auth/login', { email: real.email, password: real.password });
check('로그인 성공', login.status, 200);
const cookie = login.cookies.find((c) => c.startsWith('harness_session='));
check('세션 쿠키 발급', cookie !== undefined, true);
// 자바스크립트가 세션 토큰을 읽으면 XSS 하나로 계정이 넘어간다.
check('HttpOnly', /httponly/i.test(cookie), true);
check('Path=/', /path=\//i.test(cookie), true);
// 개발 기본값은 Lax다. 운영에서 도메인이 갈리면 None+Secure로 바꾼다.
check('SameSite 지정됨', /samesite=/i.test(cookie), true);

console.log('\n── 실패를 세되 계정 존재를 흘리지 않는다 ──');
const MAX = Number(process.env.LOGIN_MAX_ATTEMPTS ?? 10);

/** 임계 직전까지 두드린다. 아직 잠기면 안 된다. */
async function hammer(account, times) {
  const statuses = [];
  for (let i = 0; i < times; i++) {
    const res = await post('/auth/login', { email: account.email, password: WRONG });
    statuses.push(res.status);
  }
  return statuses;
}

// 임계에 닿는 그 시도까지는 401이다 — 비밀번호가 틀린 것은 사실이므로 그렇게 답한다.
// 잠기는 것은 그 실패의 결과이고, 다음 시도부터 429가 된다.
const realBefore = await hammer(real, MAX);
const ghostBefore = await hammer(ghost, MAX);
check('실재 계정 — 임계까지는 401', new Set(realBefore).size === 1 && realBefore[0] === 401, true);
// 없는 계정도 같은 응답이어야 한다.
check('없는 계정 — 임계까지도 401', new Set(ghostBefore).size === 1 && ghostBefore[0] === 401, true);

const realLocked = await post('/auth/login', { email: real.email, password: WRONG });
const ghostLocked = await post('/auth/login', { email: ghost.email, password: WRONG });
check('임계를 넘으면 실재 계정 잠김', realLocked.status, 429);
// 이것이 이 설계의 핵심이다. 사용자 행에 카운터를 붙였다면 여기가 401로 갈라져
// 공격자가 계정 존재를 알아낸다.
check('없는 계정도 똑같이 잠김', ghostLocked.status, 429);
check('두 응답의 상태가 같다', realLocked.status === ghostLocked.status, true);
check(
  '두 응답의 코드가 같다',
  realLocked.body.code === ghostLocked.body.code,
  true,
);
check('실패 코드가 명확하다', realLocked.body.code, 'TOO_MANY_ATTEMPTS');
check('언제 풀리는지 알려준다', realLocked.body.retryAfterSeconds > 0, true);

console.log('\n── 잠긴 동안은 올바른 비밀번호도 막힌다 ──');
const correctWhileLocked = await post('/auth/login', {
  email: real.email,
  password: real.password,
});
// 여기서 통과시키면 비밀번호 확인 시간 차이가 그대로 신호가 된다.
check('올바른 비밀번호도 429', correctWhileLocked.status, 429);

console.log('\n── 성공하면 카운터가 지워진다 ──');
const other = {
  email: `hard2-${stamp}@example.com`,
  password: randomBytes(18).toString('base64url'),
  displayName: '두 번째 사용자',
};
await post('/auth/register', other);
await hammer(other, MAX - 1);
const recovered = await post('/auth/login', { email: other.email, password: other.password });
check('임계 직전에 성공하면 통과', recovered.status, 200);
// 카운터가 남아 있었다면 아래 MAX-1번 중에 429가 섞인다.
const afterSuccess = await hammer(other, MAX - 1);
check('카운터가 초기화됐다', afterSuccess.every((status) => status === 401), true);

console.log('\n── IP 축은 여러 계정을 훑는 공격을 잡는다 ──');
// 계정 축만 있으면 계정마다 9번씩 훑는 password spraying이 통과한다.
//
// IP 축은 실패 **횟수**가 아니라 **서로 다른 계정 수**를 센다.
// 횟수로 세면 NAT 뒤 사무실 20명의 정상 오타와 스프레이가 같은 숫자로 보이고,
// 어떤 임계값을 잡아도 사무실을 잠그거나 공격자를 놓치거나 둘 중 하나가 된다.
const IP_MAX = Number(process.env.LOGIN_MAX_ACCOUNTS_PER_IP ?? 20);
const sprayed = [];
for (let i = 0; i < IP_MAX + 2; i++) {
  // 계정마다 한 번씩만 두드린다 — 계정 축은 건드리지 않는다.
  const res = await post('/auth/login', {
    email: `spray-${stamp}-${i}@example.com`,
    password: WRONG,
  });
  sprayed.push(res.status);
}
check('임계 전에는 통과한다', sprayed[0], 401);
// TRUST_PROXY가 꺼져 있어도 소켓 주소로 IP를 얻으므로 이 경로는 항상 돈다.
check('계정 수 임계를 넘으면 막힌다', sprayed.includes(429), true);
// 어느 축에 걸렸는지 알려주면 공격자는 IP를 바꾸면 된다는 것을 배운다.
const sprayLocked = await post('/auth/login', {
  email: `spray-${stamp}-final@example.com`,
  password: WRONG,
});
check('계정 잠금과 같은 코드', sprayLocked.body.code, 'TOO_MANY_ATTEMPTS');

// **이것이 이 축의 전제다.** 확인 전에 막으면 NAT 뒤 사무실 하나가 통째로
// 로그인하지 못하게 되고, 그 피해가 막으려던 공격보다 크다.
const goodLoginWhileSprayed = await post('/auth/login', {
  email: other.email,
  password: other.password,
});
check('IP가 잠겨도 맞는 비밀번호는 통과한다', goodLoginWhileSprayed.status, 200);

console.log('\n── 세션 정리 ──');
try {
  const userRow = await sql`select id from users where email = ${real.email}`;
  const userId = userRow[0].id;
  // 이미 만료된 세션을 직접 넣고 정리 대상인지 확인한다.
  await sql`
    insert into sessions (user_id, token_hash, expires_at)
    values (${userId}, ${'expired-' + stamp}, now() - interval '1 day')
  `;
  const before = await sql`
    select count(*)::int as c from sessions
    where user_id = ${userId} and expires_at < now()
  `;
  check('만료 세션이 존재한다', before[0].c > 0, true);

  const purgeable = await sql`
    select count(*)::int as c from sessions
    where expires_at < now() or revoked_at is not null
  `;
  // 정리 조건에 걸리는지만 본다. 실제로 지워지는 것은 SessionPurgeService가
  // 부팅 직후와 주기마다 하며, 이 테스트는 서버를 재시작하지 않으므로 여기서 확인할 수 없다.
  // (부팅 정리는 로그 `만료 세션 N건 정리`로 확인된다)
  check('정리 대상으로 잡힌다', purgeable[0].c > 0, true);

  const attempts = await sql`
    select failed_count, locked_until from login_attempts where email = ${'email:' + real.email}
  `;
  check('시도 기록이 남는다', attempts[0].failed_count >= MAX, true);
  check('잠금 시각이 있다', attempts[0].locked_until !== null, true);

  const ghostAttempts = await sql`
    select failed_count from login_attempts where email = ${'email:' + ghost.email}
  `;
  // 없는 계정도 같은 테이블에 같은 방식으로 쌓인다.
  check('없는 계정도 기록된다', ghostAttempts[0].failed_count >= MAX, true);

  // 비밀번호가 이 테이블에 새어 들어가면 안 된다.
  const leak = await sql`
    select count(*)::int as c from login_attempts where email like ${'%' + WRONG + '%'}
  `;
  check('비밀번호는 기록되지 않는다', leak[0].c, 0);
} finally {
  await sql.end();
}

console.log(`\n결과: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
