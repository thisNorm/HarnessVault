// Phase 11 완료 조건 검증: 개인이 발견한 지식이 조직 Candidate가 되고, 사람이 승격한다.
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
  email: `contrib-owner-${stamp}@example.com`,
  password: randomBytes(18).toString('base64url'),
  displayName: '조직 관리자',
};
const member = {
  email: `contrib-member-${stamp}@example.com`,
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
  await rest('POST', '/organizations', { name: 'Contribution Org', slug: `contrib-${stamp}` }),
).organization.id;
const memberId = (await rest('GET', '/auth/me', null, memberJar)).body.user.id;
expectOk(
  '멤버 추가',
  await rest('POST', `/organizations/${orgId}/members`, { email: member.email, role: 'ORG_MEMBER' }),
);

const teamId = expectOk(
  '팀',
  await rest('POST', `/organizations/${orgId}/teams`, { name: 'Platform', slug: 'platform' }),
).team.id;
const otherTeamId = expectOk(
  '타 팀',
  await rest('POST', `/organizations/${orgId}/teams`, { name: 'Design', slug: 'design' }),
).team.id;
await rest('POST', `/organizations/${orgId}/teams/${teamId}/members`, { userId: memberId });

// 중복 탐색 대상이 될 기존 자산
const existingAsset = expectOk(
  '기존 자산',
  await rest('POST', `/organizations/${orgId}/assets`, {
    type: 'KNOWLEDGE',
    key: 'db.connection.pool.tuning',
    name: 'DB 커넥션 풀 튜닝',
    description: 'PostgreSQL 커넥션 풀 크기와 타임아웃을 정하는 방법',
    scopeType: 'COMPANY',
    ownerType: 'USER',
    ownerId: memberId,
  }),
).asset.id;

// 이미 쓰이고 있는 버전. 승격이 이걸 조용히 내리지 않는지 확인하기 위해 필요하다.
const existingVersionId = expectOk(
  '기존 버전',
  await rest('POST', `/organizations/${orgId}/assets/${existingAsset}/versions`, {
    version: '1.0.0',
    status: 'CANDIDATE',
    structuredContent: { note: '기존 내용' },
    summary: '기존 요약',
  }),
).version.id;
expectOk(
  '기존 버전 활성화',
  await rest(
    'POST',
    `/organizations/${orgId}/assets/${existingAsset}/versions/${existingVersionId}/promote`,
  ),
);

console.log('\n── MCP로 기여 제출 ──');
const submitted = await rpc(memberJar.token, orgId, 'company.contribute', {
  type: 'KNOWLEDGE',
  proposedKey: 'mqtt.broker.reconnect',
  name: 'MQTT 브로커 재연결 전략',
  description: '브로커가 끊겼을 때 지수 백오프로 재연결하고 QoS 1 메시지를 재전송한다',
  summary: 'MQTT 재연결 절차',
  structuredContent: { steps: ['백오프 대기', '재연결', '미확인 메시지 재전송'] },
  proposedScopeType: 'TEAM',
  proposedScopeId: teamId,
  rationale: '장애 대응 중에 정리한 절차입니다',
});
check('제출 성공', submitted.isError, false);
check('CANDIDATE로 저장', submitted.data.contribution.status, 'CANDIDATE');
// 자동으로 자산이 되지 않는다. 사람이 봐야 한다.
check('아직 자산이 아니다', submitted.data.contribution.promotedAssetId, null);
check('무엇으로 찾았는지 알린다', typeof submitted.data.method, 'string');
check('무관한 자산은 중복이 아니다', submitted.data.contribution.duplicateOfAssetId, null);

