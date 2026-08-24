import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations, users } from './identity';

/**
 * 구현원칙 #8 — 모든 중요한 상태 변경은 Audit Event를 남긴다.
 * 이 테이블은 append-only다. 갱신·삭제하지 않는다.
 * Phase 9에서 traceId · 정책 결정 · 리소스 접근 컬럼이 추가된다.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid().references(() => organizations.id, { onDelete: 'set null' }),
    actorUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    eventType: text().notNull(),
    targetType: text(),
    targetId: text(),
    // 민감 값(비밀번호·세션 토큰·credential)은 넣지 않는다.
    metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    // 서버 시각만 신뢰한다.
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_events_org_created_idx').on(table.organizationId, table.createdAt),
    index('audit_events_actor_idx').on(table.actorUserId),
    index('audit_events_type_idx').on(table.eventType),
  ],
);
