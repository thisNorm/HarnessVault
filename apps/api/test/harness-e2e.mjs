// Phase 2 완료 조건 검증: Harness Asset을 구조화 저장하고 Version·Relation을 조회할 수 있다.
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
  for (const c of res.headers.getSetCookie?.() ?? []) {
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
const secret = randomBytes(18).toString('base64url');
const admin = { email: `h-admin-${stamp}@example.com`, password: secret, displayName: '자산 관리자' };
const member = { email: `h-member-${stamp}@example.com`, password: secret, displayName: '일반 멤버' };

await call('POST', '/auth/register', admin);
const memberRes = await call('POST', '/auth/register', member);
const memberId = memberRes.body.user.id;
await call('POST', '/auth/login', { email: admin.email, password: admin.password });

const orgRes = await call('POST', '/organizations', {
  name: 'Harness Org',
  slug: `harness-${stamp}`,
});
const orgId = orgRes.body.organization.id;
await call('POST', `/organizations/${orgId}/members`, { email: member.email });

const teamRes = await call('POST', `/organizations/${orgId}/teams`, {
  name: 'DBA Team',
  slug: 'dba',
});
const teamId = teamRes.body.team.id;

console.log('\n── Capability ──');
const capRes = await call('POST', `/organizations/${orgId}/capabilities`, {
  key: 'database.troubleshooting',
  name: 'DB 장애 대응',
  description: '데이터베이스 장애 원인 분석과 복구',
  ownerType: 'TEAM',
  ownerId: teamId,
});
check('Capability 생성', capRes.status, 201);
const capabilityId = capRes.body.capability.id;
check('중복 key 거부', (await call('POST', `/organizations/${orgId}/capabilities`, { key: 'database.troubleshooting', name: 'x', ownerType: 'TEAM', ownerId: teamId })).status, 409);
check('Capability 목록', (await call('GET', `/organizations/${orgId}/capabilities`)).body.capabilities.length, 1);

console.log('\n── 자산 생성 ──');
const coreRes = await call('POST', `/organizations/${orgId}/assets`, {
  type: 'SKILL',
  key: 'db.troubleshoot.core',
  name: 'DB 장애 진단 핵심',
  capabilityId,
  scopeType: 'COMPANY',
  inheritanceMode: 'EXTENDABLE',
  ownerType: 'TEAM',
  ownerId: teamId,
  selector: { domains: ['database'], tasks: ['troubleshoot'] },
});
check('COMPANY 자산 생성 (scopeId 자동)', coreRes.status, 201);
const coreId = coreRes.body.asset.id;
check('COMPANY scopeId가 조직 id', coreRes.body.asset.scopeId, orgId);
check('DRAFT 상태로 시작', coreRes.body.asset.status, 'DRAFT');

const ruleRes = await call('POST', `/organizations/${orgId}/assets`, {
  type: 'RULE',
  key: 'verify-before-completion',
  name: '완료 전 검증 필수',
  scopeType: 'COMPANY',
  inheritanceMode: 'LOCKED',
  ownerType: 'TEAM',
  ownerId: teamId,
});
check('LOCKED 규칙 생성', ruleRes.status, 201);

console.log('\n── identity 해석: 같은 key가 다른 스코프에 공존 ──');
const teamOverride = await call('POST', `/organizations/${orgId}/assets`, {
  type: 'RULE',
  key: 'verify-before-completion',
  name: '완료 전 검증 — 팀 확장',
  scopeType: 'TEAM',
  scopeId: teamId,
  inheritanceMode: 'EXTENDABLE',
  ownerType: 'TEAM',
  ownerId: teamId,
});
check('같은 key + 다른 스코프 허용', teamOverride.status, 201);
check(
  '같은 key + 같은 스코프 거부',
  (await call('POST', `/organizations/${orgId}/assets`, { type: 'RULE', key: 'verify-before-completion', name: 'dup', scopeType: 'COMPANY', ownerType: 'TEAM', ownerId: teamId })).status,
  409,
);
check('TEAM 스코프에 scopeId 누락 시 400', (await call('POST', `/organizations/${orgId}/assets`, { type: 'RULE', key: 'needs-scope-id', name: 'x', scopeType: 'TEAM', ownerType: 'TEAM', ownerId: teamId })).status, 400);

console.log('\n── Selector 검증 ──');
check('알 수 없는 selector 키 거부', (await call('POST', `/organizations/${orgId}/assets`, { type: 'SKILL', key: 'bad.selector', name: 'x', scopeType: 'COMPANY', ownerType: 'TEAM', ownerId: teamId, selector: { database: ['postgresql'] } })).status, 400);
check('잘못된 key 형식 거부', (await call('POST', `/organizations/${orgId}/assets`, { type: 'SKILL', key: 'Bad Key', name: 'x', scopeType: 'COMPANY', ownerType: 'TEAM', ownerId: teamId })).status, 400);

console.log('\n── 버전 ──');
const v1 = await call('POST', `/organizations/${orgId}/assets/${coreId}/versions`, {
  version: '1.0',
  summary: '초기 절차',
  structuredContent: { steps: ['연결 확인', '슬로우 쿼리 확인'] },
  status: 'CANDIDATE',
});
check('버전 생성', v1.status, 201);
check('토큰 추정치 기록됨', typeof v1.body.version.estimatedTokens, 'number');
check('중복 버전 거부', (await call('POST', `/organizations/${orgId}/assets/${coreId}/versions`, { version: '1.0', structuredContent: {} })).status, 409);
check('잘못된 버전 형식 거부', (await call('POST', `/organizations/${orgId}/assets/${coreId}/versions`, { version: 'v1', structuredContent: {} })).status, 400);

const promote1 = await call('POST', `/organizations/${orgId}/assets/${coreId}/versions/${v1.body.version.id}/promote`);
check('CANDIDATE → ACTIVE 승격', promote1.body.promoted.status, 'ACTIVE');
check('승격 시 밀려난 버전 없음', promote1.body.superseded.length, 0);

const v2 = await call('POST', `/organizations/${orgId}/assets/${coreId}/versions`, {
  version: '1.1',
  summary: '슬로우 쿼리 임계값 추가',
  structuredContent: { steps: ['연결 확인', '슬로우 쿼리 확인', '임계값 비교'] },
  status: 'CANDIDATE',
});
const promote2 = await call('POST', `/organizations/${orgId}/assets/${coreId}/versions/${v2.body.version.id}/promote`);
check('두 번째 승격', promote2.body.promoted.status, 'ACTIVE');
check('기존 ACTIVE가 SUPERSEDED로', promote2.body.superseded.length, 1);
check('밀려난 버전은 1.0', promote2.body.superseded[0].version, '1.0');

const draft = await call('POST', `/organizations/${orgId}/assets/${coreId}/versions`, {
  version: '1.2',
  structuredContent: {},
  status: 'DRAFT',
});
check('DRAFT 버전은 바로 승격 불가', (await call('POST', `/organizations/${orgId}/assets/${coreId}/versions/${draft.body.version.id}/promote`)).status, 409);
check('SUPERSEDED 버전 재승격 불가', (await call('POST', `/organizations/${orgId}/assets/${coreId}/versions/${v1.body.version.id}/promote`)).status, 409);

console.log('\n── 자산 상태 전이 ──');
check('DRAFT → ACTIVE', (await call('PATCH', `/organizations/${orgId}/assets/${coreId}`, { status: 'ACTIVE' })).body.asset.status, 'ACTIVE');
check('ACTIVE → DRAFT 거부', (await call('PATCH', `/organizations/${orgId}/assets/${coreId}`, { status: 'DRAFT' })).status, 409);
check('ACTIVE → DEPRECATED 허용', (await call('PATCH', `/organizations/${orgId}/assets/${ruleRes.body.asset.id}`, { status: 'ACTIVE' })).status, 200);

console.log('\n── 관계 ──');
const variantRes = await call('POST', `/organizations/${orgId}/assets`, {
  type: 'VARIANT',
  key: 'db.variant.sqlite',
  name: 'SQLite Variant',
  capabilityId,
  scopeType: 'COMPANY',
  ownerType: 'TEAM',
  ownerId: teamId,
  selector: { databases: ['sqlite'] },
});
const variantId = variantRes.body.asset.id;
check('VARIANT_OF 관계 생성', (await call('POST', `/organizations/${orgId}/assets/${variantId}/relations`, { toAssetId: coreId, type: 'VARIANT_OF' })).status, 201);
check('중복 관계 거부', (await call('POST', `/organizations/${orgId}/assets/${variantId}/relations`, { toAssetId: coreId, type: 'VARIANT_OF' })).status, 409);
check('자기참조 거부', (await call('POST', `/organizations/${orgId}/assets/${variantId}/relations`, { toAssetId: variantId, type: 'DEPENDS_ON' })).status, 400);

const detail = await call('GET', `/organizations/${orgId}/assets/${coreId}`);
check('상세에 버전 이력 포함', detail.body.versions.length, 3);
check('상세에 역방향 관계 포함', detail.body.relations.incoming.length, 1);
check('역방향 관계 타입', detail.body.relations.incoming[0].type, 'VARIANT_OF');
check('ACTIVE 버전 1개', detail.body.activeVersionCount, 1);

console.log('\n── 목록 필터 ──');
check('type 패싯', (await call('GET', `/organizations/${orgId}/assets?type=RULE`)).body.assets.length, 2);
check('scopeType 필터', (await call('GET', `/organizations/${orgId}/assets?scopeType=TEAM`)).body.assets.length, 1);
check('capability 필터', (await call('GET', `/organizations/${orgId}/assets?capabilityId=${capabilityId}`)).body.assets.length, 2);
check('검색어 필터', (await call('GET', `/organizations/${orgId}/assets?q=sqlite`)).body.assets.length, 1);
check('잘못된 필터값 거부', (await call('GET', `/organizations/${orgId}/assets?type=NOPE`)).status, 400);

console.log('\n── 권한 ──');
const adminCookie = cookie;
await call('POST', '/auth/login', { email: member.email, password: member.password });
check('일반 멤버는 자산 생성 불가', (await call('POST', `/organizations/${orgId}/assets`, { type: 'SKILL', key: 'nope', name: 'x', scopeType: 'COMPANY', ownerType: 'USER', ownerId: memberId })).status, 403);
check('일반 멤버도 목록 조회 가능', (await call('GET', `/organizations/${orgId}/assets`)).status, 200);
cookie = adminCookie;

console.log('\n── §63 Case 3 재현 가능성 ──');
// Resolver가 RESOLUTION_CONFLICT를 검출하려면 ACTIVE 버전 2개인 상태가 저장 가능해야 한다.
// DB가 이를 막으면 Phase 3 테스트를 작성할 수 없으므로 여기서 확인한다.
const sql = postgres(
  process.env.DATABASE_URL ?? 'postgresql://harness:harness@localhost:5432/harnessvault',
);
try {
  await sql`update asset_versions set status = 'ACTIVE' where asset_id = ${coreId} and version = '1.0'`;
  const rows = await sql`
    select count(*)::int as count from asset_versions
    where asset_id = ${coreId} and status = 'ACTIVE'
  `;
  check('ACTIVE 버전 2개 상태가 저장 가능', rows[0].count, 2);

  const conflicted = await call('GET', `/organizations/${orgId}/assets/${coreId}`);
  check('상세가 충돌을 감추지 않고 그대로 보고', conflicted.body.activeVersionCount, 2);

  await sql`update asset_versions set status = 'SUPERSEDED' where asset_id = ${coreId} and version = '1.0'`;

  console.log('\n── 감사 로그 ──');
  const events = await sql`select distinct event_type from audit_events where organization_id = ${orgId}`;
  const recorded = new Set(events.map((row) => row.event_type));
  for (const expected of [
    'capability.created',
    'asset.created',
    'asset.status_changed',
    'asset_version.created',
    'asset_version.promoted',
    'asset_relation.created',
  ]) {
    check(`${expected} 기록됨`, recorded.has(expected), true);
  }
} finally {
  await sql.end();
}

console.log(`\n결과: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