console.log('\n── 중복 탐색 ──');
const dup = await rpc(memberJar.token, orgId, 'company.contribute', {
  type: 'KNOWLEDGE',
  proposedKey: 'db.connection.pool.tuning.v2',
  name: 'DB 커넥션 풀 튜닝',
  description: 'PostgreSQL 커넥션 풀 크기와 타임아웃을 정하는 방법',
  structuredContent: { note: '같은 내용' },
  proposedScopeType: 'PERSONAL',
});
check('중복이어도 저장된다', dup.data.contribution.status, 'CANDIDATE');
// 자동으로 막으면 "기존 자산이 틀렸다"는 기여가 영영 못 들어온다.
check('중복 대상을 기록', dup.data.contribution.duplicateOfAssetId, existingAsset);
check('중복 점수도 기록', dup.data.contribution.duplicateScore > 0.75, true);
check('비슷한 자산을 함께 돌려준다', dup.data.similar.length > 0, true);
check('중복 후보로 표시', dup.data.similar[0].relationHint, 'DUPLICATE_CANDIDATE');

console.log('\n── 속하지 않은 범위에는 기여할 수 없다 ──');
const foreign = await rpc(memberJar.token, orgId, 'company.contribute', {
  type: 'RULE',
  proposedKey: 'design.system.rule',
  name: '디자인 규칙',
  structuredContent: { rule: 'x' },
  proposedScopeType: 'TEAM',
  proposedScopeId: otherTeamId,
});
check('남의 팀에는 못 꽂는다', foreign.isError, true);

console.log('\n── 승격은 조직 관리자만 ──');
const contributionId = submitted.data.contribution.id;
check(
  '일반 멤버는 승격할 수 없다',
  (await rest('POST', `/organizations/${orgId}/contributions/${contributionId}/promote`, {}, memberJar))
    .status,
  403,
);

console.log('\n── 승격 — 새 자산 ──');
const promoted = expectOk(
  '승격',
  await rest('POST', `/organizations/${orgId}/contributions/${contributionId}/promote`, {
    note: '팀 지식으로 반영합니다',
  }),
).contribution;
check('PROMOTED', promoted.status, 'PROMOTED');
check('자산이 생겼다', promoted.promotedAssetId !== null, true);
check('검토자가 남는다', promoted.reviewedByDisplayName, '조직 관리자');

const newAsset = expectOk(
  '자산 확인',
  await rest('GET', `/organizations/${orgId}/assets/${promoted.promotedAssetId}`),
);
// 승격이 아무것도 바꾸지 않으면 승격이 아니다.
check('자산은 ACTIVE', newAsset.asset.status, 'ACTIVE');
check('제안한 범위대로', newAsset.asset.scopeType, 'TEAM');
check('버전도 ACTIVE', newAsset.versions[0].status, 'ACTIVE');
check('첫 버전은 1.0.0', newAsset.versions[0].version, '1.0.0');
// 소유자는 제출자다. 검토자가 남의 지식을 가져가지 않는다.
check('소유자는 제출자', newAsset.asset.ownerId, memberId);

console.log('\n── 승격 — 기존 자산의 새 버전 ──');
const merged = expectOk(
  '병합 승격',
  await rest('POST', `/organizations/${orgId}/contributions/${dup.data.contribution.id}/promote`, {
    targetAssetId: existingAsset,
    note: '기존 자산의 새 버전으로 받습니다',
  }),
).contribution;
check('PROMOTED', merged.status, 'PROMOTED');
check('대상 자산에 붙었다', merged.promotedAssetId, existingAsset);

const targetDetail = expectOk(
  '대상 자산',
  await rest('GET', `/organizations/${orgId}/assets/${existingAsset}`),
);
const added = targetDetail.versions.find((v) => v.id === merged.promotedVersionId);
// 바로 ACTIVE로 만들면 쓰이던 버전이 조용히 내려간다. 그 강등은 별도의 명시적 행위여야 한다.
check('새 버전은 CANDIDATE', added.status, 'CANDIDATE');
check('버전 번호가 이어진다', added.version, '2.0.0');
check('쓰이던 ACTIVE는 그대로', targetDetail.activeVersionCount, 1);
check(
  '강등되지 않았다',
  targetDetail.versions.find((v) => v.id === existingVersionId).status,
  'ACTIVE',
);

console.log('\n── 상태 기계 ──');
check(
  '승격된 기여는 되돌릴 수 없다',
  (await rest('POST', `/organizations/${orgId}/contributions/${contributionId}/reject`, {
    note: '되돌리기 시도',
  })).status,
  409,
);

