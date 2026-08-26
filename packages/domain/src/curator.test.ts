import { describe, expect, it } from 'vitest';
import {
  assessComplexity,
  contextLevelForRound,
  maxRounds,
  mockVerdict,
  parseCuratorVerdict,
} from './curator';

const candidate = (score: number, key = 'k') => ({
  assetId: key,
  key,
  name: key,
  score,
  relationHint: score >= 0.75 ? ('DUPLICATE_CANDIDATE' as const) : ('RELATED' as const),
});

describe('assessComplexity', () => {
  it('비슷한 게 없으면 LOW다', () => {
    expect(assessComplexity([])).toBe('LOW');
  });

  it('하나가 압도적으로 명백하면 LOW다', () => {
    expect(assessComplexity([candidate(0.95)])).toBe('LOW');
  });

  it('애매한 하나는 MEDIUM이다', () => {
    expect(assessComplexity([candidate(0.5)])).toBe('MEDIUM');
  });

  it('후보가 넷 이상이면 HIGH다', () => {
    expect(assessComplexity([0.5, 0.4, 0.3, 0.2].map((s, i) => candidate(s, `k${i}`)))).toBe('HIGH');
  });

  it('점수는 높은데 타입이 다르면 HIGH다', () => {
    // 신호가 엇갈린 것이다. 얕게 보면 틀린다.
    expect(assessComplexity([candidate(0.95)], { hasTypeMismatch: true })).toBe('HIGH');
  });
});

describe('maxRounds', () => {
  it('명세의 최대 3라운드를 넘지 않는다', () => {
    expect(maxRounds('LOW')).toBe(1);
    expect(maxRounds('MEDIUM')).toBe(2);
    expect(maxRounds('HIGH')).toBe(3);
  });
});

describe('contextLevelForRound', () => {
  it('라운드가 돌수록 컨텍스트를 더 준다', () => {
    expect(contextLevelForRound(1)).toBe(1);
    expect(contextLevelForRound(2)).toBe(2);
    expect(contextLevelForRound(3)).toBe(3);
  });

  it('한도를 넘겨 물어도 3을 넘지 않는다', () => {
    expect(contextLevelForRound(9)).toBe(3);
  });
});

describe('parseCuratorVerdict', () => {
  const body = {
    verdict: 'DUPLICATE',
    relatedAssetKey: 'db.pool',
    confidence: 0.9,
    reasoning: '같은 내용입니다',
    suggestedValidations: [],
    needMoreContext: false,
  };

  it('맨 JSON을 읽는다', () => {
    expect(parseCuratorVerdict(JSON.stringify(body))?.verdict).toBe('DUPLICATE');
  });

  it('코드펜스로 감싸도 읽는다', () => {
    const raw = '```json\n' + JSON.stringify(body) + '\n```';
    expect(parseCuratorVerdict(raw)?.verdict).toBe('DUPLICATE');
  });

  it('앞뒤 잡담이 붙어도 읽는다', () => {
    const raw = `분석해보겠습니다.\n${JSON.stringify(body)}\n이상입니다.`;
    expect(parseCuratorVerdict(raw)?.relatedAssetKey).toBe('db.pool');
  });

  it('빠진 필드는 기본값으로 채운다', () => {
    const result = parseCuratorVerdict('{"verdict":"NEW"}');
    expect(result?.confidence).toBe(0);
    expect(result?.suggestedValidations).toEqual([]);
    expect(result?.needMoreContext).toBe(false);
  });

  it('모르는 판정은 받지 않는다', () => {
    expect(parseCuratorVerdict('{"verdict":"PROBABLY_FINE"}')).toBeNull();
  });

  it('JSON이 아니면 null이다 — 추측하지 않는다', () => {
    // 지어낸 판정이 사람 판단의 근거가 되면 안 된다.
    expect(parseCuratorVerdict('아마 중복인 것 같습니다')).toBeNull();
  });

  it('빈 문자열도 null이다', () => {
    expect(parseCuratorVerdict('')).toBeNull();
  });

  it('confidence 범위를 벗어나면 받지 않는다', () => {
    expect(parseCuratorVerdict('{"verdict":"NEW","confidence":1.5}')).toBeNull();
  });
});

describe('mockVerdict', () => {
  it('모델 결과가 아님을 이유에 밝힌다', () => {
    // Mock이 성공인 척하면 안 된다(§72).
    expect(mockVerdict([]).reasoning).toContain('모델이 판단한 것이 아니라');
    expect(mockVerdict([candidate(0.9)]).reasoning).toContain('모델이 판단한 것이 아니라');
  });

  it('비슷한 게 없으면 NEW다', () => {
    expect(mockVerdict([]).verdict).toBe('NEW');
  });

  it('임계값을 넘으면 DUPLICATE다', () => {
    expect(mockVerdict([candidate(0.8)]).verdict).toBe('DUPLICATE');
  });

  it('그 아래는 IMPROVEMENT_ON이다', () => {
    expect(mockVerdict([candidate(0.4)]).verdict).toBe('IMPROVEMENT_ON');
  });

  it('라운드를 더 요구하지 않는다', () => {
    expect(mockVerdict([candidate(0.4)]).needMoreContext).toBe(false);
  });
});
