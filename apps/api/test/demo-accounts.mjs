// 화면에서 직접 확인할 수 있는 시연 계정을 만든다.
//
// 시나리오 스크립트(scenario-approval-routing.mjs)는 승인까지 끝내 버려 화면에 남는 것이 없다.
// 여기서는 **승인 대기 상태로 남겨 두고** 로그인 정보를 출력한다.
// 박팀장과 이보안으로 각각 로그인하면 서로 다른 요청이 보인다.
//
// 실행: npm run demo:setup
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = 'http://localhost:3000';
const WEB = process.env.WEB_URL ?? 'http://localhost:3100';
const MCP = `${BASE}/mcp`;
const ROOT = process.env.HARNESS_TEST_ROOT ?? 'C:/Users/invako/AppData/Local/Temp/harness-resources';

// 시연용 고정 비밀번호. 개발 환경은 4자 이상이면 된다.
const PASSWORD = process.env.DEMO_PASSWORD ?? 'demo1234'; // secret-scan:allow

function expectOk(label, res) {
  if (res.status >= 400) throw new Error(`${label} 실패: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

function person(displayName, handle) {
  return {
    displayName,
    email: `${handle}@demo.local`,
    password: PASSWORD,
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
  if (body.error) throw new Error(JSON.stringify(body.error));
  if (body.result?.isError) throw new Error(body.result.content?.[0]?.text ?? 'tool error');
  return JSON.parse(body.result.content[0].text);
}

async function register(actor) {
  const created = await actor.rest('POST', '/auth/register', {
    email: actor.email,
    password: actor.password,
    displayName: actor.displayName,
  });
  // 이미 있으면 그대로 로그인한다. 여러 번 돌려도 깨지지 않게.
  if (created.status >= 400 && created.status !== 409) {
    throw new Error(`가입 실패: ${JSON.stringify(created.body)}`);
  }
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: actor.email, password: actor.password }),
  });
  if (!res.ok) throw new Error(`로그인 실패(${res.status}). 계정이 이미 다른 비밀번호로 있을 수 있습니다`);
  const raw = (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('harness_session='));
  actor.cookie = raw?.split(';')[0] ?? '';
  actor.token = raw?.split('=')[1]?.split(';')[0] ?? '';
  actor.id = (await actor.rest('GET', '/auth/me')).body.user.id;
  return actor;
}

const stamp = Date.now();

const admin = await register(person('시스템 관리자', `demo-admin-${stamp}`));
const member = await register(person('김팀원', `demo-member-${stamp}`));
const lead = await register(person('박팀장', `demo-lead-${stamp}`));
const security = await register(person('이보안', `demo-security-${stamp}`));

const orgId = expectOk(
  '조직',
  await admin.rest('POST', '/organizations', { name: '데모 회사', slug: `demo-${stamp}` }),
).organization.id;
for (const who of [member, lead, security]) {
  expectOk(
    '멤버',
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
await admin.rest('POST', `/organizations/${orgId}/projects/${projectId}/members`, {
  userId: member.id,
  role: 'PROJECT_MEMBER',
});
await admin.rest('POST', `/organizations/${orgId}/projects/${projectId}/members`, {
  userId: lead.id,
  role: 'PROJECT_LEAD',
});

const securityGroupId = expectOk(
  '보안팀',
  await admin.rest('POST', `/organizations/${orgId}/groups`, { name: '보안팀', slug: 'security' }),
).group.id;
await admin.rest('POST', `/organizations/${orgId}/groups/${securityGroupId}/members`, {
  userId: security.id,
});

/* ---- 자원 ---- */
mkdirSync(`${ROOT}/docs`, { recursive: true });
const runbook = `demo-runbook-${stamp}.md`;
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

/* ---- 정책 ---- */
await admin.rest('POST', `/organizations/${orgId}/policies`, {
  name: '조회 허용',
  effect: 'ALLOW',
  scopeType: 'COMPANY',
  actions: ['files.read', 'files.search', 'db.schema', 'db.query'],
});
await admin.rest('POST', `/organizations/${orgId}/policies`, {
  name: 'INTERNAL 변경은 승인 필요',
  effect: 'APPROVAL_REQUIRED',
  scopeType: 'COMPANY',
  classification: 'INTERNAL',
  actions: ['files.write'],
});
await admin.rest('POST', `/organizations/${orgId}/policies`, {
  name: 'RESTRICTED 변경은 승인 필요',
  effect: 'APPROVAL_REQUIRED',
  scopeType: 'COMPANY',
  classification: 'RESTRICTED',
  actions: ['db.update'],
});
await admin.rest('POST', `/organizations/${orgId}/approval-policies`, {
  name: 'INTERNAL은 프로젝트 리드가',
  mode: 'ANY_OF',
  classification: 'INTERNAL',
  approvers: [{ kind: 'PROJECT_ROLE', projectRole: 'PROJECT_LEAD' }],
  expiresInMinutes: 1440,
});
await admin.rest('POST', `/organizations/${orgId}/approval-policies`, {
  name: 'RESTRICTED는 보안팀이',
  mode: 'ANY_OF',
  classification: 'RESTRICTED',
  approvers: [{ kind: 'GROUP', refId: securityGroupId }],
  expiresInMinutes: 1440,
});

/* ---- 김팀원의 AI가 두 건을 요청하고 대기 상태로 남긴다 ---- */
const resolved = await ai(member, orgId, 'company.resolve_task', {
  projectId,
  task: { description: '고객 이탈 원인 분석', domain: ['database'], type: ['analyze'] },
  client: { name: 'claude-code', version: '2.0', model: 'claude-opus-5' },
});
const traceId = resolved.traceId;

const internalReq = await ai(member, orgId, 'company.files.write', {
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

const restrictedReq = await ai(member, orgId, 'company.db.update', {
  resourceId: restrictedDb,
  query: `insert into events_summary (topic, count, day) values ('demo/${stamp}', 3, '2026-08-26')`,
  purpose: '분석 결과 저장',
  projectId,
  reason: '이탈 분석 결과를 요약 테이블에 남깁니다',
  risk: '행 1건 추가',
  rollbackPlan: `delete from events_summary where topic = 'demo/${stamp}'`,
  verificationPlan: '같은 topic으로 조회해 1건 확인',
  traceId,
});

const line = '─'.repeat(70);
console.log(`
${line}
시연 준비 완료 — 비밀번호는 모두  ${PASSWORD}
${line}

  ${WEB}/login 에서 로그인하고 승인함을 보세요.

  박팀장   ${lead.email}
           → INTERNAL 요청 1건이 보입니다 (팀 운영 문서 · files.write)
           → RESTRICTED 요청은 보이지 않습니다

  이보안   ${security.email}
           → RESTRICTED 요청 1건이 보입니다 (고객 데이터베이스 · db.update)
           → INTERNAL 요청은 보이지 않습니다

  김팀원   ${member.email}
           → 본인이 요청자라 어느 것도 승인할 수 없습니다

  관리자   ${admin.email}
           → /traces 에서 흐름 전체를, /admin/policies 에서 정책을 봅니다

${line}
  같은 사람이 같은 프로젝트에서 낸 두 요청인데
  **자원 등급에 따라 승인자가 갈립니다.**

  대기 중인 요청
    INTERNAL    ${internalReq.approvalRequestId}
    RESTRICTED  ${restrictedReq.approvalRequestId}
  흐름  ${WEB}/traces/${traceId}
${line}
`);
