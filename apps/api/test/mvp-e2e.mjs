// §67 완료 기준 — 전체 흐름을 한 번에 통과시킨다.
//
//   사용자 A 가입 → 조직/팀/프로젝트 → MCP 연결 → "DB 장애 분석해줘"
//   → resolve_task → 파일·DB 조회 → 프로덕션 쓰기에서 APPROVAL_REQUIRED
//   → Project Lead가 승인 → 실행 → Output Contract → Contribution
//   → Candidate → Curator 검토 → 승격 → 사용자 B가 다른 AI로 새 버전 resolve
//
// 이 중 하나라도 Mock 성공으로 대체되어 있으면 MVP 완료로 보지 않는다(§72).
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

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

function expectOk(label, res) {
  if (res.status >= 400) throw new Error(`${label} 실패: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

/** 사람 한 명 = 쿠키 하나 + Bearer 토큰 하나. 서로 섞이지 않게 묶어 둔다. */
function person(displayName) {
  const suffix = randomBytes(6).toString('hex');
  return {
    displayName,
    email: `mvp-${suffix}@example.com`,
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
/** 외부 AI가 MCP로 붙는 경로. REST가 아니라 이쪽으로 도는지가 핵심이다. */
async function rpc(actor, orgId, name, args) {
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
      params: { name, arguments: args },
    }),
  });
  const body = await res.json();
  if (body.error) return { isError: true, text: JSON.stringify(body.error) };
  if (body.result?.isError) return { isError: true, text: body.result.content?.[0]?.text ?? '' };
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

/* ═══════════ 1. 사용자 A 가입 → 조직·팀·프로젝트 ═══════════ */
console.log('\n═══ 1. 가입과 조직 구성 ═══');

const alice = await register(person('사용자 A'));
const lead = await register(person('프로젝트 리드'));
const bob = await register(person('사용자 B'));
check('사용자 A 가입', typeof alice.id, 'string');

const orgId = expectOk(
  '조직',
  await alice.rest('POST', '/organizations', { name: 'MVP 회사', slug: `mvp-${stamp}` }),
).organization.id;
for (const member of [lead, bob]) {
  expectOk(
    '멤버 추가',
    await alice.rest('POST', `/organizations/${orgId}/members`, {
      email: member.email,
      role: 'ORG_MEMBER',
    }),
  );
}

const teamId = expectOk(
  '팀',
  await alice.rest('POST', `/organizations/${orgId}/teams`, { name: '플랫폼', slug: 'platform' }),
).team.id;
for (const member of [alice, lead, bob]) {
  await alice.rest('POST', `/organizations/${orgId}/teams/${teamId}/members`, {
    userId: member.id,
  });
}

const projectId = expectOk(
  '프로젝트',
  await alice.rest('POST', `/organizations/${orgId}/projects`, {
    name: 'Edge 서버',
    slug: 'edge',
    teamId,
  }),
).project.id;
for (const [member, role] of [
  [alice, 'PROJECT_MEMBER'],
  [lead, 'PROJECT_LEAD'],
  [bob, 'PROJECT_MEMBER'],
]) {
  await alice.rest('POST', `/organizations/${orgId}/projects/${projectId}/members`, {
    userId: member.id,
    role,
  });
}
check('조직·팀·프로젝트 구성', typeof projectId, 'string');

/* ═══════════ 2. 회사 Harness 자산 ═══════════ */
console.log('\n═══ 2. 회사 Harness 자산 ═══');

async function makeAsset(input) {
  const asset = expectOk(
    `자산 ${input.key}`,
    await alice.rest('POST', `/organizations/${orgId}/assets`, {
      ownerType: 'USER',
      ownerId: alice.id,
      ...input,
    }),
  ).asset.id;
  const versionId = expectOk(
    '버전',
    await alice.rest('POST', `/organizations/${orgId}/assets/${asset}/versions`, {
      version: '1.0.0',
      status: 'CANDIDATE',
      structuredContent: input.content,
      summary: input.summary,
    }),
  ).version.id;
  expectOk(
    '버전 활성화',
    await alice.rest('POST', `/organizations/${orgId}/assets/${asset}/versions/${versionId}/promote`),
  );
  expectOk(
    '자산 활성화',
    await alice.rest('PATCH', `/organizations/${orgId}/assets/${asset}`, { status: 'ACTIVE' }),
  );
  return asset;
}

await makeAsset({
  type: 'RULE',
  key: 'company.safety.rule',
  name: '운영 안전 규칙',
  description: '프로덕션 데이터는 승인 없이 바꾸지 않는다',
  scopeType: 'COMPANY',
  scopeId: orgId,
  inheritanceMode: 'LOCKED',
  summary: '프로덕션 변경은 승인 필수',
  content: { rules: ['프로덕션 쓰기는 반드시 승인을 거친다'] },
});
const skillId = await makeAsset({
  type: 'SKILL',
  key: 'db.incident.triage',
  name: 'DB 장애 분류',
  description: '데이터베이스 장애를 단계별로 좁혀 원인을 찾는다',
  scopeType: 'COMPANY',
  scopeId: orgId,
  selector: { domains: ['database'] },
  summary: 'DB 장애 분류 절차',
  content: { steps: ['증상 확인', '느린 쿼리 확인', '커넥션 풀 확인'] },
});
check('회사 자산 준비', typeof skillId, 'string');

expectOk(
  '산출물 계약',
  await alice.rest('POST', `/organizations/${orgId}/output-contracts`, {
    name: '회사 기본 계약',
    scopeType: 'COMPANY',
    fields: ['summary', 'verification', 'unresolved'],
  }),
);

/* ═══════════ 3. Resource와 정책 ═══════════ */
console.log('\n═══ 3. Resource와 정책 ═══');

mkdirSync(`${ROOT}/docs`, { recursive: true });
const runbook = `db-incident-${stamp}.md`;
writeFileSync(
  `${ROOT}/docs/${runbook}`,
  '# DB 장애 대응\n\n느린 쿼리는 pg_stat_statements로 확인한다.\n',
  'utf-8',
);

const fsId = expectOk(
  'FS Resource',
  await alice.rest('POST', `/organizations/${orgId}/resources`, {
    type: 'FILE_SYSTEM',
    name: '운영 문서',
    classification: 'INTERNAL',
    ownerType: 'TEAM',
    ownerId: teamId,
    adapterType: 'filesystem',
    config: { root: `${ROOT}/docs`, maxBytes: 100000 },
  }),
).resource.id;

const dbId = expectOk(
  'DB Resource',
  await alice.rest('POST', `/organizations/${orgId}/resources`, {
    type: 'DATABASE',
    name: '프로덕션 DB',
    classification: 'RESTRICTED',
    ownerType: 'TEAM',
    ownerId: teamId,
    adapterType: 'postgres',
    config: { maxRows: 50 },
    credentialRef: 'HARNESS_RESOURCE_DEMO_DB',
  }),
).resource.id;

// 조회는 허용하되 쓰기는 승인을 받게 한다.
expectOk(
  '조회 허용 정책',
  await alice.rest('POST', `/organizations/${orgId}/policies`, {
    name: 'RESTRICTED 조회 허용',
    effect: 'ALLOW',
    scopeType: 'COMPANY',
    classification: 'RESTRICTED',
    actions: ['db.schema', 'db.query'],
  }),
);
expectOk(
  '쓰기 승인 정책',
  await alice.rest('POST', `/organizations/${orgId}/policies`, {
    name: '프로덕션 쓰기 승인 필요',
    effect: 'APPROVAL_REQUIRED',
    scopeType: 'COMPANY',
    classification: 'RESTRICTED',
    actions: ['db.update'],
  }),
);
expectOk(
  '승인 정책',
  await alice.rest('POST', `/organizations/${orgId}/approval-policies`, {
    name: '프로젝트 리드 승인',
    mode: 'ANY_OF',
    approvers: [{ kind: 'PROJECT_ROLE', projectRole: 'PROJECT_LEAD' }],
    expiresInMinutes: 60,
  }),
);
check('Resource·정책 준비', typeof dbId, 'string');

/* ═══════════ 4. 외부 AI가 MCP로 붙어 작업 시작 ═══════════ */
console.log('\n═══ 4. company.resolve_task ═══');

const resolved = await rpc(alice, orgId, 'company.resolve_task', {
  projectId,
  task: {
    description: 'DB 장애 분석해줘',
    domain: ['database'],
    type: ['troubleshoot'],
  },
  environment: { os: 'windows', runtime: 'node' },
  client: { name: 'codex', version: '1.0.0', model: 'gpt-5' },
});
check('해석 성공', resolved.isError, false);
const traceId = resolved.data.traceId;
const manifest = resolved.data.manifest;
check('회사 규칙이 내려온다', manifest.rules.length > 0, true);
check('작업에 맞는 Skill이 내려온다', manifest.skills.some((s) => s.key === 'db.incident.triage'), true);
// 작업 시작 시점에 무엇을 남겨야 하는지 알아야 한다.
check('산출물 계약이 함께 온다', manifest.outputContract.requiredFields.length, 3);
check('흐름이 시작된다', typeof traceId, 'string');

/* ═══════════ 5. 회사 Resource 조회 ═══════════ */
console.log('\n═══ 5. 내부 Resource 접근 ═══');

const fileRead = await rpc(alice, orgId, 'company.files.read', {
  resourceId: fsId,
  path: runbook,
  purpose: 'DB 장애 대응 절차 확인',
  traceId,
});
check('파일 조회 성공', fileRead.isError, false);
check('실제 파일 내용이 온다', fileRead.data.content.includes('pg_stat_statements'), true);

const dbQuery = await rpc(alice, orgId, 'company.db.query', {
  resourceId: dbId,
  query: 'select count(*)::int as c from events_summary',
  purpose: '이벤트 적재량 확인',
  traceId,
});
check('DB 조회 성공', dbQuery.isError, false);
check('실제 DB에서 읽는다', typeof dbQuery.data.rows[0].c, 'number');

/* ═══════════ 6. 프로덕션 쓰기 → APPROVAL_REQUIRED ═══════════ */
console.log('\n═══ 6. 정책 판정과 승인 대기 ═══');

const topic = `mvp/${stamp}`;
const write = await rpc(alice, orgId, 'company.db.update', {
  resourceId: dbId,
  query: `insert into events_summary (topic, count, day) values ('${topic}', 42, '2026-08-26')`,
  projectId,
  purpose: 'DB 장애 분석 결과 저장',
  // 승인 화면(§55)에 그대로 표시된다. 사람이 판단하려면 이유·위험·되돌리는 법이 필요하다.
  reason: '장애 원인 분석 결과를 요약 테이블에 남깁니다',
  risk: '요약 테이블에 행 하나가 추가됩니다',
  rollbackPlan: `delete from events_summary where topic = '${topic}'`,
  verificationPlan: '같은 topic으로 조회해 1건인지 확인합니다',
  traceId,
});
// 오류가 아니라 "기다리는 중"이라는 구조화된 답이 온다. 에이전트가 무엇을 기다리는지 알아야 한다.
check('요청은 접수된다', write.isError, false);
check('실행되지 않았다', write.data.executed, false);
check('승인 대기로 만들어진다', write.data.status, 'PENDING');
const requestId = write.data.approvalRequestId;

const pending = expectOk(
  '승인 대기 목록',
  await lead.rest('GET', `/organizations/${orgId}/approvals`),
).approvals.filter((item) => item.status === 'PENDING');
check('리드에게 요청이 보인다', pending.length > 0, true);
const mine = pending.find((item) => item.id === requestId);
// PROJECT_LEAD 역할로 승인자가 풀린다.
check('리드가 승인자다', mine.canDecide, true);
// §55 — 사람이 판단하는 데 필요한 것이 다 있어야 한다.
check('무엇을 바꾸는지 보인다', mine.proposedChange.includes('events_summary'), true);
check('왜 필요한지 보인다', mine.reason.length > 0, true);
// 요청자 본인은 자기 요청을 승인할 수 없다.
const selfApprove = await alice.rest('POST', `/organizations/${orgId}/approvals/${requestId}/approve`, {
  comment: '내가 요청한 것을 내가 승인',
});
check('요청자 자기 승인 불가', selfApprove.status >= 400, true);

/* ═══════════ 7. 사람이 승인 → 실행 ═══════════ */
console.log('\n═══ 7. 승인과 실행 ═══');

expectOk(
  '리드 승인',
  await lead.rest('POST', `/organizations/${orgId}/approvals/${requestId}/approve`, {
    comment: '분석 결과 저장 승인합니다',
  }),
);

const executed = await rpc(alice, orgId, 'company.approval.execute', {
  approvalRequestId: requestId,
  traceId,
});
check('승인 후 실행된다', executed.isError, false);
// 서버에 저장된 payload로 실행한다. 에이전트가 다시 보낸 쿼리를 믿지 않는다(§34).
check('EXECUTED로 전이한다', executed.data.status, 'EXECUTED');

const verify = await rpc(alice, orgId, 'company.db.query', {
  resourceId: dbId,
  query: `select count(*)::int as c from events_summary where topic = '${topic}'`,
  purpose: '저장 확인',
  traceId,
});
// Mock 성공이 아니라 실제로 행이 들어갔는지 본다.
check('실제로 DB에 반영됐다', verify.data.rows[0].c, 1);

/* ═══════════ 8. 산출물 계약 ═══════════ */
console.log('\n═══ 8. 작업 종료와 산출물 계약 ═══');

const completed = await rpc(alice, orgId, 'company.task.complete', {
  traceId,
  status: 'COMPLETED',
  summary: '느린 쿼리로 인한 커넥션 고갈이 원인',
  clientReportedInputTokens: 12000,
  clientReportedOutputTokens: 2400,
  output: {
    summary: '느린 쿼리로 커넥션 풀이 고갈됐습니다',
    verification: 'pg_stat_statements로 확인 후 인덱스 추가',
    unresolved: '피크 시간대 재현은 아직 못 했습니다',
  },
});
check('흐름이 닫힌다', completed.data.status, 'COMPLETED');
check('산출물 계약 충족', completed.data.outputContractSatisfied, true);

/* ═══════════ 9. 감사 타임라인 ═══════════ */
console.log('\n═══ 9. 감사 타임라인 ═══');

const trace = expectOk(
  '흐름 상세',
  await alice.rest('GET', `/organizations/${orgId}/traces/${traceId}`),
).trace;
const types = trace.events.map((event) => event.eventType);
for (const expected of [
  'harness.resolved',
  'resource.accessed',
  'policy.evaluated',
  'approval.requested',
  'approval.decided',
  'task.completed',
]) {
  check(`${expected} 기록됨`, types.includes(expected), true);
}
// 한 작업의 모든 호출이 하나의 흐름으로 묶여야 시간순 재구성이 된다.
check('하나의 흐름으로 묶인다', trace.events.length >= 6, true);
check('모델은 자가 보고로 표시', trace.modelSource, 'CLIENT_REPORTED');

/* ═══════════ 10. Contribution → Curator → 승격 ═══════════ */
console.log('\n═══ 10. 기여와 승격 ═══');

const contributed = await rpc(alice, orgId, 'company.contribute', {
  type: 'KNOWLEDGE',
  proposedKey: 'db.connection.pool.exhaustion',
  name: '커넥션 풀 고갈 대응',
  description: '느린 쿼리가 커넥션을 붙잡아 풀이 고갈될 때의 대응 절차',
  summary: '느린 쿼리 → 커넥션 고갈 대응',
  structuredContent: {
    steps: ['pg_stat_statements 확인', '느린 쿼리에 인덱스 추가', '풀 크기 재조정'],
  },
  proposedScopeType: 'TEAM',
  proposedScopeId: teamId,
  traceId,
  rationale: '이번 장애 대응에서 정리한 절차입니다',
});
check('기여 제출', contributed.data.contribution.status, 'CANDIDATE');
// 자동으로 자산이 되지 않는다.
check('아직 자산이 아니다', contributed.data.contribution.promotedAssetId, null);
const contributionId = contributed.data.contribution.id;

const curated = expectOk(
  'Curator 검토',
  await alice.rest('POST', `/organizations/${orgId}/contributions/${contributionId}/curator`),
).run;
console.log(`  (curator provider=${curated.provider} model=${curated.model})`);
check('Curator가 판정을 낸다', curated.status, 'SUCCEEDED');
check('판정이 저장된다', typeof curated.verdict, 'string');
// Curator가 뭐라 하든 사람이 결정한다.
check(
  '검토 후에도 CANDIDATE',
  expectOk('상태', await alice.rest('GET', `/organizations/${orgId}/contributions/${contributionId}`))
    .contribution.status,
  'CANDIDATE',
);

const promoted = expectOk(
  '승격',
  await alice.rest('POST', `/organizations/${orgId}/contributions/${contributionId}/promote`, {
    note: '팀 지식으로 반영합니다',
  }),
).contribution;
check('사람이 승격한다', promoted.status, 'PROMOTED');
check('자산이 생겼다', typeof promoted.promotedAssetId, 'string');

/* ═══════════ 11. 사용자 B가 다른 AI로 재사용 ═══════════ */
console.log('\n═══ 11. 다른 사용자·다른 AI가 재사용 ═══');

const reused = await rpc(bob, orgId, 'company.resolve_task', {
  projectId,
  task: {
    description: '커넥션 풀이 자꾸 고갈되는데 원인 좀 봐줘',
    domain: ['database'],
    type: ['troubleshoot'],
  },
  environment: { os: 'linux', runtime: 'node' },
  // 다른 AI다. Codex가 아니라 Claude Code로 붙는다.
  client: { name: 'claude-code', version: '2.0.0', model: 'claude-opus-5' },
});
check('사용자 B도 해석된다', reused.isError, false);

const bobAssets = [
  ...reused.data.manifest.rules,
  ...reused.data.manifest.skills,
  ...reused.data.manifest.knowledge,
];
// 이것이 이 시스템의 존재 이유다 — A가 남긴 지식이 B에게 자동으로 간다.
check(
  'A가 기여한 지식이 B에게 내려온다',
  bobAssets.some((ref) => ref.key === 'db.connection.pool.exhaustion'),
  true,
);
check('회사 규칙도 함께', bobAssets.some((ref) => ref.key === 'company.safety.rule'), true);

const compiled = expectOk(
  '컴파일',
  await bob.rest('POST', `/organizations/${orgId}/compile`, {
    projectId,
    target: 'CLAUDE_CODE',
    task: {
      description: '커넥션 풀이 자꾸 고갈되는데 원인 좀 봐줘',
      domain: ['database'],
      type: ['troubleshoot'],
    },
  }),
).compiled;
const entry = compiled.files.find((file) => file.path === 'CLAUDE.md');
check('Claude Code 형식으로 나온다', entry !== undefined, true);
check('기여한 지식이 파일에 실린다', JSON.stringify(compiled.files).includes('커넥션 풀 고갈'), true);

/* ═══════════ 12. 사용량이 집계에 반영된다 ═══════════ */
console.log('\n═══ 12. 집계 ═══');

const analytics = expectOk(
  '집계',
  await alice.rest('GET', `/organizations/${orgId}/analytics`),
).analytics;
check('흐름이 집계된다', analytics.overview.totalTraces >= 2, true);
check('기여가 집계된다', analytics.overview.totalContributions, 1);
const usedSkill = analytics.assetUsage.find((row) => row.key === 'db.incident.triage');
check('자산 사용량이 잡힌다', usedSkill.selectedCount >= 1, true);
check('승인 통계가 잡힌다', analytics.approvals.byStatus.length > 0, true);
check('Curator 통계가 잡힌다', analytics.curator.totalRuns, 1);
// 개인별 생산성 점수를 만들지 않는다(§57).
check('사용자 식별자가 섞이지 않는다', JSON.stringify(analytics).includes(alice.id), false);

console.log(`\n결과: ${pass} passed, ${fail} failed`);
if (fail === 0) {
  console.log('\n§67 전체 흐름이 끝에서 끝까지 통과했습니다.');
}
process.exit(fail === 0 ? 0 : 1);
