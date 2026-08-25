// Resource Gateway 검증용 준비물을 만든다.
// resource-e2e.mjs와 수동 확인이 이 결과를 쓴다.
//
//   node test/setup-resources.mjs
//
// 만들어지는 것
//   <ROOT>/docs             파일 Resource 겸 Git Resource (커밋 1개 + 미커밋 변경 1개)
//   <ROOT>/secret-outside   root 밖. 경로 탈출이 실제로 막히는지 확인용
//   demo_app 데이터베이스    DATABASE Resource
//
// 그리고 .env에 HARNESS_RESOURCE_DEMO_DB가 있어야 한다.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = process.env.HARNESS_TEST_ROOT ?? join(tmpdir(), 'harness-resources');
const docs = join(ROOT, 'docs');
const outside = join(ROOT, 'secret-outside');

rmSync(ROOT, { recursive: true, force: true });
mkdirSync(join(docs, 'runbooks'), { recursive: true });
mkdirSync(outside, { recursive: true });

writeFileSync(
  join(docs, 'README.md'),
  '# 운영 문서\n' + 'DB 장애 시 커넥션 풀 포화를 먼저 확인한다.\n',
);
writeFileSync(
  join(docs, 'runbooks', 'db-incident.md'),
  '# DB 장애 대응 런북\n' + '1. pg_stat_activity 확인\n' + '2. 슬로우 쿼리 확인\n',
);
// root 밖에 둔다. 경로 탈출이 막히는지 확인하기 위한 것이다.
writeFileSync(join(outside, 'secret.txt'), '이건 root 밖의 비밀입니다\n');

const git = (args) => execFileSync('git', args, { cwd: docs, stdio: 'pipe' });
git(['init', '-q', '-b', 'main']);
git(['add', '-A']);
git([
  '-c',
  'user.email=seed@example.com',
  '-c',
  'user.name=seed',
  'commit',
  '-q',
  '-m',
  '운영 문서 초기 커밋',
]);
// 미커밋 변경을 하나 남긴다. git.status가 무언가를 보고해야 하기 때문이다.
appendFileSync(join(docs, 'README.md'), '미커밋 변경\n');

console.log('파일·Git Resource 준비 완료');
console.log(`  root      ${docs}`);
console.log(`  root 밖   ${outside}`);

if (!existsSync(docs)) throw new Error('docs 디렉터리 생성 실패');

console.log('\n데모 DB는 아래로 만든다.');
console.log('  docker exec harnessvault-postgres psql -U harness -d postgres \\');
console.log('    -c "drop database if exists demo_app;" -c "create database demo_app;"');
console.log('  docker exec harnessvault-postgres psql -U harness -d demo_app -c "\\');
console.log('    create table events_summary (id serial primary key, topic text, count int, day date);\\');
console.log("    insert into events_summary (topic, count, day) values ('sensor/temp', 1204, '2026-08-24');\"");
console.log('\n.env에 아래가 필요하다.');
console.log('  HARNESS_RESOURCE_DEMO_DB=postgresql://harness:harness@localhost:5432/demo_app');
