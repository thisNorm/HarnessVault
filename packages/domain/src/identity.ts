import { z } from 'zod';

export const organizationRoles = ['ORG_ADMIN', 'ORG_MEMBER'] as const;
export const projectRoles = ['PROJECT_OWNER', 'PROJECT_LEAD', 'PROJECT_MEMBER'] as const;
export const userStatuses = ['ACTIVE', 'DISABLED'] as const;

export const organizationRoleSchema = z.enum(organizationRoles);
export const projectRoleSchema = z.enum(projectRoles);
export const userStatusSchema = z.enum(userStatuses);

export type OrganizationRole = z.infer<typeof organizationRoleSchema>;
export type ProjectRole = z.infer<typeof projectRoleSchema>;
export type UserStatus = z.infer<typeof userStatusSchema>;

/** URL과 Asset key에 그대로 쓰이므로 소문자·숫자·하이픈만 허용한다. */
export const slugSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, '소문자·숫자·하이픈만 사용할 수 있습니다');

export const emailSchema = z.email().max(254).toLowerCase();
export const displayNameSchema = z.string().trim().min(1).max(100);

/** 길이만 강제한다. 문자 구성 규칙은 오히려 엔트로피를 낮추는 경우가 많다. */
export const passwordSchema = z.string().min(12).max(200);

export const registerInputSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
});

export const loginInputSchema = z.object({
  email: emailSchema,
  password: z.string().min(1),
});

export const createOrganizationInputSchema = z.object({
  name: displayNameSchema,
  slug: slugSchema,
});

export const createTeamInputSchema = z.object({
  name: displayNameSchema,
  slug: slugSchema,
});

export const createGroupInputSchema = z.object({
  name: displayNameSchema,
  slug: slugSchema,
});

export const createProjectInputSchema = z.object({
  name: displayNameSchema,
  slug: slugSchema,
  teamId: z.uuid().nullish(),
});

export const addOrganizationMemberInputSchema = z.object({
  email: emailSchema,
  role: organizationRoleSchema.default('ORG_MEMBER'),
});

export const addMemberInputSchema = z.object({
  userId: z.uuid(),
});

export const addProjectMemberInputSchema = z.object({
  userId: z.uuid(),
  role: projectRoleSchema.default('PROJECT_MEMBER'),
});

export type RegisterInput = z.infer<typeof registerInputSchema>;
export type LoginInput = z.infer<typeof loginInputSchema>;
export type CreateOrganizationInput = z.infer<typeof createOrganizationInputSchema>;
export type CreateTeamInput = z.infer<typeof createTeamInputSchema>;
export type CreateGroupInput = z.infer<typeof createGroupInputSchema>;
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;
export type AddOrganizationMemberInput = z.infer<typeof addOrganizationMemberInputSchema>;
export type AddMemberInput = z.infer<typeof addMemberInputSchema>;
export type AddProjectMemberInput = z.infer<typeof addProjectMemberInputSchema>;

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  status: UserStatus;
}
