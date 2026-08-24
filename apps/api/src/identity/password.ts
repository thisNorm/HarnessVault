import {
  randomBytes,
  scrypt as scryptCallback,
  type ScryptOptions,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

// promisify는 options를 받는 오버로드를 잃어버리므로 시그니처를 명시한다.
const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * scrypt 파라미터. 해시 문자열에 함께 저장하므로 나중에 비용을 올려도
 * 기존 해시는 저장된 파라미터로 계속 검증된다.
 */
const DEFAULT_PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

function encode(params: ScryptParams, salt: Buffer, hash: Buffer): string {
  return [
    'scrypt',
    params.N,
    params.r,
    params.p,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$');
}

interface DecodedHash {
  params: ScryptParams;
  salt: Buffer;
  hash: Buffer;
}

export function decodePasswordHash(encoded: string): DecodedHash {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    throw new Error('지원하지 않는 비밀번호 해시 형식입니다');
  }
  const [, rawN, rawR, rawP, rawSalt, rawHash] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const params = { N: Number(rawN), r: Number(rawR), p: Number(rawP) };
  if (!Number.isInteger(params.N) || !Number.isInteger(params.r) || !Number.isInteger(params.p)) {
    throw new Error('비밀번호 해시의 scrypt 파라미터가 올바르지 않습니다');
  }
  return { params, salt: Buffer.from(rawSalt, 'base64'), hash: Buffer.from(rawHash, 'base64') };
}

async function derive(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  // scrypt는 N·r·p 조합에 따라 메모리 상한을 넘길 수 있어 명시적으로 넉넉히 준다.
  const maxmem = 256 * params.N * params.r;
  return scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, { ...params, maxmem });
}

export async function hashPassword(
  password: string,
  params: ScryptParams = DEFAULT_PARAMS,
): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = await derive(password, salt, params);
  return encode(params, salt, hash);
}

/** 해시 형식이 깨졌거나 비밀번호가 틀리면 예외 없이 false를 돌려준다. */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  let decoded: DecodedHash;
  try {
    decoded = decodePasswordHash(encoded);
  } catch {
    return false;
  }
  const candidate = await derive(password, decoded.salt, decoded.params);
  if (candidate.length !== decoded.hash.length) return false;
  return timingSafeEqual(candidate, decoded.hash);
}
