import { Injectable, Logger } from '@nestjs/common';
import {
  mockVerdict,
  parseCuratorVerdict,
  type CuratorProvider,
  type CuratorRoundResult,
  type SimilarCandidate,
} from '@harnessvault/domain';
import { getEnv } from '../env';

export interface CuratorPrompt {
  round: number;
  maxRounds: number;
  contribution: {
    type: string;
    key: string;
    name: string;
    description: string;
    summary: string;
    rationale: string;
    /** 라운드가 오를 때만 채워진다(§21 점진적 공개). */
    content: string | null;
  };
  candidates: Array<{
    key: string;
    name: string;
    type: string;
    score: number;
    /** 라운드가 오를 때만 채워진다. */
    body: string | null;
    relations: string[] | null;
  }>;
}

/**
 * Curator 모델 접점. 구현은 둘이다 —
 * 모델 없이 배선을 검증하는 대역과, 실제 로컬 모델.
 */
export interface CuratorModelProvider {
  readonly kind: CuratorProvider;
  readonly model: string;
  review(prompt: CuratorPrompt): Promise<CuratorRoundResult>;
}

/** 실패를 성공으로 대체하지 않는다. 어느 코드로 실패했는지 호출자가 알아야 한다. */
export class CuratorUnavailableError extends Error {
  readonly code = 'CURATOR_UNAVAILABLE';
}

const SYSTEM_PROMPT = [
  '너는 사내 지식 저장소의 큐레이터다. 새로 제출된 지식이 기존 자산과 어떤 관계인지 판정한다.',
  '',
  '반드시 아래 JSON 하나만 출력한다. 설명·코드펜스·다른 텍스트를 붙이지 않는다.',
  '{"verdict":"...","relatedAssetKey":null,"confidence":0.0,"reasoning":"...","suggestedValidations":[],"needMoreContext":false}',
  '',
  'verdict는 다음 중 하나다.',
  '- DUPLICATE: 기존 자산과 사실상 같은 내용',
  '- VARIANT_OF: 같은 능력인데 적용 조건만 다름',
  '- IMPROVEMENT_ON: 기존 자산을 개선·보완한 것',
  '- CONFLICTS_WITH: 기존 자산과 상충해 사람이 반드시 봐야 하는 것',
  '- NEW: 기존에 없던 지식',
  '- UNKNOWN: 주어진 정보로 판단할 수 없음',
  '',
  '모르면 UNKNOWN을 낸다. 지어내지 않는다.',
  'relatedAssetKey는 후보 목록에 실제로 있는 key만 쓴다. 없으면 null이다.',
  'reasoning은 한국어 두 문장 이내로 쓴다.',
  'suggestedValidations는 이 지식을 검증할 절차 제안이다. 없으면 빈 배열이다.',
  '컨텍스트가 부족해 더 봐야겠으면 needMoreContext를 true로 낸다.',
].join('\n');

function renderPrompt(prompt: CuratorPrompt): string {
  const lines: string[] = [
    `라운드 ${prompt.round}/${prompt.maxRounds}`,
    '',
    '## 제출된 지식',
    `- type: ${prompt.contribution.type}`,
    `- key: ${prompt.contribution.key}`,
    `- 이름: ${prompt.contribution.name}`,
    `- 설명: ${prompt.contribution.description || '(없음)'}`,
    `- 요약: ${prompt.contribution.summary || '(없음)'}`,
    `- 제출 이유: ${prompt.contribution.rationale || '(없음)'}`,
  ];
  if (prompt.contribution.content) {
    lines.push('', '### 본문', prompt.contribution.content);
  }

  lines.push('', '## 기존 자산 후보');
  if (prompt.candidates.length === 0) {
    lines.push('(없음)');
  } else {
    for (const candidate of prompt.candidates) {
      lines.push(
        '',
        `### ${candidate.key} — ${candidate.name}`,
        `- type: ${candidate.type} / 유사도: ${candidate.score}`,
      );
      if (candidate.body) lines.push('', candidate.body);
      if (candidate.relations?.length) lines.push('', `관계: ${candidate.relations.join(', ')}`);
    }
  }
  return lines.join('\n');
}

/**
 * 모델 없이 결정론적으로 답한다.
 *
 * 지우지 않는 이유는 모델 없이도 배선과 상태 전이를 검증해야 하기 때문이지
 * 모델을 대신하기 위해서가 아니다. 결과에는 항상 `provider: 'MOCK'`이 따라붙는다(§72).
 */
@Injectable()
export class MockCuratorProvider implements CuratorModelProvider {
  readonly kind = 'MOCK' as const;
  readonly model = 'none';

  private candidates: SimilarCandidate[] = [];

  /** 유사도 점수만 본다. 서비스가 후보를 넣어 준다. */
  withCandidates(candidates: SimilarCandidate[]): this {
    this.candidates = candidates;
    return this;
  }

  review(): Promise<CuratorRoundResult> {
    return Promise.resolve(mockVerdict(this.candidates));
  }
}

/** Ollama `/api/chat`. `CURATOR_URL`이 있을 때만 쓴다. */
@Injectable()
export class OllamaCuratorProvider implements CuratorModelProvider {
  private readonly logger = new Logger(OllamaCuratorProvider.name);
  readonly kind = 'OLLAMA' as const;

  get model(): string {
    return getEnv().CURATOR_MODEL;
  }

  async review(prompt: CuratorPrompt): Promise<CuratorRoundResult> {
    const env = getEnv();
    if (!env.CURATOR_URL) {
      throw new CuratorUnavailableError('CURATOR_URL이 설정되지 않았습니다');
    }

    let response: Response;
    try {
      response = await fetch(env.CURATOR_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: env.CURATOR_MODEL,
          stream: false,
          // JSON을 강제한다. 그래도 코드펜스가 섞여 나오는 모델이 있어 파서가 관대하다.
          format: 'json',
          // 큐레이션은 창의성이 필요한 일이 아니다. 같은 입력에 같은 답이 나오는 편이 낫다.
          options: { temperature: 0 },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: renderPrompt(prompt) },
          ],
        }),
        signal: AbortSignal.timeout(env.CURATOR_TIMEOUT_MS),
      });
    } catch (error) {
      throw new CuratorUnavailableError(
        `Curator 모델에 닿지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!response.ok) {
      throw new CuratorUnavailableError(`Curator 모델 응답 ${response.status}`);
    }

    const body = (await response.json()) as { message?: { content?: string } };
    const raw = body.message?.content ?? '';
    const parsed = parseCuratorVerdict(raw);
    if (!parsed) {
      // 못 읽은 것을 추측으로 메우지 않는다. 판단하지 못했다고 말한다.
      this.logger.warn(`Curator 출력을 판정으로 읽지 못했습니다 (${raw.length}자)`);
      return {
        verdict: 'UNKNOWN',
        relatedAssetKey: null,
        confidence: 0,
        reasoning: '모델 출력을 판정으로 읽지 못했습니다.',
        suggestedValidations: [],
        needMoreContext: false,
      };
    }
    return parsed;
  }
}
