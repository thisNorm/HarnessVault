// 의미 검색이 실제로 도는지 검증한다.
//
// 핵심은 "VECTOR라고 응답하는가"가 아니라 **어휘 검색이 못 하는 일을 하는가**다.
// 단어가 하나도 겹치지 않는 같은 뜻의 지식을 찾아내야 의미 검색을 붙인 값을 한다.
//
// EMBEDDING_URL이 없으면 이 스위트는 건너뛴다 — 임베딩은 선택 기능이고,
// 없다고 실패로 보고하면 없는 문제를 있다고 말하는 것이 된다.
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

async function rest(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json; charset=utf-8' } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
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
const account = {
  email: `embed-${stamp}@example.com`,
  password: randomBytes(18).toString('base64url'),
  displayName: '임베딩 검증',
};

await rest('POST', '/auth/register', account);
const loginRes = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: account.email, password: account.password }),
});
const raw = (loginRes.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('harness_session='));
cookie = raw?.split(';')[0] ?? '';
const token = raw?.split('=')[1]?.split(';')[0] ?? '';

const orgId = expectOk(
  '조직',
  await rest('POST', '/organizations', { name: 'Embedding Org', slug: `embed-${stamp}` }),
).organization.id;
const userId = (await rest('GET', '/auth/me')).body.user.id;

// 임베딩 제공자가 붙어 있는지 먼저 본다. 없으면 이 스위트는 의미가 없다.
const probe = await rpc(token, orgId, 'company.find_similar', { title: '점검', description: '' });
if (probe.isError) throw new Error(`탐색 실패: ${probe.text}`);

console.log('\n── 기존 자산 준비 ──');
async function makeAsset(key, name, description) {
  const asset = expectOk(
    `자산 ${key}`,
    await rest('POST', `/organizations/${orgId}/assets`, {
      type: 'KNOWLEDGE',
      key,
      name,
      description,
      scopeType: 'COMPANY',
      ownerType: 'USER',
      ownerId: userId,
    }),
  ).asset.id;
  const versionId = expectOk(
    '버전',
    await rest('POST', `/organizations/${orgId}/assets/${asset}/versions`, {
      version: '1.0.0',
      status: 'CANDIDATE',
      structuredContent: { note: description },
      summary: description,
    }),
  ).version.id;
  expectOk(
    '버전 활성화',
    await rest('POST', `/organizations/${orgId}/assets/${asset}/versions/${versionId}/promote`),
  );
  expectOk(
    '자산 활성화',
    await rest('PATCH', `/organizations/${orgId}/assets/${asset}`, { status: 'ACTIVE' }),
  );
  return asset;
}

// 찾아야 하는 자산. 아래 질의와 **단어가 하나도 겹치지 않는다.**
const target = await makeAsset(
  'db.slow.query.index',
  '느린 조회 개선',
  '오래 걸리는 조회문에 색인을 추가해 응답 시간을 줄인다',
);
// 미끼. 질의와 단어는 겹치지만 뜻은 다르다 — 어휘 검색이 잘 속는 종류다.
const decoy = await makeAsset(
  'office.database.seat',
  '사무실 좌석 데이터베이스',
  '사무실 좌석 배치를 관리하는 데이터베이스 대장',
);

console.log('\n── 임베딩 백필 ──');
const backfilled = expectOk(
  '백필',
  await rest('POST', `/organizations/${orgId}/contributions/embeddings/backfill`),
);
console.log(
  `  갱신 ${backfilled.updated} · 건너뜀 ${backfilled.skipped}` +
    (backfilled.skippedKeys?.length ? ` (${backfilled.skippedKeys.join(', ')})` : ''),
);

if (backfilled.updated === 0) {
  console.log('\n임베딩 제공자가 설정되지 않았습니다 (EMBEDDING_URL). 이 스위트를 건너뜁니다.');
  console.log('\n결과: 0 passed, 0 failed (건너뜀)');
  process.exit(0);
}

check('모든 자산에 임베딩이 붙는다', backfilled.updated, 2);
check('실패한 자산 없음', backfilled.skipped, 0);
// 개수만 주면 어느 자산이 검색에서 빠졌는지 알 수 없다.
check('건너뛴 자산 목록도 준다', Array.isArray(backfilled.skippedKeys), true);

