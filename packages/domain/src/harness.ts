import { z } from 'zod';
import { displayNameSchema } from './identity';

export const harnessAssetTypes = [
  'RULE',
  'SKILL',
  'WORKFLOW',
  'KNOWLEDGE',
  'VALIDATION',
  'VARIANT',
  'SCRIPT',
  'TEMPLATE',
  'POLICY',
] as const;

/** 논리적 자산 자체의 생애. 개별 버전의 생애와 다르다. */
export const assetStatuses = ['DRAFT', 'ACTIVE', 'DEPRECATED', 'ARCHIVED'] as const;

/** 개별 버전의 생애. Resolver는 ACTIVE 버전만 후보로 본다. */
export const assetVersionStatuses = [
  'DRAFT',
  'CANDIDATE',
  'ACTIVE',
  'SUPERSEDED',
  'ARCHIVED',
] as const;

export const scopeTypes = ['COMPANY', 'TEAM', 'PROJECT', 'PERSONAL'] as const;
export const inheritanceModes = ['LOCKED', 'EXTENDABLE', 'OVERRIDABLE', 'DEFAULT'] as const;
export const assetOwnerTypes = ['USER', 'TEAM', 'GROUP', 'PROJECT'] as const;
export const capabilityOwnerTypes = ['TEAM', 'GROUP', 'PROJECT'] as const;

export const assetRelationTypes = [
  'DEPENDS_ON',
  'EXTENDS',
  'VARIANT_OF',
  'SUPERSEDES',
  'CONFLICTS_WITH',
  'VALIDATES',
  'REFERENCES',
] as const;

export const harnessAssetTypeSchema = z.enum(harnessAssetTypes);
export const assetStatusSchema = z.enum(assetStatuses);
export const assetVersionStatusSchema = z.enum(assetVersionStatuses);
export const scopeTypeSchema = z.enum(scopeTypes);
export const inheritanceModeSchema = z.enum(inheritanceModes);
export const assetOwnerTypeSchema = z.enum(assetOwnerTypes);
export const capabilityOwnerTypeSchema = z.enum(capabilityOwnerTypes);
export const assetRelationTypeSchema = z.enum(assetRelationTypes);

export type HarnessAssetType = z.infer<typeof harnessAssetTypeSchema>;
export type AssetStatus = z.infer<typeof assetStatusSchema>;
export type AssetVersionStatus = z.infer<typeof assetVersionStatusSchema>;
export type ScopeType = z.infer<typeof scopeTypeSchema>;
export type InheritanceMode = z.infer<typeof inheritanceModeSchema>;
export type AssetOwnerType = z.infer<typeof assetOwnerTypeSchema>;
export type CapabilityOwnerType = z.infer<typeof capabilityOwnerTypeSchema>;
export type AssetRelationType = z.infer<typeof assetRelationTypeSchema>;

/**
 * 자산 key는 스코프를 가로지르는 논리적 이름이다.
 * Company의 `rule.verify-before-completion`을 Project가 override할 때 같은 key를 쓴다.
 * `.`으로 계층을 나누고 각 마디는 slug 규칙을 따른다.
 */
export const assetKeySchema = z
  .string()
  .min(2)
  .max(200)
  .regex(
    /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/,
    '소문자·숫자·하이픈·점만 사용할 수 있습니다 (예: db.troubleshoot.core)',
  );

export const capabilityKeySchema = assetKeySchema;

/** `1.3` 형태. 자산 안에서만 유일하면 된다. */
export const assetVersionSchema = z
  .string()
  .regex(/^\d+\.\d+(?:\.\d+)?$/, '1.0 또는 1.0.0 형태여야 합니다');

