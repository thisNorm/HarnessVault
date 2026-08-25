import {
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { EMBEDDING_DIMENSIONS, type AssetSelector } from '@harnessvault/domain';
import { organizations, users } from './identity';

/**
 * pgvector 컬럼. 차원 상수를 도메인 패키지 하나에서만 관리하려고 직접 정의한다.
 * 값은 `[1,2,3]` 문자열로 주고받는다.
 */
export const embedding = customType<{ data: number[]; driverData: string }>({
  dataType: () => `vector(${EMBEDDING_DIMENSIONS})`,
  toDriver: (value) => `[${value.join(',')}]`,
  fromDriver: (value) => JSON.parse(value) as number[],
});

export const harnessAssetTypeEnum = pgEnum('harness_asset_type', [
  'RULE',
  'SKILL',
  'WORKFLOW',
  'KNOWLEDGE',
  'VALIDATION',
  'VARIANT',
  'SCRIPT',
  'TEMPLATE',
  'POLICY',
]);

export const assetStatusEnum = pgEnum('asset_status', [
  'DRAFT',
  'ACTIVE',
  'DEPRECATED',
  'ARCHIVED',
]);

export const assetVersionStatusEnum = pgEnum('asset_version_status', [
  'DRAFT',
  'CANDIDATE',
  'ACTIVE',
  'SUPERSEDED',
  'ARCHIVED',
]);

export const scopeTypeEnum = pgEnum('scope_type', ['COMPANY', 'TEAM', 'PROJECT', 'PERSONAL']);

export const inheritanceModeEnum = pgEnum('inheritance_mode', [
  'LOCKED',
  'EXTENDABLE',
  'OVERRIDABLE',
  'DEFAULT',
]);

export const assetOwnerTypeEnum = pgEnum('asset_owner_type', ['USER', 'TEAM', 'GROUP', 'PROJECT']);

export const capabilityOwnerTypeEnum = pgEnum('capability_owner_type', [
  'TEAM',
  'GROUP',
  'PROJECT',
]);

export const assetRelationTypeEnum = pgEnum('asset_relation_type', [
  'DEPENDS_ON',
  'EXTENDS',
  'VARIANT_OF',
  'SUPERSEDES',
  'CONFLICTS_WITH',
  'VALIDATES',
  'REFERENCES',
]);

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** 조직이 보유한 AI 업무능력의 상위 개념. 자산을 묶는 축이다. */
export const capabilities = pgTable(
  'capabilities',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    key: text().notNull(),
    name: text().notNull(),
    description: text().notNull().default(''),
    parentId: uuid().references((): AnyPgColumn => capabilities.id, { onDelete: 'set null' }),
    ownerType: capabilityOwnerTypeEnum().notNull(),
    ownerId: uuid().notNull(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (table) => [
    unique('capabilities_org_key_unique').on(table.organizationId, table.key),
    index('capabilities_parent_idx').on(table.parentId),
  ],
);

/**
 * 논리적 자산. 파일 경로가 아니라 `(organization, key, scope)`가 identity다.
 * 같은 key가 COMPANY·TEAM·PROJECT에 공존해야 상속·override가 성립한다.
 */
export const harnessAssets = pgTable(
  'harness_assets',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    capabilityId: uuid().references(() => capabilities.id, { onDelete: 'set null' }),

    type: harnessAssetTypeEnum().notNull(),
    key: text().notNull(),
    name: text().notNull(),
    description: text().notNull().default(''),

    scopeType: scopeTypeEnum().notNull(),
    // 다형 참조라 외래키를 걸 수 없다.
    // COMPANY=organization, TEAM=team, PROJECT=project, PERSONAL=user를 가리킨다.
    scopeId: uuid().notNull(),

    inheritanceMode: inheritanceModeEnum().notNull().default('DEFAULT'),
    status: assetStatusEnum().notNull().default('DRAFT'),

    ownerType: assetOwnerTypeEnum().notNull(),
    ownerId: uuid().notNull(),

    // Resolver가 버전 본문을 로드하지 않고 필터링할 수 있도록 자산 단위에 둔다.
    selector: jsonb().$type<AssetSelector>().notNull().default({}),
    reviewAfter: timestamp({ withTimezone: true }),

    // 의미 검색용. 임베딩 제공자가 없으면 null로 남고 어휘 검색으로 떨어진다.
    embedding: embedding(),

    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (table) => [
    unique('harness_assets_identity_unique').on(
      table.organizationId,
      table.key,
      table.scopeType,
      table.scopeId,
    ),
    index('harness_assets_org_status_idx').on(table.organizationId, table.status),
    index('harness_assets_scope_idx').on(table.scopeType, table.scopeId),
    index('harness_assets_capability_idx').on(table.capabilityId),
    index('harness_assets_key_idx').on(table.organizationId, table.key),
  ],
);

/**
 * 버전은 삭제하지 않는다(명세 §51). 상태만 전이시킨다.
 *
 * ACTIVE 버전에 부분 유니크 인덱스를 걸지 않는다.
 * 명세 §63 Case 3이 "동일 Asset에 ACTIVE Version 2개" 상태를 Resolver가
 * RESOLUTION_CONFLICT로 검출하도록 요구하므로, DB가 그 상태를 막으면 재현할 수 없다.
 */
export const assetVersions = pgTable(
  'asset_versions',
  {
    id: uuid().primaryKey().defaultRandom(),
    assetId: uuid()
      .notNull()
      .references(() => harnessAssets.id, { onDelete: 'cascade' }),
    version: text().notNull(),
    status: assetVersionStatusEnum().notNull().default('DRAFT'),

    // Source of Truth. renderedMarkdown은 타깃 렌더링 결과 또는 캐시다.
    structuredContent: jsonb().notNull(),
    renderedMarkdown: text(),
    summary: text().notNull().default(''),

    // 거친 추정치다. 실제 토크나이저 결과가 아니다.
    estimatedTokens: integer(),

    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('asset_versions_asset_version_unique').on(table.assetId, table.version),
    index('asset_versions_asset_status_idx').on(table.assetId, table.status),
  ],
);

export const assetRelations = pgTable(
  'asset_relations',
  {
    id: uuid().primaryKey().defaultRandom(),
    fromAssetId: uuid()
      .notNull()
      .references(() => harnessAssets.id, { onDelete: 'cascade' }),
    toAssetId: uuid()
      .notNull()
      .references(() => harnessAssets.id, { onDelete: 'cascade' }),
    type: assetRelationTypeEnum().notNull(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('asset_relations_unique').on(table.fromAssetId, table.toAssetId, table.type),
    index('asset_relations_to_idx').on(table.toAssetId),
    check('asset_relations_no_self', sql`${table.fromAssetId} <> ${table.toAssetId}`),
  ],
);