const toReject = await rpc(memberJar.token, orgId, 'company.contribute', {
  type: 'RULE',
  proposedKey: 'temp.rule.one',
  name: '임시 규칙',
  structuredContent: { rule: 'temp' },
  proposedScopeType: 'PERSONAL',
});
check(
  '거절에는 이유가 필요하다',
  (await rest('POST', `/organizations/${orgId}/contributions/${toReject.data.contribution.id}/reject`, {
    note: '',
  })).status,
  400,
);
const rejected = expectOk(
  '거절',
  await rest('POST', `/organizations/${orgId}/contributions/${toReject.data.contribution.id}/reject`, {
    note: '이미 회사 규칙에 있습니다',
  }),
).contribution;
check('REJECTED', rejected.status, 'REJECTED');
check('이유가 남는다', rejected.reviewNote, '이미 회사 규칙에 있습니다');

console.log('\n── 취소는 본인만 ──');
const toWithdraw = await rpc(memberJar.token, orgId, 'company.contribute', {
  type: 'RULE',
  proposedKey: 'temp.rule.two',
  name: '취소할 규칙',
  structuredContent: { rule: 'temp' },
  proposedScopeType: 'PERSONAL',
});
const withdrawId = toWithdraw.data.contribution.id;
check(
  '남이 취소할 수 없다',
  (await rest('POST', `/organizations/${orgId}/contributions/${withdrawId}/withdraw`)).status,
  403,
);
check(
  '본인은 취소한다',
  expectOk(
    '취소',
    await rest('POST', `/organizations/${orgId}/contributions/${withdrawId}/withdraw`, null, memberJar),
  ).contribution.status,
  'WITHDRAWN',
);

console.log('\n── 목록 ──');
const all = expectOk('목록', await rest('GET', `/organizations/${orgId}/contributions`)).contributions;
// 남의 팀에 꽂으려던 기여는 저장 자체가 되지 않았다.
check('저장된 것만 보인다', all.length, 4);
const candidates = expectOk(
  '대기 목록',
  await rest('GET', `/organizations/${orgId}/contributions?status=CANDIDATE`),
).contributions;
// 둘 승격, 하나 거절, 하나 취소 — 대기 중은 남지 않는다.
check('대기 중은 없다', candidates.length, 0);

console.log('\n── find_similar도 같은 판정을 쓴다 ──');
const similar = await rpc(memberJar.token, orgId, 'company.find_similar', {
  title: 'DB 커넥션 풀 튜닝',
  description: 'PostgreSQL 커넥션 풀 크기와 타임아웃을 정하는 방법',
});
check('method를 알린다', ['VECTOR', 'LEXICAL'].includes(similar.data.method), true);
check('기존 자산을 찾는다', similar.data.candidates.some((c) => c.assetId === existingAsset), true);

console.log('\n── 임베딩 없이도 전부 동작한다 ──');
// Ollama가 없는 환경에서도 시스템 전체가 돌아야 한다. 부가 기능 장애가 본 경로를 막지 않는다.
check(
  '임베딩 상태를 숨기지 않는다',
  ['NOT_CONFIGURED', 'OK', 'FAILED'].includes(promoted.embeddingStatus),
  true,
);

console.log('\n── 기여 본문은 감사에 없다 (§39) ──');
const postgresModule = await import('postgres');
const sql = postgresModule.default(
  process.env.DATABASE_URL ?? 'postgresql://harness:harness@localhost:5432/harnessvault',
);
try {
  const leak = await sql`
    select count(*)::int as c from audit_events
    where organization_id = ${orgId} and metadata::text like '%미확인 메시지 재전송%'
  `;
  check('본문 미저장', leak[0].c, 0);
  const kept = await sql`
    select count(*)::int as c from audit_events
    where organization_id = ${orgId} and event_type = 'contribution.submitted'
      and metadata::text like '%contentLength%'
  `;
  check('길이만 기록', kept[0].c > 0, true);
  const promotedEvents = await sql`
    select count(*)::int as c from audit_events
    where organization_id = ${orgId} and event_type = 'contribution.promoted'
  `;
  check('승격 이벤트 2건', promotedEvents[0].c, 2);
} finally {
  await sql.end();
}

console.log(`\n결과: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
