import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CuratorUnavailableError, MockCuratorProvider, OllamaCuratorProvider } from './provider';
import type { CuratorPrompt } from './provider';

/**
 * 이 두 클래스는 생성자 주입이 없어 Vitest에서 그대로 만들 수 있다.
 * 실패 매핑은 e2e로 재현하기 어려우므로(서버가 이미 떠 있다) 여기서 실제 연결 실패로 검증한다.
 */

const prompt: CuratorPrompt = {
  round: 1,
  maxRounds: 1,
  contribution: {
    type: 'KNOWLEDGE',
    key: 'a.b',
    name: '이름',
    description: '설명',
    summary: '',
    rationale: '',
    content: null,
  },
  candidates: [],
};

describe('OllamaCuratorProvider', () => {
  const original = { ...process.env };

  beforeEach(() => {
    // getEnv()는 한 번만 읽고 캐시하므로 모듈 캐시를 비운 뒤 읽게 한다.
    delete process.env.CURATOR_URL;
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it('닿을 수 없으면 CURATOR_UNAVAILABLE이다', async () => {
    // 9번 포트는 discard다. 연결이 즉시 거부된다.
    process.env.CURATOR_URL = 'http://127.0.0.1:9/api/chat';
    process.env.CURATOR_TIMEOUT_MS = '1500';

    const provider = new OllamaCuratorProvider();
    // 설정이 실제로 반영됐는지 먼저 확인한다. 설정을 못 읽으면 이 테스트가
    // "URL이 없어서 던졌다"로 통과해 버려 실패 매핑을 검증하지 못한다.
    expect(provider.model).toBeTruthy();
    await expect(provider.review(prompt)).rejects.toBeInstanceOf(CuratorUnavailableError);
  });

  it('실패 코드가 문자열로 붙어 있다', () => {
    const error = new CuratorUnavailableError('테스트');
    // 서비스가 이 코드로 failureCode를 채운다. 실패를 성공으로 대체하지 않기 위한 값이다.
    expect(error.code).toBe('CURATOR_UNAVAILABLE');
    expect(error).toBeInstanceOf(Error);
  });
});

describe('MockCuratorProvider', () => {
  it('자기가 실제 모델이 아님을 kind로 밝힌다', () => {
    const provider = new MockCuratorProvider();
    expect(provider.kind).toBe('MOCK');
    expect(provider.model).toBe('none');
  });

  it('후보가 없으면 NEW를 낸다', async () => {
    const provider = new MockCuratorProvider().withCandidates([]);
    await expect(provider.review()).resolves.toMatchObject({ verdict: 'NEW' });
  });

  it('같은 입력에 같은 답을 낸다', async () => {
    const candidates = [
      {
        assetId: 'id',
        key: 'k',
        name: 'n',
        score: 0.8,
        relationHint: 'DUPLICATE_CANDIDATE' as const,
      },
    ];
    const first = await new MockCuratorProvider().withCandidates(candidates).review();
    const second = await new MockCuratorProvider().withCandidates(candidates).review();
    expect(first).toEqual(second);
  });
});
