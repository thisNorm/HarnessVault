import { boolean, index, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { organizations, users } from './identity';
import { scopeTypeEnum } from './harness';

/**
 * 산출물 계약(§35).
 * 병합 규칙은 합집합 하나뿐이다 — 하위 스코프는 추가만 하고 제거하지 못한다.
 * 자산의 4가지 상속 모드를 쓰지 않는다. 계약에서 "빼기"를 허용할 이유가 없다.
 */
export const outputContracts = pgTable(
  'output_contracts',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    name: text().notNull(),
    description: text().notNull().default(''),

    scopeType: scopeTypeEnum().notNull(),
    // 다형 참조. COMPANY=organization, TEAM=team, PROJECT=project, PERSONAL=user.
    scopeId: uuid().notNull(),

    fields: jsonb().$type<string[]>().notNull(),
    enabled: boolean().notNull().default(true),

    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('output_contracts_org_name_unique').on(table.organizationId, table.name),
    index('output_contracts_scope_idx').on(table.organizationId, table.scopeType, table.scopeId),
  ],
);
