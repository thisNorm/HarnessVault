import { describe, expect, it } from 'vitest';
import {
  canTransitionApproval,
  isExecutable,
  isTerminal,
  type ApprovalStatus,
} from '@harnessvault/domain';
import {
  type ResolvedApproverSpec,
  effectiveStatus,
  evaluateSatisfaction,
  isEligibleApprover,
} from './satisfy';

function spec(index: number, userIds: string[], label = `spec-${index}`): ResolvedApproverSpec {
  return { specIndex: index, kind: 'GROUP', label, userIds };
}

/* ================= §65 필수 전이 ================= */

describe('§65 — PENDING → APPROVED → EXECUTING → EXECUTED', () => {
  it('전 구간이 허용된다', () => {
    expect(canTransitionApproval('PENDING', 'APPROVED')).toBe(true);
    expect(canTransitionApproval('APPROVED', 'EXECUTING')).toBe(true);
    expect(canTransitionApproval('EXECUTING', 'EXECUTED')).toBe(true);
  });
});

describe('§65 — PENDING → REJECTED → EXECUTED 불가', () => {
  it('거부는 가능하다', () => {
    expect(canTransitionApproval('PENDING', 'REJECTED')).toBe(true);
  });

  it('거부된 요청은 실행할 수 없다', () => {
    expect(canTransitionApproval('REJECTED', 'EXECUTED')).toBe(false);
    expect(canTransitionApproval('REJECTED', 'EXECUTING')).toBe(false);
    expect(canTransitionApproval('REJECTED', 'APPROVED')).toBe(false);
  });
});

describe('§65 — EXPIRED → APPROVED 불가', () => {
  it('만료된 요청은 승인할 수 없다', () => {
    expect(canTransitionApproval('EXPIRED', 'APPROVED')).toBe(false);
    expect(canTransitionApproval('EXPIRED', 'EXECUTING')).toBe(false);
  });

  it('FAILED도 되살릴 수 없다', () => {
    expect(canTransitionApproval('FAILED', 'APPROVED')).toBe(false);
    expect(canTransitionApproval('FAILED', 'EXECUTING')).toBe(false);
  });
});

