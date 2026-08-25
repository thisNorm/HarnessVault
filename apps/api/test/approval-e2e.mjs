// Phase 8 완료 조건 검증: MCP request → pending → human approval → execution 이 실제 동작한다.
import { randomBytes } from 'node:crypto';

const BASE = 'http://localhost:3000';
const MCP = `${BASE}/mcp`;
const ROOT = process.env.HARNESS_TEST_ROOT ?? 'C:/Users/invako/AppData/Local/Temp/harness-resources';

let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (${actual}${ok ? '' : ` != ${expected}`})`);
  if (ok) pass++;
  else fail++;
}

/** 계정마다 쿠키·토큰을 따로 들고 다닌다. 승인은 요청자와 다른 사람이 해야 한다. */
function makeClient() {
  let cookie = '';
  return {
    get token() {
      return cookie.split('=')[1] ?? '';
    },
    async rest(method, path, body) {
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
    },
    async login(account) {
      const res = await fetch(`${BASE}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: account.email, password: account.password }),
      });
      const raw = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('harness_session='));
      cookie = raw?.split(';')[0] ?? '';
    },
  };
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
const secret = randomBytes(18).toString('base64url');
// demo DB는 실행 간 유지된다. 토픽에 스탬프를 붙여 실행끼리 간섭하지 않게 한다.
const topic = `approved/${stamp}`;
const safeTopic = `safe/${stamp}`;
const requester = { email: `ap-req-${stamp}@example.com`, password: secret, displayName: '요청자 코덱스' };
const approver = { email: `ap-lead-${stamp}@example.com`, password: secret, displayName: '승인자 리드' };
const outsider = { email: `ap-out-${stamp}@example.com`, password: secret, displayName: '무관한 사람' };

const admin = makeClient();
const lead = makeClient();
const other = makeClient();

for (const account of [requester, approver, outsider]) {
  await admin.rest('POST', '/auth/register', account);
}
await admin.login(requester);
const requesterId = (await admin.rest('GET', '/auth/me')).body.user.id;

const orgId = expectOk('조직', await admin.rest('POST', '/organizations', {
  name: 'Approval Org',
  slug: `ap-${stamp}`,
})).organization.id;

await admin.rest('POST', `/organizations/${orgId}/members`, { email: approver.email });
await admin.rest('POST', `/organizations/${orgId}/members`, { email: outsider.email });

await lead.login(approver);
const approverId = (await lead.rest('GET', '/auth/me')).body.user.id;
await other.login(outsider);
const outsiderId = (await other.rest('GET', '/auth/me')).body.user.id;
await admin.login(requester);

const teamId = expectOk('팀', await admin.rest('POST', `/organizations/${orgId}/teams`, {
  name: 'Ops',
  slug: 'ops',
})).team.id;
const groupId = expectOk('그룹', await admin.rest('POST', `/organizations/${orgId}/groups`, {
  name: 'DB Admin',
  slug: 'db-admin',
})).group.id;
await admin.rest('POST', `/organizations/${orgId}/groups/${groupId}/members`, { userId: approverId });

const dbId = expectOk('DB Resource', await admin.rest('POST', `/organizations/${orgId}/resources`, {
  type: 'DATABASE',
  name: '운영 DB',
  classification: 'RESTRICTED',
  ownerType: 'TEAM',
  ownerId: teamId,
  adapterType: 'postgres',
  credentialRef: 'HARNESS_RESOURCE_DEMO_DB',
})).resource.id;

const fsId = expectOk('FS Resource', await admin.rest('POST', `/organizations/${orgId}/resources`, {
  type: 'FILE_SYSTEM',
  name: '운영 문서',
  ownerType: 'TEAM',
  ownerId: teamId,
  adapterType: 'filesystem',
  config: { root: `${ROOT}/docs` },
})).resource.id;

