import { index, jsonb, pgEnum, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import {
  assetVersions,
  capabilities,
  embedding,
  harnessAssetTypeEnum,
  harnessAssets,
  scopeTypeEnum,
} from './harness';
import { organizations, users } from './identity';
import { taskTraces } from './trace';

export const contributionStatusEnum = pgEnum('contribution_status', [
  'CANDIDATE',
  'PROMOTED',
  'REJECTED',
  'WITHDRAWN',
]);

export const similarityMethodEnum = pgEnum('similarity_method', ['VECTOR', 'LEXICAL']);

export const embeddingStatusEnum = pgEnum('embedding_status', ['NOT_CONFIGURED', 'OK', 'FAILED']);

/**
 * 개인이 발견한 지식을 조직 자산으로 되돌리는 통로.
 * 자동으로 자산이 되지 않는다 — PROMOTED로 가는 유일한 길은 사람의 명시적 행위다.
 */
export const contributions = pgTable(
  'contributions',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    submittedByUserId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // 어느 작업에서 나온 지식인지. 흐름을 지워도 기여는 남아야 하므로 set null이다.
    traceId: uuid().references(() => taskTraces.id, { onDelete: 'set null' }),

    status: contributionStatusEnum().notNull().default('CANDIDATE'),
    type: harnessAssetTypeEnum().notNull(),
    proposedKey: text().notNull(),
    name: text().notNull(),
    description: text().notNull().default(''),
    summary: text().notNull().default(''),
    rationale: text().notNull().default(''),
    structuredContent: jsonb().notNull(),

    capabilityId: uuid().references(() => capabilities.id, { onDelete: 'set null' }),
    proposedScopeType: scopeTypeEnum().notNull(),
    proposedScopeId: uuid(),

    // 중복이어도 거절하지 않는다. 사실만 기록하고 사람이 판단한다.
    duplicateOfAssetId: uuid().references(() => harnessAssets.id, { onDelete: 'set null' }),
    duplicateScore: real(),
    similarityMethod: similarityMethodEnum().notNull().default('LEXICAL'),
    embeddingStatus: embeddingStatusEnum().notNull().default('NOT_CONFIGURED'),
    embedding: embedding(),

    reviewedByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp({ withTimezone: true }),
    reviewNote: text().notNull().default(''),
    promotedAssetId: uuid().references(() => harnessAssets.id, { onDelete: 'set null' }),
    promotedVersionId: uuid().references(() => assetVersions.id, { onDelete: 'set null' }),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('contributions_org_status_idx').on(table.organizationId, table.status),
    index('contributions_submitter_idx').on(table.submittedByUserId),
    index('contributions_trace_idx').on(table.traceId),
  ],
);
