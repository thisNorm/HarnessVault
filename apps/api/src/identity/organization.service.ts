import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateOrganizationInput,
  OrganizationRole,
  AddOrganizationMemberInput,
} from '@harnessvault/domain';
import { and, count, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import { organizationMemberships, organizations, users } from '../db/schema';

export interface OrganizationMemberView {
  userId: string;
  email: string;
  displayName: string;
  role: OrganizationRole;
}

@Injectable()
export class OrganizationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** 조직을 만든 사용자는 자동으로 ORG_ADMIN이 된다. */
  async create(actorUserId: string, input: CreateOrganizationInput) {
    return this.database.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(organizations)
        .values({ name: input.name, slug: input.slug })
        .onConflictDoNothing({ target: organizations.slug })
        .returning();

      if (!created) throw new ConflictException('이미 사용 중인 조직 slug입니다');

      await tx.insert(organizationMemberships).values({
        organizationId: created.id,
        userId: actorUserId,
        role: 'ORG_ADMIN',
      });

      // tx를 넘긴다. 다른 커넥션으로 쓰면 아직 커밋되지 않은 조직을 참조하지 못해 실패한다.
      await this.audit.record(
        {
          organizationId: created.id,
          actorUserId,
          eventType: 'organization.created',
          targetType: 'organization',
          targetId: created.id,
          metadata: { slug: created.slug },
        },
        tx,
      );

      return created;
    });
  }

  async findById(organizationId: string) {
    const [found] = await this.database.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!found) throw new NotFoundException('조직을 찾을 수 없습니다');
    return found;
  }

  async members(organizationId: string): Promise<OrganizationMemberView[]> {
    return this.database.db
      .select({
        userId: users.id,
        email: users.email,
        displayName: users.displayName,
        role: organizationMemberships.role,
      })
      .from(organizationMemberships)
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .where(eq(organizationMemberships.organizationId, organizationId))
      .orderBy(users.displayName);
  }

  /** 이메일로 기존 사용자를 조직에 넣는다. 초대 메일 발송은 MVP 범위 밖이다. */
  async addMember(
    actorUserId: string,
    organizationId: string,
    input: AddOrganizationMemberInput,
  ): Promise<OrganizationMemberView> {
    const [user] = await this.database.db
      .select()
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);

    if (!user) throw new NotFoundException('가입되지 않은 이메일입니다');

    const [membership] = await this.database.db
      .insert(organizationMemberships)
      .values({ organizationId, userId: user.id, role: input.role })
      .onConflictDoUpdate({
        target: [organizationMemberships.organizationId, organizationMemberships.userId],
        set: { role: input.role },
      })
      .returning();

    if (!membership) throw new ConflictException('멤버십을 저장하지 못했습니다');

    await this.audit.record({
      organizationId,
      actorUserId,
      eventType: 'membership.granted',
      targetType: 'organization',
      targetId: organizationId,
      metadata: { userId: user.id, role: input.role },
    });

    return {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      role: membership.role,
    };
  }

  async removeMember(actorUserId: string, organizationId: string, userId: string): Promise<void> {
    // 마지막 관리자를 지우면 조직이 잠긴다. 삭제 전에 막는다.
    const [target] = await this.database.db
      .select({ role: organizationMemberships.role })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.userId, userId),
        ),
      )
      .limit(1);

    if (!target) throw new NotFoundException('조직 멤버가 아닙니다');

    if (target.role === 'ORG_ADMIN') {
      const [adminRow] = await this.database.db
        .select({ value: count() })
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.role, 'ORG_ADMIN'),
          ),
        );
      if ((adminRow?.value ?? 0) <= 1) {
        throw new ConflictException('마지막 조직 관리자는 제거할 수 없습니다');
      }
    }

    await this.database.db
      .delete(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.userId, userId),
        ),
      );

    await this.audit.record({
      organizationId,
      actorUserId,
      eventType: 'membership.revoked',
      targetType: 'organization',
      targetId: organizationId,
      metadata: { userId },
    });
  }
}
