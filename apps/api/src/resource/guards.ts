import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

/**
 * Resource Gateway의 보안 경계. 전부 순수 함수로 두고 단위 테스트한다.
 * 여기가 뚫리면 회사 데이터가 그대로 새므로 어댑터 안에 섞어 두지 않는다.
 */

/* ---------------- credential 참조 ---------------- */

/**
 * `credential_ref`는 환경변수 **이름**이다. 비밀 자체가 아니다.
 *
 * 자유롭게 두면 ORG_ADMIN이 `DATABASE_URL`을 지정해 이 애플리케이션 자신의 DB를
 * Resource로 등록할 수 있다. 다른 조직 데이터 전체가 열린다.
 */
export const CREDENTIAL_PREFIX = 'HARNESS_RESOURCE_';
const CREDENTIAL_PATTERN = /^HARNESS_RESOURCE_[A-Z0-9_]+$/;

export function isAllowedCredentialRef(ref: string): boolean {
  return CREDENTIAL_PATTERN.test(ref);
}

export class ResourceCredentialError extends Error {
  constructor(
    readonly code: 'PERMISSION_DENIED' | 'RESOURCE_UNAVAILABLE',
    message: string,
  ) {
    super(message);
    this.name = 'ResourceCredentialError';
  }
}

/**
 * 실행 시점에도 접두사를 다시 검사한다.
 * 등록 시점만 막으면 DB를 직접 고친 행이 통과한다.
 */
export function resolveCredential(
  ref: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (!isAllowedCredentialRef(ref)) {
    throw new ResourceCredentialError(
      'PERMISSION_DENIED',
      `credential 참조는 ${CREDENTIAL_PREFIX}로 시작해야 합니다`,
    );
  }
  const value = env[ref];
  if (!value) {
    // 비어 있는 것을 빈 문자열로 넘기면 드라이버가 엉뚱한 곳에 붙는다.
    throw new ResourceCredentialError(
      'RESOURCE_UNAVAILABLE',
      `환경변수 ${ref}가 설정되지 않았습니다`,
    );
  }
  return value;
}

/* ---------------- 경로 탈출 ---------------- */

export class ResourcePathError extends Error {
  readonly code = 'PERMISSION_DENIED';

  constructor(message: string) {
    super(message);
    this.name = 'ResourcePathError';
  }
}

/**
 * `root` 밖으로 나가는 경로를 막는다.
 *
 * `realpath`까지 확인하는 이유는 심볼릭 링크다.
 * `root/link → /etc`처럼 걸어 두면 문자열 검사만으로는 통과한다.
 * 파일이 아직 없을 수 있으므로 실경로 확인은 실패해도 문자열 검사 결과를 쓴다.
 */
export function resolveInsideRoot(root: string, requested: string): string {
  if (requested.includes('\0')) {
    throw new ResourcePathError('경로에 허용되지 않는 문자가 있습니다');
  }
  if (isAbsolute(requested)) {
    throw new ResourcePathError('절대 경로는 사용할 수 없습니다');
  }

  const rootResolved = resolve(root);
  const target = resolve(rootResolved, requested);
  if (!isInside(rootResolved, target)) {
    throw new ResourcePathError('허용된 경로 밖입니다');
  }

  try {
    const realRoot = realpathSync(rootResolved);
    const realTarget = realpathSync(target);
    if (!isInside(realRoot, realTarget)) {
      throw new ResourcePathError('심볼릭 링크가 허용된 경로 밖을 가리킵니다');
    }
    return realTarget;
  } catch (error) {
    if (error instanceof ResourcePathError) throw error;
    // 아직 존재하지 않는 경로다. 문자열 기준 검사는 이미 통과했다.
    return target;
  }
}

function isInside(root: string, target: string): boolean {
  if (root === target) return true;
  const rel = relative(root, target);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/* ---------------- 읽기 전용 SQL ---------------- */

export class ResourceQueryError extends Error {
  readonly code = 'VALIDATION_FAILED';

  constructor(message: string) {
    super(message);
    this.name = 'ResourceQueryError';
  }
}

const WRITE_KEYWORDS = [
  'insert',
  'update',
  'delete',
  'merge',
  'truncate',
  'drop',
  'create',
  'alter',
  'grant',
  'revoke',
  'comment',
  'copy',
  'call',
  'do',
  'vacuum',
  'refresh',
  'reindex',
  'set',
  'reset',
  'listen',
  'notify',
  'lock',
  'prepare',
  'execute',
];

/** 줄 주석과 블록 주석을 지운다. 주석 뒤에 쓰기를 감추는 것을 막는다. */
export function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

/**
 * Phase 6은 읽기 전용이다. 정책 게이트(Phase 7)와 승인(Phase 8)이 붙기 전에는 쓰기를 열지 않는다.
 *
 * 이 검사는 **1차 방어일 뿐이다.** 실제 보장은 실행 시 `read only` 트랜잭션이 한다.
 * 문자열 검사만 믿지 않는다.
 */
export function assertReadOnlyQuery(sql: string): string {
  const cleaned = stripSqlComments(sql).trim();
  if (cleaned === '') throw new ResourceQueryError('빈 질의입니다');

  // 세미콜론 뒤에 내용이 남으면 여러 문장이다. 끝의 세미콜론 하나는 허용한다.
  const withoutTrailing = cleaned.replace(/;\s*$/, '');
  if (withoutTrailing.includes(';')) {
    throw new ResourceQueryError('한 번에 한 문장만 실행할 수 있습니다');
  }

  const firstWord = withoutTrailing.split(/[\s(]+/)[0]?.toLowerCase() ?? '';
  if (firstWord !== 'select' && firstWord !== 'with' && firstWord !== 'table') {
    throw new ResourceQueryError('SELECT 질의만 실행할 수 있습니다');
  }

  // WITH ... AS (INSERT ... RETURNING) 같은 CTE 안의 쓰기를 잡는다.
  const lowered = withoutTrailing.toLowerCase();
  for (const keyword of WRITE_KEYWORDS) {
    if (new RegExp(`(^|[\\s(,;])${keyword}[\\s(]`, 'i').test(lowered)) {
      throw new ResourceQueryError(`읽기 전용 질의에 ${keyword.toUpperCase()}를 쓸 수 없습니다`);
    }
  }

  return withoutTrailing;
}

/* ---------------- 오류 메시지 정화 ---------------- */

const CONNECTION_STRING = /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"]*/gi;

/**
 * 드라이버 오류에는 접속 문자열이 그대로 섞여 나온다.
 * 오류를 삼키지는 않되 비밀만 지운다(§60).
 */
export function redactSecrets(message: string, extra: readonly string[] = []): string {
  let safe = message.replace(CONNECTION_STRING, '[redacted-connection-string]');
  for (const secret of extra) {
    if (secret && secret.length >= 4) safe = safe.split(secret).join('[redacted]');
  }
  return safe;
}
