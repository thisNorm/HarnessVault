import { describe, expect, it } from 'vitest';
import { cookieSecure, loadEnv } from './env';

const base = { DATABASE_URL: 'postgresql://user:pass@localhost:5432/db' };

describe('쿠키 조합 검증', () => {
  it('SameSite=none인데 Secure가 아니면 부팅을 막는다', () => {
    // 브라우저가 이 조합의 쿠키를 조용히 버린다. 잘못된 설정으로 뜨느니 안 뜨는 편이 낫다.
    expect(() =>
      loadEnv({ ...base, SESSION_COOKIE_SAMESITE: 'none', SESSION_COOKIE_SECURE: 'false' }),
    ).toThrow('SESSION_COOKIE_SECURE=true 를 요구합니다');
  });

  it('개발 기본값(none + Secure 미지정)도 막는다', () => {
    // NODE_ENV가 development면 Secure가 기본 false다. 이것도 같은 함정이다.
    expect(() => loadEnv({ ...base, SESSION_COOKIE_SAMESITE: 'none' })).toThrow();
  });

  it('none + Secure는 통과한다', () => {
    const env = loadEnv({
      ...base,
      SESSION_COOKIE_SAMESITE: 'none',
      SESSION_COOKIE_SECURE: 'true',
    });
    expect(env.SESSION_COOKIE_SAMESITE).toBe('none');
    expect(cookieSecure(env)).toBe(true);
  });

  it('기본값은 lax다', () => {
    expect(loadEnv(base).SESSION_COOKIE_SAMESITE).toBe('lax');
  });
});

describe('cookieSecure', () => {
  it('명시하지 않으면 프로덕션에서만 Secure다', () => {
    expect(cookieSecure(loadEnv({ ...base, NODE_ENV: 'production' }))).toBe(true);
    expect(cookieSecure(loadEnv({ ...base, NODE_ENV: 'development' }))).toBe(false);
  });

  it('명시하면 NODE_ENV보다 우선한다', () => {
    // 프로덕션인데 TLS 종단이 앞단에 있는 배포에서 필요할 수 있다.
    expect(
      cookieSecure(loadEnv({ ...base, NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'false' })),
    ).toBe(false);
  });
});

describe('로그인 제한 기본값', () => {
  it('기본값이 있다', () => {
    const env = loadEnv(base);
    expect(env.LOGIN_MAX_ATTEMPTS).toBe(10);
    expect(env.LOGIN_LOCKOUT_MINUTES).toBe(15);
  });

  it('0은 받지 않는다 — 즉시 잠기면 아무도 로그인 못 한다', () => {
    expect(() => loadEnv({ ...base, LOGIN_MAX_ATTEMPTS: '0' })).toThrow();
  });
});

describe('세션 정리 주기', () => {
  it('0이면 끈다', () => {
    expect(loadEnv({ ...base, SESSION_PURGE_INTERVAL_MINUTES: '0' }).SESSION_PURGE_INTERVAL_MINUTES).toBe(0);
  });

  it('음수는 받지 않는다', () => {
    expect(() => loadEnv({ ...base, SESSION_PURGE_INTERVAL_MINUTES: '-1' })).toThrow();
  });
});