describe('상태 기계 전반', () => {
  it('종료 상태에서 나가는 전이가 없다', () => {
    for (const status of ['EXECUTED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'FAILED'] as const) {
      expect(isTerminal(status), status).toBe(true);
    }
  });

  it('PENDING·APPROVED·EXECUTING은 종료 상태가 아니다', () => {
    for (const status of ['PENDING', 'APPROVED', 'EXECUTING'] as const) {
      expect(isTerminal(status), status).toBe(false);
    }
  });

  it('실행 가능한 상태는 APPROVED뿐이다', () => {
    const all: ApprovalStatus[] = [
      'PENDING',
      'APPROVED',
      'REJECTED',
      'EXPIRED',
      'CANCELLED',
      'EXECUTING',
      'EXECUTED',
      'FAILED',
    ];
    expect(all.filter(isExecutable)).toEqual(['APPROVED']);
  });

  it('PENDING에서 바로 EXECUTED로 갈 수 없다', () => {
    expect(canTransitionApproval('PENDING', 'EXECUTED')).toBe(false);
    expect(canTransitionApproval('PENDING', 'EXECUTING')).toBe(false);
  });

  it('EXECUTING은 되돌릴 수 없다', () => {
    // 실행이 이미 일부 반영됐을 수 있다.
    expect(canTransitionApproval('EXECUTING', 'PENDING')).toBe(false);
    expect(canTransitionApproval('EXECUTING', 'APPROVED')).toBe(false);
  });
});

/* ================= 성립 판정 ================= */

describe('ANY_OF', () => {
  const specs = [spec(0, ['lead']), spec(1, ['dba-a', 'dba-b'])];

  it('아무도 승인하지 않으면 PENDING', () => {
    expect(evaluateSatisfaction('ANY_OF', null, specs, []).status).toBe('PENDING');
  });

  it('한 명만 승인해도 APPROVED', () => {
    expect(
      evaluateSatisfaction('ANY_OF', null, specs, [{ userId: 'dba-a', decision: 'APPROVE' }]).status,
    ).toBe('APPROVED');
  });

  it('자격 없는 사람의 승인은 성립시키지 않는다', () => {
    expect(
      evaluateSatisfaction('ANY_OF', null, specs, [{ userId: 'stranger', decision: 'APPROVE' }])
        .status,
    ).toBe('PENDING');
  });
});

describe('ALL_OF', () => {
  const specs = [spec(0, ['lead']), spec(1, ['dba-a', 'dba-b'])];

  it('한 축만 승인하면 여전히 PENDING', () => {
    const result = evaluateSatisfaction('ALL_OF', null, specs, [
      { userId: 'lead', decision: 'APPROVE' },
    ]);
    expect(result.status).toBe('PENDING');
    if (result.status !== 'PENDING') return;
    expect(result.satisfiedSpecs).toEqual([0]);
  });

  it('각 축에서 한 명씩이면 APPROVED', () => {
    expect(
      evaluateSatisfaction('ALL_OF', null, specs, [
        { userId: 'lead', decision: 'APPROVE' },
        { userId: 'dba-b', decision: 'APPROVE' },
      ]).status,
    ).toBe('APPROVED');
  });

  it('한 축의 전원을 요구하지 않는다', () => {
    // "DB Admin 전원"이 아니라 "각 축에서 한 명씩"이 의도다(§31 예시).
    const result = evaluateSatisfaction('ALL_OF', null, specs, [
      { userId: 'lead', decision: 'APPROVE' },
      { userId: 'dba-a', decision: 'APPROVE' },
    ]);
    expect(result.status).toBe('APPROVED');
  });
});

describe('N_OF_M', () => {
  const specs = [spec(0, ['a', 'b', 'c', 'd'])];

  it('필요 수에 못 미치면 PENDING', () => {
    expect(
      evaluateSatisfaction('N_OF_M', 2, specs, [{ userId: 'a', decision: 'APPROVE' }]).status,
    ).toBe('PENDING');
  });

  it('필요 수를 채우면 APPROVED', () => {
    expect(
      evaluateSatisfaction('N_OF_M', 2, specs, [
        { userId: 'a', decision: 'APPROVE' },
        { userId: 'b', decision: 'APPROVE' },
      ]).status,
    ).toBe('APPROVED');
  });

  it('같은 사람이 여러 번 승인해도 한 번으로 센다', () => {
    expect(
      evaluateSatisfaction('N_OF_M', 2, specs, [
        { userId: 'a', decision: 'APPROVE' },
        { userId: 'a', decision: 'APPROVE' },
      ]).status,
    ).toBe('PENDING');
  });
});

describe('거부는 즉시 확정된다', () => {
  const specs = [spec(0, ['a', 'b', 'c'])];

  it('승인이 많아도 거부 한 건이 이긴다', () => {
    const result = evaluateSatisfaction('N_OF_M', 2, specs, [
      { userId: 'a', decision: 'APPROVE' },
      { userId: 'b', decision: 'APPROVE' },
      { userId: 'c', decision: 'REJECT' },
    ]);
    expect(result.status).toBe('REJECTED');
    if (result.status !== 'REJECTED') return;
    expect(result.rejectedBy).toBe('c');
  });

  it('mode와 무관하다', () => {
    for (const mode of ['ANY_OF', 'ALL_OF', 'N_OF_M'] as const) {
      expect(
        evaluateSatisfaction(mode, 1, specs, [{ userId: 'a', decision: 'REJECT' }]).status,
        mode,
      ).toBe('REJECTED');
    }
  });
});

describe('승인 자격', () => {
  const specs = [spec(0, ['lead']), spec(1, ['dba-a'])];

  it('해석된 승인자면 자격이 있다', () => {
    expect(isEligibleApprover(specs, 'lead')).toBe(true);
    expect(isEligibleApprover(specs, 'dba-a')).toBe(true);
  });

  it('그 밖의 사람은 자격이 없다', () => {
    expect(isEligibleApprover(specs, 'stranger')).toBe(false);
  });

  it('승인자가 아무도 해석되지 않으면 누구도 자격이 없다', () => {
    expect(isEligibleApprover([spec(0, [])], 'anyone')).toBe(false);
  });
});

describe('만료는 조회 시점에 계산한다', () => {
  const now = new Date('2026-08-25T12:00:00Z');

  it('만료 시각이 지난 PENDING은 EXPIRED로 본다', () => {
    // 배치가 안 돌아 PENDING으로 남은 요청이 나중에 승인되는 일을 막는다.
    expect(effectiveStatus('PENDING', new Date('2026-08-25T11:59:59Z'), now)).toBe('EXPIRED');
  });

  it('APPROVED도 만료된다', () => {
    expect(effectiveStatus('APPROVED', new Date('2026-08-25T11:00:00Z'), now)).toBe('EXPIRED');
  });

  it('만료 전이면 그대로다', () => {
    expect(effectiveStatus('PENDING', new Date('2026-08-25T13:00:00Z'), now)).toBe('PENDING');
  });

  it('만료 시각이 없으면 그대로다', () => {
    expect(effectiveStatus('PENDING', null, now)).toBe('PENDING');
  });

  it('이미 끝난 상태는 만료로 덮지 않는다', () => {
    // 실행까지 끝난 요청을 나중에 EXPIRED로 보이게 하면 기록이 왜곡된다.
    expect(effectiveStatus('EXECUTED', new Date('2026-08-25T11:00:00Z'), now)).toBe('EXECUTED');
    expect(effectiveStatus('REJECTED', new Date('2026-08-25T11:00:00Z'), now)).toBe('REJECTED');
  });
});
