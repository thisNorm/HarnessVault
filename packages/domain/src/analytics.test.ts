import { describe, expect, it } from 'vitest';
import { averageOf, safeRatio, topBuckets } from './analytics';

describe('safeRatio', () => {
  it('분모가 0이면 null이다 — 0%로 표시하면 거짓이다', () => {
    expect(safeRatio(0, 0)).toBeNull();
    expect(safeRatio(5, 0)).toBeNull();
  });

  it('정상 비율을 낸다', () => {
    expect(safeRatio(1, 4)).toBe(0.25);
  });

  it('전부 실패한 것과 분모 없음을 구분한다', () => {
    // 0을 돌려주면 이 둘이 같아 보인다.
    expect(safeRatio(0, 10)).toBe(0);
    expect(safeRatio(0, 0)).toBeNull();
  });
});

describe('averageOf', () => {
  it('null을 0으로 치환하지 않는다', () => {
    // 0으로 치면 평균이 2.5로 조용히 낮아진다(§40).
    const result = averageOf([5, null, 5, null]);
    expect(result.value).toBe(5);
  });

  it('몇 건이 들어갔는지 함께 낸다', () => {
    const result = averageOf([5, null, 5, null]);
    expect(result.sampleSize).toBe(2);
    expect(result.totalCandidates).toBe(4);
  });

  it('전부 모르면 null이다', () => {
    const result = averageOf([null, undefined]);
    expect(result.value).toBeNull();
    expect(result.sampleSize).toBe(0);
  });

  it('빈 배열도 null이다', () => {
    expect(averageOf([]).value).toBeNull();
  });

  it('0은 유효한 값이다 — 모른다와 다르다', () => {
    expect(averageOf([0, 0]).value).toBe(0);
    expect(averageOf([0, 0]).sampleSize).toBe(2);
  });
});

describe('topBuckets', () => {
  const bucket = (key: string, count: number) => ({ key, label: key, count });

  it('많은 순으로 정렬한다', () => {
    const result = topBuckets([bucket('a', 1), bucket('b', 3)], 10);
    expect(result.map((item) => item.key)).toEqual(['b', 'a']);
  });

  it('동점은 key로 갈라 결정론을 지킨다', () => {
    const result = topBuckets([bucket('z', 2), bucket('a', 2)], 10);
    expect(result.map((item) => item.key)).toEqual(['a', 'z']);
  });

  it('limit을 넘기지 않는다', () => {
    expect(topBuckets([bucket('a', 1), bucket('b', 2), bucket('c', 3)], 2)).toHaveLength(2);
  });

  it('원본을 건드리지 않는다', () => {
    const input = [bucket('a', 1), bucket('b', 3)];
    topBuckets(input, 10);
    expect(input[0]?.key).toBe('a');
  });
});
