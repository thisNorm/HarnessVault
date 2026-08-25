import type { ApprovalMode, ApprovalStatus, ApproverKind } from '@harnessvault/domain';

/**
 * 승인 성립 판정. IO가 없는 순수 함수다.
 * 누가 승인자인지 해석하는 것은 service가 DB에서 하고, 여기는 "성립했는가"만 본다.
 */

export interface ResolvedApproverSpec {
  /** 정책의 approver 항목 하나. ALL_OF는 항목마다 한 명씩을 요구한다. */
  specIndex: number;
  kind: ApproverKind;
  label: string;
  /** 이 항목으로 해석된 사용자들. */
  userIds: string[];
}

export interface RecordedDecision {
  userId: string;
  decision: 'APPROVE' | 'REJECT';
}

export type SatisfactionResult =
  | { status: 'PENDING'; satisfiedSpecs: number[]; approvedCount: number }
  | { status: 'APPROVED'; satisfiedSpecs: number[]; approvedCount: number }
  | { status: 'REJECTED'; rejectedBy: string };

/**
 * 한 명이라도 거부하면 mode와 무관하게 거부다.
 * 거부를 다수결로 덮을 수 있으면 승인 게이트의 의미가 없다.
 */
export function evaluateSatisfaction(
  mode: ApprovalMode,
  requiredCount: number | null,
  specs: readonly ResolvedApproverSpec[],
  decisions: readonly RecordedDecision[],
): SatisfactionResult {
  const rejection = decisions.find((decision) => decision.decision === 'REJECT');
  if (rejection) return { status: 'REJECTED', rejectedBy: rejection.userId };

  // 같은 사람이 여러 번 승인해도 한 번으로 센다.
  const approvers = new Set(
    decisions.filter((decision) => decision.decision === 'APPROVE').map((d) => d.userId),
  );

  const satisfiedSpecs = specs
    .filter((spec) => spec.userIds.some((userId) => approvers.has(userId)))
    .map((spec) => spec.specIndex);

  const approvedCount = approvers.size;

  switch (mode) {
    case 'ANY_OF':
      return satisfiedSpecs.length > 0
        ? { status: 'APPROVED', satisfiedSpecs, approvedCount }
        : { status: 'PENDING', satisfiedSpecs, approvedCount };

    case 'ALL_OF':
      // "모든 사람"이 아니라 "각 항목마다 최소 한 명"이다.
      // 명세 §31 예시가 project_role + group 조합이라 축마다 한 명이 의도다.
      return satisfiedSpecs.length === specs.length
        ? { status: 'APPROVED', satisfiedSpecs, approvedCount }
        : { status: 'PENDING', satisfiedSpecs, approvedCount };

    case 'N_OF_M': {
      const needed = requiredCount ?? 1;
      return approvedCount >= needed
        ? { status: 'APPROVED', satisfiedSpecs, approvedCount }
        : { status: 'PENDING', satisfiedSpecs, approvedCount };
    }
  }
}

/** 승인 자격이 있는 사용자인가. */
export function isEligibleApprover(
  specs: readonly ResolvedApproverSpec[],
  userId: string,
): boolean {
  return specs.some((spec) => spec.userIds.includes(userId));
}

/**
 * 만료를 조회 시점에 계산한다.
 * 배치가 돌지 않아 PENDING으로 남은 요청이 나중에 승인되는 일을 막는다.
 */
export function effectiveStatus(
  status: ApprovalStatus,
  expiresAt: Date | null,
  now: Date = new Date(),
): ApprovalStatus {
  if (status !== 'PENDING' && status !== 'APPROVED') return status;
  if (expiresAt && expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  return status;
}
