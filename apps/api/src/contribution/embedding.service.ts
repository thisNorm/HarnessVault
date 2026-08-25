import { Injectable, Logger } from '@nestjs/common';
import { EMBEDDING_DIMENSIONS, type EmbeddingStatus } from '@harnessvault/domain';
import { getEnv } from '../env';

export interface EmbeddingResult {
  vector: number[] | null;
  status: EmbeddingStatus;
}

/**
 * Ollama 호환 `/api/embed`를 부른다.
 *
 * **선택 기능이다.** `EMBEDDING_URL`이 없으면 임베딩을 만들지 않고
 * 시스템 전체는 어휘 기반으로 동작한다. 여기서 나는 장애가 기여 경로를 닫지 않는다 —
 * 부가 기능의 실패가 본 경로를 막으면 사용자는 지식을 남길 곳을 잃는다.
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  get configured(): boolean {
    return Boolean(getEnv().EMBEDDING_URL);
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const env = getEnv();
    if (!env.EMBEDDING_URL) return { vector: null, status: 'NOT_CONFIGURED' };

    const trimmed = text.trim();
    if (trimmed.length === 0) return { vector: null, status: 'FAILED' };

    try {
      const response = await fetch(env.EMBEDDING_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: env.EMBEDDING_MODEL, input: trimmed }),
        signal: AbortSignal.timeout(env.EMBEDDING_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(`임베딩 제공자 응답 ${response.status} — 어휘 기반으로 진행합니다`);
        return { vector: null, status: 'FAILED' };
      }

      const body = (await response.json()) as { embeddings?: number[][]; embedding?: number[] };
      // Ollama는 /api/embed에서 embeddings[], 구버전 /api/embeddings에서 embedding을 준다.
      const vector = body.embeddings?.[0] ?? body.embedding ?? null;
      if (!Array.isArray(vector) || vector.length === 0) {
        this.logger.warn('임베딩 응답에 벡터가 없습니다 — 어휘 기반으로 진행합니다');
        return { vector: null, status: 'FAILED' };
      }

      // 차원이 다르면 잘라 넣지 않는다. 유사도가 조용히 망가지는 것보다 안 쓰는 편이 낫다.
      if (vector.length !== EMBEDDING_DIMENSIONS) {
        this.logger.error(
          `임베딩 차원 불일치: 모델 ${vector.length} ≠ 스키마 ${EMBEDDING_DIMENSIONS}. ` +
            `EMBEDDING_MODEL을 ${EMBEDDING_DIMENSIONS}차원 모델로 바꾸거나 마이그레이션이 필요합니다`,
        );
        return { vector: null, status: 'FAILED' };
      }

      return { vector, status: 'OK' };
    } catch (error) {
      this.logger.warn(
        `임베딩 생성 실패 — 어휘 기반으로 진행합니다: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { vector: null, status: 'FAILED' };
    }
  }

  /** 자산·기여를 같은 방식으로 문자열화한다. 양쪽이 어긋나면 유사도가 의미를 잃는다. */
  static describe(input: {
    key: string;
    name: string;
    description: string;
    summary?: string;
  }): string {
    return [input.key, input.name, input.description, input.summary ?? ''].join('\n').trim();
  }
}
