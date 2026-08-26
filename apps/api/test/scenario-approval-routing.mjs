// 시연: 팀원의 AI가 MCP로 사내 자료를 요청했을 때
//       등급에 따라 승인이 **어디로 가는지**, 승인 후 실제로 접근되는지.
//
//   김팀원   ORG_MEMBER · PROJECT_MEMBER  — AI를 MCP로 붙여 일한다
//   박팀장   ORG_MEMBER · PROJECT_LEAD    — INTERNAL 자료를 승인한다
//   이보안   ORG_MEMBER · 보안팀 그룹      — RESTRICTED 자료를 승인한다
//
// 실행: node scripts/with-api.mjs node apps/api/test/scenario-approval-routing.mjs
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = 'http://localhost:3000';
const MCP = `${BASE}/mcp`;
const ROOT = process.env.HARNESS_TEST_ROOT ?? 'C:/Users/invako/AppData/Local/Temp/harness-resources';

let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? '' : `  (${actual} != ${expected})`}`);
  if (ok) pass++;
  else fail++;
}

function step(title) {
  console.log(`\n${'─'.repeat(66)}\n${title}\n${'─'.repeat(66)}`);
}

function expectOk(label, res) {
  if (res.status >= 400) throw new Error(`${label} 실패: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

/** 사람 한 명 = 쿠키 + Bearer 토큰. 서로 섞이지 않게 묶는다. */
function person(displayName) {
  const suffix = randomBytes(5).toString('hex');
  return {
    displayName,
    email: `demo-${suffix}@example.com`,
    password: randomBytes(18).toString('base64url'),
    cookie: '',
    token: '',
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

let seq = 0;
/** 팀원의 AI가 회사에 들어오는 경로. REST가 아니라 MCP다. */
async function ai(actor, orgId, tool, args) {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${actor.token}`,
      'x-harness-organization': orgId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++seq,
      method: 'tools/call',
      params: { name: tool, arguments: args },
    }),
  });
  const body = await res.json();
  if (body.error) return { isError: true, code: null, text: JSON.stringify(body.error) };
  if (body.result?.isError) {
    const text = body.result.content?.[0]?.text ?? '';
    let code = null;
    try {
      code = JSON.parse(text).code ?? null;
    } catch {
      /* 코드가 없는 오류도 있다 */
    }
    return { isError: true, code, text };
  }
  return { isError: false, data: JSON.parse(body.result.content[0].text) };
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
  actor.token = raw?.split('=')[1]?.split(';')[0] ?? '';
  actor.id = (await actor.rest('GET', '/auth/me')).body.user.id;
  return actor;
}

const stamp = Date.now();

/* ══════════════════════════════════════════════════════════ */
step('1. 계정과 조직');

const admin = await register(person('시스템 관리자'));
const member = await register(person('김팀원'));
const lead = await register(person('박팀장'));
const security = await register(person('이보안'));
console.log(`  김팀원  ${member.email}`);
console.log(`  박팀장  ${lead.email}`);
console.log(`  이보안  ${security.email}`);

const orgId = expectOk(
  '조직',
  await admin.rest('POST', '/organizations', { name: '데모 회사', slug: `demo-${stamp}` }),
).organization.id;
for (const who of [member, lead, security]) {
  expectOk(
    '멤버 추가',
    await admin.rest('POST', `/organizations/${orgId}/members`, {
      email: who.email,
      role: 'ORG_MEMBER',
    }),
  );
}

const teamId = expectOk(
  '팀',
  await admin.rest('POST', `/organizations/${orgId}/teams`, { name: '플랫폼팀', slug: 'platform' }),
).team.id;
for (const who of [member, lead]) {
  await admin.rest('POST', `/organizations/${orgId}/teams/${teamId}/members`, { userId: who.id });
}

const projectId = expectOk(
  '프로젝트',
  await admin.rest('POST', `/organizations/${orgId}/projects`, {
    name: '결제 서비스',
    slug: 'payments',
    teamId,
  }),
).project.id;
expectOk(
  '팀원 배치',
  await admin.rest('POST', `/organizations/${orgId}/projects/${projectId}/members`, {
    userId: member.id,
    role: 'PROJECT_MEMBER',
  }),
);
expectOk(
  '팀장 배치',
  await admin.rest('POST', `/organizations/${orgId}/projects/${projectId}/members`, {
    userId: lead.id,
    role: 'PROJECT_LEAD',
  }),
);

// 보안팀은 프로젝트에 속하지 않는다. 등급으로만 불려 온다.
const securityGroupId = expectOk(
  '보안팀 그룹',
  await admin.rest('POST', `/organizations/${orgId}/groups`, {
    name: '보안팀',
    slug: 'security',
  }),
).group.id;
expectOk(
  '보안팀 배치',
  await admin.rest('POST', `/organizations/${orgId}/groups/${securityGroupId}/members`, {
    userId: security.id,
  }),
);
console.log('  플랫폼팀: 김팀원(PROJECT_MEMBER) · 박팀장(PROJECT_LEAD)');
console.log('  보안팀 그룹: 이보안 (프로젝트에는 속하지 않음)');

/* ══════════════════════════════════════════════════════════ */
step('2. 사내 자료 — 등급이 다른 두 자원');

mkdirSync(`${ROOT}/docs`, { recursive: true });
const runbook = `runbook-${stamp}.md`;
writeFileSync(`${ROOT}/docs/${runbook}`, '# 배포 절차\n\n1. 카나리 배포\n2. 지표 확인\n', 'utf-8');

const internalFs = expectOk(
  '내부 문서',
  await admin.rest('POST', `/organizations/${orgId}/resources`, {
    type: 'FILE_SYSTEM',
    name: '팀 운영 문서',
    classification: 'INTERNAL',
    ownerType: 'TEAM',
    ownerId: teamId,
    adapterType: 'filesystem',
    config: { root: `${ROOT}/docs`, maxBytes: 100000 },
  }),
).resource.id;

const restrictedDb = expectOk(
  '고객 DB',
  await admin.rest('POST', `/organizations/${orgId}/resources`, {
    type: 'DATABASE',
    name: '고객 데이터베이스',
    classification: 'RESTRICTED',
    ownerType: 'TEAM',
    ownerId: teamId,
    adapterType: 'postgres',
    config: { maxRows: 50 },
    credentialRef: 'HARNESS_RESOURCE_DEMO_DB',
  }),
).resource.id;
console.log('  팀 운영 문서       INTERNAL    (파일)');
console.log('  고객 데이터베이스   RESTRICTED  (DB)');

/* ══════════════════════════════════════════════════════════ */
step('3. 정책 — 무엇을 누가 승인하는가');

// 읽기는 등급과 무관하게 허용. 쓰기만 승인을 받는다.
expectOk(
  '읽기 허용',
  await admin.rest('POST', `/organizations/${orgId}/policies`, {
    name: '조회 허용',
    effect: 'ALLOW',
    scopeType: 'COMPANY',
    actions: ['files.read', 'files.search', 'db.schema', 'db.query'],
  }),
);
expectOk(
  'INTERNAL 쓰기 승인 필요',
  await admin.rest('POST', `/organizations/${orgId}/policies`, {
    name: 'INTERNAL 변경은 승인 필요',
    effect: 'APPROVAL_REQUIRED',
    scopeType: 'COMPANY',
    classification: 'INTERNAL',
    actions: ['files.write'],
  }),
);
expectOk(
  'RESTRICTED 쓰기 승인 필요',
  await admin.rest('POST', `/organizations/${orgId}/policies`, {
    name: 'RESTRICTED 변경은 승인 필요',
    effect: 'APPROVAL_REQUIRED',
    scopeType: 'COMPANY',
    classification: 'RESTRICTED',
    actions: ['db.update'],
  }),
);

// 여기가 이 시연의 핵심 — 등급에 따라 승인자가 갈린다.
expectOk(
  'INTERNAL 승인자',
  await admin.rest('POST', `/organizations/${orgId}/approval-policies`, {
    name: 'INTERNAL은 프로젝트 리드가',
    mode: 'ANY_OF',
    classification: 'INTERNAL',
    approvers: [{ kind: 'PROJECT_ROLE', projectRole: 'PROJECT_LEAD' }],
    expiresInMinutes: 60,
  }),
);
expectOk(
  'RESTRICTED 승인자',
  await admin.rest('POST', `/organizations/${orgId}/approval-policies`, {
    name: 'RESTRICTED는 보안팀이',
    mode: 'ANY_OF',
    classification: 'RESTRICTED',
    approvers: [{ kind: 'GROUP', refId: securityGroupId }],
    expiresInMinutes: 60,
  }),
);
console.log('  INTERNAL   변경 → PROJECT_LEAD (박팀장)');
console.log('  RESTRICTED 변경 → 보안팀 그룹 (이보안)');

/* ══════════════════════════════════════════════════════════ */
step('4. 김팀원의 AI가 MCP로 들어와 일을 시작한다');

const resolved = await ai(member, orgId, 'company.resolve_task', {
  projectId,
  task: { description: '고객 이탈 원인 분석', domain: ['database'], type: ['analyze'] },
  client: { name: 'claude-code', version: '2.0', model: 'claude-opus-5' },
});
if (resolved.isError) throw new Error(`해석 실패: ${resolved.text}`);
const traceId = resolved.data.traceId;
console.log(`  company.resolve_task → trace ${traceId.slice(0, 8)}…`);

const listed = await ai(member, orgId, 'company.resources', {});
console.log(`  company.resources → ${listed.data.resources.map((r) => r.name).join(', ')}`);
// credential 값은 어떤 경로로도 나가지 않는다(§60).
check(
  '접속 문자열은 노출되지 않는다',
  JSON.stringify(listed.data).includes('postgresql://'),
  false,
);

/* ══════════════════════════════════════════════════════════ */
step('5. 조회 — 승인 없이 바로 된다');

const fileRead = await ai(member, orgId, 'company.files.read', {
  resourceId: internalFs,
  path: runbook,
  purpose: '배포 절차 확인',
  traceId,
});
check('내부 문서를 바로 읽는다', fileRead.isError, false);
check('실제 내용이 온다', fileRead.data.content.includes('카나리 배포'), true);

const dbQuery = await ai(member, orgId, 'company.db.query', {
  resourceId: restrictedDb,
  query: 'select count(*)::int as c from events_summary',
  purpose: '이벤트 적재량 확인',
  traceId,
});
check('고객 DB 조회도 바로 된다', dbQuery.isError, false);
console.log(`  조회 결과: ${JSON.stringify(dbQuery.data.rows[0])}`);

/* ══════════════════════════════════════════════════════════ */
step('6. INTERNAL 변경 → 박팀장에게 간다');

const fileWrite = await ai(member, orgId, 'company.files.write', {
  resourceId: internalFs,
  path: runbook,
  content: '# 배포 절차\n\n1. 카나리 배포\n2. 지표 확인\n3. 롤백 기준 확인\n',
  purpose: '롤백 기준 추가',
  projectId,
  reason: '배포 절차에 롤백 기준이 빠져 있습니다',
  risk: '문서 한 줄 추가',
  rollbackPlan: '이전 내용으로 되돌립니다',
  verificationPlan: '다시 읽어 확인',
  traceId,
});
check('바로 실행되지 않는다', fileWrite.data.executed, false);
check('승인 대기로 만들어진다', fileWrite.data.status, 'PENDING');
const internalRequestId = fileWrite.data.approvalRequestId;

// 누구 화면에 뜨는가 — 이것이 "어디서 승인이 일어나는가"의 답이다.
async function canDecide(who, requestId) {
  const list = expectOk('승인함', await who.rest('GET', `/organizations/${orgId}/approvals`))
    .approvals;
  const found = list.find((item) => item.id === requestId);
  return found?.canDecide === true;
}

check('박팀장 승인함에 뜬다', await canDecide(lead, internalRequestId), true);
// 보안팀은 INTERNAL에 불려 오지 않는다.
check('이보안에게는 권한이 없다', await canDecide(security, internalRequestId), false);
check('김팀원 스스로도 승인 못 한다', await canDecide(member, internalRequestId), false);

/** 승인함에 아예 보이는지. 권한만 막고 내용을 보여 주면 절반만 막은 것이다. */
async function isVisible(who, requestId) {
  const list = expectOk('승인함', await who.rest('GET', `/organizations/${orgId}/approvals`))
    .approvals;
  return list.some((item) => item.id === requestId);
}
// 요청자 본인은 자기 요청을 본다.
check('김팀원은 자기 요청을 본다', await isVisible(member, internalRequestId), true);

const leadView = expectOk(
  '요청 상세',
  await lead.rest('GET', `/organizations/${orgId}/approvals/${internalRequestId}`),
).approval;
console.log(`  박팀장이 보는 것: "${leadView.reason}"`);
console.log(`                   ${leadView.resourceName} · ${leadView.action}`);

/* ══════════════════════════════════════════════════════════ */
step('7. 박팀장이 승인 → 실행된다');

expectOk(
  '승인',
  await lead.rest('POST', `/organizations/${orgId}/approvals/${internalRequestId}/approve`, {
    comment: '롤백 기준은 있어야 합니다',
  }),
);
const executedInternal = await ai(member, orgId, 'company.approval.execute', {
  approvalRequestId: internalRequestId,
  traceId,
});
check('승인 후 실행된다', executedInternal.isError, false);
check('EXECUTED로 전이', executedInternal.data.status, 'EXECUTED');

const reread = await ai(member, orgId, 'company.files.read', {
  resourceId: internalFs,
  path: runbook,
  purpose: '반영 확인',
  traceId,
});
// 실제로 파일이 바뀌었는지 본다. 상태만 바뀌고 끝나면 의미가 없다.
check('파일이 실제로 바뀌었다', reread.data.content.includes('롤백 기준 확인'), true);

/* ══════════════════════════════════════════════════════════ */
step('8. RESTRICTED 변경 → 같은 사람인데 보안팀으로 간다');

const topic = `demo/${stamp}`;
const dbWrite = await ai(member, orgId, 'company.db.update', {
  resourceId: restrictedDb,
  query: `insert into events_summary (topic, count, day) values ('${topic}', 3, '2026-08-26')`,
  purpose: '분석 결과 저장',
  projectId,
  reason: '이탈 분석 결과를 요약 테이블에 남깁니다',
  risk: '행 1건 추가',
  rollbackPlan: `delete from events_summary where topic = '${topic}'`,
  verificationPlan: '같은 topic으로 조회해 1건 확인',
  traceId,
});
check('바로 실행되지 않는다', dbWrite.data.executed, false);
const restrictedRequestId = dbWrite.data.approvalRequestId;

// 같은 요청자·같은 프로젝트인데 등급이 다르니 승인자가 바뀐다.
check('이보안 승인함에 뜬다', await canDecide(security, restrictedRequestId), true);
check('박팀장에게는 권한이 없다', await canDecide(lead, restrictedRequestId), false);
console.log('  → 등급이 RESTRICTED라 프로젝트 리드가 아니라 보안팀으로 갔다');

// 권한 없는 사람이 눌러도 서버가 막는다. 화면에 안 보이는 것에 기대지 않는다.
const leadTries = await lead.rest(
  'POST',
  `/organizations/${orgId}/approvals/${restrictedRequestId}/approve`,
  { comment: '제가 승인하겠습니다' },
);
check('박팀장이 강제로 눌러도 거부', leadTries.status, 403);
check('이유를 알려준다', leadTries.body.code, 'PERMISSION_DENIED');

// 요청 본문에는 고객 DB를 향한 SQL이 그대로 들어 있다.
// 결정만 막고 내용을 보여 주면 보안팀으로 라우팅한 의미가 사라진다.
check('박팀장 승인함에 아예 안 보인다', await isVisible(lead, restrictedRequestId), false);
check(
  '내용도 볼 수 없다',
  (await lead.rest('GET', `/organizations/${orgId}/approvals/${restrictedRequestId}`)).status,
  404,
);
check('이보안에게는 보인다', await isVisible(security, restrictedRequestId), true);
// 조직 관리자는 본다 — 아무도 볼 수 없으면 거버넌스가 성립하지 않는다.
check('관리자는 전부 본다', await isVisible(admin, restrictedRequestId), true);

/* ══════════════════════════════════════════════════════════ */
step('9. 승인 전에 실행하려 하면 — 기다리라고 답한다');

const early = await ai(member, orgId, 'company.approval.execute', {
  approvalRequestId: restrictedRequestId,
  traceId,
});
check('실행 거부', early.isError, true);
// 거절이 아니라 대기다. 에이전트가 다음에 무엇을 할지 알아야 한다.
check('대기 중임을 알린다', early.code, 'APPROVAL_REQUIRED');

/* ══════════════════════════════════════════════════════════ */
step('10. 이보안이 승인 → 실제로 데이터가 들어간다');

expectOk(
  '보안팀 승인',
  await security.rest('POST', `/organizations/${orgId}/approvals/${restrictedRequestId}/approve`, {
    comment: '개인정보 항목이 없어 승인합니다',
  }),
);
const executedDb = await ai(member, orgId, 'company.approval.execute', {
  approvalRequestId: restrictedRequestId,
  traceId,
});
check('승인 후 실행된다', executedDb.isError, false);

const verify = await ai(member, orgId, 'company.db.query', {
  resourceId: restrictedDb,
  query: `select count(*)::int as c from events_summary where topic = '${topic}'`,
  purpose: '저장 확인',
  traceId,
});
// Mock 성공이 아니라 실제 행이 들어갔는지 본다.
check('실제로 DB에 반영됐다', verify.data.rows[0].c, 1);

/* ══════════════════════════════════════════════════════════ */
step('11. 거절되면 접근하지 못한다');

const willReject = await ai(member, orgId, 'company.db.update', {
  resourceId: restrictedDb,
  query: `delete from events_summary where topic = '${topic}'`,
  purpose: '되돌리기',
  projectId,
  reason: '잘못 넣은 것 같아 지우겠습니다',
  traceId,
});
const rejectId = willReject.data.approvalRequestId;
expectOk(
  '거절',
  await security.rest('POST', `/organizations/${orgId}/approvals/${rejectId}/reject`, {
    comment: '삭제는 이력이 남지 않아 안 됩니다',
  }),
);
const afterReject = await ai(member, orgId, 'company.approval.execute', {
  approvalRequestId: rejectId,
  traceId,
});
check('거절된 요청은 실행 불가', afterReject.isError, true);
// 대기와 다른 코드여야 에이전트가 접근을 바꾼다.
check('거절임을 구분해 알린다', afterReject.code, 'APPROVAL_REJECTED');

const stillThere = await ai(member, orgId, 'company.db.query', {
  resourceId: restrictedDb,
  query: `select count(*)::int as c from events_summary where topic = '${topic}'`,
  purpose: '거절 후 확인',
  traceId,
});
check('데이터가 지워지지 않았다', stillThere.data.rows[0].c, 1);

/* ══════════════════════════════════════════════════════════ */
step('12. 누가 무엇을 승인했는지 남는다');

const trace = expectOk(
  '흐름',
  await admin.rest('GET', `/organizations/${orgId}/traces/${traceId}`),
).trace;
const decisions = trace.events.filter((event) => event.eventType === 'approval.decided');
check('판단이 3건 기록됐다', decisions.length, 3);
for (const event of decisions) {
  console.log(`  ${event.actorDisplayName} — ${JSON.stringify(event.metadata).slice(0, 90)}`);
}

const postgresModule = await import('postgres');
const sql = postgresModule.default(
  process.env.DATABASE_URL ?? 'postgresql://harness:harness@localhost:5432/harnessvault',
);
try {
  const leak = await sql`
    select count(*)::int as c from audit_events
    where organization_id = ${orgId} and metadata::text like '%postgresql://%'
  `;
  // 감사 로그에도 접속 문자열은 없다(§39·§60).
  check('감사에 credential 없음', leak[0].c, 0);
} finally {
  await sql.end();
}

console.log(`\n${'═'.repeat(66)}`);
console.log(`결과: ${pass} passed, ${fail} failed`);
if (fail === 0) {
  console.log(`
요약
  조회        승인 없이 바로   — 정책이 ALLOW
  INTERNAL    박팀장이 승인    — PROJECT_LEAD 로 라우팅
  RESTRICTED  이보안이 승인    — 등급으로 보안팀 그룹에 라우팅
  거절        접근 불가        — APPROVAL_REJECTED 로 구분해 통보
  같은 요청자·같은 프로젝트라도 자원 등급에 따라 승인자가 바뀐다.`);
}
process.exit(fail === 0 ? 0 : 1);
