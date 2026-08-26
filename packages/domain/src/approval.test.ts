import { describe, expect, it } from 'vitest';
import { canTransitionApproval, executionBlockedCode, isExecutable, isTerminal } from './approval';

describe('canTransitionApproval', () => {
  it('PENDING에서만 판단할 수 있다', () => {
    expect(canTransitionApproval('PENDING', 'APPROVED')).toBe(true);
    expect(canTransitionApproval('PENDING', 'REJECTED')).toBe(true);
  });

  it('터미널 상태는 되돌릴 수 없다', () => {
    expect(canTransitionApproval('REJECTED', 'APPROVED')).toBe(false);
    expect(canTransitionApproval('EXECUTED', 'PENDING')).toBe(false);
  });
});

describe('isExecutable', () => {
  it('APPROVED만 실행할 수 있다 — 클라이언트 주장은 신뢰하지 않는다(§34)', () => {
    expect(isExecutable('APPROVED')).toBe(true);
    for (const status of ['PENDING', 'REJECTED', 'EXPIRED', 'EXECUTED'] as const) {
      expect(isExecutable(status)).toBe(false);
    }
  });
});

describe('isTerminal', () => {
  it('나갈 길이 없는 상태를 가린다', () => {
    expect(isTerminal('REJECTED')).toBe(true);
    expect(isTerminal('PENDING')).toBe(false);
  });
});
describe('executionBlockedCode', () => {
  it('거절과 만료와 대기를 구분한다', () => {
    // 하나로 뭉개면 에이전트가 다음에 무엇을 해야 하는지 알 수 없다.
    expect(executionBlockedCode('REJECTED')).toBe('APPROVAL_REJECTED');
    expect(executionBlockedCode('EXPIRED')).toBe('APPROVAL_EXPIRED');
    expect(executionBlockedCode('PENDING')).toBe('APPROVAL_REQUIRED');
  });

  it('실행 자격과 무관한 상태는 따로 묶는다', () => {
    for (const status of ['EXECUTING', 'EXECUTED', 'CANCELLED', 'FAILED'] as const) {
      expect(executionBlockedCode(status)).toBe('NOT_EXECUTABLE');
    }
  });

  it('세 코드가 서로 다르다', () => {
    const codes = ['REJECTED', 'EXPIRED', 'PENDING'].map((s) =>
      executionBlockedCode(s as never),
    );
    expect(new Set(codes).size).toBe(3);
  });
});
