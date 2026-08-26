import { describe, expect, it } from 'vitest';
import { DEFAULT_LANDING, safeNext } from './next-path';

describe('safeNext', () => {
  it('없으면 기본 경로다', () => {
    expect(safeNext(null)).toBe(DEFAULT_LANDING);
    expect(safeNext('')).toBe(DEFAULT_LANDING);
  });

  it('앱 내부 경로는 그대로 쓴다', () => {
    expect(safeNext('/invitations/abc123')).toBe('/invitations/abc123');
  });

  it('외부 URL은 따라가지 않는다', () => {
    // 로그인 직후 남이 만든 페이지로 보내는 오픈 리다이렉트가 된다.
    expect(safeNext('https://evil.example.com')).toBe(DEFAULT_LANDING);
    expect(safeNext('http://evil.example.com')).toBe(DEFAULT_LANDING);
  });

  it('프로토콜 상대 URL도 막는다', () => {
    // `//host`는 슬래시로 시작하지만 브라우저가 외부로 읽는다.
    expect(safeNext('//evil.example.com')).toBe(DEFAULT_LANDING);
  });

  it('스킴만 있는 값도 막는다', () => {
    expect(safeNext('javascript:alert(1)')).toBe(DEFAULT_LANDING);
  });
});
