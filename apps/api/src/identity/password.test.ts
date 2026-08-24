import { describe, expect, it } from 'vitest';
import { decodePasswordHash, hashPassword, verifyPassword } from './password';

// 테스트에서는 비용을 낮춰 실행 시간을 줄인다. 저장 형식은 동일하다.
const cheap = { N: 2 ** 10, r: 8, p: 1 };

describe('password', () => {
  it('해시·검증 왕복이 성공한다', async () => {
    const encoded = await hashPassword('correct horse battery staple', cheap);
    await expect(verifyPassword('correct horse battery staple', encoded)).resolves.toBe(true);
  });

  it('틀린 비밀번호를 거부한다', async () => {
    const encoded = await hashPassword('correct horse battery staple', cheap);
    await expect(verifyPassword('correct horse battery stapl', encoded)).resolves.toBe(false);
  });

  it('같은 비밀번호도 salt 때문에 매번 다른 해시가 된다', async () => {
    const a = await hashPassword('same-password-value', cheap);
    const b = await hashPassword('same-password-value', cheap);
    expect(a).not.toBe(b);
  });

  it('해시에 scrypt 파라미터를 함께 저장한다', async () => {
    const encoded = await hashPassword('some-password-value', cheap);
    expect(encoded.startsWith('scrypt$1024$8$1$')).toBe(true);
    expect(decodePasswordHash(encoded).params).toEqual(cheap);
  });

  it('저장된 파라미터로 검증하므로 기본값을 바꿔도 기존 해시가 유효하다', async () => {
    const encoded = await hashPassword('legacy-password-value', { N: 2 ** 10, r: 8, p: 1 });
    await expect(verifyPassword('legacy-password-value', encoded)).resolves.toBe(true);
  });

  it('유니코드 정규화 차이를 흡수한다', async () => {
    // NFC 조합형 '가' 와 NFD 분해형 '가'
    const encoded = await hashPassword('비밀번호가맞다ABCDE'.normalize('NFC'), cheap);
    await expect(verifyPassword('비밀번호가맞다ABCDE'.normalize('NFD'), encoded)).resolves.toBe(
      true,
    );
  });

  it('망가진 해시 문자열에 예외 대신 false를 반환한다', async () => {
    await expect(verifyPassword('x', 'not-a-hash')).resolves.toBe(false);
    await expect(verifyPassword('x', 'bcrypt$1$2$3$4$5')).resolves.toBe(false);
    await expect(verifyPassword('x', 'scrypt$abc$8$1$AAAA$BBBB')).resolves.toBe(false);
  });
});
