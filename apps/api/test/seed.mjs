// 개발용 시드. 명세 §67 E2E 시나리오가 요구하는 최소 Harness 자산을 심는다.
// Phase 3 Resolver 테스트가 이 구성을 그대로 쓴다.
//
//   node test/seed.mjs                  기본 계정으로 생성
//   SEED_EMAIL=... SEED_PASSWORD=...    계정 지정
//
// 비밀번호를 인자로 받지 않는다. 저장소에 남는 자격증명을 만들지 않기 위함이다.
import { randomBytes } from 'node:crypto';

const BASE = process.env.API_URL ?? 'http://localhost:3000';
const stamp = Date.now();
const email = process.env.SEED_EMAIL ?? `seed-${stamp}@example.com`;
const password = process.env.SEED_PASSWORD ?? randomBytes(18).toString('base64url');

let cookie = '';

async function call(method, path, body, tolerate = []) {
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
  const parsed = text ? JSON.parse(text) : null;
  if (tolerate.includes(res.status)) return null;
  if (res.status >= 400) {
    throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

// 이미 있는 계정이면 그대로 로그인한다. 반복 실행할 수 있어야 개발에 쓸모가 있다.
const registered = await call('POST', '/auth/register', {
  email,
  password,
  displayName: '시드 관리자',
}, [409]);
if (registered === null) console.log(`기존 계정으로 진행합니다: ${email}`);
await call('POST', '/auth/login', { email, password });

const { organization } = await call('POST', '/organizations', {
  name: 'Acme Corporation',
  slug: `acme-seed-${stamp}`,
});
const orgId = organization.id;

const { team } = await call('POST', `/organizations/${orgId}/teams`, {
  name: 'Backend Team',
  slug: 'backend',
});
const { team: dba } = await call('POST', `/organizations/${orgId}/teams`, {
  name: 'DBA Team',
  slug: 'dba',
});
const { project } = await call('POST', `/organizations/${orgId}/projects`, {
  name: 'Edge Server',
  slug: 'edge-server',
  teamId: team.id,
});
await call('POST', `/organizations/${orgId}/groups`, { name: 'Security Team', slug: 'security' });

const { capability: dbCap } = await call('POST', `/organizations/${orgId}/capabilities`, {
  key: 'database.troubleshooting',
  name: 'DB 장애 대응',
  description: '데이터베이스 장애 원인 분석과 복구',
  ownerType: 'TEAM',
  ownerId: dba.id,
});
const { capability: mqttCap } = await call('POST', `/organizations/${orgId}/capabilities`, {
  key: 'mqtt.ingestion.diagnosis',
  name: 'MQTT 수집 진단',
  description: 'MQTT 메시지 수집 경로 장애 진단',
  ownerType: 'TEAM',
  ownerId: team.id,
});

/** 자산을 만들고 첫 버전을 ACTIVE로 올린다. */
async function seedAsset(asset, version) {
  const { asset: created } = await call('POST', `/organizations/${orgId}/assets`, asset);
  const { version: draft } = await call(
    'POST',
    `/organizations/${orgId}/assets/${created.id}/versions`,
    { ...version, status: 'CANDIDATE' },
  );
  await call('POST', `/organizations/${orgId}/assets/${created.id}/versions/${draft.id}/promote`);
  await call('PATCH', `/organizations/${orgId}/assets/${created.id}`, { status: 'ACTIVE' });
  return created;
}

const core = await seedAsset(
  {
    type: 'SKILL',
    key: 'db.troubleshoot.core',
    name: 'DB 장애 진단 핵심',
    description: 'DB 장애 원인 분석 및 복구 핵심 절차',
    capabilityId: dbCap.id,
    scopeType: 'COMPANY',
    inheritanceMode: 'EXTENDABLE',
    ownerType: 'TEAM',
    ownerId: dba.id,
    selector: { domains: ['database'], tasks: ['troubleshoot'] },
  },
  {
    version: '1.6',
    summary: 'DB 장애 원인 분석 및 복구 핵심 절차',
    structuredContent: {
      instructions: [
        '연결 상태와 커넥션 풀 포화 여부를 확인한다',
        '슬로우 쿼리와 락 대기를 확인한다',
        '디스크·메모리 여유를 확인한다',
        '원인을 특정하기 전에 쓰기 작업을 하지 않는다',
      ],
    },
  },
);

const sqlite = await seedAsset(
  {
    type: 'VARIANT',
    key: 'db.variant.sqlite',
    name: 'SQLite Variant',
    description: 'SQLite 환경에 맞춘 진단 절차',
    capabilityId: dbCap.id,
    scopeType: 'COMPANY',
    inheritanceMode: 'DEFAULT',
    ownerType: 'TEAM',
    ownerId: dba.id,
    selector: { databases: ['sqlite'] },
  },
  {
    version: '2.1',
    summary: 'SQLite는 단일 파일이라 락 경합 확인이 핵심이다',
    structuredContent: { instructions: ['WAL 모드 여부 확인', 'busy_timeout 확인'] },
  },
);

const postgres = await seedAsset(
  {
    type: 'VARIANT',
    key: 'db.variant.postgresql',
    name: 'PostgreSQL Variant',
    description: 'PostgreSQL 환경에 맞춘 진단 절차',
    capabilityId: dbCap.id,
    scopeType: 'COMPANY',
    inheritanceMode: 'DEFAULT',
    ownerType: 'TEAM',
    ownerId: dba.id,
    selector: { databases: ['postgresql'] },
  },
  {
    version: '1.4',
    summary: 'pg_stat_activity와 autovacuum 상태를 먼저 본다',
    structuredContent: { instructions: ['pg_stat_activity 확인', 'autovacuum 지연 확인'] },
  },
);

await seedAsset(
  {
    type: 'RULE',
    key: 'verify-before-completion',
    name: '작업 완료 전 검증 필수',
    description: '회사 필수 규칙. 하위 스코프가 제거할 수 없다.',
    scopeType: 'COMPANY',
    inheritanceMode: 'LOCKED',
    ownerType: 'GROUP',
    ownerId: dba.id,
  },
  {
    version: '1.2',
    summary: '검증 없이 작업을 완료로 보고하지 않는다',
    structuredContent: {
      rule: '변경을 적용한 뒤 반드시 검증 절차를 수행하고 결과를 산출물에 남긴다',
    },
  },
);

await seedAsset(
  {
    type: 'VALIDATION',
    key: 'db.checklist.basic',
    name: 'DB 점검 체크리스트',
    description: '운영 안정성 확보를 위한 필수 검증',
    capabilityId: dbCap.id,
    scopeType: 'TEAM',
    scopeId: dba.id,
    inheritanceMode: 'EXTENDABLE',
    ownerType: 'TEAM',
    ownerId: dba.id,
    selector: { domains: ['database'] },
  },
  {
    version: '1.3',
    summary: 'DB 작업 후 확인할 최소 항목',
    structuredContent: { checks: ['커넥션 수 정상', '슬로우 쿼리 없음', '복제 지연 없음'] },
  },
);

await seedAsset(
  {
    type: 'WORKFLOW',
    key: 'mqtt.diagnosis.flow',
    name: 'MQTT 장애 진단 워크플로우',
    description: 'MQTT 수집 경로 장애를 단계적으로 좁힌다',
    capabilityId: mqttCap.id,
    scopeType: 'PROJECT',
    scopeId: project.id,
    inheritanceMode: 'OVERRIDABLE',
    ownerType: 'PROJECT',
    ownerId: project.id,
    selector: { domains: ['mqtt'], tasks: ['troubleshoot'] },
  },
  {
    version: '2.0',
    summary: 'broker → subscriber → 저장 순으로 확인한다',
    structuredContent: {
      steps: ['broker 연결 확인', 'subscriber 소비 지연 확인', 'DB 적재 확인'],
    },
  },
);

// Variant 관계를 연결한다. Phase 3 Resolver가 이 관계로 후보를 확장한다.
for (const variant of [sqlite, postgres]) {
  await call('POST', `/organizations/${orgId}/assets/${variant.id}/relations`, {
    toAssetId: core.id,
    type: 'VARIANT_OF',
  });
}

console.log('시드 완료');
console.log(`  organization  ${organization.name} (${organization.slug})`);
console.log(`  orgId         ${orgId}`);
console.log(`  로그인        ${email}`);
if (!process.env.SEED_PASSWORD) console.log(`  비밀번호      ${password}`);
console.log('  자산 6개, capability 2개, variant 관계 2개');
