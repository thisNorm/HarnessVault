// Phase 13 완료 조건 검증: 웹 콘솔에서 조직 Harness 사용 흐름을 확인할 수 있다.
// 지켜야 하는 두 가지 — 개인별 생산성 점수를 만들지 않는다(§57), 추정치를 실측처럼 내지 않는다(§40).
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
const account = {
  email: `analytics-${stamp}@example.com`,
  password: randomBytes(18).toString('base64url'),
  displayName: '분석 사용자',
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
  await rest('POST', '/organizations', { name: 'Analytics Org', slug: `analytics-${stamp}` }),
).organization.id;
const userId = (await rest('GET', '/auth/me')).body.user.id;

const capabilityId = expectOk(
  'Capability',
  await rest('POST', `/organizations/${orgId}/capabilities`, {
    key: 'db.ops',
    name: 'DB 운영',
    ownerType: 'TEAM',
    ownerId: userId,
  }),
).capability.id;

async function makeAsset(key, name, description) {
  const asset = expectOk(
    `자산 ${key}`,
    await rest('POST', `/organizations/${orgId}/assets`, {
      type: 'KNOWLEDGE',
      key,
      name,
      description,
      capabilityId,
      scopeType: 'COMPANY',
      ownerType: 'USER',
      ownerId: userId,
      selector: { domains: ['database'] },
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
  // 버전 활성화와 자산 활성화는 별개다. 자산이 DRAFT면 Resolver 후보에 오르지 않는다.
  expectOk(
    '자산 활성화',
    await rest('PATCH', `/organizations/${orgId}/assets/${asset}`, { status: 'ACTIVE' }),
  );
  return asset;
}

const usedAsset = await makeAsset('db.index.tuning', '인덱스 튜닝', '느린 쿼리에 인덱스를 붙인다');
// selector가 domain=database라 아래 해석에서 후보에 오르지 않는다 — "안 쓰는 자산"이 된다.
const unusedAsset = expectOk(
  '미사용 자산',
  await rest('POST', `/organizations/${orgId}/assets`, {
    type: 'KNOWLEDGE',
    key: 'frontend.css.reset',
    name: 'CSS 리셋',
    description: '브라우저 기본 스타일 초기화',
    scopeType: 'COMPANY',
    ownerType: 'USER',
    ownerId: userId,
    selector: { domains: ['frontend'] },
  }),
).asset.id;
const unusedVersionId = expectOk(
  '미사용 자산 버전',
  await rest('POST', `/organizations/${orgId}/assets/${unusedAsset}/versions`, {
    version: '1.0.0',
    status: 'CANDIDATE',
    structuredContent: { note: 'CSS 리셋' },
    summary: 'CSS 리셋',
  }),
).version.id;
expectOk(
  '미사용 자산 버전 활성화',
  await rest(
    'POST',
    `/organizations/${orgId}/assets/${unusedAsset}/versions/${unusedVersionId}/promote`,
  ),
);
// 후보에는 오르되 selector가 맞지 않아 매번 밀리는 상태를 만든다.
expectOk(
  '미사용 자산 활성화',
  await rest('PATCH', `/organizations/${orgId}/assets/${unusedAsset}`, { status: 'ACTIVE' }),
);

console.log('\n── 해석 두 번 (사용 기록이 쌓인다) ──');
for (let i = 0; i < 2; i++) {
  const result = await rpc(token, orgId, 'company.resolve_task', {
    task: { description: 'DB 인덱스 점검', domain: ['database'], type: ['troubleshoot'] },
    client: { name: 'codex', version: '1.0', model: 'gpt-5' },
  });
  if (result.isError) throw new Error(`해석 실패: ${result.text}`);
  if (i === 0) {
    // 첫 해석만 종료해 토큰을 보고한다. 두 번째는 보고하지 않아 "모르는 값"이 섞인다.
    await rpc(token, orgId, 'company.task.complete', {
      traceId: result.data.traceId,
      status: 'COMPLETED',
      summary: '점검 완료',
      clientReportedInputTokens: 4000,
      clientReportedOutputTokens: 900,
    });
  }
}

console.log('\n── 사용량 집계 ──');
const analytics = expectOk('집계', await rest('GET', `/organizations/${orgId}/analytics`)).analytics;

check('자산 2개', analytics.overview.totalAssets, 2);
check('흐름 2건', analytics.overview.totalTraces, 2);
check('타입별 집계', analytics.overview.assetsByType[0].key, 'KNOWLEDGE');

const used = analytics.assetUsage.find((row) => row.assetId === usedAsset);
// 개수만 남기던 시절에는 답할 수 없던 질문이다.
check('주입된 자산이 집계된다', used !== undefined, true);
check('두 번 선택됐다', used.selectedCount, 2);
check('선택률이 계산된다', used.selectionRate, 1);

console.log('\n── 한 번도 주입되지 않은 자산을 찾는다 ──');
const unused = analytics.unusedAssets.find((row) => row.assetId === unusedAsset);
// 이 화면의 존재 이유다. 매번 후보에 올랐다가 매번 밀리는 자산이 보여야 정리할 수 있다.
check('한 번도 주입 안 된 자산이 잡힌다', unused !== undefined, true);
check('쓰이는 자산은 목록에 없다', analytics.unusedAssets.some((r) => r.assetId === usedAsset), false);
// 후보에는 올랐다는 사실도 함께 보여야 한다 — 왜 밀렸는지가 정리의 근거다.
const excludedRow = analytics.assetUsage.find((row) => row.assetId === unusedAsset);
check('제외 이력이 남는다', excludedRow.excludedCount > 0, true);
check('제외 사유도 남는다', typeof excludedRow.topExclusionReason, 'string');
check('선택률 0으로 나온다', excludedRow.selectionRate, 0);

console.log('\n── Capability ──');
const capability = analytics.capabilities.find((row) => row.key === 'db.ops');
check('Capability별 자산 수', capability.count, 1);

console.log('\n── Context 효율 (§41) ──');
const efficiency = analytics.contextEfficiency;
check('후보 평균이 나온다', efficiency.averageCandidates.value > 0, true);
check('몇 건이 들어갔는지 밝힌다', efficiency.averageCandidates.sampleSize, 2);

// 흐름 하나만 토큰을 보고했다. 모르는 흐름은 분모에서도 빠져야 한다(§40).
const reported = efficiency.averageClientReportedInputTokens;
check('보고된 건만 집계한다', reported.sampleSize, 1);
check('전체 대상 수는 따로 밝힌다', reported.totalCandidates, 2);
// 0으로 치환했다면 평균이 2000이 된다. 그러면 조직이 토큰을 절반만 쓰는 것처럼 보인다.
check('0으로 치환하지 않는다', reported.value, 4000);

console.log('\n── 분모가 0이면 비율을 내지 않는다 ──');
const emptyOrgId = expectOk(
  '빈 조직',
  await rest('POST', '/organizations', { name: 'Empty Org', slug: `empty-${stamp}` }),
).organization.id;
const empty = expectOk('빈 집계', await rest('GET', `/organizations/${emptyOrgId}/analytics`)).analytics;
// 0%로 표시하면 "전부 실패"와 구분되지 않는다.
check('산출물 계약 충족률은 null', empty.outputContract.satisfiedRate, null);
check('승격률도 null', empty.contributions.promotedRate, null);
check('평균도 null', empty.contextEfficiency.averageCandidates.value, null);
check('0건임은 밝힌다', empty.contextEfficiency.averageCandidates.sampleSize, 0);

console.log('\n── 개인별 생산성 점수를 만들지 않는다 (§57) ──');
// 원칙이 주석으로만 있으면 다음 사람이 "참고용인데" 하며 추가한다. 응답 형태로 못 박는다.
const serialized = JSON.stringify(analytics);
check('사용자 id가 응답에 없다', serialized.includes(userId), false);
check('userId 키가 없다', /"user(Id|Name)"/i.test(serialized), false);
check('displayName 키가 없다', serialized.includes('displayName'), false);
check('제출자·승인자별 순위가 없다', /submittedBy|reviewedBy|approvedBy/.test(serialized), false);

console.log('\n── 기간 ──');
const scoped = expectOk('7일', await rest('GET', `/organizations/${orgId}/analytics?days=7`)).analytics;
check('기간이 응답에 실린다', scoped.overview.days, 7);
const allTime = expectOk('전 구간', await rest('GET', `/organizations/${orgId}/analytics?days=0`))
  .analytics;
// 0은 "0일"이 아니라 "제한 없음"이다. null로 밝힌다.
check('0이면 제한 없음', allTime.overview.days, null);
check('잘못된 기간은 400', (await rest('GET', `/organizations/${orgId}/analytics?days=-1`)).status, 400);
check(
  '숫자가 아니면 400',
  (await rest('GET', `/organizations/${orgId}/analytics?days=abc`)).status,
  400,
);

console.log('\n── 다른 조직 것은 보이지 않는다 ──');
const otherOrg = expectOk(
  '남의 조직',
  await rest('POST', '/organizations', { name: 'Other', slug: `other-${stamp}` }),
).organization.id;
const otherAnalytics = expectOk(
  '남의 집계',
  await rest('GET', `/organizations/${otherOrg}/analytics`),
).analytics;
check('자산이 섞이지 않는다', otherAnalytics.overview.totalAssets, 0);
check('사용량도 섞이지 않는다', otherAnalytics.assetUsage.length, 0);

console.log(`\n결과: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
