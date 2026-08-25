import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations, users } from './identity';
import { taskTraces } from './trace';

/**
 * 구현원칙 #8 — 모든 중요한 상태 변경은 Audit Event를 남긴다.
 * 이 테이블은 append-only다. 갱신·삭제하지 않는다.
 *
 * §38이 나열한 필드 중 `traceId`만 컬럼으로 올렸다 — 타임라인 조인 키이기 때문이다.
 * resourceId · action · policyDecision 등은 이미 metadata에 있고,
 * 대부분 null인 희소 컬럼을 더 두는 것보다 jsonb가 낫다.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid().references(() => organizations.id, { onDelete: 'set null' }),
    // 흐름에 이어 붙일 수 없으면 null이다. 추측해서 채우지 않는다.
    traceId: uuid().references(() => taskTraces.id, { onDelete: 'set null' }),
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
    index('audit_events_trace_idx').on(table.traceId, table.createdAt),
  ],
);