// 쓰기는 승인을 요구한다.
const writePolicy = expectOk('쓰기 정책', await admin.rest('POST', `/organizations/${orgId}/policies`, {
  name: '쓰기는 승인 필요',
  effect: 'APPROVAL_REQUIRED',
  scopeType: 'COMPANY',
  actions: ['db.update', 'files.write'],
})).policy;
const approvalPolicy = expectOk('승인 정책', await admin.rest('POST', `/organizations/${orgId}/approval-policies`, {
  name: 'DB Admin 승인',
  mode: 'ANY_OF',
  approvers: [{ kind: 'GROUP', refId: groupId }],
  expiresInMinutes: 60,
})).policy;
check('승인 정책 생성', approvalPolicy.mode, 'ANY_OF');

console.log('\n── 1. 쓰기 요청 → PENDING ──');
const requested = await rpc(admin.token, orgId, 'company.db.update', {
  resourceId: dbId,
  query: `insert into events_summary (topic, count, day) values ('${topic}', 7, '2026-08-25')`,
  purpose: 'MQTT 장애 분석 결과 저장',
  reason: '분석 결과를 운영 테이블에 남겨야 합니다',
  risk: '행 1건 추가. 기존 데이터 변경 없음',
  rollbackPlan: `delete from events_summary where topic = '${topic}'`,
  verificationPlan: 'select로 1건 확인',
});
check('실행되지 않음', requested.data.executed, false);
check('PENDING 상태로 생성', requested.data.status, 'PENDING');
const requestId = requested.data.approvalRequestId;

const beforeRows = await rpc(admin.token, orgId, 'company.db.query', {
  resourceId: dbId,
  query: `select count(*)::int as c from events_summary where topic = '${topic}'`,
  purpose: '승인 전 확인',
});
check('승인 전에는 반영되지 않음', beforeRows.data.rows[0].c, 0);

console.log('\n── 2. 승인 없이 실행 시도 ──');
const early = await rpc(admin.token, orgId, 'company.approval.execute', {
  approvalRequestId: requestId,
});
check('승인 없이 실행 거부', early.isError, true);
check('NOT_APPROVED로 알림', early.text.includes('NOT_APPROVED'), true);

console.log('\n── 3. 승인 자격 ──');
check(
  '자기 요청 자기 승인 거부',
  (await admin.rest('POST', `/organizations/${orgId}/approvals/${requestId}/approve`, {})).status,
  403,
);
check(
  '승인자가 아닌 사람 거부',
  (await other.rest('POST', `/organizations/${orgId}/approvals/${requestId}/approve`, {})).status,
  403,
);

console.log('\n── 4. 승인함 표시 (§55) ──');
const inbox = expectOk('승인함', await lead.rest('GET', `/organizations/${orgId}/approvals`));
const view = inbox.approvals.find((a) => a.id === requestId);
check('승인자에게 보인다', Boolean(view), true);
check('요청자 표시', view.requester.displayName, '요청자 코덱스');
check('Resource 표시', view.resourceName, '운영 DB');
check('Action 표시', view.action, 'db.update');
check('Reason 표시', view.reason.length > 0, true);
check('Risk 표시', view.risk.length > 0, true);
check('Rollback 표시', view.rollbackPlan.length > 0, true);
check('Verification 표시', view.verificationPlan.length > 0, true);
check('변경 내용 표시', view.proposedChange.includes(topic), true);
check('승인을 요구한 Policy 표시', view.policyIds.length > 0, true);
check('승인 정책 이름 표시', view.approvalPolicyName, 'DB Admin 승인');
check('승인자는 판단 가능', view.canDecide, true);

const requesterView = expectOk('요청자 시야', await admin.rest('GET', `/organizations/${orgId}/approvals/${requestId}`)).approval;
check('요청자는 판단 불가', requesterView.canDecide, false);

