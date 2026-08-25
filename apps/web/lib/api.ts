import type {
  AssetSelector,
  AssetStatus,
  AssetVersionStatus,
  HarnessAssetType,
  InheritanceMode,
  OrganizationRole,
  ProjectRole,
  PublicUser,
  ScopeType,
} from '@harnessvault/domain';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  readonly statusCode: number;
  /** 서버가 함께 준 구조화 정보. RESOLUTION_CONFLICT의 conflicts 같은 것이 들어온다. */
  readonly details: Record<string, unknown> | null;

  constructor(statusCode: number, message: string, details: Record<string, unknown> | null = null) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

type Json = Record<string, unknown>;

/** NestJS 기본 에러 형태 { statusCode, message } 를 최대한 그대로 노출한다. */
function readErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'message' in body) {
    const message = (body as Json).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join(', ');
  }
  return fallback;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: 'include',
      cache: 'no-store',
      headers: init?.body ? { 'content-type': 'application/json', ...init?.headers } : init?.headers,
    });
  } catch {
    throw new ApiError(
      0,
      `API에 연결하지 못했습니다 — 서버 미기동 또는 CORS 설정을 확인하세요 (${API_URL})`,
    );
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const body: unknown = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new ApiError(
      res.status,
      readErrorMessage(body, `${res.status} ${res.statusText}`),
      body && typeof body === 'object' ? (body as Record<string, unknown>) : null,
    );
  }
  return body as T;
}

export const post = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const del = (path: string) => api<void>(path, { method: 'DELETE' });

/* ---- 도메인 타입 ----
 * 역할·상태 enum은 packages/domain을 단일 출처로 쓴다. web에서 다시 정의하면 계약이 갈라진다. */

export type {
  AssetSelector,
  AssetStatus,
  AssetVersionStatus,
  HarnessAssetType,
  InheritanceMode,
  OrganizationRole,
  ProjectRole,
  ScopeType,
} from '@harnessvault/domain';
export type User = PublicUser;

export interface Organization {
  id: string;
  name: string;
  slug: string;
  role?: OrganizationRole;
}

export interface OrgMember {
  userId: string;
  email: string;
  displayName: string;
  role: OrganizationRole;
}

export interface Me {
  user: User;
  organizations: Organization[];
}

/** teams / projects / groups 는 동일한 형태를 공유한다. */
export interface Scope {
  id: string;
  name: string;
  slug: string;
  memberCount: number;
}

export interface ScopeMember {
  userId: string;
  email: string;
  displayName: string;
  role?: ProjectRole;
}

/* ---- Harness 자산 ---- */

export interface Capability {
  id: string;
  key: string;
  name: string;
  description: string;
  parentId: string | null;
}

export interface Asset {
  id: string;
  capabilityId: string | null;
  type: HarnessAssetType;
  key: string;
  name: string;
  description: string;
  scopeType: ScopeType;
  scopeId: string;
  inheritanceMode: InheritanceMode;
  status: AssetStatus;
  ownerType: string;
  ownerId: string;
  selector: AssetSelector;
}

export interface AssetVersionRow {
  id: string;
  version: string;
  status: AssetVersionStatus;
  summary: string;
  /** 실측이 아닌 추정치다. 그대로 표시하지 않고 `~`를 붙인다. */
  estimatedTokens: number | null;
}

export interface RelatedAsset {
  id: string;
  type: string;
  assetId: string;
  key: string;
  name: string;
  assetType: HarnessAssetType;
}

export interface AssetDetail {
  asset: Asset;
  versions: AssetVersionRow[];
  relations: { outgoing: RelatedAsset[]; incoming: RelatedAsset[] };
  activeVersionCount: number;
}


/* ---- Resolver ---- */

export interface Project {
  id: string;
  name: string;
  slug: string;
}

export interface ResolvedRef {
  assetId: string;
  versionId: string;
  key: string;
  name: string;
  type: HarnessAssetType;
  version: string;
  scope: ScopeType;
  inheritanceMode: InheritanceMode;
  reasonCode: string;
  reason: string;
  mandatory: boolean;
  /** 추정치다. 화면에서는 `~`를 붙여 실측과 구분한다. */
  estimatedTokens: number;
}

export interface ExcludedRef {
  assetId: string;
  key: string;
  name: string;
  type: HarnessAssetType;
  scope: ScopeType;
  reasonCode: string;
  reason: string;
}

export interface ResolvedManifest {
  traceId: string;
  organizationId: string;
  userId: string;
  projectId: string | null;
  rules: ResolvedRef[];
  policies: ResolvedRef[];
  validations: ResolvedRef[];
  workflows: ResolvedRef[];
  skills: ResolvedRef[];
  variants: ResolvedRef[];
  scripts: ResolvedRef[];
  templates: ResolvedRef[];
  knowledge: ResolvedRef[];
  outputContract: ResolvedOutputContract | null;
  excluded: ExcludedRef[];
  resolution: {
    candidateCount: number;
    selectedCount: number;
    excludedCount: number;
    estimatedAvailableTokens: number | null;
    estimatedInjectedTokens: number;
    budgetExceededByMandatory: boolean;
  };
}

export type CompileTarget = 'CODEX' | 'CLAUDE_CODE';

export interface CompiledFile {
  path: string;
  content: string;
}

export interface CompiledHarness {
  files: CompiledFile[];
  metadata: {
    target: CompileTarget;
    generatedAt: string;
    manifestTraceId: string;
  };
}

