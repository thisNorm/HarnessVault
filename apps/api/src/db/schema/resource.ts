import { boolean, index, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { ResourceConfig } from '@harnessvault/domain';
import { organizations, users } from './identity';

export const resourceTypeEnum = pgEnum('resource_type', [
  'FILE_SYSTEM',
  'DATABASE',
  'GIT',
  'INTERNAL_API',
]);

export const resourceClassificationEnum = pgEnum('resource_classification', [
  'PUBLIC',
  'INTERNAL',
  'RESTRICTED',
  'HIGHLY_RESTRICTED',
]);

export const resourceOwnerTypeEnum = pgEnum('resource_owner_type', [
  'TEAM',
  'GROUP',
  'USER',
  'PROJECT',
]);

/**
 * 회사 내부 Resource. **credential을 담지 않는다.**
 * `credentialRef`는 환경변수 이름이고 실제 값은 실행 시점에만 읽는다(옵션 C).
 */
export const resources = pgTable(
  'resources',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    type: resourceTypeEnum().notNull(),
    name: text().notNull(),
    description: text().notNull().default(''),
    classification: resourceClassificationEnum().notNull().default('INTERNAL'),

    ownerType: resourceOwnerTypeEnum().notNull(),
    ownerId: uuid().notNull(),

    adapterType: text().notNull(),
    // 비밀이 아닌 설정만. root 경로·행 수 제한 등.
    config: jsonb().$type<ResourceConfig>().notNull().default({}),
    // 환경변수 이름. HARNESS_RESOURCE_ 접두사가 강제된다.
    credentialRef: text(),

    enabled: boolean().notNull().default(true),

    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('resources_org_name_unique').on(table.organizationId, table.name),
    index('resources_org_type_idx').on(table.organizationId, table.type),
  ],
);
