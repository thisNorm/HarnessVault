// Phase 9 완료 조건 검증: 하나의 업무 흐름을 시간순으로 재구성할 수 있다.
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
const agent = { email: `tr-agent-${stamp}@example.com`, password: secret, displayName: 'Codex 에이전트' };
const lead = { email: `tr-lead-${stamp}@example.com`, password: secret, displayName: '승인자 리드' };

const a = makeClient();
const l = makeClient();
for (const account of [agent, lead]) await a.rest('POST', '/auth/register', account);
await a.login(agent);

const orgId = expectOk('조직', await a.rest('POST', '/organizations', {
  name: 'Trace Org',
  slug: `tr-${stamp}`,
})).organization.id;
await a.rest('POST', `/organizations/${orgId}/members`, { email: lead.email });
await l.login(lead);
const leadId = (await l.rest('GET', '/auth/me')).body.user.id;
await a.login(agent);

const teamId = expectOk('팀', await a.rest('POST', `/organizations/${orgId}/teams`, {
  name: 'Ops',
  slug: 'ops',
})).team.id;
const groupId = expectOk('그룹', await a.rest('POST', `/organizations/${orgId}/groups`, {
  name: 'DB Admin',
  slug: 'db-admin',
})).group.id;
await a.rest('POST', `/organizations/${orgId}/groups/${groupId}/members`, { userId: leadId });

const fsId = expectOk('FS', await a.rest('POST', `/organizations/${orgId}/resources`, {
  type: 'FILE_SYSTEM',
  name: '운영 문서',
  ownerType: 'TEAM',
  ownerId: teamId,
  adapterType: 'filesystem',
  config: { root: `${ROOT}/docs` },
})).resource.id;
const dbId = expectOk('DB', await a.rest('POST', `/organizations/${orgId}/resources`, {
  type: 'DATABASE',
  name: '운영 DB',
  classification: 'RESTRICTED',
  ownerType: 'TEAM',
  ownerId: teamId,
  adapterType: 'postgres',
  credentialRef: 'HARNESS_RESOURCE_DEMO_DB',
})).resource.id;

expectOk('쓰기 정책', await a.rest('POST', `/organizations/${orgId}/policies`, {
  name: '쓰기는 승인 필요',
  effect: 'APPROVAL_REQUIRED',
  scopeType: 'COMPANY',
  actions: ['db.update'],
}));
expectOk('승인 정책', await a.rest('POST', `/organizations/${orgId}/approval-policies`, {
  name: 'DB Admin 승인',
  mode: 'ANY_OF',
  approvers: [{ kind: 'GROUP', refId: groupId }],
}));

// 자산이 하나는 있어야 resolve 통계가 의미를 갖는다.
const assetRes = expectOk('자산', await a.rest('POST', `/organizations/${orgId}/assets`, {
  type: 'SKILL',
  key: 'db.troubleshoot.core',
  name: 'DB 진단',
  scopeType: 'COMPANY',
  ownerType: 'TEAM',
  ownerId: teamId,
  selector: { domains: ['database'] },
}));
const assetId = assetRes.asset.id;
const version = expectOk('버전', await a.rest('POST', `/organizations/${orgId}/assets/${assetId}/versions`, {
  version: '1.0',
  summary: 'DB 진단 절차',
  structuredContent: { instructions: ['연결 확인'] },
  status: 'CANDIDATE',
})).version;
await a.rest('POST', `/organizations/${orgId}/assets/${assetId}/versions/${version.id}/promote`);
await a.rest('PATCH', `/organizations/${orgId}/assets/${assetId}`, { status: 'ACTIVE' });

console.log('\n── 1. resolve가 흐름을 시작한다 ──');
const resolved = await rpc(a.token, orgId, 'company.resolve_task', {
  task: { description: 'DB 장애 분석', domain: ['database'], type: ['troubleshoot'] },
  environment: { database: 'sqlite' },
  client: { name: 'Codex CLI', version: '0.20.1', model: 'gpt-5' },
});
const traceId = resolved.data.traceId;
check('traceId 발급', typeof traceId, 'string');

const list1 = expectOk('흐름 목록', await a.rest('GET', `/organizations/${orgId}/traces`));
const trace = list1.traces.find((t) => t.id === traceId);
check('흐름이 생성됨', Boolean(trace), true);
check('OPEN 상태', trace.status, 'OPEN');
check('작업 설명 기록', trace.purpose, 'DB 장애 분석');
check('클라이언트 기록', trace.clientName, 'Codex CLI');
check('모델 기록', trace.modelName, 'gpt-5');
// 검증된 값처럼 보여주면 감사가 거짓말을 한다(§59).
check('모델 출처가 자가 보고로 표시', trace.modelSource, 'CLIENT_REPORTED');
check('후보 수 기록', typeof trace.candidateAssetCount, 'number');
check('선택 수 기록', typeof trace.selectedAssetCount, 'number');
check('주입 추정 기록', typeof trace.estimatedInjectedTokens, 'number');
// 아직 보고받지 않았다. 0이 아니라 null이어야 한다(§40).
check('클라이언트 토큰은 아직 null', trace.clientReportedInputTokens, null);

console.log('\n── 2. traceId를 이으면 같은 흐름에 묶인다 ──');
await rpc(a.token, orgId, 'company.files.read', {
  resourceId: fsId,
  path: 'README.md',
  purpose: '운영 문서 확인',
  traceId,
});
await rpc(a.token, orgId, 'company.db.query', {
  resourceId: dbId,
  query: "select count(*)::int as c from events_summary where topic like 'sensor/%'",
  purpose: '수집량 확인',
  traceId,
});

