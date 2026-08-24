import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const valid = {
  DATABASE_URL: 'postgresql://harness:harness@localhost:5432/harnessvault',
};

describe('loadEnv', () => {
  it('필수 값만 있으면 기본값을 채워 반환한다', () => {
    const env = loadEnv(valid);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.SESSION_TTL_HOURS).toBe(720);
  });

  it('숫자 환경변수를 문자열에서 변환한다', () => {
    expect(loadEnv({ ...valid, PORT: '8080' }).PORT).toBe(8080);
  });

  it('DATABASE_URL이 없으면 예외를 던진다', () => {
    expect(() => loadEnv({})).toThrow(/환경변수 검증 실패/);
  });

  it('postgresql이 아닌 스킴을 거부한다', () => {
    expect(() => loadEnv({ DATABASE_URL: 'mysql://localhost:3306/x' })).toThrow();
  });

  it('PORT가 숫자가 아니면 거부한다', () => {
    expect(() => loadEnv({ ...valid, PORT: 'abc' })).toThrow();
  });

  it('WEB_ORIGINS 기본값은 웹 콘솔 개발 주소다', () => {
    expect(loadEnv(valid).WEB_ORIGINS).toEqual(['http://localhost:3100']);
  });

  it('WEB_ORIGINS를 쉼표로 나누고 공백·빈 값을 정리한다', () => {
    expect(
      loadEnv({ ...valid, WEB_ORIGINS: 'http://a.test , http://b.test ,' }).WEB_ORIGINS,
    ).toEqual(['http://a.test', 'http://b.test']);
  });
});
