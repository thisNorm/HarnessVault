import { describe, expect, it } from 'vitest';
import {
  DEVELOPMENT_LOGIN_LIMITS,
  PRODUCTION_LOGIN_LIMITS,
  loadEnv,
  loginLimits,
} from './env';

const base = { DATABASE_URL: 'postgresql://user:pass@localhost:5432/db' };

describe('loginLimits', () => {
  it('개발에서는 느슨하다', () => {
    // 데모 중에 오타 몇 번으로 15분을 기다리게 만들 이유가 없다.
    const limits = loginLimits(loadEnv({ ...base, NODE_ENV: 'development' }));
    expect(limits).toEqual(DEVELOPMENT_LOGIN_LIMITS);
    expect(limits.lockoutMinutes).toBe(1);
  });

  it('운영에서는 조인다', () => {
    // 개발의 느슨함이 운영으로 물려 내려가면 안 된다.
    const limits = loginLimits(loadEnv({ ...base, NODE_ENV: 'production' }));
    expect(limits).toEqual(PRODUCTION_LOGIN_LIMITS);
    expect(limits.lockoutMinutes).toBe(15);
  });

  it('운영이 개발보다 엄격하다', () => {
    expect(PRODUCTION_LOGIN_LIMITS.maxAttempts).toBeLessThan(
      DEVELOPMENT_LOGIN_LIMITS.maxAttempts,
    );
    expect(PRODUCTION_LOGIN_LIMITS.lockoutMinutes).toBeGreaterThan(
      DEVELOPMENT_LOGIN_LIMITS.lockoutMinutes,
    );
  });

  it('명시한 값이 환경 판단보다 우선한다', () => {
    const limits = loginLimits(
      loadEnv({ ...base, NODE_ENV: 'production', LOGIN_MAX_ATTEMPTS: '3' }),
    );
    expect(limits.maxAttempts).toBe(3);
    // 지정하지 않은 쪽은 그대로 환경 기본값이다.
    expect(limits.lockoutMinutes).toBe(PRODUCTION_LOGIN_LIMITS.lockoutMinutes);
  });

  it('0은 받지 않는다 — 즉시 잠기면 아무도 로그인 못 한다', () => {
    expect(() => loadEnv({ ...base, LOGIN_MAX_ATTEMPTS: '0' })).toThrow();
  });
});
