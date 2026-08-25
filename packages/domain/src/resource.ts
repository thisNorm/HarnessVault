import { z } from 'zod';
import { displayNameSchema } from './identity';

export const resourceTypes = ['FILE_SYSTEM', 'DATABASE', 'GIT', 'INTERNAL_API'] as const;
export const resourceClassifications = [
  'PUBLIC',
  'INTERNAL',
  'RESTRICTED',
  'HIGHLY_RESTRICTED',
] as const;
export const resourceOwnerTypes = ['TEAM', 'GROUP', 'USER', 'PROJECT'] as const;

export const resourceTypeSchema = z.enum(resourceTypes);
export const resourceClassificationSchema = z.enum(resourceClassifications);
export const resourceOwnerTypeSchema = z.enum(resourceOwnerTypes);

export type ResourceType = z.infer<typeof resourceTypeSchema>;
export type ResourceClassification = z.infer<typeof resourceClassificationSchema>;
export type ResourceOwnerType = z.infer<typeof resourceOwnerTypeSchema>;

/**
 * 환경변수 **이름**이다. 비밀 자체가 아니다.
 * `HARNESS_RESOURCE_` 접두사를 강제하지 않으면 앱 자신의 `DATABASE_URL`을 가리킬 수 있다.
 */
export const credentialRefSchema = z
  .string()
  .regex(
    /^HARNESS_RESOURCE_[A-Z0-9_]+$/,
    'HARNESS_RESOURCE_로 시작하고 대문자·숫자·언더스코어만 쓸 수 있습니다',
  );

/** 비밀이 아닌 설정만 담는다. 접속 문자열·토큰을 여기 넣지 않는다. */
export const resourceConfigSchema = z
  .object({
    /** FILE_SYSTEM · GIT — 이 경로 밖으로는 나갈 수 없다. */
    root: z.string().min(1).optional(),
    /** FILE_SYSTEM — 한 번에 읽는 최대 바이트. */
    maxBytes: z.number().int().positive().max(5_000_000).optional(),
    /** DATABASE — 한 번에 돌려주는 최대 행 수. */
    maxRows: z.number().int().positive().max(1000).optional(),
  })
  .strict();

export type ResourceConfig = z.infer<typeof resourceConfigSchema>;

export const createResourceInputSchema = z.object({
  type: resourceTypeSchema,
  name: displayNameSchema,
  description: z.string().max(2000).default(''),
  classification: resourceClassificationSchema.default('INTERNAL'),
  ownerType: resourceOwnerTypeSchema,
  ownerId: z.uuid(),
  adapterType: z.string().min(1).max(100),
  config: resourceConfigSchema.default({}),
  credentialRef: credentialRefSchema.nullish(),
  enabled: z.boolean().default(true),
});

export const updateResourceInputSchema = z
  .object({
    name: displayNameSchema.optional(),
    description: z.string().max(2000).optional(),
    classification: resourceClassificationSchema.optional(),
    config: resourceConfigSchema.optional(),
    credentialRef: credentialRefSchema.nullish(),
    enabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: '변경할 값이 없습니다' });

export type CreateResourceInput = z.infer<typeof createResourceInputSchema>;
export type UpdateResourceInput = z.infer<typeof updateResourceInputSchema>;

/** 관리 API·MCP 응답에 싣는 형태. credential **값**은 어디에도 담기지 않는다. */
export interface ResourceSummary {
  id: string;
  type: ResourceType;
  name: string;
  description: string;
  classification: ResourceClassification;
  adapterType: string;
  enabled: boolean;
  /** 환경변수 이름. 이름은 비밀이 아니지만 값은 절대 싣지 않는다. */
  credentialRef: string | null;
  /** 설정이 실제로 갖춰졌는지. 값을 노출하지 않고 상태만 알린다. */
  credentialConfigured: boolean;
}