console.log('\n── 5. 승인 → 실행 ──');
const approved = expectOk('승인', await lead.rest('POST', `/organizations/${orgId}/approvals/${requestId}/approve`, {
  comment: '롤백 계획 확인했습니다',
})).approval;
check('APPROVED로 전이', approved.status, 'APPROVED');

const status = await rpc(admin.token, orgId, 'company.approval.status', {
  approvalRequestId: requestId,
});
check('에이전트가 상태 확인', status.data.status, 'APPROVED');

const executed = await rpc(admin.token, orgId, 'company.approval.execute', {
  approvalRequestId: requestId,
});
check('실행 성공', executed.data.status, 'EXECUTED');

const afterRows = await rpc(admin.token, orgId, 'company.db.query', {
  resourceId: dbId,
  query: `select count(*)::int as c from events_summary where topic = '${topic}'`,
  purpose: '승인 후 확인',
});
check('실제로 반영됨', afterRows.data.rows[0].c, 1);

console.log('\n── 6. 재실행 방지 ──');
const again = await rpc(admin.token, orgId, 'company.approval.execute', {
  approvalRequestId: requestId,
});
check('EXECUTED는 다시 실행 불가', again.isError, true);
const afterAgain = await rpc(admin.token, orgId, 'company.db.query', {
  resourceId: dbId,
  query: `select count(*)::int as c from events_summary where topic = '${topic}'`,
  purpose: '중복 실행 확인',
});
check('중복 반영되지 않음', afterAgain.data.rows[0].c, 1);

console.log('\n── 7. §65 PENDING → REJECTED → EXECUTED 불가 ──');
const toReject = await rpc(admin.token, orgId, 'company.db.update', {
  resourceId: dbId,
  query: `delete from events_summary where topic = '${topic}'`,
  purpose: '거부될 요청',
  reason: '거부 경로 확인',
});
const rejectId = toReject.data.approvalRequestId;
const rejected = expectOk('거부', await lead.rest('POST', `/organizations/${orgId}/approvals/${rejectId}/reject`, {
  comment: '지금은 안 됩니다',
})).approval;
check('REJECTED로 전이', rejected.status, 'REJECTED');

const rejectedExec = await rpc(admin.token, orgId, 'company.approval.execute', {
  approvalRequestId: rejectId,
});
check('거부된 요청은 실행 불가', rejectedExec.isError, true);
const stillThere = await rpc(admin.token, orgId, 'company.db.query', {
  resourceId: dbId,
  query: `select count(*)::int as c from events_summary where topic = '${topic}'`,
  purpose: '거부 후 확인',
});
check('데이터가 그대로', stillThere.data.rows[0].c, 1);

check(
  '거부 후 승인 시도 거부',
  (await lead.rest('POST', `/organizations/${orgId}/approvals/${rejectId}/approve`, {})).status,
  409,
);

console.log('\n── 8. payload 바꿔치기 방지 (§34) ──');
const swapTarget = await rpc(admin.token, orgId, 'company.db.update', {
  resourceId: dbId,
  query: `insert into events_summary (topic, count, day) values ('${safeTopic}', 1, '2026-08-25')`,
  purpose: '바꿔치기 확인',
  reason: '승인자가 본 것과 실행되는 것이 같아야 합니다',
});
const swapId = swapTarget.data.approvalRequestId;
await lead.rest('POST', `/organizations/${orgId}/approvals/${swapId}/approve`, {});
// execute는 approvalRequestId만 받는다. 다른 쿼리를 끼워 넣을 자리가 없다.
await rpc(admin.token, orgId, 'company.approval.execute', { approvalRequestId: swapId });
const safeRows = await rpc(admin.token, orgId, 'company.db.query', {
  resourceId: dbId,
  query: `select topic from events_summary where topic in ('${safeTopic}', '${safeTopic}-evil')`,
  purpose: '바꿔치기 결과 확인',
});
check('승인받은 내용만 실행됨', safeRows.data.rows.length, 1);
check('승인받은 그 행이다', safeRows.data.rows[0].topic, safeTopic);

