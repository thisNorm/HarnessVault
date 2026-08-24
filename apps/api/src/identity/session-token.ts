import { createHash, randomBytes } from 'node:crypto';

const TOKEN_BYTES = 32;

/** 클라이언트에게만 주는 원문 토큰. 서버는 이 값을 저장하지 않는다. */
export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** DB에 저장·조회할 때 쓰는 지문. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const SESSION_COOKIE_NAME = 'harness_session';

/** `Authorization: Bearer <token>` 헤더에서 토큰을 뽑는다. */
export function parseBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/** `Cookie` 헤더에서 이름이 일치하는 값을 뽑는다. cookie-parser 의존성을 두지 않기 위함이다. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return null;
}
