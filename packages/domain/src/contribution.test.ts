import { describe, expect, it } from 'vitest';
import {
  canTransitionContribution,
  classifyDuplicates,
  cosineSimilarity,
  nextVersionLabel,
} from './contribution';

describe('canTransitionContribution', () => {
  it('CANDIDATE에서만 나갈 수 있다', () => {
    expect(canTransitionContribution('CANDIDATE', 'PROMOTED')).toBe(true);
    expect(canTransitionContribution('CANDIDATE', 'REJECTED')).toBe(true);
    expect(canTransitionContribution('CANDIDATE', 'WITHDRAWN')).toBe(true);
  });

  it('터미널 상태는 되돌릴 수 없다', () => {
    expect(canTransitionContribution('PROMOTED', 'REJECTED')).toBe(false);
    expect(canTransitionContribution('REJECTED', 'PROMOTED')).toBe(false);
    expect(canTransitionContribution('WITHDRAWN', 'CANDIDATE')).toBe(false);
  });
});

describe('cosineSimilarity', () => {
  it('같은 벡터는 1이다', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBe(1);
  });

  it('직교하면 0이다', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('영벡터는 0이다 — 나눗셈을 하지 않는다', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it('차원이 다르면 0이 아니라 예외다', () => {
    // 조용히 0을 주면 모델 교체 사고가 "닮은 게 없다"로 위장된다.
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow('벡터 차원이 다릅니다');
  });

  it('1을 넘지 않는다', () => {
    const vector = Array.from({ length: 100 }, (_, i) => i * 0.37);
    expect(cosineSimilarity(vector, vector)).toBeLessThanOrEqual(1);
  });
});

describe('classifyDuplicates', () => {
  const asset = (key: string, score: number) => ({ assetId: key, key, name: key, score });

  it('임계값 이상이면 중복 후보로 표시한다', () => {
    expect(classifyDuplicates([asset('a', 0.9)])[0]?.relationHint).toBe('DUPLICATE_CANDIDATE');
  });

  it('그 아래는 관련으로만 본다', () => {
    expect(classifyDuplicates([asset('a', 0.5)])[0]?.relationHint).toBe('RELATED');
  });

  it('소음 임계값 미만은 아예 내보내지 않는다', () => {
    expect(classifyDuplicates([asset('a', 0.05)])).toHaveLength(0);
  });

  it('점수 내림차순, 동점은 key로 정렬한다', () => {
    const result = classifyDuplicates([asset('b', 0.5), asset('a', 0.5), asset('c', 0.9)]);
    expect(result.map((item) => item.key)).toEqual(['c', 'a', 'b']);
  });

  it('limit을 넘기지 않는다', () => {
    const many = Array.from({ length: 20 }, (_, i) => asset(`k${i}`, 0.5));
    expect(classifyDuplicates(many, 3)).toHaveLength(3);
  });
});

describe('nextVersionLabel', () => {
  it('비어 있으면 1.0.0이다', () => {
    expect(nextVersionLabel([])).toBe('1.0.0');
  });

  it('가장 큰 major 다음이다', () => {
    expect(nextVersionLabel(['1.0.0', '2.0.0', '1.3.0'])).toBe('3.0.0');
  });

  it('semver가 아닌 라벨은 무시한다', () => {
    // 손으로 붙인 이름을 근거로 증가시키면 예측할 수 없는 버전이 나온다.
    expect(nextVersionLabel(['draft', '1.0.0'])).toBe('2.0.0');
  });

  it('숫자 정렬이다 — 문자열 정렬이 아니다', () => {
    expect(nextVersionLabel(['9.0.0', '10.0.0'])).toBe('11.0.0');
  });
});
