import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import {
  assetVersions,
  harnessAssetTypeEnum,
  harnessAssets,
  scopeTypeEnum,
} from './harness';
import { taskTraces } from './trace';

/**
 * 해석 한 번에 자산 한 줄. 선택된 것도 제외된 것도 남긴다.
 *
 * `task_traces`는 개수만 남기므로 "어느 자산이 실제로 쓰이는가"에 답할 수 없었다.
 * 제외 이력이 더 중요하다 — 계속 후보에 오르는데 매번 밀리는 자산은 쪼개야 한다는 신호다.
 */
export const traceAssetUsage = pgTable(
  'trace_asset_usage',
  {
    id: uuid().primaryKey().defaultRandom(),
    traceId: uuid()
      .notNull()
      .references(() => taskTraces.id, { onDelete: 'cascade' }),
    assetId: uuid()
      .notNull()
      .references(() => harnessAssets.id, { onDelete: 'cascade' }),
    versionId: uuid().references(() => assetVersions.id, { onDelete: 'set null' }),

    selected: boolean().notNull(),
    // 선택 사유 또는 제외 사유. 둘 다 §19가 정한 코드다.
    reasonCode: text().notNull(),
    // 집계할 때마다 자산을 조인하지 않도록 해석 시점 값을 박아 둔다.
    // 자산이 나중에 옮겨져도 "그때 무엇이 쓰였는가"는 바뀌면 안 된다.
    assetType: harnessAssetTypeEnum().notNull(),
    scopeType: scopeTypeEnum().notNull(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('trace_asset_usage_trace_idx').on(table.traceId),
    index('trace_asset_usage_asset_idx').on(table.assetId, table.selected),
    index('trace_asset_usage_created_idx').on(table.createdAt),
  ],
);
