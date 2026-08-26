import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  canAcceptInvitation,
  invitationStatusAt,
  type CreateInvitationInput,
  type InvitationPreview,
  type InvitationView,
  type IssuedInvitation,
} from '@harnessvault/domain';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import { invitations, organizationMemberships, organizations, users } from '../db/schema';
import { generateSessionToken, hashSessionToken } from './session-token';

@Injectable()
export class InvitationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /**
   * 초대를 만든다. **토큰 원문은 이 반환값에서 한 번만 나간다.**
   * 다시 보려면 다시 만들어야 한다 — 원문을 저장하면 DB 유출로 링크가 재구성된다.
   */
  async create(
    organizationId: string,
    actorUserId: string,
    input: CreateInvitationInput,
  ): Promise<IssuedInvitation> {
    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + input.expiresInHours * 3_600_000);

    const [created] = await this.database.db
      .insert(invitations)
      .values({
        organizationId,
        email: input.email,
        role: input.role,
        tokenHash: hashSessionToken(token),
        note: input.note,
        expiresAt,
        invitedByUserId: actorUserId,
      })
      .returning({ id: invitations.id });
    if (!created) throw new ConflictException('초대를 만들지 못했습니다');

    await this.audit.record({
      organizationId,
      actorUserId,
      eventType: 'invitation.created',
      targetType: 'invitation',
      targetId: created.id,
      // 토큰은 감사에도 남기지 않는다. 감사 로그를 읽을 수 있으면 초대를 가로챌 수 있게 된다.
      metadata: { email: input.email, role: input.role, expiresAt: expiresAt.toISOString() },
    });

    const view = await this.detail(organizationId, created.id);
    return { ...view, token };
  }

  async list(organizationId: string): Promise<InvitationView[]> {
    const rows = await this.database.db
      .select()
      .from(invitations)
      .where(eq(invitations.organizationId, organizationId))
      .orderBy(desc(invitations.createdAt));
    return this.hydrate(rows);
  }

  async detail(organizationId: string, invitationId: string): Promise<InvitationView> {
    const [row] = await this.database.db
      .select()
      .from(invitations)
      .where(
        and(eq(invitations.id, invitationId), eq(invitations.organizationId, organizationId)),
      )
      .limit(1);
    if (!row) throw new NotFoundException('초대를 찾을 수 없습니다');
    const [view] = await this.hydrate([row]);
    if (!view) throw new NotFoundException('초대를 찾을 수 없습니다');
    return view;
  }

  async revoke(
    organizationId: string,
    actorUserId: string,
    invitationId: string,
  ): Promise<InvitationView> {
    const current = await this.detail(organizationId, invitationId);
    if (current.status === 'ACCEPTED') {
      // 이미 들어온 사람을 초대 철회로 내보내지 않는다. 그건 멤버십 해제다.
      throw new ConflictException({
        code: 'INVITATION_ALREADY_ACCEPTED',
        message: '이미 수락된 초대입니다. 멤버십 해제로 처리하세요',
      });
    }

    await this.database.db
      .update(invitations)
      .set({ status: 'REVOKED' })
      .where(eq(invitations.id, invitationId));

    await this.audit.record({
      organizationId,
      actorUserId,
      eventType: 'invitation.revoked',
      targetType: 'invitation',
      targetId: invitationId,
      metadata: { email: current.email },
    });

    return this.detail(organizationId, invitationId);
  }

  /** 수락 전에 무엇을 수락하는지 보여준다. 멤버가 아닌 사람이 보므로 최소한만 담는다. */
  async preview(token: string): Promise<InvitationPreview> {
    const { row, organizationName } = await this.loadByToken(token);
    return {
      organizationName,
      role: row.role,
      status: invitationStatusAt(row.status, row.expiresAt, new Date()),
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  /**
   * 수락은 로그인한 사람만 한다. 초대 링크가 가입 절차를 대신하지 않는다 —
   * 비밀번호 생성을 여기 섞으면 초대 토큰이 곧 계정 생성 권한이 된다.
   */
  async accept(token: string, userId: string): Promise<{ organizationId: string; role: string }> {
    const { row } = await this.loadByToken(token);
    const status = invitationStatusAt(row.status, row.expiresAt, new Date());
    if (!canAcceptInvitation(status)) {
      throw new ConflictException({
        code: 'INVITATION_NOT_ACCEPTABLE',
        message:
          status === 'EXPIRED'
            ? '만료된 초대입니다. 관리자에게 새 링크를 요청하세요'
            : '이미 처리된 초대입니다',
      });
    }

    const [existing] = await this.database.db
      .select({ role: organizationMemberships.role })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, row.organizationId),
          eq(organizationMemberships.userId, userId),
        ),
      )
      .limit(1);

    // 이미 멤버여도 실패가 아니다. 목적("이 조직에 들어간다")은 달성돼 있다.
    // 역할은 덮어쓰지 않는다 — 초대장이 기존 관리자를 일반 멤버로 강등시키면 안 된다.
    if (!existing) {
      await this.database.db
        .insert(organizationMemberships)
        .values({ organizationId: row.organizationId, userId, role: row.role })
        .onConflictDoNothing();
    }

    await this.database.db
      .update(invitations)
      .set({ status: 'ACCEPTED', acceptedByUserId: userId, acceptedAt: new Date() })
      .where(eq(invitations.id, row.id));

    await this.audit.record({
      organizationId: row.organizationId,
      actorUserId: userId,
      eventType: 'invitation.accepted',
      targetType: 'invitation',
      targetId: row.id,
      // 초대한 이메일과 수락한 사람이 다를 수 있다. 둘 다 남겨야 나중에 설명할 수 있다.
      metadata: {
        invitedEmail: row.email,
        role: existing?.role ?? row.role,
        alreadyMember: Boolean(existing),
      },
    });

    return { organizationId: row.organizationId, role: existing?.role ?? row.role };
  }

  private async loadByToken(token: string) {
    const [found] = await this.database.db
      .select({
        invitation: invitations,
        organizationName: organizations.name,
      })
      .from(invitations)
      .innerJoin(organizations, eq(organizations.id, invitations.organizationId))
      .where(eq(invitations.tokenHash, hashSessionToken(token)))
      .limit(1);

    // 존재하지 않는 토큰과 잘못된 토큰을 구분하지 않는다.
    if (!found) throw new NotFoundException('초대를 찾을 수 없습니다');
    return { row: found.invitation, organizationName: found.organizationName };
  }

  private async hydrate(
    rows: Array<typeof invitations.$inferSelect>,
  ): Promise<InvitationView[]> {
    const userIds = [
      ...new Set(
        rows.flatMap((row) =>
          [row.invitedByUserId, row.acceptedByUserId].filter((id): id is string => Boolean(id)),
        ),
      ),
    ];
    const people =
      userIds.length === 0
        ? []
        : await this.database.db
            .select({ id: users.id, displayName: users.displayName, email: users.email })
            .from(users)
            .where(inArray(users.id, userIds));
    const byId = new Map(people.map((person) => [person.id, person]));
    const now = new Date();

    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      status: invitationStatusAt(row.status, row.expiresAt, now),
      note: row.note,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      invitedByDisplayName: row.invitedByUserId
        ? (byId.get(row.invitedByUserId)?.displayName ?? '알 수 없음')
        : '알 수 없음',
      acceptedAt: row.acceptedAt?.toISOString() ?? null,
      acceptedByDisplayName: row.acceptedByUserId
        ? (byId.get(row.acceptedByUserId)?.displayName ?? '알 수 없음')
        : null,
      acceptedByEmail: row.acceptedByUserId
        ? (byId.get(row.acceptedByUserId)?.email ?? null)
        : null,
    }));
  }
}
