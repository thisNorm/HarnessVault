import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AddMemberInput,
  AddProjectMemberInput,
  CreateGroupInput,
  CreateProjectInput,
  CreateTeamInput,
  ProjectRole,
} from '@harnessvault/domain';
import { and, count, eq, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import {
  groupMemberships,
  groups,
  organizationMemberships,
  projectMemberships,
  projects,
  teamMemberships,
  teams,
  users,
} from '../db/schema';

export interface ScopeView {
  id: string;
  name: string;
  slug: string;
  memberCount: number;
}

export interface ScopeMemberView {
  userId: string;
  email: string;
  displayName: string;
  role?: ProjectRole;
}

/**
 * Team · Project · Group은 소유 테이블만 다르고 흐름이 같다.
 * 제네릭으로 묶으면 Drizzle 타입 추론이 무너지므로 명시적으로 세 벌 둔다.
 */
@Injectable()
export class WorkspaceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /* ---------------- Team ---------------- */

  async listTeams(organizationId: string): Promise<ScopeView[]> {
    return this.database.db
      .select({
        id: teams.id,
        name: teams.name,
        slug: teams.slug,
        memberCount: sql<number>`count(${teamMemberships.id})::int`,
      })
      .from(teams)
      .leftJoin(teamMemberships, eq(teamMemberships.teamId, teams.id))
      .where(eq(teams.organizationId, organizationId))
      .groupBy(teams.id)
      .orderBy(teams.name);
  }

  async createTeam(actorUserId: string, organizationId: string, input: CreateTeamInput) {
    const [created] = await this.database.db
      .insert(teams)
      .values({ organizationId, name: input.name, slug: input.slug })
      .onConflictDoNothing({ target: [teams.organizationId, teams.slug] })
      .returning();
    if (!created) throw new ConflictException('이미 사용 중인 팀 slug입니다');

    await this.audit.record({
      organizationId,
      actorUserId,
      eventType: 'team.created',
      targetType: 'team',
      targetId: created.id,
      metadata: { slug: created.slug },
    });
    return created;
  }

  async teamMembers(organizationId: string, teamId: string): Promise<ScopeMemberView[]> {
    await this.assertTeam(organizationId, teamId);
    return this.database.db
      .select({ userId: users.id, email: users.email, displayName: users.displayName })
      .from(teamMemberships)
      .innerJoin(users, eq(users.id, teamMemberships.userId))
      .where(eq(teamMemberships.teamId, teamId))
      .orderBy(users.displayName);
  }

  async addTeamMember(
    actorUserId: string,
    organizationId: string,
    teamId: string,
    input: AddMemberInput,
  ): Promise<ScopeMemberView> {
    await this.assertTeam(organizationId, teamId);
    const user = await this.assertOrganizationMember(organizationId, input.userId);

    await this.database.db
      .insert(teamMemberships)
      .values({ teamId, userId: user.id })
      .onConflictDoNothing({ target: [teamMemberships.teamId, teamMemberships.userId] });

    await this.audit.record({
      organizationId,
      actorUserId,
      eventType: 'membership.granted',
      targetType: 'team',
      targetId: teamId,
      metadata: { userId: user.id },
    });
    return { userId: user.id, email: user.email, displayName: user.displayName };
  }

  async removeTeamMember(
    actorUserId: string,
    organizationId: string,
    teamId: string,
    userId: string,
  ): Promise<void> {
    await this.assertTeam(organizationId, teamId);
    await this.database.db
      .delete(teamMemberships)
      .where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.userId, userId)));

    await this.audit.record({
      organizationId,
      actorUserId,
      eventType: 'membership.revoked',
      targetType: 'team',
      targetId: teamId,
      metadata: { userId },
    });
  }

  /* ---------------- Group ---------------- */

  async listGroups(organizationId: string): Promise<ScopeView[]> {
    return this.database.db
      .select({
        id: groups.id,
        name: groups.name,
        slug: groups.slug,
        memberCount: sql<number>`count(${groupMemberships.id})::int`,
      })
      .from(groups)
      .leftJoin(groupMemberships, eq(groupMemberships.groupId, groups.id))
      .where(eq(groups.organizationId, organizationId))
      .groupBy(groups.id)
      .orderBy(groups.name);
  }

  async createGroup(actorUserId: string, organizationId: string, input: CreateGroupInput) {
    const [created] = await this.database.db
      .insert(groups)
      .values({ organizationId, name: input.name, slug: input.slug })
      .onConflictDoNothing({ target: [groups.organizationId, groups.slug] })
      .returning();
    if (!created) throw new ConflictException('이미 사용 중인 그룹 slug입니다');

    await this.audit.record({
      organizationId,
      actorUserId,
      eventType: 'group.created',
      targetType: 'group',
      targetId: created.id,
      metadata: { slug: created.slug },
    });
    return created;
  }

  async groupMembers(organizationId: string, groupId: string): Promise<ScopeMemberView[]> {
    await this.assertGroup(organizationId, groupId);
    return this.database.db
      .select({ userId: users.id, email: users.email, displayName: users.displayName })
      .from(groupMemberships)
      .innerJoin(users, eq(users.id, groupMemberships.userId))
      .where(eq(groupMemberships.groupId, groupId))
      .orderBy(users.displayName);
  }

  async addGroupMember(
    actorUserId: string,
    organizationId: string,
    groupId: string,
    input: AddMemberInput,
  ): Promise<ScopeMemberView> {
    await this.assertGroup(organizationId, groupId);
    const user = await this.assertOrganizationMember(organizationId, input.userId);

    await this.database.db
      .insert(groupMemberships)
      .values({ groupId, userId: user.id })
      .onConflictDoNothing({ target: [groupMemberships.groupId, groupMemberships.userId] });

    await this.audit.record({
      organizationId,
      actorUserId,
      eventType: 'membership.granted',
      targetType: 'group',
      targetId: groupId,
      metadata: { userId: user.id },
    });
    return { userId: user.id, email: user.email, displayName: user.displayName };
  }

  async removeGroupMember(
    actorUserId: string,
    organizationId: string,
    groupId: string,
    userId: string,
  ): Promise<void> {
    await this.assertGroup(organizationId, groupId);
    await this.database.db
      .delete(groupMemberships)
      .where(and(eq(groupMemberships.groupId, groupId), eq(groupMemberships.userId, userId)));

    await this.audit.record({
      organizationId,
      actorUserId,
      eventType: 'membership.revoked',
      targetType: 'group',
      targetId: groupId,
      metadata: { userId },
    });
  }

  /* ---------------- Project ---------------- */

  async listProjects(organizationId: string): Promise<ScopeView[]> {
    return this.database.db
      .select({
        id: projects.id,
        name: projects.name,
        slug: projects.slug,
        memberCount: sql<number>`count(${projectMemberships.id})::int`,
      })
      .from(projects)
      .leftJoin(projectMemberships, eq(projectMemberships.projectId, projects.id))
      .where(eq(projects.organizationId, organizationId))
      .groupBy(projects.id)
      .orderBy(projects.name);
  }

  async createProject(actorUserId: string, organizationId: string, input: CreateProjectInput) {
    if (input.teamId) await this.assertTeam(organizationId, input.teamId);

    const [created] = await this.database.db
      .insert(projects)
      .values({
        organizationId,
        teamId: input.teamId ?? null,
        name: input.name,
        slug: input.slug,
      })
      .onConflictDoNothing({ target: [projects.organizationId, projects.slug] })
      .returning();
    if (!created) throw new ConflictException('이미 사용 중인 프로젝트 slug입니다');

    await this.audit.record({
      organizationId,
      actorUserId,
      eventType: 'project.created',
      targetType: 'project',
      targetId: created.id,
      metadata: { slug: created.slug, teamId: created.teamId },
    });
    return created;
  }

  async projectMembers(organizationId: string, projectId: string): Promise<ScopeMemberView[]> {
    await this.assertProject(organizationId, projectId);
    return this.database.db
      .select({
        userId: users.id,
        email: users.email,
        displayName: users.displayName,
        role: projectMemberships.role,
      })
      .from(projectMemberships)
      .innerJoin(users, eq(users.id, projectMemberships.userId))
      .where(eq(projectMemberships.projectId, projectId))
      .orderBy(users.displayName);
  }

  async addProjectMember(
    actorUserId: string,
    organizationId: string,
    projectId: string,
    input: AddProjectMemberInput,
  ): Promise<ScopeMemberView> {
    await this.assertProject(organizationId, projectId);
    const user = await this.assertOrganizationMember(organizationId, input.userId);

    const [membership] = await this.database.db
      .insert(projectMemberships)
      .values({ projectId, userId: user.id, role: input.role })
      .onConflictDoUpdate({
        target: [projectMemberships.projectId, projectMemberships.userId],
        set: { role: input.role },
      })
      .returning();
    if (!membership) throw new ConflictException('멤버십을 저장하지 못했습니다');

    await this.audit.record({
      organizationId,
      actorUserId,
      eventType: 'membership.granted',
      targetType: 'project',
      targetId: projectId,
      metadata: { userId: user.id, role: input.role },
    });
    return {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      role: membership.role,
    };
  }

  async removeProjectMember(
    actorUserId: string,
    organizationId: string,
    projectId: string,
    userId: string,
  ): Promise<void> {
    await this.assertProject(organizationId, projectId);

    // PROJECT_OWNER가 한 명도 없는 프로젝트가 생기지 않게 막는다.
    const [target] = await this.database.db
      .select({ role: projectMemberships.role })
      .from(projectMemberships)
      .where(and(eq(projectMemberships.projectId, projectId), eq(projectMemberships.userId, userId)))
      .limit(1);
    if (!target) throw new NotFoundException('프로젝트 멤버가 아닙니다');

    if (target.role === 'PROJECT_OWNER') {
      const [ownerRow] = await this.database.db
        .select({ value: count() })
        .from(projectMemberships)
        .where(
          and(
            eq(projectMemberships.projectId, projectId),
            eq(projectMemberships.role, 'PROJECT_OWNER'),
          ),
        );
      if ((ownerRow?.value ?? 0) <= 1) {
        throw new ConflictException('마지막 PROJECT_OWNER는 제거할 수 없습니다');
      }
    }

    await this.database.db
      .delete(projectMemberships)
      .where(
        and(eq(projectMemberships.projectId, projectId), eq(projectMemberships.userId, userId)),
      );

    await this.audit.record({
      organizationId,
      actorUserId,
      eventType: 'membership.revoked',
      targetType: 'project',
      targetId: projectId,
      metadata: { userId },
    });
  }

  /* ---------------- 공통 확인 ---------------- */

  /** 다른 조직의 자원을 id만 알고 조작하지 못하게 막는다. */
  private async assertTeam(organizationId: string, teamId: string): Promise<void> {
    const [found] = await this.database.db
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.id, teamId), eq(teams.organizationId, organizationId)))
      .limit(1);
    if (!found) throw new NotFoundException('팀을 찾을 수 없습니다');
  }

  private async assertGroup(organizationId: string, groupId: string): Promise<void> {
    const [found] = await this.database.db
      .select({ id: groups.id })
      .from(groups)
      .where(and(eq(groups.id, groupId), eq(groups.organizationId, organizationId)))
      .limit(1);
    if (!found) throw new NotFoundException('그룹을 찾을 수 없습니다');
  }

  private async assertProject(organizationId: string, projectId: string): Promise<void> {
    const [found] = await this.database.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
      .limit(1);
    if (!found) throw new NotFoundException('프로젝트를 찾을 수 없습니다');
  }

  /** 조직 멤버가 아닌 사용자를 팀·프로젝트·그룹에 넣지 않는다. */
  private async assertOrganizationMember(organizationId: string, userId: string) {
    const [found] = await this.database.db
      .select({ id: users.id, email: users.email, displayName: users.displayName })
      .from(organizationMemberships)
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .where(
        and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.userId, userId),
        ),
      )
      .limit(1);
    if (!found) throw new NotFoundException('조직 멤버가 아닙니다');
    return found;
  }
}