console.log('\n── 9. 파일 쓰기 승인 ──');
const fileReq = await rpc(admin.token, orgId, 'company.files.write', {
  resourceId: fsId,
  path: `approved-${stamp}.md`,
  content: '# 승인을 거쳐 작성된 문서\n',
  purpose: '문서 생성',
  reason: '장애 보고서를 남깁니다',
});
check('파일 쓰기도 승인 필요', fileReq.data.executed, false);
await lead.rest('POST', `/organizations/${orgId}/approvals/${fileReq.data.approvalRequestId}/approve`, {});
const fileExec = await rpc(admin.token, orgId, 'company.approval.execute', {
  approvalRequestId: fileReq.data.approvalRequestId,
});
check('파일이 실제로 쓰임', fileExec.data.status, 'EXECUTED');
const readBack = await rpc(admin.token, orgId, 'company.files.read', {
  resourceId: fsId,
  path: `approved-${stamp}.md`,
  purpose: '쓰기 확인',
});
check('내용 확인', readBack.data.content.includes('승인을 거쳐'), true);

console.log('\n── 10. 정책이 ALLOW면 승인 없이 실행 ──');
// 같은 스코프에서는 심각도가 항상 이긴다(DENY > APPROVAL_REQUIRED > ALLOW).
// 구체적인 ALLOW가 일반 APPROVAL_REQUIRED를 조용히 이기면 거버넌스가 무너지므로,
// 예외는 **넓은 정책을 좁혀서** 표현한다.
check(
  '넓은 정책을 좁힌다',
  (await admin.rest('PATCH', `/organizations/${orgId}/policies/${writePolicy.id}`, {
    classification: 'RESTRICTED',
  })).status,
  200,
);
expectOk('허용 정책', await admin.rest('POST', `/organizations/${orgId}/policies`, {
  name: '문서 쓰기는 자유',
  effect: 'ALLOW',
  scopeType: 'COMPANY',
  resourceId: fsId,
  actions: ['files.write'],
}));
const direct = await rpc(admin.token, orgId, 'company.files.write', {
  resourceId: fsId,
  path: `direct-${stamp}.md`,
  content: '승인 없이 작성\n',
  purpose: '직접 쓰기',
  reason: '승인이 필요 없는 경로',
});
check('INTERNAL 자원은 승인 없이 실행', direct.data.executed, true);

// 좁힌 뒤에도 RESTRICTED 자원은 여전히 승인을 거친다.
const stillGated = await rpc(admin.token, orgId, 'company.db.update', {
  resourceId: dbId,
  query: `delete from events_summary where topic = '${safeTopic}'`,
  purpose: '좁힌 뒤에도 유효한지',
  reason: 'RESTRICTED는 여전히 승인 대상',
});
check('RESTRICTED 자원은 여전히 승인 필요', stillGated.data.executed, false);

console.log('\n── 11. 감사 기록 ──');
const postgresModule = await import('postgres');
const sql = postgresModule.default(
  process.env.DATABASE_URL ?? 'postgresql://harness:harness@localhost:5432/harnessvault',
);
try {
  const rows = await sql`
    select event_type from audit_events where organization_id = ${orgId}
  `;
  const kinds = new Set(rows.map((r) => r.event_type));
  for (const expected of [
    'approval.requested',
    'approval.decided',
    'approval.executed',
    'resource.accessed',
    'policy.evaluated',
  ]) {
    check(`${expected} 기록됨`, kinds.has(expected), true);
  }

  const payloadLeak = await sql`
    select count(*)::int as c from audit_events
    where organization_id = ${orgId} and metadata::text like ${'%' + topic + '%'}
  `;
  // payload 원문은 요청 테이블에만 둔다(§39).
  check('감사에 payload 원문 미저장', payloadLeak[0].c, 0);
} finally {
  await sql.end();
}

void requesterId;
void outsiderId;

console.log(`\n결과: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
