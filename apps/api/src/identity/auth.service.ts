import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { LoginInput, PublicUser, RegisterInput } from '@harnessvault/domain';
import { and, count, eq, gt, gte, isNull, like, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import { loginAttempts, organizationMemberships, organizations, sessions, users } from '../db/schema';
import { getEnv } from '../env';
import {
  ipPairKey,
  ipPrefix,
  lockRemainingSeconds,
  nextAfterFailure,
  throttleKey,
  type AttemptRecord,
} from './login-throttle';
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

  async login(
    input: LoginInput,
    /** 없으면 IP 축을 건너뛴다. 모르는 것을 한 통에 몰지 않는다. */
    ip: string | null = null,
  ): Promise<{ user: PublicUser; session: IssuedSession }> {
    const env = getEnv();
    const key = throttleKey(input.email);
    const now = new Date();

    // 계정 축은 확인 **전에** 막는다. 확인하면 그 시간 차이가 계정 존재의 신호가 된다.
    const attempt = await this.loadAttempt(key);
    const accountLock = lockRemainingSeconds(attempt, now);
    if (accountLock !== null) throw this.tooManyAttempts(accountLock);

    const [found] = await this.database.db
      .select()
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);

    // 사용자 없음과 비밀번호 불일치를 구분해 알려주지 않는다.
    const valid = found ? await verifyPassword(input.password, found.passwordHash) : false;
    if (!found || !valid) {
      await this.recordFailures(key, attempt, ip, input.email, now);
      // IP 축은 **여기서만** 본다. 확인 전에 막으면 비밀번호가 맞는 사람까지 잠긴다 —
      // NAT 뒤 사무실 하나가 통째로 로그인하지 못하게 되는 것이 이 축이 막으려던
      // 공격보다 큰 피해다. 맞는 자격증명은 IP와 무관하게 통과한다.
      if (ip) {
        const windowStart = new Date(now.getTime() - env.LOGIN_LOCKOUT_MINUTES * 60_000);
        // 어느 축에 걸렸는지 알려주지 않는다 — 알려주면 IP를 바꾸면 된다는 것을 배운다.
        if (await this.sprayingFromIp(ip, windowStart)) {
          throw this.tooManyAttempts(env.LOGIN_LOCKOUT_MINUTES * 60);
        }
      }
      throw new UnauthorizedException('이메일 또는 비밀번호가 올바르지 않습니다');
    }
    if (found.status !== 'ACTIVE') {
      // 비활성 계정도 실패로 센다. 세지 않으면 무제한으로 두드릴 수 있다.
      await this.recordFailures(key, attempt, ip, input.email, now);
      throw new UnauthorizedException('비활성화된 계정입니다');
    }

    // 성공하면 즉시 지운다. 오타 몇 번이 다음 로그인까지 따라다니지 않게 한다.
    // IP 통은 지우지 않는다 — 같은 IP의 다른 계정 공격이 성공 하나로 초기화되면 안 된다.
    await this.database.db.delete(loginAttempts).where(eq(loginAttempts.email, key));

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

  private tooManyAttempts(retryAfterSeconds: number): HttpException {
    return new HttpException(
      {
        code: 'TOO_MANY_ATTEMPTS',
        message: `로그인 시도가 너무 많습니다. ${Math.ceil(retryAfterSeconds / 60)}분 후 다시 시도하세요`,
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private async loadAttempt(key: string): Promise<AttemptRecord | null> {
    const [row] = await this.database.db
      .select()
      .from(loginAttempts)
      .where(eq(loginAttempts.email, key))
      .limit(1);
    return row
      ? { failedCount: row.failedCount, lockedUntil: row.lockedUntil, lastFailedAt: row.lastFailedAt }
      : null;
  }

  /**
   * 계정 축은 횟수를, IP 축은 (ip, 계정) 쌍을 남긴다.
   *
   * 계정 키는 제출된 이메일 문자열이라 **존재하지 않는 계정도 똑같이 잠긴다** —
   * 잠기는지 여부로 계정 존재가 새어 나가지 않게 하기 위해서다.
   * 쌍은 같은 계정을 몇 번 두드리든 하나다 — 그래서 사무실이 잠기지 않는다.
   */
  private async recordFailures(
    key: string,
    current: AttemptRecord | null,
    ip: string | null,
    email: string,
    now: Date,
  ): Promise<void> {
    await this.recordFailure(key, current, getEnv().LOGIN_MAX_ATTEMPTS, now);
    if (!ip) return;

    await this.database.db
      .insert(loginAttempts)
      .values({ email: ipPairKey(ip, email), failedCount: 1, lastFailedAt: now })
      .onConflictDoUpdate({
        target: loginAttempts.email,
        set: { failedCount: sql`${loginAttempts.failedCount} + 1`, lastFailedAt: now },
      });
  }

  /** 창 안에 이 IP가 실패시킨 **서로 다른 계정 수**가 임계를 넘었는가. */
  private async sprayingFromIp(ip: string, since: Date): Promise<boolean> {
    const [row] = await this.database.db
      .select({ value: count() })
      .from(loginAttempts)
      .where(
        and(
          like(loginAttempts.email, `${ipPrefix(ip)}%`),
          gte(loginAttempts.lastFailedAt, since),
        ),
      );
    return (row?.value ?? 0) >= getEnv().LOGIN_MAX_ACCOUNTS_PER_IP;
  }

  private async recordFailure(
    key: string,
    current: AttemptRecord | null,
    maxAttempts: number,
    now: Date,
  ): Promise<void> {
    const env = getEnv();
    const next = nextAfterFailure(
      current,
      { maxAttempts, lockoutMinutes: env.LOGIN_LOCKOUT_MINUTES },
      now,
    );
    await this.database.db
      .insert(loginAttempts)
      .values({
        email: key,
        failedCount: next.failedCount,
        lockedUntil: next.lockedUntil,
        lastFailedAt: next.lastFailedAt,
      })
      .onConflictDoUpdate({
        target: loginAttempts.email,
        set: {
          failedCount: next.failedCount,
          lockedUntil: next.lockedUntil,
          lastFailedAt: next.lastFailedAt,
        },
      });
  }

  /** 만료됐거나 폐기된 세션 행을 지운다. 운영 중 주기 실행을 염두에 둔 유지보수용이다. */
  async purgeExpiredSessions(): Promise<number> {
    const deleted = await this.database.db
      .delete(sessions)
      .where(sql`${sessions.expiresAt} < now() or ${sessions.revokedAt} is not null`)
      .returning({ id: sessions.id });
    return deleted.length;
  }

  /**
   * 창을 벗어난 로그인 시도 기록을 지운다.
   *
   * IP 축이 (ip, 계정) 쌍마다 한 줄을 만들므로, 계정을 훑는 공격 한 번에
   * 수천 줄이 생긴다. 창을 지나면 판정에 쓰이지 않으니 남길 이유가 없다.
   * 잠금이 아직 살아 있는 줄은 건드리지 않는다.
   */
  async purgeStaleLoginAttempts(): Promise<number> {
    const windowMinutes = getEnv().LOGIN_LOCKOUT_MINUTES;
    const deleted = await this.database.db
      .delete(loginAttempts)
      .where(
        sql`${loginAttempts.lastFailedAt} < now() - make_interval(mins => ${windowMinutes})
            and (${loginAttempts.lockedUntil} is null or ${loginAttempts.lockedUntil} < now())`,
      )
      .returning({ email: loginAttempts.email });
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
