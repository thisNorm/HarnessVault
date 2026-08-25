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
});

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
