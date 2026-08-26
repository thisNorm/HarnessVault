import { z } from 'zod';
import { emailSchema, organizationRoleSchema } from './identity';

export const invitationStatuses = ['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'] as const;
export const invitationStatusSchema = z.enum(invitationStatuses);
export type InvitationStatus = z.infer<typeof invitationStatusSchema>;

export const createInvitationInputSchema = z.object({
  /** 누구를 부른 것인지 목록에서 보여주는 용도다. 수락 시 이 이메일을 강제하지 않는다. */
  email: emailSchema,
  role: organizationRoleSchema.default('ORG_MEMBER'),
  /** 링크가 새는 것이 걱정이면 짧게 잡는다. */
  expiresInHours: z.coerce.number().int().positive().max(720).default(168),
  note: z.string().max(500).default(''),
});
export type CreateInvitationInput = z.infer<typeof createInvitationInputSchema>;

export interface InvitationView {
  id: string;
  email: string;
  role: string;
  status: InvitationStatus;
  note: string;
  expiresAt: string;
  createdAt: string;
  invitedByDisplayName: string;
  acceptedAt: string | null;
  /** 초대한 이메일과 실제로 수락한 사람이 다를 수 있다. 감추지 않는다. */
  acceptedByDisplayName: string | null;
  acceptedByEmail: string | null;
}

/** 초대를 만든 직후 한 번만 나가는 값. 이후에는 어디에도 없다. */
export interface IssuedInvitation extends InvitationView {
  token: string;
}

/** 수락하기 전에 무엇을 수락하는지 보여준다. 멤버가 아닌 사람이 보므로 조직 내부 정보를 담지 않는다. */
export interface InvitationPreview {
  organizationName: string;
  role: string;
  status: InvitationStatus;
  expiresAt: string;
}

/**
 * 만료는 상태로 저장하지 않고 읽는 시점에 계산한다.
 * 저장하면 누군가 갱신 작업을 돌려야 EXPIRED가 되고, 그 사이 수락이 통과한다.
 */
export function invitationStatusAt(
  stored: 'PENDING' | 'ACCEPTED' | 'REVOKED',
  expiresAt: Date,
  now: Date,
): InvitationStatus {
  // 이미 수락·철회된 것은 만료가 덮어쓰지 않는다. 무슨 일이 있었는지가 더 중요하다.
  if (stored !== 'PENDING') return stored;
  return expiresAt.getTime() <= now.getTime() ? 'EXPIRED' : 'PENDING';
}

export function canAcceptInvitation(status: InvitationStatus): boolean {
  return status === 'PENDING';
}
