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

  /**
   * 로그인 시도 제한. 계정 존재 여부를 흘리지 않도록 제출된 이메일 문자열로 센다.
   *
   * 명시하지 않으면 **개발에서는 느슨하고 운영에서는 조인다.**
   * 비밀번호 최소 길이(4자 대 12자)와 같은 태도다 — 데모 중에 오타 몇 번으로
   * 15분을 기다리게 만들 이유가 없고, 운영에서 그 느슨함을 물려줄 이유도 없다.
   */
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().optional(),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().optional(),
  /**
   * 한 IP가 창 안에 실패시킬 수 있는 **서로 다른 계정 수**. 실패 횟수가 아니다.
   * 사무실은 각자 자기 계정에서만 실패하므로 인원수 근처에서 멈추고,
   * 계정을 훑는 공격만 이 선을 넘는다.
   */
  LOGIN_MAX_ACCOUNTS_PER_IP: z.coerce.number().int().positive().default(20),
  /**
   * 스프레이로 표시된 IP에서도 (IP, 계정) 쌍마다 **확인을 거쳐 주는** 횟수.
   *
   * 0으로 두면 오타 한 번 낸 사람이 맞는 비밀번호로도 막힌다.
   * 이 유예 안에서 제대로 치면 언제나 들어간다 — 공격자는 계정당 이 횟수만큼만
   * scrypt를 태울 수 있다. 계정 축의 10회보다 훨씬 적다.
   */
  LOGIN_VERIFY_GRACE_PER_PAIR: z.coerce.number().int().positive().default(3),
  /**
   * `X-Forwarded-For`를 믿을지. **기본은 믿지 않는다.**
   * 프록시가 없는데 믿으면 공격자가 요청마다 다른 IP를 적어 제한을 무력화한다.
   * 반대로 프록시가 있는데 안 믿으면 모든 요청이 프록시 IP 하나로 묶여
   * 정상 사용자 전체가 함께 잠긴다. 운영자가 배포 형태를 알고 켜야 한다.
   */
  TRUST_PROXY: z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((value) => value === 'true'),
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

/** 운영 기본값. 무차별 대입을 실질적으로 막는 선이다. */
export const PRODUCTION_LOGIN_LIMITS = { maxAttempts: 10, lockoutMinutes: 15 } as const;
/**
 * 개발 기본값. 잠기기 어렵고, 잠겨도 금방 풀린다.
 * 데모 중에 로그인이 막혀 있는 시간이 길면 그것 자체가 더 큰 문제다.
 */
export const DEVELOPMENT_LOGIN_LIMITS = { maxAttempts: 20, lockoutMinutes: 1 } as const;

export function loginLimits(env: Env): { maxAttempts: number; lockoutMinutes: number } {
  const base =
    env.NODE_ENV === 'production' ? PRODUCTION_LOGIN_LIMITS : DEVELOPMENT_LOGIN_LIMITS;
  // 개별 지정은 언제나 우선한다. 환경 판단은 값을 안 줬을 때의 기본일 뿐이다.
  return {
    maxAttempts: env.LOGIN_MAX_ATTEMPTS ?? base.maxAttempts,
    lockoutMinutes: env.LOGIN_LOCKOUT_MINUTES ?? base.lockoutMinutes,
  };
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