console.log('\n── 의미 검색이 실제로 돈다 ──');
// "쿼리가 느려요" — target의 '느린 조회 개선'과 단어가 겹치지 않는다.
const query = {
  title: '쿼리 성능 저하',
  description: 'SELECT 문 응답이 지연되어 인덱스를 검토해야 합니다',
};
const semantic = await rpc(token, orgId, 'company.find_similar', query);
check('벡터로 돈다', semantic.data.method, 'VECTOR');
check('후보를 찾는다', semantic.data.candidates.length > 0, true);

const top = semantic.data.candidates[0];
console.log(`  1위: ${top.key} (${top.score})`);
// 이것이 붙인 값이다. 어휘로는 '색인'과 '인덱스'가 다른 단어라 못 잇는다.
check('뜻이 같은 자산을 1위로 찾는다', top.assetId, target);

console.log('\n── 어휘 검색과 비교 ──');
const postgresModule = await import('postgres');
const sql = postgresModule.default(
  process.env.DATABASE_URL ?? 'postgresql://harness:harness@localhost:5432/harnessvault',
);
try {
  // 임베딩을 지우면 같은 질의가 어휘 경로로 떨어진다. 같은 입력, 다른 방법.
  await sql`update harness_assets set embedding = null where organization_id = ${orgId}`;
  const lexical = await rpc(token, orgId, 'company.find_similar', query);
  check('임베딩이 없으면 어휘로 떨어진다', lexical.data.method, 'LEXICAL');
  // 단어가 겹치지 않으니 어휘 검색은 이 자산을 찾지 못한다 —
  // 바로 그래서 의미 검색을 붙인다.
  const lexicalFoundTarget = lexical.data.candidates.some((c) => c.assetId === target);
  check('어휘로는 못 찾는다', lexicalFoundTarget, false);
  console.log(
    `  어휘 결과: ${lexical.data.candidates.map((c) => c.key).join(', ') || '(없음)'}`,
  );

  // 되돌린다.
  expectOk('재백필', await rest('POST', `/organizations/${orgId}/contributions/embeddings/backfill`));
} finally {
  await sql.end();
}

console.log('\n── 기여 경로도 벡터로 돈다 ──');
const contributed = await rpc(token, orgId, 'company.contribute', {
  type: 'KNOWLEDGE',
  proposedKey: 'db.query.latency.fix',
  name: '조회 지연 해소',
  description: '오래 걸리는 SELECT에 인덱스를 걸어 지연을 줄인다',
  structuredContent: { note: '같은 뜻, 다른 표현' },
  proposedScopeType: 'PERSONAL',
});
check('기여 제출', contributed.data.contribution.status, 'CANDIDATE');
check('벡터로 중복 탐색', contributed.data.method, 'VECTOR');
check('임베딩 상태가 OK', contributed.data.contribution.embeddingStatus, 'OK');
// 표현이 달라도 같은 지식임을 잡아내는 것이 중복 탐색의 목적이다.
check('중복 후보로 잡는다', contributed.data.contribution.duplicateOfAssetId, target);
check('미끼는 1위가 아니다', contributed.data.similar[0].assetId !== decoy, true);

console.log('\n── 임베딩은 자산 승격 시에도 붙는다 ──');
const promoted = expectOk(
  '승격',
  await rest(
    'POST',
    `/organizations/${orgId}/contributions/${contributed.data.contribution.id}/promote`,
    { note: '반영합니다' },
  ),
).contribution;
const sql2 = postgresModule.default(
  process.env.DATABASE_URL ?? 'postgresql://harness:harness@localhost:5432/harnessvault',
);
try {
  const row = await sql2`
    select embedding is not null as has_embedding
    from harness_assets where id = ${promoted.promotedAssetId}
  `;
  // 승격된 자산이 임베딩 없이 들어가면 다음 기여가 그걸 못 찾는다.
  check('승격된 자산에 임베딩이 실린다', row[0].has_embedding, true);
} finally {
  await sql2.end();
}

console.log(`\n결과: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
