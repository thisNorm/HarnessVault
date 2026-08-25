// Phase 5 완료 조건 검증: 외부 Agent가 인증된 사용자 기준으로 Harness Asset을 조회할 수 있다.
import { randomBytes } from 'node:crypto';

const BASE = 'http://localhost:3000';
const MCP = `${BASE}/mcp`;

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
/** MCP JSON-RPC 호출. 인증 헤더를 직접 붙인다 — 쿠키가 아니라 Bearer 토큰을 쓴다. */
async function rpc(method, params, { token, orgId } = {}) {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(orgId ? { 'x-harness-organization': orgId } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method, params }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** 툴 결과를 꺼낸다. MCP는 성공 응답 안에 텍스트로 담아 준다. */
function toolResult(res) {
  if (res.body?.error) throw new Error(`RPC 오류: ${JSON.stringify(res.body.error).slice(0, 300)}`);
  return JSON.parse(res.body.result.content[0].text);
}

const stamp = Date.now();
const secret = randomBytes(18).toString('base64url');
const admin = { email: `m-admin-${stamp}@example.com`, password: secret, displayName: 'MCP 관리자' };
const other = { email: `m-other-${stamp}@example.com`, password: secret, displayName: '다른 조직' };

await rest('POST', '/auth/register', admin);
await rest('POST', '/auth/register', other);

/** 로그인해서 Bearer로 쓸 세션 토큰을 얻는다. */
async function login(account) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const raw = setCookie.find((c) => c.startsWith('harness_session='));
  cookie = raw?.split(';')[0] ?? '';
  return raw?.split('=')[1]?.split(';')[0] ?? '';
}

const adminToken = await login(admin);

const orgId = expectOk('조직 생성', await rest('POST', '/organizations', {
  name: 'MCP Org',
  slug: `mcp-${stamp}`,
})).organization.id;
const userId = (await rest('GET', '/auth/me')).body.user.id;

const teamId = expectOk('팀 생성', await rest('POST', `/organizations/${orgId}/teams`, {
  name: 'DBA',
  slug: 'dba',
})).team.id;
await rest('POST', `/organizations/${orgId}/teams/${teamId}/members`, { userId });

const capabilityId = expectOk('capability', await rest('POST', `/organizations/${orgId}/capabilities`, {
  key: 'database.troubleshooting',
  name: 'DB 장애 대응',
  ownerType: 'TEAM',
  ownerId: teamId,
})).capability.id;

async function makeAsset(asset, structuredContent) {
  const created = expectOk('자산 생성', await rest('POST', `/organizations/${orgId}/assets`, asset));
  const id = created.asset.id;
  const version = expectOk(
    '버전 생성',
    await rest('POST', `/organizations/${orgId}/assets/${id}/versions`, {
      version: '1.0',
      summary: `${asset.name} 요약`,
      structuredContent,
      status: 'CANDIDATE',
    }),
  );
  await rest('POST', `/organizations/${orgId}/assets/${id}/versions/${version.version.id}/promote`);
  await rest('PATCH', `/organizations/${orgId}/assets/${id}`, { status: 'ACTIVE' });
  return id;
}

const coreId = await makeAsset(
  {
    type: 'SKILL',
    key: 'db.troubleshoot.core',
    name: 'DB 장애 진단 핵심',
    description: 'DB 장애 원인 분석 절차',
    capabilityId,
    scopeType: 'COMPANY',
    inheritanceMode: 'EXTENDABLE',
    ownerType: 'TEAM',
    ownerId: teamId,
    selector: { domains: ['database'] },
  },
  { instructions: ['연결 확인', '슬로우 쿼리 확인'] },
);
const variantId = await makeAsset(
  {
    type: 'VARIANT',
    key: 'db.variant.sqlite',
    name: 'SQLite Variant',
    description: 'SQLite 환경 진단',
    capabilityId,
    scopeType: 'COMPANY',
    ownerType: 'TEAM',
    ownerId: teamId,
    selector: { databases: ['sqlite'] },
  },
  { instructions: ['WAL 모드 확인'] },
);
await makeAsset(
  {
    type: 'WORKFLOW',
    key: 'mqtt.diagnosis.flow',
    name: 'MQTT 진단 워크플로우',
    description: 'MQTT 수집 경로 진단',
    scopeType: 'COMPANY',
    ownerType: 'TEAM',
    ownerId: teamId,
    selector: { domains: ['mqtt'] },
  },
  { steps: ['broker 확인'] },
);
await rest('POST', `/organizations/${orgId}/assets/${variantId}/relations`, {
  toAssetId: coreId,
  type: 'VARIANT_OF',
});

