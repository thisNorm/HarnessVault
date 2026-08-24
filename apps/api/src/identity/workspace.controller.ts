import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  type AddMemberInput,
  type AddProjectMemberInput,
  type CreateGroupInput,
  type CreateProjectInput,
  type CreateTeamInput,
  addMemberInputSchema,
  addProjectMemberInputSchema,
  createGroupInputSchema,
  createProjectInputSchema,
  createTeamInputSchema,
} from '@harnessvault/domain';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentAuth } from './current-user.decorator';
import { OrgScopeGuard, RequireOrgRole } from './org-scope.guard';
import { type RequestAuth, SessionGuard } from './session.guard';
import { WorkspaceService } from './workspace.service';

@Controller('organizations/:orgId')
@UseGuards(SessionGuard, OrgScopeGuard)
export class WorkspaceController {
  constructor(private readonly workspace: WorkspaceService) {}

  /* ---------------- Team ---------------- */

  @Get('teams')
  async listTeams(@Param('orgId') orgId: string) {
    return { teams: await this.workspace.listTeams(orgId) };
  }

  @Post('teams')
  @RequireOrgRole('ORG_ADMIN')
  async createTeam(
    @CurrentAuth() auth: RequestAuth,
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(createTeamInputSchema)) input: CreateTeamInput,
  ) {
    return { team: await this.workspace.createTeam(auth.user.id, orgId, input) };
  }

  @Get('teams/:teamId/members')
  async teamMembers(@Param('orgId') orgId: string, @Param('teamId') teamId: string) {
    return { members: await this.workspace.teamMembers(orgId, teamId) };
  }

  @Post('teams/:teamId/members')
  @RequireOrgRole('ORG_ADMIN')
  async addTeamMember(
    @CurrentAuth() auth: RequestAuth,
    @Param('orgId') orgId: string,
    @Param('teamId') teamId: string,
    @Body(new ZodValidationPipe(addMemberInputSchema)) input: AddMemberInput,
  ) {
    return { member: await this.workspace.addTeamMember(auth.user.id, orgId, teamId, input) };
  }

  @Delete('teams/:teamId/members/:userId')
  @RequireOrgRole('ORG_ADMIN')
  @HttpCode(204)
  async removeTeamMember(
    @CurrentAuth() auth: RequestAuth,
    @Param('orgId') orgId: string,
    @Param('teamId') teamId: string,
    @Param('userId') userId: string,
  ) {
    await this.workspace.removeTeamMember(auth.user.id, orgId, teamId, userId);
  }

  /* ---------------- Group ---------------- */

  @Get('groups')
  async listGroups(@Param('orgId') orgId: string) {
    return { groups: await this.workspace.listGroups(orgId) };
  }

  @Post('groups')
  @RequireOrgRole('ORG_ADMIN')
  async createGroup(
    @CurrentAuth() auth: RequestAuth,
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(createGroupInputSchema)) input: CreateGroupInput,
  ) {
    return { group: await this.workspace.createGroup(auth.user.id, orgId, input) };
  }

  @Get('groups/:groupId/members')
  async groupMembers(@Param('orgId') orgId: string, @Param('groupId') groupId: string) {
    return { members: await this.workspace.groupMembers(orgId, groupId) };
  }

  @Post('groups/:groupId/members')
  @RequireOrgRole('ORG_ADMIN')
  async addGroupMember(
    @CurrentAuth() auth: RequestAuth,
    @Param('orgId') orgId: string,
    @Param('groupId') groupId: string,
    @Body(new ZodValidationPipe(addMemberInputSchema)) input: AddMemberInput,
  ) {
    return { member: await this.workspace.addGroupMember(auth.user.id, orgId, groupId, input) };
  }

  @Delete('groups/:groupId/members/:userId')
  @RequireOrgRole('ORG_ADMIN')
  @HttpCode(204)
  async removeGroupMember(
    @CurrentAuth() auth: RequestAuth,
    @Param('orgId') orgId: string,
    @Param('groupId') groupId: string,
    @Param('userId') userId: string,
  ) {
    await this.workspace.removeGroupMember(auth.user.id, orgId, groupId, userId);
  }

  /* ---------------- Project ---------------- */

  @Get('projects')
  async listProjects(@Param('orgId') orgId: string) {
    return { projects: await this.workspace.listProjects(orgId) };
  }

  @Post('projects')
  @RequireOrgRole('ORG_ADMIN')
  async createProject(
    @CurrentAuth() auth: RequestAuth,
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(createProjectInputSchema)) input: CreateProjectInput,
  ) {
    return { project: await this.workspace.createProject(auth.user.id, orgId, input) };
  }

  @Get('projects/:projectId/members')
  async projectMembers(@Param('orgId') orgId: string, @Param('projectId') projectId: string) {
    return { members: await this.workspace.projectMembers(orgId, projectId) };
  }

  @Post('projects/:projectId/members')
  @RequireOrgRole('ORG_ADMIN')
  async addProjectMember(
    @CurrentAuth() auth: RequestAuth,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(addProjectMemberInputSchema)) input: AddProjectMemberInput,
  ) {
    return {
      member: await this.workspace.addProjectMember(auth.user.id, orgId, projectId, input),
    };
  }

  @Delete('projects/:projectId/members/:userId')
  @RequireOrgRole('ORG_ADMIN')
  @HttpCode(204)
  async removeProjectMember(
    @CurrentAuth() auth: RequestAuth,
    @Param('orgId') orgId: string,
    @Param('projectId') projectId: string,
    @Param('userId') userId: string,
  ) {
    await this.workspace.removeProjectMember(auth.user.id, orgId, projectId, userId);
  }
}
