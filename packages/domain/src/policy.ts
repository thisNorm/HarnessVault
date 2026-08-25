import { z } from 'zod';
import { displayNameSchema } from './identity';
import { inheritanceModeSchema, scopeTypeSchema } from './harness';
import { organizationRoleSchema } from './identity';
import { resourceClassificationSchema, resourceTypeSchema } from './resource';

export const policyEffects = ['ALLOW', 'APPROVAL_REQUIRED', 'DENY'] as const;
export const policyEffectSchema = z.enum(policyEffects);
export type PolicyEffect = z.infer<typeof policyEffectSchema>;

/** Resource Action 이름. Phase 6의 MCP 툴 이름과 같은 어휘를 쓴다. */
export const resourceActions = [
  'files.search',
  'files.read',
  'files.write',
  'db.schema',
  'db.query',
  'db.update',
  'git.status',
  'git.read',
  'git.write',
] as const;

export type ResourceAction = (typeof resourceActions)[number];

/** 기본 정책이 허용하는 읽기 Action. 쓰기는 조직이 명시적으로 열어야 한다. */
export const readOnlyResourceActions = [
  'files.search',
  'files.read',
  'db.schema',
  'db.query',
  'git.status',
  'git.read',
] as const satisfies readonly ResourceAction[];

/** `*`는 모든 Action을 뜻한다. */
export const policyActionSchema = z.union([z.literal('*'), z.enum(resourceActions)]);

export const createPolicyInputSchema = z.object({
  name: displayNameSchema,
  description: z.string().max(2000).default(''),
  effect: policyEffectSchema,
  scopeType: scopeTypeSchema,
  /** COMPANY면 생략 가능하다. 서버가 organizationId로 채운다. */
  scopeId: z.uuid().nullish(),
  inheritanceMode: inheritanceModeSchema.default('DEFAULT'),

  /* 매칭 조건 — 비워 두면 "무엇이든" */
  resourceId: z.uuid().nullish(),
  resourceType: resourceTypeSchema.nullish(),
  classification: resourceClassificationSchema.nullish(),
  actions: z.array(policyActionSchema).min(1).default(['*']),
  subjectOrgRole: organizationRoleSchema.nullish(),
  subjectGroupId: z.uuid().nullish(),

  /** APPROVAL_REQUIRED일 때 어떤 승인 계약을 쓸지. 승인자 해석은 Phase 8이다. */
  approvalPolicyId: z.uuid().nullish(),
  enabled: z.boolean().default(true),
});

export const updatePolicyInputSchema = z
  .object({
    name: displayNameSchema.optional(),
    description: z.string().max(2000).optional(),
    effect: policyEffectSchema.optional(),
    inheritanceMode: inheritanceModeSchema.optional(),
    resourceId: z.uuid().nullish(),
    resourceType: resourceTypeSchema.nullish(),
    classification: resourceClassificationSchema.nullish(),
    actions: z.array(policyActionSchema).min(1).optional(),
    subjectOrgRole: organizationRoleSchema.nullish(),
    subjectGroupId: z.uuid().nullish(),
    approvalPolicyId: z.uuid().nullish(),
    enabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: '변경할 값이 없습니다' });

export const evaluatePolicyInputSchema = z.object({
  resourceId: z.uuid(),
  action: z.enum(resourceActions),
  projectId: z.uuid().nullish(),
});

export type CreatePolicyInput = z.infer<typeof createPolicyInputSchema>;
export type UpdatePolicyInput = z.infer<typeof updatePolicyInputSchema>;
export type EvaluatePolicyInput = z.infer<typeof evaluatePolicyInputSchema>;

export type PolicyDenyReasonCode =
  | 'NO_POLICY_MATCHED'
  | 'EXPLICIT_DENY';

/** 어떤 정책이 그렇게 판정했는지 항상 밝힌다. 감사와 콘솔이 사람에게 보여줄 수 있어야 한다. */
export type PolicyDecision =
  | { decision: 'ALLOW'; policyIds: string[]; reason: string }
  | {
      decision: 'APPROVAL_REQUIRED';
      policyIds: string[];
      /** 승인자 해석은 Phase 8이다. 빈 배열을 주면 "승인자가 없다"는 거짓 진술이 된다. */
      approvalPolicyId: string | null;
      reason: string;
    }
  | {
      decision: 'DENY';
      policyIds: string[];
      reasonCode: PolicyDenyReasonCode;
      reason: string;
    };
