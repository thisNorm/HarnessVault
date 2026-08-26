/**
 * 로그인 시도 제한의 판정부. DB 접근 없이 순수하게 계산한다.
 *
 * 하드 잠금(관리자 해제 필요)을 두지 않는 것이 설계의 축이다 —
 * 그러면 공격자가 남의 계정을 일부러 잠가 서비스 거부를 만들 수 있다.
 * 시간이 지나면 스스로 풀린다.
 */

export interface AttemptRecord {
  failedCount: number;
  lockedUntil: Date | null;
  lastFailedAt: Date;
}

export interface ThrottlePolicy {
  maxAttempts: number;
  lockoutMinutes: number;
}

/** 잠겨 있으면 남은 초를 준다. 아니면 null이다. */
export function lockRemainingSeconds(
  record: AttemptRecord | null,
  now: Date,
): number | null {
  if (!record?.lockedUntil) return null;
  const remaining = record.lockedUntil.getTime() - now.getTime();
  if (remaining <= 0) return null;
  return Math.ceil(remaining / 1000);
}

/**
 * 실패 하나를 반영한 다음 상태를 계산한다.
 *
 * 마지막 실패로부터 잠금 시간이 지났으면 카운터를 새로 시작한다.
 * 그러지 않으면 몇 달에 걸쳐 오타 10번을 낸 사람이 잠긴다.
 */
export function nextAfterFailure(
  record: AttemptRecord | null,
  policy: ThrottlePolicy,
  now: Date,
): AttemptRecord {
  const windowMs = policy.lockoutMinutes * 60_000;
  const stale = record !== null && now.getTime() - record.lastFailedAt.getTime() >= windowMs;
  const failedCount = record === null || stale ? 1 : record.failedCount + 1;

  return {
    failedCount,
    lockedUntil:
      failedCount >= policy.maxAttempts ? new Date(now.getTime() + windowMs) : null,
    lastFailedAt: now,
  };
}

/**
 * 키는 제출된 이메일 문자열이다. 사용자 id가 아니다 —
 * 존재하지 않는 계정도 똑같이 세어야 잠기는지 여부로 계정 존재가 새어 나가지 않는다.
 */
export function throttleKey(email: string): string {
  return `email:${email.trim().toLowerCase()}`;
}

/**
 * IP 축은 **실패 횟수가 아니라 서로 다른 계정 수**를 센다.
 *
 * 횟수로 세면 NAT 뒤 사무실 20명의 정상 오타와 스프레이 공격이 같은 숫자로 보인다.
 * 임계를 낮추면 사무실 전체가 잠기고 높이면 느긋한 공격자를 놓친다 —
 * 어떤 임계값으로도 두 목표가 양립하지 않는다.
 *
 * 계정 수로 세면 갈린다. 사무실은 각자 자기 계정에서만 실패하므로 인원수에서 멈추고,
 * 스프레이는 계정을 훑는 것이 목적이라 끝없이 늘어난다.
 *
 * (ip, email) 쌍마다 한 줄을 만들고 창 안의 줄 수를 센다.
 */
export function ipPairKey(ip: string, email: string): string {
  return `${ipPrefix(ip)}${email.trim().toLowerCase()}`;
}

/** 같은 IP의 쌍을 한 번에 세기 위한 접두사. */
export function ipPrefix(ip: string): string {
  return `ip:${ip.trim()}|`;
}

/**
 * 요청에서 클라이언트 IP를 뽑는다.
 *
 * `X-Forwarded-For`는 누구나 위조할 수 있다. 프록시가 없는데 믿으면
 * 공격자가 요청마다 다른 IP를 적어 제한을 무력화한다. 그래서 `trustProxy`가
 * 명시적으로 켜졌을 때만 헤더를 본다.
 *
 * 헤더를 볼 때는 **가장 오른쪽** 값을 쓴다. 왼쪽은 클라이언트가 직접 적어 보낼 수 있고,
 * 우리 프록시가 덧붙인 값은 오른쪽 끝에 있다.
 *
 * 알 수 없으면 `null`이다. 모르는 것을 "unknown" 하나에 몰면
 * 그 통이 금방 차서 모든 사용자를 잠근다.
 */
export function clientIp(
  input: { forwardedFor?: string | string[]; socketAddress?: string | null },
  trustProxy: boolean,
): string | null {
  if (trustProxy) {
    const raw = Array.isArray(input.forwardedFor)
      ? input.forwardedFor.join(',')
      : (input.forwardedFor ?? '');
    const hops = raw
      .split(',')
      .map((hop) => hop.trim())
      .filter(Boolean);
    const nearest = hops[hops.length - 1];
    if (nearest) return nearest;
  }
  const socket = input.socketAddress?.trim();
  return socket ? socket : null;
}
