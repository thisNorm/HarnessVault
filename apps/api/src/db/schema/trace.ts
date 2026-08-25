import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organizations, projects, users } from './identity';

export const traceStatusEnum = pgEnum('trace_status', [
  'OPEN',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

export const modelSourceEnum = pgEnum('model_source', [
  'VERIFIED',
  'CLIENT_REPORTED',
  'UNKNOWN',
]);

/**
 * 외부 AI의 한 업무 단위(§37).
 * 이 행이 감사 타임라인을 묶는 단위다.
 */
export const taskTraces = pgTable(
  'task_traces',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: uuid().references(() => projects.id, { onDelete: 'set null' }),

    clientName: text(),
    clientVersion: text(),
    modelName: text(),
    // 클라이언트 자가 보고를 검증된 값처럼 보여주면 감사가 거짓말을 한다(§59).
    modelSource: modelSourceEnum().notNull().default('UNKNOWN'),

    purpose: text().notNull(),
    status: traceStatusEnum().notNull().default('OPEN'),
    summary: text(),

    // §41 Context 효율 — 전부 추정치다. 이름에 estimated를 남긴다.
    candidateAssetCount: integer(),
    selectedAssetCount: integer(),
    estimatedAvailableTokens: integer(),
    estimatedInjectedTokens: integer(),

    // §40 토큰 계량 — 갈래를 구분한다.
    harnessInputTokens: integer(),
    harnessOutputTokens: integer(),
    curatorInputTokens: integer(),
    curatorReasoningTokens: integer(),
    curatorOutputTokens: integer(),
    // 외부 AI가 보고하지 않으면 NULL이다. 0으로 바꾸지 않는다.
    clientReportedInputTokens: integer(),
    clientReportedOutputTokens: integer(),

    // §35 산출물 계약. 못 채운 항목이 있어도 흐름은 닫되 그 사실을 남긴다.
    outputContractSatisfied: boolean(),
    missingOutputFields: jsonb().$type<string[]>(),

    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    index('task_traces_org_started_idx').on(table.organizationId, table.startedAt),
    index('task_traces_user_idx').on(table.userId),
    index('task_traces_status_idx').on(table.organizationId, table.status),
  ],
);
