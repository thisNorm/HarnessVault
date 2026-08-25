// Phase 10 완료 조건 검증: 외부 AI가 업무 종료 시 현재 적용되는 산출물 계약을 조회할 수 있다.
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
const account = { email: `oc-${stamp}@example.com`, password: secret, displayName: '계약 사용자' };

await rest('POST', '/auth/register', account);
const loginRes = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: account.email, password: account.password }),
});
const raw = (loginRes.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('harness_session='));
cookie = raw?.split(';')[0] ?? '';
const token = raw?.split('=')[1]?.split(';')[0] ?? '';

const orgId = expectOk('조직', await rest('POST', '/organizations', {
  name: 'Contract Org',
  slug: `oc-${stamp}`,
})).organization.id;
const userId = (await rest('GET', '/auth/me')).body.user.id;

const teamId = expectOk('팀', await rest('POST', `/organizations/${orgId}/teams`, {
  name: 'Backend Team',
  slug: 'backend',
})).team.id;
await rest('POST', `/organizations/${orgId}/teams/${teamId}/members`, { userId });

const otherTeamId = expectOk('타 팀', await rest('POST', `/organizations/${orgId}/teams`, {
  name: 'Frontend Team',
  slug: 'frontend',
})).team.id;

const projectId = expectOk('프로젝트', await rest('POST', `/organizations/${orgId}/projects`, {
  name: 'Edge Server',
  slug: 'edge-server',
  teamId,
})).project.id;
await rest('POST', `/organizations/${orgId}/projects/${projectId}/members`, {
  userId,
  role: 'PROJECT_OWNER',
});

console.log('\n── 계약이 없으면 빈 목록 ──');
const empty = expectOk('빈 해석', await rest('POST', `/organizations/${orgId}/output-contracts/resolve`, {}));
check('requiredFields는 빈 배열', empty.outputContract.requiredFields.length, 0);
// null이 아니라 빈 배열이다. "모른다"와 "요구 없음"은 다르다.
check('null이 아니다', empty.outputContract.requiredFields === null, false);

console.log('\n── 계약 등록 ──');
expectOk('회사 계약', await rest('POST', `/organizations/${orgId}/output-contracts`, {
  name: '회사 기본',
  scopeType: 'COMPANY',
  fields: ['summary', 'verification', 'unresolved'],
}));
expectOk('팀 계약', await rest('POST', `/organizations/${orgId}/output-contracts`, {
  name: '백엔드 팀 확장',
  scopeType: 'TEAM',
  scopeId: teamId,
  fields: ['changedFiles', 'testResults'],
}));
expectOk('프로젝트 계약', await rest('POST', `/organizations/${orgId}/output-contracts`, {
  name: 'Edge Server 확장',
  scopeType: 'PROJECT',
  scopeId: projectId,
  fields: ['mqttVerification', 'dbIngestionCheck'],
}));
// 내가 속하지 않은 팀의 계약. 섞이면 안 된다.
expectOk('타 팀 계약', await rest('POST', `/organizations/${orgId}/output-contracts`, {
  name: '프론트엔드 팀 확장',
  scopeType: 'TEAM',
  scopeId: otherTeamId,
  fields: ['screenshotDiff'],
}));

check(
  '항목 이름 형식 강제',
  (await rest('POST', `/organizations/${orgId}/output-contracts`, {
    name: '잘못된 형식',
    scopeType: 'COMPANY',
    fields: ['Changed_Files'],
  })).status,
  400,
);

console.log('\n── 병합 (§35) ──');
const resolved = expectOk('해석', await rest('POST', `/organizations/${orgId}/output-contracts/resolve`, {
  projectId,
})).outputContract;
console.log(`  ${resolved.requiredFields.join(', ')}`);
check('7개 항목', resolved.requiredFields.length, 7);
check('회사 항목 포함', resolved.requiredFields.includes('summary'), true);
check('팀 항목 포함', resolved.requiredFields.includes('changedFiles'), true);
check('프로젝트 항목 포함', resolved.requiredFields.includes('dbIngestionCheck'), true);
check('타 팀 항목은 섞이지 않음', resolved.requiredFields.includes('screenshotDiff'), false);
check('회사 항목이 앞에 온다', resolved.requiredFields[0], 'summary');

console.log('\n── sourceMap (§36) ──');
check('회사 항목 출처', resolved.sourceMap.summary.scope, 'COMPANY');
check('팀 항목 출처', resolved.sourceMap.changedFiles.scope, 'TEAM');
check('출처 이름도 남는다', resolved.sourceMap.changedFiles.sourceName, '백엔드 팀 확장');
check('기여 계약 목록', resolved.contributingContracts.length, 3);

