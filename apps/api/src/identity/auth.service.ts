import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { LoginInput, PublicUser, RegisterInput } from '@harnessvault/domain';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import { organizationMemberships, organizations, sessions, users } from '../db/schema';
import { getEnv } from '../env';
import { hashPassword, verifyPassword } from './password';
import { generateSessionToken, hashSessionToken } from './session-token';

export interface IssuedSession {
  token: string;
  expiresAt: Date;
}

export interface AuthenticatedIdentity {
  user: PublicUser;
  sessionId: string;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  role: 'ORG_ADMIN' | 'ORG_MEMBER';
}

function toPublicUser(row: typeof users.$inferSelect): PublicUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    status: row.status,
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async register(input: RegisterInput): Promise<PublicUser> {
    const passwordHash = await hashPassword(input.password);
    const [created] = await this.database.db
      .insert(users)
      .values({ email: input.email, displayName: input.displayName, passwordHash })
      .onConflictDoNothing({ target: users.email })
      .returning();

    if (!created) {
      throw new ConflictException('이미 가입된 이메일입니다');
    }

    await this.audit.record({
      actorUserId: created.id,
      eventType: 'user.registered',
      targetType: 'user',
      targetId: created.id,
      metadata: { email: created.email },
    });

    return toPublicUser(created);
  }

  async login(input: LoginInput): Promise<{ user: PublicUser; session: IssuedSession }> {
    const [found] = await this.database.db
      .select()
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);

    // 사용자 없음과 비밀번호 불일치를 구분해 알려주지 않는다.
    const valid = found ? await verifyPassword(input.password, found.passwordHash) : false;
    if (!found || !valid) {
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다');
    }
    if (found.status !== 'ACTIVE') {
      throw new UnauthorizedException('비활성화된 계정입니다');
    }

    const session = await this.issueSession(found.id);
    await this.audit.record({
      actorUserId: found.id,
      eventType: 'session.created',
      targetType: 'user',
      targetId: found.id,
    });

    return { user: toPublicUser(found), session };
  }

  async logout(token: string): Promise<void> {
    const [revoked] = await this.database.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.tokenHash, hashSessionToken(token)), isNull(sessions.revokedAt)))
      .returning();

    if (revoked) {
      await this.audit.record({
        actorUserId: revoked.userId,
        eventType: 'session.revoked',
        targetType: 'session',
        targetId: revoked.id,
      });
    }
  }

  /** 유효한 세션이면 사용자를, 아니면 null을 돌려준다. 만료·폐기를 구분해 노출하지 않는다. */
  async resolveSession(token: string): Promise<AuthenticatedIdentity | null> {
    const [row] = await this.database.db
      .select({ user: users, sessionId: sessions.id })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, hashSessionToken(token)),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
          eq(users.status, 'ACTIVE'),
        ),
      )
      .limit(1);

    if (!row) return null;
    return { user: toPublicUser(row.user), sessionId: row.sessionId };
  }

  async organizationsOf(userId: string): Promise<OrganizationSummary[]> {
    return this.database.db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        role: organizationMemberships.role,
      })
      .from(organizationMemberships)
      .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
      .where(eq(organizationMemberships.userId, userId))
      .orderBy(organizations.name);
  }

  /** 만료됐거나 폐기된 세션 행을 지운다. 운영 중 주기 실행을 염두에 둔 유지보수용이다. */
  async purgeExpiredSessions(): Promise<number> {
    const deleted = await this.database.db
      .delete(sessions)
      .where(sql`${sessions.expiresAt} < now() or ${sessions.revokedAt} is not null`)
      .returning({ id: sessions.id });
    return deleted.length;
  }

  private async issueSession(userId: string): Promise<IssuedSession> {
    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + getEnv().SESSION_TTL_HOURS * 60 * 60 * 1000);
    await this.database.db
      .insert(sessions)
      .values({ userId, tokenHash: hashSessionToken(token), expiresAt });
    return { token, expiresAt };
  }
}
