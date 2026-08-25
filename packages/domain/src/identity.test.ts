import { describe, expect, it } from 'vitest';
import {
  DEVELOPMENT_MIN_PASSWORD_LENGTH,
  PRODUCTION_MIN_PASSWORD_LENGTH,
  emailSchema,
  makeRegisterInputSchema,
  slugSchema,
} from './identity';

const devSchema = makeRegisterInputSchema(DEVELOPMENT_MIN_PASSWORD_LENGTH);
const prodSchema = makeRegisterInputSchema(PRODUCTION_MIN_PASSWORD_LENGTH);

describe('가입 입력', () => {
  const base = { email: 'test@test.com', displayName: '테스터' };

  it('개발 기준은 test@test.com / 1234를 받는다', () => {
    expect(devSchema.safeParse({ ...base, password: '1234' }).success).toBe(true);
  });

  it('운영 기준은 같은 계정을 거부한다', () => {
    expect(prodSchema.safeParse({ ...base, password: '1234' }).success).toBe(false);
  });

  it('개발 기준도 3자는 거부한다', () => {
    expect(devSchema.safeParse({ ...base, password: '123' }).success).toBe(false);
  });

  it('이메일을 소문자로 정규화한다', () => {
    expect(emailSchema.parse('Test@Test.COM')).toBe('test@test.com');
  });

  it('이메일 형식을 강제한다', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
  });
});

describe('slugSchema', () => {
  it('소문자·숫자·하이픈을 받는다', () => {
    expect(slugSchema.safeParse('acme-corp').success).toBe(true);
  });

  it('대문자·공백·양끝 하이픈을 거부한다', () => {
    for (const bad of ['Acme', 'acme corp', '-acme', 'acme-', 'a']) {
      expect(slugSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});