/** 자산이 언제 적용되는지. 비어 있으면 조건 없이 후보가 된다. */
export const assetSelectorSchema = z
  .object({
    domains: z.array(z.string().min(1)).optional(),
    tasks: z.array(z.string().min(1)).optional(),
    os: z.array(z.string().min(1)).optional(),
    runtimes: z.array(z.string().min(1)).optional(),
    databases: z.array(z.string().min(1)).optional(),
    environments: z.array(z.string().min(1)).optional(),
    projects: z.array(z.string().min(1)).optional(),
    tags: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type AssetSelector = z.infer<typeof assetSelectorSchema>;

export const createCapabilityInputSchema = z.object({
  key: capabilityKeySchema,
  name: displayNameSchema,
  description: z.string().max(2000).default(''),
  parentId: z.uuid().nullish(),
  ownerType: capabilityOwnerTypeSchema,
  ownerId: z.uuid(),
});

export const createAssetInputSchema = z.object({
  type: harnessAssetTypeSchema,
  key: assetKeySchema,
  name: displayNameSchema,
  description: z.string().max(2000).default(''),
  capabilityId: z.uuid().nullish(),
  scopeType: scopeTypeSchema,
  /** COMPANY면 생략 가능하다. 서버가 organizationId로 채운다. */
  scopeId: z.uuid().nullish(),
  inheritanceMode: inheritanceModeSchema.default('DEFAULT'),
  ownerType: assetOwnerTypeSchema,
  ownerId: z.uuid(),
  selector: assetSelectorSchema.default({}),
  reviewAfter: z.iso.datetime().nullish(),
});

export const updateAssetInputSchema = z
  .object({
    name: displayNameSchema.optional(),
    description: z.string().max(2000).optional(),
    capabilityId: z.uuid().nullish(),
    inheritanceMode: inheritanceModeSchema.optional(),
    selector: assetSelectorSchema.optional(),
    reviewAfter: z.iso.datetime().nullish(),
    status: assetStatusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: '변경할 값이 없습니다' });

export const createAssetVersionInputSchema = z.object({
  version: assetVersionSchema,
  summary: z.string().max(2000).default(''),
  /** Source of Truth. 형태는 자산 타입마다 다르므로 여기서 강제하지 않는다. */
  structuredContent: z.unknown(),
  renderedMarkdown: z.string().nullish(),
  status: z.enum(['DRAFT', 'CANDIDATE']).default('DRAFT'),
});

export const createAssetRelationInputSchema = z.object({
  toAssetId: z.uuid(),
  type: assetRelationTypeSchema,
});

export const listAssetsQuerySchema = z.object({
  type: harnessAssetTypeSchema.optional(),
  scopeType: scopeTypeSchema.optional(),
  status: assetStatusSchema.optional(),
  capabilityId: z.uuid().optional(),
  q: z.string().max(200).optional(),
});

export type CreateCapabilityInput = z.infer<typeof createCapabilityInputSchema>;
export type CreateAssetInput = z.infer<typeof createAssetInputSchema>;
export type UpdateAssetInput = z.infer<typeof updateAssetInputSchema>;
export type CreateAssetVersionInput = z.infer<typeof createAssetVersionInputSchema>;
export type CreateAssetRelationInput = z.infer<typeof createAssetRelationInputSchema>;
export type ListAssetsQuery = z.infer<typeof listAssetsQuerySchema>;

/* ---------------- 라이프사이클 ---------------- */

/** 되돌리는 전이는 없다. 명세 §52. */
const ASSET_TRANSITIONS: Record<AssetStatus, readonly AssetStatus[]> = {
  DRAFT: ['ACTIVE', 'ARCHIVED'],
  ACTIVE: ['DEPRECATED', 'ARCHIVED'],
  DEPRECATED: ['ARCHIVED'],
  ARCHIVED: [],
};

/** SUPERSEDED는 승격이 자동으로 만든다. 직접 지정하는 전이가 아니다. */
const VERSION_TRANSITIONS: Record<AssetVersionStatus, readonly AssetVersionStatus[]> = {
  DRAFT: ['CANDIDATE', 'ARCHIVED'],
  CANDIDATE: ['ACTIVE', 'DRAFT', 'ARCHIVED'],
  ACTIVE: ['SUPERSEDED', 'ARCHIVED'],
  SUPERSEDED: ['ARCHIVED'],
  ARCHIVED: [],
};

export function canTransitionAsset(from: AssetStatus, to: AssetStatus): boolean {
  return ASSET_TRANSITIONS[from].includes(to);
}

export function canTransitionAssetVersion(
  from: AssetVersionStatus,
  to: AssetVersionStatus,
): boolean {
  return VERSION_TRANSITIONS[from].includes(to);
}

/**
 * Context Budget(Phase 3)이 쓸 거친 추정치다. 실제 토크나이저를 붙이지 않는다.
 * 한글은 대략 문자당 1토큰, 라틴 문자는 대략 4문자당 1토큰으로 잡는다.
 * 실제 사용량이 아니므로 절대 실측값처럼 표시하지 않는다.
 */
export function estimateTokens(text: string): number {
  let wide = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    // CJK·한글 음절 대역
    if ((code >= 0x1100 && code <= 0x11ff) || (code >= 0x3000 && code <= 0x9fff) || (code >= 0xac00 && code <= 0xd7af)) {
      wide++;
    }
  }
  const narrow = [...text].length - wide;
  return Math.ceil(wide + narrow / 4);
}
