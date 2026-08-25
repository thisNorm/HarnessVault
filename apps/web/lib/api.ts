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

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
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
    throw new ApiError(res.status, readErrorMessage(body, `${res.status} ${res.statusText}`));
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
