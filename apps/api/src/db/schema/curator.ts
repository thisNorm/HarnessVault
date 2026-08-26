import { index, integer, jsonb, pgEnum, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { contributions } from './contribution';
import { harnessAssets } from './harness';
import { organizations } from './identity';

export const curatorVerdictEnum = pgEnum('curator_verdict', [
  'DUPLICATE',
  'VARIANT_OF',
  'IMPROVEMENT_ON',
  'CONFLICTS_WITH',
  'NEW',
  'UNKNOWN',
]);

export const curatorComplexityEnum = pgEnum('curator_complexity', ['LOW', 'MEDIUM', 'HIGH']);

/** 실제 모델인지 배선 검증용 대역인지. Mock이 성공인 척 못 하게 하는 필드다(§72). */
export const curatorProviderEnum = pgEnum('curator_provider', ['MOCK', 'OLLAMA']);

export const curatorRunStatusEnum = pgEnum('curator_run_status', ['SUCCEEDED', 'FAILED']);

/**
 * 실행마다 한 줄. 덮어쓰지 않는다 —
 * 모델이 죽어 있다가 살아난 뒤 판단이 바뀐 이력도 남아야 한다.
 */
export const curatorRuns = pgTable(
  'curator_runs',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    contributionId: uuid()
      .notNull()
      .references(() => contributions.id, { onDelete: 'cascade' }),

    status: curatorRunStatusEnum().notNull(),
    provider: curatorProviderEnum().notNull(),
    model: text().notNull().default(''),
    complexity: curatorComplexityEnum().notNull(),
    roundsUsed: integer().notNull().default(0),

    verdict: curatorVerdictEnum(),
    relatedAssetId: uuid().references(() => harnessAssets.id, { onDelete: 'set null' }),
    // 모델은 key로 답한다. 그 key가 실제 자산과 맞지 않아도 무엇을 가리켰는지는 남긴다.
    relatedAssetKey: text(),
    confidence: real(),
    reasoning: text().notNull().default(''),
    suggestedValidations: jsonb().$type<string[]>().notNull().default([]),

    // 실패를 성공으로 위장하지 않는다. CURATOR_UNAVAILABLE 등이 그대로 들어간다.
    failureCode: text(),
    failureMessage: text().notNull().default(''),
    durationMs: integer().notNull().default(0),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('curator_runs_contribution_idx').on(table.contributionId, table.createdAt),
    index('curator_runs_org_idx').on(table.organizationId),
  ],
);
