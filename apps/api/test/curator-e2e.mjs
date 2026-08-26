// Phase 12 완료 조건 검증: Curator가 Candidate를 검토해 구조화된 추천을 낸다.
// 가장 중요한 두 가지 — 장애가 Candidate를 막지 않는다(§61), Mock이 성공인 척하지 않는다(§72).
import { randomBytes } from 'node:crypto';

const BASE = 'http://localhost:3000';
const MCP = `${BASE}/mcp`;

let cookie = '';
let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (${actual}${ok ? '' : ` != ${expected}`})`);
  if (ok) pass++;
  else fail++;
}

async function rest(method, path, body, jar = null) {
  const jarCookie = jar === null ? cookie : jar.cookie;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json; charset=utf-8' } : {}),
      ...(jarCookie ? { cookie: jarCookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    if (c.startsWith('harness_session=')) {
      if (jar === null) cookie = c.split(';')[0];
      else jar.cookie = c.split(';')[0];
    }
  }
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function expectOk(label, res) {
  if (res.status >= 400) throw new Error(`${label} 실패: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

let seq = 0;
async function rpc(token, orgId, name, args) {
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
  if (body.error) return { isError: true, text: JSON.stringify(body.error) };
  if (body.result?.isError) return { isError: true, text: body.result.content?.[0]?.text ?? '' };
  return { isError: false, data: JSON.parse(body.result.content[0].text) };
}

const stamp = Date.now();
const owner = {
  email: `curator-owner-${stamp}@example.com`,
  password: randomBytes(18).toString('base64url'),
  displayName: '큐레이터 관리자',
};
const member = {
  email: `curator-member-${stamp}@example.com`,
  password: randomBytes(18).toString('base64url'),
  displayName: '기여자',
};

async function login(account) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  const raw = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('harness_session='));
  return { cookie: raw?.split(';')[0] ?? '', token: raw?.split('=')[1]?.split(';')[0] ?? '' };
}

await rest('POST', '/auth/register', owner);
await rest('POST', '/auth/register', member);
const ownerJar = await login(owner);
const memberJar = await login(member);
cookie = ownerJar.cookie;

const orgId = expectOk(
  '조직',
  await rest('POST', '/organizations', { name: 'Curator Org', slug: `curator-${stamp}` }),
).organization.id;
const memberId = (await rest('GET', '/auth/me', null, memberJar)).body.user.id;
expectOk(
  '멤버 추가',
  await rest('POST', `/organizations/${orgId}/members`, { email: member.email, role: 'ORG_MEMBER' }),
);

// 후보가 될 기존 자산
const existingAsset = expectOk(
  '기존 자산',
  await rest('POST', `/organizations/${orgId}/assets`, {
    type: 'KNOWLEDGE',
    key: 'kafka.consumer.lag',
    name: 'Kafka 컨슈머 랙 대응',
    description: '컨슈머 랙이 쌓일 때 파티션 재분배와 배치 크기를 조정한다',
    scopeType: 'COMPANY',
    ownerType: 'USER',
    ownerId: memberId,
  }),
).asset.id;
const versionId = expectOk(
  '기존 버전',
  await rest('POST', `/organizations/${orgId}/assets/${existingAsset}/versions`, {
    version: '1.0.0',
    status: 'CANDIDATE',
    structuredContent: { steps: ['랙 확인', '파티션 재분배'] },
    summary: '컨슈머 랙 대응 절차',
  }),
).version.id;
expectOk(
  '버전 활성화',
  await rest('POST', `/organizations/${orgId}/assets/${existingAsset}/versions/${versionId}/promote`),
);

async function contribute(payload) {
  const res = await rpc(memberJar.token, orgId, 'company.contribute', payload);
  if (res.isError) throw new Error(`기여 실패: ${res.text}`);
  return res.data.contribution;
}