const write = await rpc(a.token, orgId, 'company.db.update', {
  resourceId: dbId,
  query: `insert into events_summary (topic, count, day) values ('trace/${stamp}', 3, '2026-08-25')`,
  purpose: '분석 결과 저장',
  reason: '흐름 재구성 확인용',
  traceId,
});
check('쓰기는 승인 대기', write.data.executed, false);
const requestId = write.data.approvalRequestId;

await l.rest('POST', `/organizations/${orgId}/approvals/${requestId}/approve`, {});
const exec = await rpc(a.token, orgId, 'company.approval.execute', {
  approvalRequestId: requestId,
});
check('승인 후 실행', exec.data.status, 'EXECUTED');

console.log('\n── 3. traceId 없이 호출하면 흐름에 섞이지 않는다 ──');
await rpc(a.token, orgId, 'company.files.read', {
  resourceId: fsId,
  path: 'README.md',
  purpose: '흐름 없이 조회',
});

console.log('\n── 4. 남의 traceId는 붙지 않는다 ──');
const stranger = makeClient();
const strangerAccount = {
  email: `tr-x-${stamp}@example.com`,
  password: secret,
  displayName: '다른 사용자',
};
await a.rest('POST', '/auth/register', strangerAccount);
await a.rest('POST', `/organizations/${orgId}/members`, { email: strangerAccount.email });
await stranger.login(strangerAccount);
await rpc(stranger.token, orgId, 'company.files.read', {
  resourceId: fsId,
  path: 'README.md',
  purpose: '남의 흐름에 붙이기 시도',
  traceId,
});

console.log('\n── 5. 타임라인 재구성 ──');
const detail = expectOk('상세', await a.rest('GET', `/organizations/${orgId}/traces/${traceId}`)).trace;
const kinds = detail.events.map((e) => e.eventType);
console.log(`  ${kinds.join(' → ')}`);

for (const expected of [
  'harness.resolved',
  'resource.accessed',
  'policy.evaluated',
  'approval.requested',
  'approval.decided',
  'approval.executed',
]) {
  check(`${expected} 포함`, kinds.includes(expected), true);
}

const times = detail.events.map((e) => new Date(e.createdAt).getTime());
check(
  '시간순 정렬',
  JSON.stringify(times),
  JSON.stringify([...times].sort((x, y) => x - y)),
);
check('승인자 이름이 남는다', detail.events.some((e) => e.actorDisplayName === '승인자 리드'), true);

const untrackedRead = detail.events.filter(
  (e) => e.eventType === 'resource.accessed' && e.metadata?.purpose === '흐름 없이 조회',
);
check('traceId 없는 호출은 이 흐름에 없다', untrackedRead.length, 0);

const strangerRead = detail.events.filter(
  (e) => e.metadata?.purpose === '남의 흐름에 붙이기 시도',
);
check('남의 traceId도 이 흐름에 없다', strangerRead.length, 0);

const list2 = expectOk('목록', await a.rest('GET', `/organizations/${orgId}/traces`));
check(
  '흐름 없는 이벤트를 따로 보여준다',
  list2.untracked.some((e) => e.eventType === 'resource.accessed'),
  true,
);

console.log('\n── 6. 흐름 종료 ──');
const completed = await rpc(a.token, orgId, 'company.task.complete', {
  traceId,
  status: 'COMPLETED',
  summary: 'DB 장애 원인은 커넥션 풀 포화였습니다',
  clientReportedInputTokens: 15234,
  clientReportedOutputTokens: 892,
});
check('COMPLETED로 전이', completed.data.status, 'COMPLETED');
check('클라이언트 보고 토큰 기록', completed.data.clientReportedInputTokens, 15234);
check('종료 시각 기록', typeof completed.data.completedAt, 'string');

const reclose = await rpc(a.token, orgId, 'company.task.complete', {
  traceId,
  status: 'COMPLETED',
});
check('이미 닫힌 흐름은 다시 못 닫는다', reclose.isError, true);

console.log('\n── 7. 토큰을 보고하지 않으면 null ──');
const second = await rpc(a.token, orgId, 'company.resolve_task', {
  task: { description: '두 번째 작업', domain: ['database'], type: ['troubleshoot'] },
});
const closedWithout = await rpc(a.token, orgId, 'company.task.complete', {
  traceId: second.data.traceId,
  status: 'COMPLETED',
});
// 0으로 채우면 "안 썼다"는 거짓 진술이 된다(§40).
check('보고 없으면 null', closedWithout.data.clientReportedInputTokens, null);
check('0으로 채우지 않는다', closedWithout.data.clientReportedOutputTokens, null);

console.log('\n── 8. 원문 미저장 (§39) ──');
const postgresModule = await import('postgres');
const sql = postgresModule.default(
  process.env.DATABASE_URL ?? 'postgresql://harness:harness@localhost:5432/harnessvault',
);
try {
  const leak = await sql`
    select count(*)::int as c from audit_events
    where trace_id = ${traceId} and metadata::text like ${'%trace/' + stamp + '%'}
  `;
  check('쓰기 payload 원문 미저장', leak[0].c, 0);

  const fileLeak = await sql`
    select count(*)::int as c from audit_events
    where trace_id = ${traceId} and metadata::text like '%커넥션 풀 포화를 먼저%'
  `;
  check('파일 내용 미저장', fileLeak[0].c, 0);
} finally {
  await sql.end();
}

console.log(`\n결과: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
