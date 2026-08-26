import { describe, expect, it } from 'vitest';
import { lockRemainingSeconds, nextAfterFailure, throttleKey } from './login-throttle';

const policy = { maxAttempts: 3, lockoutMinutes: 15 };
const now = new Date('2026-08-26T10:00:00Z');

describe('throttleKey', () => {
  it('대소문자와 공백을 정규화한다', () => {
    expect(throttleKey('  Test@Example.COM ')).toBe('test@example.com');
  });
});

describe('nextAfterFailure', () => {
  it('첫 실패는 1이다', () => {
    const result = nextAfterFailure(null, policy, now);
    expect(result.failedCount).toBe(1);
    expect(result.lockedUntil).toBeNull();
  });

  it('임계에 닿으면 잠근다', () => {
    const record = { failedCount: 2, lockedUntil: null, lastFailedAt: now };
    const result = nextAfterFailure(record, policy, now);
    expect(result.failedCount).toBe(3);
    expect(result.lockedUntil?.getTime()).toBe(now.getTime() + 15 * 60_000);
  });

  it('임계 전에는 잠그지 않는다', () => {
    const record = { failedCount: 1, lockedUntil: null, lastFailedAt: now };
    expect(nextAfterFailure(record, policy, now).lockedUntil).toBeNull();
  });

  it('창이 지나면 카운터를 새로 시작한다', () => {
    // 몇 달에 걸쳐 오타 3번을 낸 사람이 잠기면 안 된다.
    const long = new Date(now.getTime() - 60 * 60_000);
    const record = { failedCount: 2, lockedUntil: null, lastFailedAt: long };
    const result = nextAfterFailure(record, policy, now);
    expect(result.failedCount).toBe(1);
    expect(result.lockedUntil).toBeNull();
  });

  it('창 안이면 이어서 센다', () => {
    const recent = new Date(now.getTime() - 60_000);
    const record = { failedCount: 2, lockedUntil: null, lastFailedAt: recent };
    expect(nextAfterFailure(record, policy, now).failedCount).toBe(3);
  });
});

describe('lockRemainingSeconds', () => {
  it('기록이 없으면 null이다', () => {
    expect(lockRemainingSeconds(null, now)).toBeNull();
  });

  it('잠기지 않았으면 null이다', () => {
    expect(
      lockRemainingSeconds({ failedCount: 1, lockedUntil: null, lastFailedAt: now }, now),
    ).toBeNull();
  });

  it('잠겨 있으면 남은 초를 준다', () => {
    const until = new Date(now.getTime() + 90_000);
    expect(
      lockRemainingSeconds({ failedCount: 3, lockedUntil: until, lastFailedAt: now }, now),
    ).toBe(90);
  });

  it('시간이 지나면 스스로 풀린다', () => {
    // 관리자 해제를 요구하면 공격자가 남의 계정을 잠가 서비스 거부를 만든다.
    const past = new Date(now.getTime() - 1000);
    expect(
      lockRemainingSeconds({ failedCount: 3, lockedUntil: past, lastFailedAt: now }, now),
    ).toBeNull();
  });
});