console.log('\n── 후보가 없는 기여 → LOW ──');
const novel = await contribute({
  type: 'KNOWLEDGE',
  proposedKey: 'grpc.deadline.propagation',
  name: 'gRPC 데드라인 전파',
  description: '상위 호출의 데드라인을 하위 호출에 그대로 넘겨 좀비 요청을 막는다',
  structuredContent: { note: '데드라인 전파' },
  proposedScopeType: 'PERSONAL',
});
const novelRun = expectOk(
  '검토',
  await rest('POST', `/organizations/${orgId}/contributions/${novel.id}/curator`),
).run;
const VERDICTS = ['DUPLICATE', 'VARIANT_OF', 'IMPROVEMENT_ON', 'CONFLICTS_WITH', 'NEW', 'UNKNOWN'];
// 실제 모델을 붙이면 판정 내용은 모델의 것이다. 특정 값을 박으면 CURATOR_MODEL을 바꿀 때마다 깨진다.
// 여기서는 시스템이 보장하는 것만 본다. 결정론적인 판정은 MOCK일 때만 검사한다.
const isMock = novelRun.provider === 'MOCK';
console.log(`  (provider=${novelRun.provider} model=${novelRun.model})`);

check('성공으로 끝난다', novelRun.status, 'SUCCEEDED');
check('비슷한 게 없으면 LOW', novelRun.complexity, 'LOW');
// 복잡도가 라운드 예산을 정한다. LOW는 한 번만 돈다.
check('LOW는 1라운드', novelRun.roundsUsed, 1);
check('아는 판정만 저장된다', VERDICTS.includes(novelRun.verdict), true);
// 후보가 없었으므로 어떤 모델도 자산을 지목할 수 없다 — 이건 모델이 아니라 시스템의 보장이다.
check('연결된 자산 없음', novelRun.relatedAssetId, null);
if (isMock) check('MOCK은 NEW로 본다', novelRun.verdict, 'NEW');

console.log('\n── Mock은 자기가 Mock임을 밝힌다 (§72) ──');
// "Mock 성공으로 대체되어 있으면 MVP 완료로 보지 않는다"를 코드가 지킬 수 있게 한다.
check('provider가 결과에 박힌다', ['MOCK', 'OLLAMA'].includes(novelRun.provider), true);
if (novelRun.provider === 'MOCK') {
  check('모델 결과가 아님을 이유에 쓴다', novelRun.reasoning.includes('모델이 판단한 것이 아니라'), true);
  check('모델 이름이 none이다', novelRun.model, 'none');
}

console.log('\n── 명백한 중복 → LOW, DUPLICATE ──');
const duplicate = await contribute({
  type: 'KNOWLEDGE',
  proposedKey: 'kafka.consumer.lag.again',
  name: 'Kafka 컨슈머 랙 대응',
  description: '컨슈머 랙이 쌓일 때 파티션 재분배와 배치 크기를 조정한다',
  structuredContent: { note: '같은 내용' },
  proposedScopeType: 'PERSONAL',
});
const dupRun = expectOk(
  '검토',
  await rest('POST', `/organizations/${orgId}/contributions/${duplicate.id}/curator`),
).run;
check('아는 판정만 저장된다', VERDICTS.includes(dupRun.verdict), true);
// 모델이 답한 key를 실제 자산 id로 옮기는 것은 시스템의 몫이다. 여기가 틀리면 링크가 깨진다.
check('key도 남는다', dupRun.relatedAssetKey, 'kafka.consumer.lag');
check('어느 자산인지 연결한다', dupRun.relatedAssetId, existingAsset);
check('확신도를 남긴다', dupRun.confidence > 0, true);
if (isMock) check('MOCK은 DUPLICATE로 본다', dupRun.verdict, 'DUPLICATE');

console.log('\n── 판정은 아무것도 자동으로 하지 않는다 ──');
const afterReview = expectOk(
  '기여 상태',
  await rest('GET', `/organizations/${orgId}/contributions/${duplicate.id}`),
).contribution;
// 어떤 판정이 나와도 거절되지 않는다. Phase 11의 "자동 승격 없음"을 뒷문으로 무력화하지 않는다.
check('판정 후에도 CANDIDATE 그대로', afterReview.status, 'CANDIDATE');
check('승격도 되지 않았다', afterReview.promotedAssetId, null);