// 다른 사용자가 자기 조직을 만든다. 조직 경계를 확인하기 위한 것이다.
const otherToken = await login(other);
const otherOrgId = expectOk('타 조직 생성', await rest('POST', '/organizations', {
  name: 'Other Org',
  slug: `other-${stamp}`,
})).organization.id;

console.log('\n── 인증 ──');
check('토큰 없으면 401', (await rpc('tools/list', {})).status, 401);
// secret-scan:allow — 일부러 유효하지 않은 값이다. 실제 자격증명이 아니다.
check('잘못된 토큰은 401', (await rpc('tools/list', {}, { token: 'not-a-real-token' })).status, 401);
check(
  '남의 조직 헤더는 403',
  (await rpc('tools/list', {}, { token: adminToken, orgId: otherOrgId })).status,
  403,
);

const single = await rpc('tools/list', {}, { token: adminToken });
check('단일 소속이면 헤더 없이 통과', single.status, 200);

console.log('\n── stateless transport ──');
const getRes = await fetch(MCP, {
  method: 'GET',
  headers: { authorization: `Bearer ${adminToken}` },
});
check('GET은 405', getRes.status, 405);

console.log('\n── tools/list ──');
const listed = await rpc('tools/list', {}, { token: adminToken, orgId });
const toolNames = listed.body.result.tools.map((t) => t.name).sort();
check('툴 4개', toolNames.length, 4);
check(
  '명세 §25 이름 그대로',
  JSON.stringify(toolNames),
  JSON.stringify([
    'company.find_similar',
    'company.get_asset',
    'company.resolve_task',
    'company.search_asset',
  ]),
);
check(
  'contribute는 아직 없음',
  toolNames.includes('company.contribute'),
  false,
);

console.log('\n── company.resolve_task ──');
const resolveArgs = {
  task: { description: 'DB 장애 분석', domain: ['database'], type: ['troubleshoot'] },
  environment: { database: 'sqlite' },
};
const resolved = toolResult(
  await rpc(
    'tools/call',
    { name: 'company.resolve_task', arguments: resolveArgs },
    { token: adminToken, orgId },
  ),
);
check('traceId 발급', typeof resolved.traceId, 'string');
const mcpKeys = [
  ...resolved.manifest.skills,
  ...resolved.manifest.variants,
  ...resolved.manifest.workflows,
].map((r) => r.key).sort();
check('core Skill 선택', mcpKeys.includes('db.troubleshoot.core'), true);
check('SQLite Variant 선택', mcpKeys.includes('db.variant.sqlite'), true);
check('MQTT 워크플로우 제외', mcpKeys.includes('mqtt.diagnosis.flow'), false);

// REST와 같은 결과여야 한다. Resolver를 두 번 만들지 않았다는 증거다.
// 위에서 other로 로그인했으므로 쿠키를 admin으로 되돌린다.
await login(admin);
const viaRest = expectOk('REST resolve', await rest('POST', `/organizations/${orgId}/resolve`, resolveArgs));
const restKeys = [
  ...viaRest.manifest.skills,
  ...viaRest.manifest.variants,
  ...viaRest.manifest.workflows,
].map((r) => r.key).sort();
check('MCP와 REST 결과 동일', JSON.stringify(mcpKeys), JSON.stringify(restKeys));

