import { z } from 'zod';
import { scopeTypeSchema, type ScopeType } from './harness';

/**
 * 산출물 항목 이름. 대소문자만 다른 항목이 따로 집계되면 계약이 조용히 갈라진다.
 * lowerCamelCase만 허용한다.
 */
export const outputFieldSchema = z
  .string()
  .min(2)
  .max(60)
  .regex(/^[a-z][a-zA-Z0-9]*$/, 'lowerCamelCase만 사용할 수 있습니다 (예: changedFiles)');

export const createOutputContractInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(2000).default(''),
  scopeType: scopeTypeSchema,
  /** COMPANY면 생략 가능하다. 서버가 organizationId로 채운다. */
  scopeId: z.uuid().nullish(),
  /** 이 계약이 요구하는 항목. 하위 스코프는 추가만 하고 제거하지 못한다. */
  fields: z.array(outputFieldSchema).min(1),
  enabled: z.boolean().default(true),
});

export const resolveOutputContractInputSchema = z.object({
  projectId: z.uuid().nullish(),
});

export type CreateOutputContractInput = z.infer<typeof createOutputContractInputSchema>;
export type ResolveOutputContractInput = z.infer<typeof resolveOutputContractInputSchema>;

export interface OutputContractSource {
  scope: ScopeType;
  sourceId: string;
  sourceName: string;
}

/** 명세 §36. */
export interface ResolvedOutputContract {
  requiredFields: string[];
  sourceMap: Record<string, OutputContractSource>;
  /** 기여한 계약 목록. 콘솔이 "어디서 왔는가"를 보여준다. */
  contributingContracts: Array<{ id: string; name: string; scope: ScopeType; fields: string[] }>;
}

export interface OutputContractCandidate {
  id: string;
  name: string;
  scopeType: ScopeType;
  fields: string[];
}

const SCOPE_SPECIFICITY: Record<ScopeType, number> = {
  COMPANY: 0,
  TEAM: 1,
  PROJECT: 2,
  PERSONAL: 3,
};

/**
 * 병합 규칙은 하나뿐이다 — **합집합**.
 * 하위 스코프는 항목을 추가만 하고 제거하지 못한다(§10 EXTENDABLE).
 *
 * 같은 항목을 두 스코프가 선언하면 **덜 구체적인 쪽**이 출처다.
 * 회사가 먼저 요구한 것의 출처가 팀으로 바뀌면 "왜 필요한가"를 거꾸로 읽게 된다.
 */
export function mergeOutputContracts(
  candidates: readonly OutputContractCandidate[],
): ResolvedOutputContract {
  const ordered = [...candidates].sort(
    (a, b) =>
      SCOPE_SPECIFICITY[a.scopeType] - SCOPE_SPECIFICITY[b.scopeType] || a.id.localeCompare(b.id),
  );

  const sourceMap: Record<string, OutputContractSource> = {};
  const requiredFields: string[] = [];

  for (const contract of ordered) {
    for (const field of contract.fields) {
      // 이미 등록된 항목이면 출처를 덮지 않는다. 먼저 요구한 쪽이 출처다.
      if (sourceMap[field]) continue;
      sourceMap[field] = {
        scope: contract.scopeType,
        sourceId: contract.id,
        sourceName: contract.name,
      };
      requiredFields.push(field);
    }
  }

  return {
    requiredFields,
    sourceMap,
    contributingContracts: ordered.map((contract) => ({
      id: contract.id,
      name: contract.name,
      scope: contract.scopeType,
      fields: contract.fields,
    })),
  };
}

/**
 * 제출된 산출물이 계약을 만족하는지 본다.
 * 빠진 항목이 있어도 **거부하지 않는다** — 호출자가 기록하고 드러낸다.
 */
export function checkOutputAgainstContract(
  contract: ResolvedOutputContract,
  output: Record<string, unknown> | null | undefined,
): { satisfied: boolean; missingFields: string[] } {
  const provided = output ?? {};
  const missingFields = contract.requiredFields.filter((field) => {
    const value = provided[field];
    // 빈 문자열·빈 배열은 채운 것으로 보지 않는다. 형식만 맞춘 산출물을 통과시키지 않는다.
    if (value === null || value === undefined) return true;
    if (typeof value === 'string' && value.trim() === '') return true;
    if (Array.isArray(value) && value.length === 0) return true;
    return false;
  });
  return { satisfied: missingFields.length === 0, missingFields };
}
