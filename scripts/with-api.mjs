#!/usr/bin/env node
// API 서버가 떠 있으면 그대로 쓰고, 없으면 띄웠다가 끝나면 내린다.
//
// e2e가 "서버는 알아서 띄워 두었겠지"를 전제하면, 잊었을 때 나오는 오류가
// ECONNREFUSED 스택 트레이스다. 무엇을 해야 하는지 알려주지 않는다.
// Playwright의 webServer가 웹에 해 주는 일을 API에도 해 준다.
import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';
const HEALTH = `${API_URL}/health`;
const START_TIMEOUT_MS = 120_000;

async function isUp() {
  try {
    const res = await fetch(HEALTH, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return false;
    const body = await res.json();
    // 떠 있어도 DB가 끊겨 있으면 e2e는 전부 실패한다. 여기서 걸러 낸다.
    return body.status === 'ok' && body.db === 'ok';
  } catch {
    return false;
  }
}

function run(command, args, options = {}) {
  return spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32', ...options });
}

/**
 * 프로세스 **트리**를 죽인다.
 *
 * `npm run dev`는 npm → nest → node로 이어진다. 부모만 죽이면 손자가 살아남아
 * 포트를 잡은 채 떠돈다. 실제로 이 세션에서 그렇게 162개가 쌓였다.
 */
function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  // detached로 띄웠으므로 프로세스 그룹째 보낸다.
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

async function waitUntilUp(child, deadline) {
  for (;;) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`API가 기동 중 종료했습니다 (exit ${child.exitCode})`);
    }
    if (await isUp()) return;
    if (Date.now() > deadline) {
      throw new Error(
        `API가 ${START_TIMEOUT_MS / 1000}초 안에 뜨지 않았습니다.\n` +
          `DB가 켜져 있는지 확인하세요: npm run db:up`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

let started = null;

// Ctrl+C나 상위 종료로 끊겨도 내가 띄운 것은 내린다. 안 그러면 포트가 물린 채 남는다.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (started) killTree(started);
    process.exit(130);
  });
}

const [, , ...command] = process.argv;
if (command.length === 0) {
  console.error('사용법: node scripts/with-api.mjs <실행할 명령...>');
  process.exit(1);
}

if (await isUp()) {
  console.log(`API가 이미 떠 있습니다 — ${API_URL}`);
} else {
  console.log('API를 띄웁니다…');
  // 로그를 삼키지 않는다. 기동 실패 원인이 보여야 한다.
  started = run('npm', ['run', 'dev', '-w', '@harnessvault/api'], {
    // POSIX에서 그룹째 죽이려면 자기 그룹을 가져야 한다.
    detached: process.platform !== 'win32',
  });
  try {
    await waitUntilUp(started, Date.now() + START_TIMEOUT_MS);
  } catch (error) {
    killTree(started);
    console.error(`\n${error.message}`);
    process.exit(1);
  }
  console.log(`API 준비됨 — ${API_URL}`);
}

const child = run(command[0], command.slice(1));
const code = await new Promise((resolve) => child.on('exit', resolve));

// 내가 띄운 것만 내린다. 사용자가 이미 띄워 둔 개발 서버를 끄면 안 된다.
if (started) {
  console.log('띄웠던 API를 내립니다.');
  killTree(started);
}
process.exit(code ?? 1);
