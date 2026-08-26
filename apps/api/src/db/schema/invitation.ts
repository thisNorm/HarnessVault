import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizationRoleEnum, organizations, users } from './identity';

// EXPIRED가 없다. 만료는 저장된 상태가 아니라 expiresAt과의 비교다.
export const invitationStoredStatusEnum = pgEnum('invitation_stored_status', [
  'PENDING',
  'ACCEPTED',
  'REVOKED',
]);

/**
 * 조직 초대. 이메일을 보내지 않는다 — 링크를 만드는 것까지가 이 테이블의 일이고
 * 전달은 사람이 한다(§70: 명세에 없는 인프라를 도입하지 않는다).
 */
export const invitations = pgTable(
  'invitations',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    // 누구를 부른 것인지 보여주는 용도다. 수락 시 이 이메일을 강제하지 않는다.
    email: text().notNull(),
    role: organizationRoleEnum().notNull().default('ORG_MEMBER'),

    // 원문은 저장하지 않는다. 세션 토큰과 같은 태도다 —
    // DB가 새어도 초대 링크를 재구성할 수 없다.
    tokenHash: text().notNull().unique(),

    status: invitationStoredStatusEnum().notNull().default('PENDING'),
    note: text().notNull().default(''),
    expiresAt: timestamp({ withTimezone: true }).notNull(),

    invitedByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    // 초대한 이메일과 다른 사람이 수락할 수 있다. 누가 수락했는지는 반드시 남긴다.
    acceptedByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    acceptedAt: timestamp({ withTimezone: true }),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('invitations_org_status_idx').on(table.organizationId, table.status),
    index('invitations_expires_idx').on(table.expiresAt),
  ],
);
