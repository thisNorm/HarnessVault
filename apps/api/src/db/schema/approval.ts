import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type { ApproverSpec } from '@harnessvault/domain';
import { organizations, projects, users } from './identity';
import { resourceClassificationEnum, resourceTypeEnum, resources } from './resource';

export const approvalStatusEnum = pgEnum('approval_status', [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
  'EXECUTING',
  'EXECUTED',
  'FAILED',
]);

export const approvalModeEnum = pgEnum('approval_mode', ['ANY_OF', 'ALL_OF', 'N_OF_M']);
export const approvalDecisionEnum = pgEnum('approval_decision', ['APPROVE', 'REJECT']);

/** 승인자를 코드에 하드코딩하지 않는다(§31). */
export const approvalPolicies = pgTable(
  'approval_policies',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    name: text().notNull(),
    description: text().notNull().default(''),
    mode: approvalModeEnum().notNull(),
    requiredCount: integer(),
    // approver 항목 목록. ALL_OF는 항목마다 최소 한 명을 요구한다.
    approvers: jsonb().$type<ApproverSpec[]>().notNull(),

    resourceId: uuid().references(() => resources.id, { onDelete: 'cascade' }),
    resourceType: resourceTypeEnum(),
    classification: resourceClassificationEnum(),

    expiresInMinutes: integer().notNull().default(1440),
    enabled: boolean().notNull().default(true),

    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [unique('approval_policies_org_name_unique').on(table.organizationId, table.name)],
);

/**
 * 승인 요청. `requestPayload`는 **서버가 보관하고 실행 시 이것을 쓴다**.
 * 클라이언트가 실행 단계에서 다시 보낸 값을 쓰면
 * "안전한 쿼리로 승인받고 위험한 쿼리로 실행"이 가능해진다(§34).
 */
export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    traceId: uuid(),

    requesterUserId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // 클라이언트가 스스로 보고한 값이다. 신뢰하지 않고 기록만 한다(§59).
    clientName: text(),
    clientReportedModel: text(),

    projectId: uuid().references(() => projects.id, { onDelete: 'set null' }),
    resourceId: uuid()
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    action: text().notNull(),
    requestPayload: jsonb().$type<Record<string, unknown>>().notNull(),
    /** 승인자가 보는 "무엇이 바뀌는가". 사람이 읽는 요약이다. */
    proposedChange: text().notNull(),

    reason: text().notNull(),
    risk: text(),
    rollbackPlan: text(),
    verificationPlan: text(),

    // 왜 승인이 필요했는지. 승인 화면이 사람에게 보여준다(§55).
    policyIds: jsonb().$type<string[]>().notNull().default([]),
    approvalPolicyId: uuid().references(() => approvalPolicies.id, { onDelete: 'set null' }),

    status: approvalStatusEnum().notNull().default('PENDING'),
    failureReason: text(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }),
    decidedAt: timestamp({ withTimezone: true }),
    executedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    index('approval_requests_org_status_idx').on(table.organizationId, table.status),
    index('approval_requests_requester_idx').on(table.requesterUserId),
  ],
);

export const approvalDecisions = pgTable(
  'approval_decisions',
  {
    id: uuid().primaryKey().defaultRandom(),
    requestId: uuid()
      .notNull()
      .references(() => approvalRequests.id, { onDelete: 'cascade' }),
    approverUserId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    decision: approvalDecisionEnum().notNull(),
    comment: text().notNull().default(''),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // 한 사람이 같은 요청에 두 번 판단하지 않는다.
    unique('approval_decisions_request_user_unique').on(table.requestId, table.approverUserId),
    index('approval_decisions_request_idx').on(table.requestId),
  ],
);