console.log('\n── 실행 이력은 덮어쓰지 않는다 ──');
expectOk('재검토', await rest('POST', `/organizations/${orgId}/contributions/${duplicate.id}/curator`));
const runs = expectOk(
  '이력',
  await rest('GET', `/organizations/${orgId}/contributions/${duplicate.id}/curator`),
).runs;
// 모델이 죽어 있다가 살아난 뒤 판단이 바뀐 이력도 남아야 한다.
check('실행마다 한 줄', runs.length, 2);
check('최신이 먼저', new Date(runs[0].createdAt) >= new Date(runs[1].createdAt), true);

console.log('\n── 권한 ──');
check(
  '일반 멤버는 검토를 돌릴 수 없다',
  (await rest('POST', `/organizations/${orgId}/contributions/${novel.id}/curator`, null, memberJar))
    .status,
  403,
);
check(
  '이력 조회는 멤버도 된다',
  (await rest('GET', `/organizations/${orgId}/contributions/${novel.id}/curator`, null, memberJar))
    .status,
  200,
);

console.log('\n── Curator 실행이 Candidate 상태를 바꾸지 않는다 ──');
// 제공자가 죽었을 때의 실패 매핑은 provider.test.ts가 실제 연결 실패로 검증한다.
// 여기서는 "검토를 돌려도 기여의 생사가 걸리지 않는다"만 본다 — §61의 관측 가능한 절반이다.
const unreachable = await contribute({
  type: 'KNOWLEDGE',
  proposedKey: 'redis.eviction.policy',
  name: 'Redis 축출 정책',
  description: 'maxmemory-policy 선택 기준',
  structuredContent: { note: 'allkeys-lru' },
  proposedScopeType: 'PERSONAL',
});
const failRun = expectOk(
  '검토 시도',
  await rest('POST', `/organizations/${orgId}/contributions/${unreachable.id}/curator`),
).run;
// 실패해도 4xx를 던지지 않는다. 실패한 실행 기록을 돌려준다.
check('실행 기록을 돌려준다', typeof failRun.id, 'string');
check('상태가 둘 중 하나다', ['SUCCEEDED', 'FAILED'].includes(failRun.status), true);
if (failRun.status === 'FAILED') {
  check('실패 코드가 남는다', failRun.failureCode, 'CURATOR_UNAVAILABLE');
  check('판정은 비어 있다', failRun.verdict, null);
}
const survivor = expectOk(
  '기여 생존',
  await rest('GET', `/organizations/${orgId}/contributions/${unreachable.id}`),
).contribution;
check('Candidate는 그대로 유지된다', survivor.status, 'CANDIDATE');

console.log('\n── 승격 경로는 Curator와 무관하게 열려 있다 ──');
const promoted = expectOk(
  '승격',
  await rest('POST', `/organizations/${orgId}/contributions/${unreachable.id}/promote`, {
    note: 'Curator 없이도 판단합니다',
  }),
).contribution;
// Curator가 없어도 사람은 판단할 수 있어야 한다.
check('사람이 승격할 수 있다', promoted.status, 'PROMOTED');

console.log('\n── 감사 ──');
const postgresModule = await import('postgres');
const sql = postgresModule.default(
  process.env.DATABASE_URL ?? 'postgresql://harness:harness@localhost:5432/harnessvault',
);
try {
  const events = await sql`
    select count(*)::int as c from audit_events
    where organization_id = ${orgId} and event_type = 'curator.reviewed'
  `;
  check('실행마다 감사 이벤트', events[0].c, 4);
  const withProvider = await sql`
    select count(*)::int as c from audit_events
    where organization_id = ${orgId} and event_type = 'curator.reviewed'
      and metadata->>'provider' is not null
  `;
  // 무엇이 판단했는지가 감사에도 남는다.
  check('무엇이 판단했는지 남는다', withProvider[0].c, 4);
  const leak = await sql`
    select count(*)::int as c from audit_events
    where organization_id = ${orgId} and event_type = 'curator.reviewed'
      and metadata::text like '%allkeys-lru%'
  `;
  check('기여 본문은 감사에 없다', leak[0].c, 0);
} finally {
  await sql.end();
}

console.log(`\n결과: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
