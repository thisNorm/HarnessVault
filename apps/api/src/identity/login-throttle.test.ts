import { describe, expect, it } from 'vitest';
import {
  clientIp,
  ipPairKey,
  ipPrefix,
  lockRemainingSeconds,
  nextAfterFailure,
  throttleKey,
} from './login-throttle';

const policy = { maxAttempts: 3, lockoutMinutes: 15 };
const now = new Date('2026-08-26T10:00:00Z');

describe('throttleKey', () => {
  it('대소문자와 공백을 정규화한다', () => {
    expect(throttleKey('  Test@Example.COM ')).toBe('email:test@example.com');
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

describe('throttleKey / ipPairKey', () => {
  it('축을 접두사로 가른다', () => {
    // 한 테이블을 쓰므로 이메일 'ip:x'가 IP 통을 오염시키면 안 된다.
    expect(throttleKey('a@b.com')).toBe('email:a@b.com');
    expect(ipPairKey('1.2.3.4', 'a@b.com')).toBe('ip:1.2.3.4|a@b.com');
  });

  it('IP당 쌍은 계정마다 다르다', () => {
    // 같은 계정을 백 번 두드려도 쌍은 하나다 — 그래서 사무실이 잠기지 않는다.
    expect(ipPairKey('1.2.3.4', 'a@b.com')).toBe(ipPairKey('1.2.3.4', 'A@B.com'));
    expect(ipPairKey('1.2.3.4', 'a@b.com')).not.toBe(ipPairKey('1.2.3.4', 'c@d.com'));
  });

  it('접두사로 같은 IP의 쌍을 모을 수 있다', () => {
    expect(ipPairKey('1.2.3.4', 'a@b.com').startsWith(ipPrefix('1.2.3.4'))).toBe(true);
    expect(ipPairKey('9.9.9.9', 'a@b.com').startsWith(ipPrefix('1.2.3.4'))).toBe(false);
  });
});

describe('clientIp', () => {
  const socket = { socketAddress: '10.0.0.1' };

  it('프록시를 믿지 않으면 헤더를 무시한다', () => {
    // 프록시가 없는데 믿으면 공격자가 요청마다 다른 IP를 적어 제한을 무력화한다.
    expect(clientIp({ ...socket, forwardedFor: '9.9.9.9' }, false)).toBe('10.0.0.1');
  });

  it('프록시를 믿으면 가장 오른쪽 홉을 쓴다', () => {
    // 왼쪽은 클라이언트가 적어 보낼 수 있다. 우리 프록시가 덧붙인 값은 오른쪽 끝이다.
    expect(clientIp({ ...socket, forwardedFor: '1.1.1.1, 2.2.2.2, 3.3.3.3' }, true)).toBe('3.3.3.3');
  });

  it('헤더가 배열로 와도 다룬다', () => {
    expect(clientIp({ ...socket, forwardedFor: ['1.1.1.1', '2.2.2.2'] }, true)).toBe('2.2.2.2');
  });

  it('믿기로 했는데 헤더가 없으면 소켓으로 떨어진다', () => {
    expect(clientIp(socket, true)).toBe('10.0.0.1');
  });

  it('아무것도 없으면 null이다', () => {
    // "unknown" 하나로 몰면 그 통이 금방 차서 모든 사용자를 잠근다.
    expect(clientIp({ socketAddress: null }, true)).toBeNull();
    expect(clientIp({ socketAddress: '   ' }, false)).toBeNull();
  });

  it('빈 헤더 값은 건너뛴다', () => {
    expect(clientIp({ ...socket, forwardedFor: ' , , ' }, true)).toBe('10.0.0.1');
  });
});
