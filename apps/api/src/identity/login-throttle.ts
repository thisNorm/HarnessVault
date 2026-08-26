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
  return email.trim().toLowerCase();
}