/* ---- Resource · Policy (Phase 6~7) ---- */

export interface ResourceSummary {
  id: string;
  type: 'FILE_SYSTEM' | 'DATABASE' | 'GIT' | 'INTERNAL_API';
  name: string;
  description: string;
  classification: 'PUBLIC' | 'INTERNAL' | 'RESTRICTED' | 'HIGHLY_RESTRICTED';
  adapterType: string;
  enabled: boolean;
  /** 환경변수 **이름**이다. 값은 서버가 절대 내보내지 않는다. */
  credentialRef: string | null;
  credentialConfigured: boolean;
}

export interface Policy {
  id: string;
  name: string;
  description: string;
  effect: 'ALLOW' | 'APPROVAL_REQUIRED' | 'DENY';
  scopeType: ScopeType;
  inheritanceMode: InheritanceMode;
  actions: string[];
  enabled: boolean;
}

/* ---- Approval (Phase 8) ---- */

export type ApprovalStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'EXECUTING'
  | 'EXECUTED'
  | 'FAILED';

export interface ApprovalRequestView {
  id: string;
  status: ApprovalStatus;
  requester: { userId: string; displayName: string; email: string };
  /** 클라이언트 자가 보고 값이다. 서버가 검증하지 않는다(§59). */
  clientName: string | null;
  clientReportedModel: string | null;
  projectId: string | null;
  projectName: string | null;
  resourceId: string;
  resourceName: string;
  resourceClassification: string;
  action: string;
  proposedChange: string;
  reason: string;
  risk: string | null;
  rollbackPlan: string | null;
  verificationPlan: string | null;
  policyIds: string[];
  approvalPolicyId: string | null;
  approvalPolicyName: string | null;
  mode: 'ANY_OF' | 'ALL_OF' | 'N_OF_M' | null;
  requiredCount: number | null;
  decisions: Array<{
    userId: string;
    displayName: string;
    decision: 'APPROVE' | 'REJECT';
    comment: string;
    decidedAt: string;
  }>;
  canDecide: boolean;
  createdAt: string;
  expiresAt: string | null;
  executedAt: string | null;
  failureReason: string | null;
}

/* ---- Contribution (Phase 11) ---- */

export interface ContributionSummary {
  id: string;
  status: 'CANDIDATE' | 'PROMOTED' | 'REJECTED' | 'WITHDRAWN';
  type: string;
  proposedKey: string;
  name: string;
  description: string;
  summary: string;
  rationale: string;
  proposedScopeType: ScopeType;
  proposedScopeId: string | null;
  capabilityId: string | null;
  submittedByUserId: string;
  submittedByDisplayName: string;
  traceId: string | null;
  /** 중복이어도 거절되지 않는다. 사실만 기록된다. */
  duplicateOfAssetId: string | null;
  duplicateScore: number | null;
  similarityMethod: 'VECTOR' | 'LEXICAL';
  embeddingStatus: 'NOT_CONFIGURED' | 'OK' | 'FAILED';
  reviewedByUserId: string | null;
  reviewedByDisplayName: string | null;
  reviewedAt: string | null;
  reviewNote: string;
  promotedAssetId: string | null;
  promotedVersionId: string | null;
  createdAt: string;
}

/* ---- Output Contract (Phase 10) ---- */

export interface ResolvedOutputContract {
  requiredFields: string[];
  sourceMap: Record<string, { scope: ScopeType; sourceId: string; sourceName: string }>;
  contributingContracts: Array<{
    id: string;
    name: string;
    scope: ScopeType;
    fields: string[];
  }>;
}

/* ---- Trace (Phase 9) ---- */

export type TraceStatus = 'OPEN' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type ModelSource = 'VERIFIED' | 'CLIENT_REPORTED' | 'UNKNOWN';

export interface TraceSummary {
  id: string;
  userId: string;
  userDisplayName: string;
  projectId: string | null;
  projectName: string | null;
  clientName: string | null;
  clientVersion: string | null;
  modelName: string | null;
  /** 자가 보고를 검증된 값처럼 보여주지 않기 위해 함께 받는다. */
  modelSource: ModelSource;
  purpose: string;
  status: TraceStatus;
  startedAt: string;
  completedAt: string | null;
  summary: string | null;
  candidateAssetCount: number | null;
  selectedAssetCount: number | null;
  estimatedAvailableTokens: number | null;
  estimatedInjectedTokens: number | null;
  harnessInputTokens: number | null;
  harnessOutputTokens: number | null;
  curatorInputTokens: number | null;
  curatorReasoningTokens: number | null;
  curatorOutputTokens: number | null;
  /** 모르면 null이다. 0이 아니다. */
  clientReportedInputTokens: number | null;
  clientReportedOutputTokens: number | null;
  eventCount: number;
  /** 아직 종료하지 않았으면 null이다. */
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

export interface TraceListResponse {
  traces: TraceSummary[];
  /** 어느 흐름인지 추측하지 않고 따로 보여준다. */
  untracked: Array<{
    id: string;
    eventType: string;
    actorDisplayName: string | null;
    createdAt: string;
  }>;
}

/** 감축률. 분모가 0이면 계산하지 않는다 — 0%로 표시하면 거짓이다(§41). */
export function contextReduction(
  candidateCount: number | null,
  selectedCount: number | null,
): number | null {
  if (!candidateCount || candidateCount <= 0 || selectedCount === null) return null;
  return Math.round((1 - selectedCount / candidateCount) * 1000) / 10;
}
