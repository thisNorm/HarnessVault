import { z } from 'zod';
import { displayNameSchema, organizationRoleSchema, projectRoleSchema } from './identity';
import { resourceClassificationSchema, resourceTypeSchema } from './resource';

export const approvalStatuses = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
  'EXECUTING',
  'EXECUTED',
  'FAILED',
] as const;

export const approvalModes = ['ANY_OF', 'ALL_OF', 'N_OF_M'] as const;
export const approverKinds = [
  'USER',
  'GROUP',
  'ORG_ROLE',
  'PROJECT_ROLE',
  'RESOURCE_OWNER',
] as const;

export const approvalStatusSchema = z.enum(approvalStatuses);
export const approvalModeSchema = z.enum(approvalModes);
export const approverKindSchema = z.enum(approverKinds);

export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;
export type ApprovalMode = z.infer<typeof approvalModeSchema>;
export type ApproverKind = z.infer<typeof approverKindSchema>;

/**
 * 명세 §32의 상태 기계. 되돌리는 전이는 없다.
 *
 * EXECUTING에서 서버가 죽으면 그 요청은 EXECUTING에 남는다.
 * 자동으로 PENDING으로 되돌리지 않는다 — 실행이 이미 일부 반영됐을 수 있다.
 */
const TRANSITIONS: Record<ApprovalStatus, readonly ApprovalStatus[]> = {
  PENDING: ['APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED'],
  APPROVED: ['EXECUTING', 'CANCELLED', 'EXPIRED'],
  EXECUTING: ['EXECUTED', 'FAILED'],
  EXECUTED: [],
  REJECTED: [],
  EXPIRED: [],
  CANCELLED: [],
  FAILED: [],
};

export function canTransitionApproval(from: ApprovalStatus, to: ApprovalStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** 실행 조건은 오직 이것이다(§34). 클라이언트의 주장은 신뢰하지 않는다. */
export function isExecutable(status: ApprovalStatus): boolean {
  return status === 'APPROVED';
}

/** 더 이상 사람이 손댈 수 없는 상태. */
export function isTerminal(status: ApprovalStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/* ---------------- 승인 정책 ---------------- */

export const approverSpecSchema = z
  .object({
    kind: approverKindSchema,
    /** USER · GROUP일 때 대상 id. */
    refId: z.uuid().nullish(),
    /** ORG_ROLE일 때 조직 역할. */
    orgRole: organizationRoleSchema.nullish(),
    /** PROJECT_ROLE일 때 프로젝트 역할. */
    projectRole: projectRoleSchema.nullish(),
  })
  .refine(
    (value) =>
      (value.kind === 'USER' && Boolean(value.refId)) ||
      (value.kind === 'GROUP' && Boolean(value.refId)) ||
      (value.kind === 'ORG_ROLE' && Boolean(value.orgRole)) ||
      (value.kind === 'PROJECT_ROLE' && Boolean(value.projectRole)) ||
      value.kind === 'RESOURCE_OWNER',
    { message: 'approver 종류에 맞는 대상이 필요합니다' },
  );

export type ApproverSpec = z.infer<typeof approverSpecSchema>;

export const createApprovalPolicyInputSchema = z
  .object({
    name: displayNameSchema,
    description: z.string().max(2000).default(''),
    mode: approvalModeSchema,
    /** N_OF_M일 때 필요한 승인 수. */
    requiredCount: z.number().int().positive().max(20).nullish(),
    approvers: z.array(approverSpecSchema).min(1),

    resourceId: z.uuid().nullish(),
    resourceType: resourceTypeSchema.nullish(),
    classification: resourceClassificationSchema.nullish(),

    expiresInMinutes: z.number().int().positive().max(20160).default(1440),
    enabled: z.boolean().default(true),
  })
  .refine((value) => value.mode !== 'N_OF_M' || Boolean(value.requiredCount), {
    message: 'N_OF_M 모드에는 requiredCount가 필요합니다',
  });

export type CreateApprovalPolicyInput = z.infer<typeof createApprovalPolicyInputSchema>;

/* ---------------- 승인 요청 ---------------- */

/** 승인자가 판단할 수 있어야 한다. reason은 필수다. */
export const approvalRequestContextSchema = z.object({
  reason: z.string().min(1).max(2000),
  risk: z.string().max(2000).nullish(),
  rollbackPlan: z.string().max(2000).nullish(),
  verificationPlan: z.string().max(2000).nullish(),
});

export const approvalDecisionInputSchema = z.object({
  comment: z.string().max(2000).default(''),
});

export type ApprovalRequestContext = z.infer<typeof approvalRequestContextSchema>;
export type ApprovalDecisionInput = z.infer<typeof approvalDecisionInputSchema>;

export interface ApprovalRequestView {
  id: string;
  organizationId: string;
  traceId: string | null;
  status: ApprovalStatus;

  requester: { userId: string; displayName: string; email: string };
  /** 클라이언트가 스스로 보고한 값이다. 신뢰하지 않고 표시만 한다(§59). */
  clientName: string | null;
  clientReportedModel: string | null;

  projectId: string | null;
  projectName: string | null;
  resourceId: string;
  resourceName: string;
  resourceClassification: string;
  action: string;

  /** 승인자가 보는 "무엇이 바뀌는가". 실행도 이 값으로 한다. */
  proposedChange: string;

  reason: string;
  risk: string | null;
  rollbackPlan: string | null;
  verificationPlan: string | null;

  /** 승인을 요구한 Policy. 왜 승인이 필요한지 보여준다. */
  policyIds: string[];
  approvalPolicyId: string | null;
  approvalPolicyName: string | null;
  mode: ApprovalMode | null;
  requiredCount: number | null;

  decisions: Array<{
    userId: string;
    displayName: string;
    decision: 'APPROVE' | 'REJECT';
    comment: string;
    decidedAt: string;
  }>;

  /** 현재 사용자가 이 요청을 승인할 수 있는가. */
  canDecide: boolean;

  createdAt: string;
  expiresAt: string | null;
  executedAt: string | null;
  failureReason: string | null;
}
