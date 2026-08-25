import { boolean, index, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { organizationRoleEnum, organizations, users } from './identity';
import { inheritanceModeEnum, scopeTypeEnum } from './harness';
import { resourceClassificationEnum, resourceTypeEnum, resources } from './resource';

export const policyEffectEnum = pgEnum('policy_effect', ['ALLOW', 'APPROVAL_REQUIRED', 'DENY']);

/**
 * Resource Action 판정 규칙.
 * 선언하지 않은 매칭 조건은 "무엇이든"이다(Selector와 같은 규약).
 */
export const resourcePolicies = pgTable(
  'resource_policies',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),

    name: text().notNull(),
    description: text().notNull().default(''),
    effect: policyEffectEnum().notNull(),

    scopeType: scopeTypeEnum().notNull(),
    // 다형 참조. COMPANY=organization, TEAM=team, PROJECT=project, PERSONAL=user.
    scopeId: uuid().notNull(),
    // LOCKED면 더 구체적인 스코프의 정책이 판정에서 빠진다(§10).
    inheritanceMode: inheritanceModeEnum().notNull().default('DEFAULT'),

    resourceId: uuid().references(() => resources.id, { onDelete: 'cascade' }),
    resourceType: resourceTypeEnum(),
    classification: resourceClassificationEnum(),
    // `*`는 모든 Action을 뜻한다.
    actions: jsonb().$type<string[]>().notNull().default(['*']),
    subjectOrgRole: organizationRoleEnum(),
    subjectGroupId: uuid(),

    // 승인자 해석은 Phase 8이다. 여기는 참조만 담는다.
    approvalPolicyId: uuid(),
    enabled: boolean().notNull().default(true),

    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique('resource_policies_org_name_unique').on(table.organizationId, table.name),
    index('resource_policies_org_enabled_idx').on(table.organizationId, table.enabled),
    index('resource_policies_scope_idx').on(table.scopeType, table.scopeId),
  ],
);
