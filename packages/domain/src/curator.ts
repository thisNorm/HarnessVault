import { z } from 'zod';
import { DUPLICATE_THRESHOLD, type SimilarCandidate } from './contribution';

/**
 * Curator 판정. 어떤 값도 자동으로 무엇을 하지 않는다 —
 * 검토자 화면에 표시될 뿐이다. Phase 11의 "자동 승격 없음"을 뒷문으로 무력화하지 않기 위해서다.
 */
export const curatorVerdicts = [
  'DUPLICATE',
  'VARIANT_OF',
  'IMPROVEMENT_ON',
  'CONFLICTS_WITH',
  'NEW',
  // 실패가 아니다. 모르는 것을 모른다고 하는 것이 지어내는 것보다 낫다.
  'UNKNOWN',
] as const;
export const curatorVerdictSchema = z.enum(curatorVerdicts);
export type CuratorVerdict = z.infer<typeof curatorVerdictSchema>;

export const curatorComplexities = ['LOW', 'MEDIUM', 'HIGH'] as const;
export const curatorComplexitySchema = z.enum(curatorComplexities);
export type CuratorComplexity = z.infer<typeof curatorComplexitySchema>;

/** 실제 모델이 판단했는지 배선 검증용 대역이 답했는지. 저장·표시 양쪽에 따라다닌다(§72). */
export const curatorProviders = ['MOCK', 'OLLAMA'] as const;
export const curatorProviderSchema = z.enum(curatorProviders);
export type CuratorProvider = z.infer<typeof curatorProviderSchema>;

export const curatorRunStatuses = ['SUCCEEDED', 'FAILED'] as const;
export const curatorRunStatusSchema = z.enum(curatorRunStatuses);
export type CuratorRunStatus = z.infer<typeof curatorRunStatusSchema>;

/** 모델이 한 라운드에서 돌려주는 것. 라운드를 더 원하면 needMoreContext를 켠다. */
export const curatorRoundResultSchema = z.object({
  verdict: curatorVerdictSchema,
  relatedAssetKey: z.string().max(200).nullable().default(null),
  confidence: z.number().min(0).max(1).default(0),
  reasoning: z.string().max(4000).default(''),
  suggestedValidations: z.array(z.string().max(300)).max(10).default([]),
  needMoreContext: z.boolean().default(false),
});
export type CuratorRoundResult = z.infer<typeof curatorRoundResultSchema>;

export interface CuratorRunView {
  id: string;
  contributionId: string;
  status: CuratorRunStatus;
  provider: CuratorProvider;
  model: string;
  complexity: CuratorComplexity;
  roundsUsed: number;
  verdict: CuratorVerdict | null;
  relatedAssetId: string | null;
  relatedAssetKey: string | null;
  confidence: number | null;
  reasoning: string;
  suggestedValidations: string[];
  failureCode: string | null;
  failureMessage: string;
  durationMs: number;
  createdAt: string;
}

/**
 * 복잡도는 입력에서 정한다. 모델에게 "이거 어려워?"를 물으면
 * 어려운 것을 어렵다고 답할 능력이 이미 있어야 한다는 순환이 생긴다.
 */
export function assessComplexity(
  candidates: readonly Pick<SimilarCandidate, 'score'>[],
  options: { hasTypeMismatch?: boolean } = {},
): CuratorComplexity {
  if (candidates.length === 0) return 'LOW';

  // 점수는 높은데 타입이 다르면 신호가 엇갈린 것이다. 얕게 보면 틀린다.
  if (options.hasTypeMismatch) return 'HIGH';
  if (candidates.length >= 4) return 'HIGH';

  const top = candidates[0];
  // 하나가 압도적으로 명백하면 길게 볼 이유가 없다.
  if (candidates.length === 1 && top && top.score >= 0.9) return 'LOW';

  return 'MEDIUM';
}

/** 복잡도가 라운드 예산을 정한다. 명세의 최대 3라운드를 넘지 않는다. */
export function maxRounds(complexity: CuratorComplexity): number {
  switch (complexity) {
    case 'LOW':
      return 1;
    case 'MEDIUM':
      return 2;
    case 'HIGH':
      return 3;
  }
}

/**
 * 라운드가 돌수록 컨텍스트를 더 준다(§21과 같은 태도).
 * 1라운드 요약 → 2라운드 본문 → 3라운드 관계까지.
 */
export function contextLevelForRound(round: number): 1 | 2 | 3 {
  if (round <= 1) return 1;
  if (round === 2) return 2;
  return 3;
}

/**
 * 모델 출력에서 판정을 꺼낸다. 코드펜스·앞뒤 설명이 섞여 나와도 견딘다.
 * **못 꺼내면 null이다. 추측하지 않는다** — 지어낸 판정이 사람 판단의 근거가 되면 안 된다.
 */
export function parseCuratorVerdict(raw: string): CuratorRoundResult | null {
  const candidates: string[] = [];

  // ```json ... ``` 형태를 먼저 꺼낸다. 모델이 습관적으로 감싸서 낸다.
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  if (fenced?.[1]) candidates.push(fenced[1]);

  // 중괄호 바깥의 잡담을 버린다.
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(raw.slice(first, last + 1));

  candidates.push(raw);

  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate.trim());
    } catch {
      continue;
    }
    const result = curatorRoundResultSchema.safeParse(parsed);
    if (result.success) return result.data;
  }
  return null;
}

/**
 * 모델 없이 답하는 대역. 유사도 점수만 본다.
 * 실제 판단이 아니므로 저장·표시에 `provider: 'MOCK'`이 항상 함께 간다(§72).
 */
export function mockVerdict(
  candidates: readonly SimilarCandidate[],
): CuratorRoundResult {
  const top = candidates[0];
  if (!top) {
    return {
      verdict: 'NEW',
      relatedAssetKey: null,
      confidence: 0.5,
      reasoning: '비슷한 자산이 없습니다. (모델이 판단한 것이 아니라 유사도만 본 결과입니다)',
      suggestedValidations: [],
      needMoreContext: false,
    };
  }
  return {
    verdict: top.score >= DUPLICATE_THRESHOLD ? 'DUPLICATE' : 'IMPROVEMENT_ON',
    relatedAssetKey: top.key,
    confidence: top.score,
    reasoning: `유사도 ${top.score}로 \`${top.key}\`와 가깝습니다. (모델이 판단한 것이 아니라 유사도만 본 결과입니다)`,
    suggestedValidations: [],
    needMoreContext: false,
  };
}
