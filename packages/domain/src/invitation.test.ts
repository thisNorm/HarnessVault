import { describe, expect, it } from 'vitest';
import { canAcceptInvitation, invitationStatusAt } from './invitation';

const now = new Date('2026-08-26T12:00:00Z');
const future = new Date('2026-08-27T12:00:00Z');
const past = new Date('2026-08-25T12:00:00Z');

describe('invitationStatusAt', () => {
  it('아직 유효하면 PENDING이다', () => {
    expect(invitationStatusAt('PENDING', future, now)).toBe('PENDING');
  });

  it('시각이 지나면 EXPIRED다 — 갱신 작업 없이 계산된다', () => {
    expect(invitationStatusAt('PENDING', past, now)).toBe('EXPIRED');
  });

  it('만료 시각 정각도 만료다', () => {
    expect(invitationStatusAt('PENDING', now, now)).toBe('EXPIRED');
  });

  it('수락된 것은 만료가 덮어쓰지 않는다', () => {
    // 무슨 일이 있었는지가 시간보다 중요하다.
    expect(invitationStatusAt('ACCEPTED', past, now)).toBe('ACCEPTED');
  });

  it('철회된 것도 그대로다', () => {
    expect(invitationStatusAt('REVOKED', past, now)).toBe('REVOKED');
  });
});

describe('canAcceptInvitation', () => {
  it('PENDING만 수락할 수 있다', () => {
    expect(canAcceptInvitation('PENDING')).toBe(true);
  });

  it('나머지는 안 된다', () => {
    expect(canAcceptInvitation('ACCEPTED')).toBe(false);
    expect(canAcceptInvitation('REVOKED')).toBe(false);
    expect(canAcceptInvitation('EXPIRED')).toBe(false);
  });
});
