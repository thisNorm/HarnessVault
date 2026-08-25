import { z } from 'zod';

export const traceStatuses = ['OPEN', 'COMPLETED', 'FAILED', 'CANCELLED'] as const;
export const modelSources = ['VERIFIED', 'CLIENT_REPORTED', 'UNKNOWN'] as const;

export const traceStatusSchema = z.enum(traceStatuses);
export const modelSourceSchema = z.enum(modelSources);

export type TraceStatus = z.infer<typeof traceStatusSchema>;
export type ModelSource = z.infer<typeof modelSourceSchema>;

export const completeTaskInputSchema = z.object({
  traceId: z.uuid(),
  status: z.enum(['COMPLETED', 'FAILED', 'CANCELLED']),
  summary: z.string().max(4000).optional(),
  /**
   * 외부 AI가 스스로 보고한 토큰 사용량. 서버가 검증하지 않는다.
   * 모르면 보내지 않는다 — 0으로 채우면 "안 썼다"는 거짓 진술이 된다(§40).
   */
  clientReportedInputTokens: z.number().int().nonnegative().max(100_000_000).optional(),
  clientReportedOutputTokens: z.number().int().nonnegative().max(100_000_000).optional(),
  /**
   * 산출물(§35). 계약과 대조해 빠진 항목을 기록한다.
   * 빠져도 흐름은 닫힌다 — 통과하려고 값을 지어내게 만들지 않기 위해서다.
   */
  output: z.record(z.string(), z.unknown()).optional(),
});

export type CompleteTaskInput = z.infer<typeof completeTaskInputSchema>;

export interface TraceSummary {
  id: string;
  organizationId: string;
  userId: string;
  userDisplayName: string;
  projectId: string | null;
  projectName: string | null;

  clientName: string | null;
  clientVersion: string | null;
  modelName: string | null;
  /** 클라이언트 자가 보고인지 검증된 값인지. 감사가 거짓말하지 않으려면 필요하다(§59). */
  modelSource: ModelSource;

  purpose: string;
  status: TraceStatus;
  startedAt: string;
  completedAt: string | null;
  summary: string | null;

  /* §41 Context 효율 — 전부 추정치다. */
  candidateAssetCount: number | null;
  selectedAssetCount: number | null;
  estimatedAvailableTokens: number | null;
  estimatedInjectedTokens: number | null;

  /* §40 토큰 계량 — 갈래를 구분해서 둔다. */
  harnessInputTokens: number | null;
  harnessOutputTokens: number | null;
  curatorInputTokens: number | null;
  curatorReasoningTokens: number | null;
  curatorOutputTokens: number | null;
  /** 모르면 null이다. 0으로 바꾸지 않는다. */
  clientReportedInputTokens: number | null;
  clientReportedOutputTokens: number | null;

  eventCount: number;

  /** §35 산출물 계약 충족 여부. 아직 종료하지 않았으면 null이다. */
  outputContractSatisfied: boolean | null;
  missingOutputFields: string[] | null;
}

export interface TraceEventView {
  id: string;
  eventType: string;
  actorUserId: string | null;
  actorDisplayName: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface TraceDetail extends TraceSummary {
  events: TraceEventView[];
}

/**
 * 감축률. 분모가 0이면 계산하지 않는다 — 0%로 표시하면 거짓이다(§41).
 */
export function contextReductionRatio(
  candidateCount: number | null,
  selectedCount: number | null,
): number | null {
  if (!candidateCount || candidateCount <= 0 || selectedCount === null) return null;
  return Math.round((1 - selectedCount / candidateCount) * 1000) / 10;
}