console.log('\n── company.search_asset ──');
const search = toolResult(
  await rpc(
    'tools/call',
    { name: 'company.search_asset', arguments: { query: 'DB 장애 진단' } },
    { token: adminToken, orgId },
  ),
);
check('어휘 기반임을 밝힘', search.method, 'LEXICAL');
check('관련 자산을 찾음', search.assets.some((a) => a.key === 'db.troubleshoot.core'), true);
// 어휘 검색이므로 "진단" 같은 공통 토큰이 있으면 무관해 보이는 자산도 낮은 점수로 딸려온다.
// 중요한 것은 배제가 아니라 순위다.
check('가장 관련 있는 자산이 1위', search.assets[0]?.key, 'db.troubleshoot.core');
const mqttScore = search.assets.find((a) => a.key === 'mqtt.diagnosis.flow')?.score ?? 0;
check('무관한 자산은 더 낮은 점수', search.assets[0].score > mqttScore, true);
check('점수 포함', typeof search.assets[0]?.score, 'number');
check(
  '점수 내림차순 정렬',
  JSON.stringify(search.assets.map((a) => a.score)),
  JSON.stringify([...search.assets.map((a) => a.score)].sort((a, b) => b - a)),
);

const limited = toolResult(
  await rpc(
    'tools/call',
    { name: 'company.search_asset', arguments: { query: 'DB', limit: 1 } },
    { token: adminToken, orgId },
  ),
);
check('limit 적용', limited.assets.length <= 1, true);

console.log('\n── company.get_asset (progressive disclosure) ──');
async function getAsset(level) {
  return toolResult(
    await rpc(
      'tools/call',
      { name: 'company.get_asset', arguments: { assetId: coreId, ...(level === undefined ? {} : { level }) } },
      { token: adminToken, orgId },
    ),
  );
}
const level0 = await getAsset(0);
const level1 = await getAsset(1);
const level2 = await getAsset(2);
const level3 = await getAsset(3);
check('level 0은 본문 없음', level0.body, undefined);
check('level 0도 메타데이터는 있음', level0.key, 'db.troubleshoot.core');
check('level 1은 본문 포함', typeof level1.body, 'string');
check('level 1 본문이 렌더됨', level1.body.includes('연결 확인'), true);
check('level 2는 관계 포함', Array.isArray(level2.relations?.incoming), true);
check('level 2에 Variant 역참조', level2.relations.incoming[0]?.key, 'db.variant.sqlite');
check('level 3은 원본 포함', Array.isArray(level3.structuredContent?.instructions), true);
check('기본 level은 1', JSON.stringify(await getAsset()), JSON.stringify(level1));
check(
  '응답 크기가 level에 따라 커짐',
  JSON.stringify(level0).length < JSON.stringify(level1).length &&
    JSON.stringify(level1).length < JSON.stringify(level3).length,
  true,
);

console.log('\n── company.find_similar ──');
const similar = toolResult(
  await rpc(
    'tools/call',
    {
      name: 'company.find_similar',
      arguments: {
        title: 'DB 장애 진단 절차',
        description: 'DB 장애 원인을 분석하는 절차',
        capability: capabilityId,
      },
    },
    { token: adminToken, orgId },
  ),
);
check('어휘 기반임을 밝힘', similar.method, 'LEXICAL');
check('기존 자산을 후보로 제시', similar.candidates.some((c) => c.key === 'db.troubleshoot.core'), true);
check('중복 후보 힌트', typeof similar.candidates[0]?.relationHint, 'string');

console.log('\n── 조직 경계 ──');
const crossOrg = await rpc(
  'tools/call',
  { name: 'company.get_asset', arguments: { assetId: coreId } },
  { token: otherToken, orgId: otherOrgId },
);
check('다른 조직 자산은 못 봄', crossOrg.body?.result?.isError ?? crossOrg.status !== 200, true);

const otherSearch = toolResult(
  await rpc(
    'tools/call',
    { name: 'company.search_asset', arguments: { query: 'DB 장애' } },
    { token: otherToken, orgId: otherOrgId },
  ),
);
check('다른 조직 검색은 비어 있음', otherSearch.assets.length, 0);

console.log(`\n결과: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
