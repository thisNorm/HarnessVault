import { index, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

export const organizationRoleEnum = pgEnum('organization_role', ['ORG_ADMIN', 'ORG_MEMBER']);
export const projectRoleEnum = pgEnum('project_role', [
  'PROJECT_OWNER',
  'PROJECT_LEAD',
  'PROJECT_MEMBER',
]);
export const userStatusEnum = pgEnum('user_status', ['ACTIVE', 'DISABLED']);

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(),
  displayName: text().notNull(),
  // scrypt$N$r$p$<salt-b64>$<hash-b64> — 파라미터를 함께 저장해 비용 상향 후에도 기존 해시를 검증한다.
  passwordHash: text().notNull(),
  status: userStatusEnum().notNull().default('ACTIVE'),
  ...timestamps,
});

export const organizations = pgTable('organizations', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  ...timestamps,
});

export const organizationMemberships = pgTable(
  'organization_memberships',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: organizationRoleEnum().notNull().default('ORG_MEMBER'),
    ...timestamps,
  },
  (table) => [
    unique('organization_memberships_org_user_unique').on(table.organizationId, table.userId),
    index('organization_memberships_user_idx').on(table.userId),
  ],
);

export const teams = pgTable(
  'teams',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    slug: text().notNull(),
    ...timestamps,
  },
  (table) => [unique('teams_org_slug_unique').on(table.organizationId, table.slug)],
);

export const teamMemberships = pgTable(
  'team_memberships',
  {
    id: uuid().primaryKey().defaultRandom(),
    teamId: uuid()
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (table) => [
    unique('team_memberships_team_user_unique').on(table.teamId, table.userId),
    index('team_memberships_user_idx').on(table.userId),
  ],
);

export const projects = pgTable(
  'projects',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    // 프로젝트는 팀에 속할 수도, 조직 직속일 수도 있다.
    teamId: uuid().references(() => teams.id, { onDelete: 'set null' }),
    name: text().notNull(),
    slug: text().notNull(),
    ...timestamps,
  },
  (table) => [unique('projects_org_slug_unique').on(table.organizationId, table.slug)],
);

export const projectMemberships = pgTable(
  'project_memberships',
  {
    id: uuid().primaryKey().defaultRandom(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: projectRoleEnum().notNull().default('PROJECT_MEMBER'),
    ...timestamps,
  },
  (table) => [
    unique('project_memberships_project_user_unique').on(table.projectId, table.userId),
    index('project_memberships_user_idx').on(table.userId),
  ],
);

/** 승인자 지정 단위. Harness Scope가 아니므로 상속 경로에 관여하지 않는다. */
export const groups = pgTable(
  'groups',
  {
    id: uuid().primaryKey().defaultRandom(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    slug: text().notNull(),
    ...timestamps,
  },
  (table) => [unique('groups_org_slug_unique').on(table.organizationId, table.slug)],
);

export const groupMemberships = pgTable(
  'group_memberships',
  {
    id: uuid().primaryKey().defaultRandom(),
    groupId: uuid()
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (table) => [
    unique('group_memberships_group_user_unique').on(table.groupId, table.userId),
    index('group_memberships_user_idx').on(table.userId),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // 원문 토큰은 저장하지 않는다. DB가 유출돼도 세션을 위조할 수 없어야 한다.
    tokenHash: text().notNull().unique(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('sessions_user_idx').on(table.userId)],
);
