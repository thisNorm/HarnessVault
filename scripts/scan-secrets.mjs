#!/usr/bin/env node
// 커밋에 자격증명이 섞여 들어가는 것을 막는다.
// 외부 도구 설치를 요구하면 사람마다 훅이 다르게 동작하므로 Node 표준 기능만 쓴다.
//
//   node scripts/scan-secrets.mjs         스테이징된 변경만 검사 (pre-commit 훅)
//   node scripts/scan-secrets.mjs --all   추적 중인 파일 전체 검사
//
// 오탐이 확실한 줄에는 같은 줄에 secret-scan:allow 주석을 남긴다.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ALLOW_MARKER = 'secret-scan' + ':allow';

/** 값의 형태 자체가 자격증명인 것들. 오탐이 거의 없다. */
const HIGH_CONFIDENCE = [
  { name: '개인키 블록', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'AWS 액세스 키', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub 토큰', re: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/ },
  { name: 'Slack 토큰', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'OpenAI 키', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/ },
  { name: 'Anthropic 키', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'Google API 키', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { name: 'Stripe 키', re: /\b[rs]k_live_[A-Za-z0-9]{20,}\b/ },
];

/**
 * 이름이 자격증명인 변수에 리터럴을 대입한 경우.
 * 환경변수 참조(${VAR}, process.env.X)와 명백한 예시값은 통과시킨다.
 */
const ASSIGNMENT =
  /\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credential)\b\s*[:=]\s*(['"`])([^'"`\n]{6,})\1/i;

const PLACEHOLDER =
  /^(?:\$|process\.env|import\.meta|<|\{\{|xxx+|todo|changeme|example|placeholder|your[_-]|\*{3,}|\.{3,})/i;

/** 자격증명이 들어갈 이유가 없는 파일. 통째로 차단한다. */
const FORBIDDEN_PATH = /(?:^|\/)\.env(?:\.[A-Za-z0-9_-]+)?$/;
const ALLOWED_ENV_PATH = /(?:^|\/)\.env\.(?:example|sample|template)$/;

/** 내용을 검사할 이유가 없거나 오탐만 만드는 파일. */
const SKIP_CONTENT = [
  /(?:^|\/)package-lock\.json$/,
  /(?:^|\/)pnpm-lock\.yaml$/,
  /(?:^|\/)yarn\.lock$/,
  /(?:^|\/)scripts\/scan-secrets\.mjs$/,
  /\.(?:png|jpe?g|gif|webp|ico|svg|pdf|woff2?|ttf|otf|eot|zip|gz|mp4|webm)$/i,
];

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function listFiles(all) {
  const out = all
    ? git(['ls-files', '-z'])
    : git(['diff', '--cached', '--name-only', '--diff-filter=ACM', '-z']);
  return out.split('\0').filter(Boolean);
}

function readFile(path, all) {
  try {
    // 커밋 시에는 스테이징된 내용을 읽는다.
    // 작업 트리에서 되돌린 값이 커밋에 남는 것을 놓치지 않기 위함이다.
    return all ? readFileSync(path, 'utf8') : git(['show', `:${path}`]);
  } catch {
    return null;
  }
}

function scanLine(line) {
  if (line.includes(ALLOW_MARKER)) return null;

  for (const rule of HIGH_CONFIDENCE) {
    if (rule.re.test(line)) return rule.name;
  }

  const assigned = ASSIGNMENT.exec(line);
  if (assigned) {
    const value = assigned[2];
    if (!PLACEHOLDER.test(value)) return '자격증명 리터럴 대입';
  }
  return null;
}

const all = process.argv.includes('--all');
const findings = [];

for (const path of listFiles(all)) {
  if (FORBIDDEN_PATH.test(path) && !ALLOWED_ENV_PATH.test(path)) {
    findings.push({ path, line: 0, reason: '.env 파일은 커밋할 수 없습니다', text: path });
    continue;
  }
  if (SKIP_CONTENT.some((re) => re.test(path))) continue;

  const content = readFile(path, all);
  if (content === null || content.includes('\0')) continue;

  content.split(/\r?\n/).forEach((line, index) => {
    const reason = scanLine(line);
    if (reason) {
      findings.push({ path, line: index + 1, reason, text: line.trim().slice(0, 120) });
    }
  });
}

if (findings.length === 0) {
  if (all) console.log(`시크릿 스캔 통과 — ${listFiles(true).length}개 파일 검사`);
  process.exit(0);
}

console.error(`\n시크릿 스캔 실패 — ${findings.length}건\n`);
for (const f of findings) {
  console.error(`  ${f.path}${f.line ? `:${f.line}` : ''}  [${f.reason}]`);
  console.error(`    ${f.text}`);
}
console.error(
  `\n실제 자격증명이면 값을 제거하고 환경변수로 옮기세요.` +
    `\n오탐이면 해당 줄 끝에 ${ALLOW_MARKER} 주석을 남기세요.\n`,
);
process.exit(1);