console.log('\n── 프로젝트 없이 해석 ──');
const noProject = expectOk('프로젝트 없음', await rest('POST', `/organizations/${orgId}/output-contracts/resolve`, {})).outputContract;
check('프로젝트 항목 제외', noProject.requiredFields.includes('dbIngestionCheck'), false);
check('회사·팀 항목은 유지', noProject.requiredFields.length, 5);

console.log('\n── MCP 조회 ──');
const viaMcp = await rpc(token, orgId, 'company.output_contract', { projectId });
check('MCP로 조회 가능', viaMcp.data.requiredFields.length, 7);
check(
  'REST와 같은 결과',
  JSON.stringify(viaMcp.data.requiredFields),
  JSON.stringify(resolved.requiredFields),
);

console.log('\n── manifest에 실린다 ──');
const manifestRes = await rpc(token, orgId, 'company.resolve_task', {
  projectId,
  task: { description: 'DB 장애 분석', domain: ['database'], type: ['troubleshoot'] },
});
const traceId = manifestRes.data.traceId;
check('manifest에 계약 포함', manifestRes.data.manifest.outputContract.requiredFields.length, 7);
// 작업 시작 시점에 무엇을 남겨야 하는지 알아야 그에 맞춰 일한다.
check('계약이 null이 아니다', manifestRes.data.manifest.outputContract === null, false);

console.log('\n── 종료 시 대조 — 빠진 항목 기록 ──');
const partial = await rpc(token, orgId, 'company.task.complete', {
  traceId,
  status: 'COMPLETED',
  output: { summary: '분석 완료', verification: '검증함' },
});
// 흐름은 닫되 빠진 사실을 남긴다. 거부하면 값을 지어내게 된다.
check('흐름은 닫힌다', partial.data.status, 'COMPLETED');
check('미충족으로 기록', partial.data.outputContractSatisfied, false);
check('빠진 항목 수', partial.data.missingOutputFields.length, 5);
check('빠진 항목 이름', partial.data.missingOutputFields.includes('changedFiles'), true);

console.log('\n── 모두 채우면 satisfied ──');
const second = await rpc(token, orgId, 'company.resolve_task', {
  projectId,
  task: { description: '두 번째 작업', domain: ['database'], type: ['troubleshoot'] },
});
const full = await rpc(token, orgId, 'company.task.complete', {
  traceId: second.data.traceId,
  status: 'COMPLETED',
  output: {
    summary: '요약',
    verification: '검증',
    unresolved: '없음',
    changedFiles: ['a.ts'],
    testResults: '전부 통과',
    mqttVerification: '확인',
    dbIngestionCheck: '확인',
  },
});
check('충족으로 기록', full.data.outputContractSatisfied, true);
check('빠진 항목 없음', full.data.missingOutputFields.length, 0);

console.log('\n── 빈 값은 채운 것으로 보지 않는다 ──');
const third = await rpc(token, orgId, 'company.resolve_task', {
  projectId,
  task: { description: '세 번째 작업', domain: ['database'], type: ['troubleshoot'] },
});
const blanks = await rpc(token, orgId, 'company.task.complete', {
  traceId: third.data.traceId,
  status: 'COMPLETED',
  output: {
    summary: '   ',
    verification: '검증',
    unresolved: '없음',
    changedFiles: [],
    testResults: '통과',
    mqttVerification: '확인',
    dbIngestionCheck: '확인',
  },
});
check('공백 문자열은 미충족', blanks.data.missingOutputFields.includes('summary'), true);
check('빈 배열도 미충족', blanks.data.missingOutputFields.includes('changedFiles'), true);

console.log('\n── 컴파일 결과에 실린다 ──');
const compiled = expectOk('컴파일', await rest('POST', `/organizations/${orgId}/compile`, {
  projectId,
  target: 'CODEX',
  task: { description: 'DB 장애 분석', domain: ['database'], type: ['troubleshoot'] },
}));
const agents = compiled.compiled.files.find((f) => f.path === 'AGENTS.md');
check('진입 파일에 산출물 계약', agents.content.includes('산출물 계약'), true);
check('항목이 적힌다', agents.content.includes('changedFiles'), true);
check('요구한 곳이 적힌다', agents.content.includes('백엔드 팀 확장'), true);

console.log('\n── 산출물 원문은 감사에 없다 (§39) ──');
const postgresModule = await import('postgres');
const sql = postgresModule.default(
  process.env.DATABASE_URL ?? 'postgresql://harness:harness@localhost:5432/harnessvault',
);
try {
  const leak = await sql`
    select count(*)::int as c from audit_events
    where organization_id = ${orgId} and metadata::text like '%전부 통과%'
  `;
  check('산출물 값 미저장', leak[0].c, 0);
  const names = await sql`
    select count(*)::int as c from audit_events
    where organization_id = ${orgId} and metadata::text like '%missingOutputFields%'
  `;
  check('빠진 항목 이름은 기록', names[0].c > 0, true);
} finally {
  await sql.end();
}

console.log(`\n결과: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
