import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

/**
 * cwd에서 위로 올라가며 첫 번째 `.env`를 찾는다.
 * 워크스페이스 루트에서 실행하든 `apps/api`에서 실행하든 같은 파일을 읽게 하기 위함이다.
 */
function findEnvFile(from: string): string | null {
  let dir = from;
  for (;;) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url({ protocol: /^postgresql$/ }),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(720),
  // 만료 세션 정리 주기. 0이면 끈다.
  SESSION_PURGE_INTERVAL_MINUTES: z.coerce.number().int().min(0).default(60),

  // 운영에서 웹과 API 도메인이 갈리면 Lax로는 쿠키가 가지 않는다.
  SESSION_COOKIE_SAMESITE: z.enum(['lax', 'none', 'strict']).default('lax'),
  SESSION_COOKIE_SECURE: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  SESSION_COOKIE_DOMAIN: z.string().min(1).optional(),

  // 로그인 시도 제한. 계정 존재 여부를 흘리지 않도록 제출된 이메일 문자열로 센다.
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
  // 쿠키 인증을 쓰므로 와일드카드 origin을 허용하지 않는다. 쉼표로 여러 개를 줄 수 있다.
  WEB_ORIGINS: z
    .string()
    .default('http://localhost:3100')
    .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean)),

  // 임베딩은 선택이다. 없으면 중복 탐색이 어휘 기반으로 동작한다 —
  // Ollama가 없는 환경에서도 시스템 전체가 돌아야 한다.
  EMBEDDING_URL: z.url().optional(),
  EMBEDDING_MODEL: z.string().default('nomic-embed-text'),
  EMBEDDING_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  // Curator도 선택이다. 없으면 배선 검증용 대역이 돌고, 결과에 MOCK이 박힌다(§72).
  CURATOR_URL: z.url().optional(),
  CURATOR_MODEL: z.string().default('qwen3:4b'),
  // 로컬 모델은 느리다. 임베딩보다 넉넉하게 준다.
  CURATOR_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
});

/**
 * 브라우저는 `SameSite=None`인데 `Secure`가 아닌 쿠키를 **조용히 버린다.**
 * 그대로 뜨면 운영자는 "로그인이 안 된다"만 보고 원인을 찾지 못한다.
 * 잘못된 설정으로 뜨느니 이유를 말하고 안 뜨는 편이 낫다.
 */
function assertCookieCombination(env: Env): void {
  if (env.SESSION_COOKIE_SAMESITE === 'none' && !cookieSecure(env)) {
    throw new Error(
      'SESSION_COOKIE_SAMESITE=none 은 SESSION_COOKIE_SECURE=true 를 요구합니다. ' +
        '브라우저가 이 조합의 쿠키를 조용히 버려 로그인이 되지 않습니다.',
    );
  }
}

/** 명시하지 않으면 프로덕션에서만 Secure다. */
export function cookieSecure(env: Env): boolean {
  return env.SESSION_COOKIE_SECURE ?? env.NODE_ENV === 'production';
}

export type Env = z.infer<typeof envSchema>;

/**
 * 환경변수를 검증한다. 실패하면 부팅을 중단한다 —
 * 잘못된 설정을 기본값으로 덮어 정상 상태로 위장하지 않는다.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`환경변수 검증 실패\n${z.prettifyError(parsed.error)}`);
  }
  assertCookieCombination(parsed.data);
  return parsed.data;
}

let cached: Env | null = null;

/** `.env`를 한 번만 읽어 검증한 환경변수를 돌려준다. */
export function getEnv(): Env {
  if (cached === null) {
    const envFile = findEnvFile(process.cwd());
    if (envFile) process.loadEnvFile(envFile);
    cached = loadEnv();
  }
  return cached;
}
