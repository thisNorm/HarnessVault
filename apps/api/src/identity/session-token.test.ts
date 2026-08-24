import { describe, expect, it } from 'vitest';
import {
  generateSessionToken,
  hashSessionToken,
  parseBearerToken,
  readCookie,
} from './session-token';

describe('session token', () => {
  it('매번 다른 토큰을 만든다', () => {
    expect(generateSessionToken()).not.toBe(generateSessionToken());
  });

  it('URL에 안전한 문자만 쓴다', () => {
    expect(generateSessionToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('같은 토큰은 같은 지문으로, 다른 토큰은 다른 지문으로 해시된다', () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
    expect(hashSessionToken(token)).not.toBe(hashSessionToken(generateSessionToken()));
  });

  it('지문에서 원문을 되돌릴 수 없도록 원문과 다른 값이다', () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).not.toContain(token);
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('Bearer 헤더를 파싱한다', () => {
    expect(parseBearerToken('Bearer abc123')).toBe('abc123');
    expect(parseBearerToken('bearer abc123')).toBe('abc123');
    expect(parseBearerToken('  Bearer   abc123  ')).toBe('abc123');
  });

  it('Bearer가 아닌 헤더는 거부한다', () => {
    expect(parseBearerToken(undefined)).toBeNull();
    expect(parseBearerToken('')).toBeNull();
    expect(parseBearerToken('Basic abc123')).toBeNull();
    expect(parseBearerToken('Bearer')).toBeNull();
    expect(parseBearerToken('Bearer a b')).toBeNull();
  });

  it('Cookie 헤더에서 값을 뽑는다', () => {
    expect(readCookie('harness_session=abc123', 'harness_session')).toBe('abc123');
    expect(readCookie('other=1; harness_session=abc123; more=2', 'harness_session')).toBe('abc123');
    expect(readCookie('harness_session=a%20b', 'harness_session')).toBe('a b');
  });

  it('없는 쿠키·유사한 이름에는 null을 준다', () => {
    expect(readCookie(undefined, 'harness_session')).toBeNull();
    expect(readCookie('other=1', 'harness_session')).toBeNull();
    expect(readCookie('xharness_session=1', 'harness_session')).toBeNull();
    expect(readCookie('harness_session', 'harness_session')).toBeNull();
  });
});
