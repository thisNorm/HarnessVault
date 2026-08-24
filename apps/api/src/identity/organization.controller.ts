import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  type AddOrganizationMemberInput,
  type CreateOrganizationInput,
  addOrganizationMemberInputSchema,
  createOrganizationInputSchema,
} from '@harnessvault/domain';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService } from './auth.service';
import { CurrentAuth } from './current-user.decorator';
import { OrgScopeGuard, RequireOrgRole } from './org-scope.guard';
import { OrganizationService } from './organization.service';
import { type RequestAuth, SessionGuard } from './session.guard';

@Controller('organizations')
@UseGuards(SessionGuard)
export class OrganizationController {
  constructor(
    private readonly organizations: OrganizationService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  async list(@CurrentAuth() auth: RequestAuth) {
    return { organizations: await this.auth.organizationsOf(auth.user.id) };
  }

  @Post()
  async create(
    @CurrentAuth() auth: RequestAuth,
    @Body(new ZodValidationPipe(createOrganizationInputSchema)) input: CreateOrganizationInput,
  ) {
    return { organization: await this.organizations.create(auth.user.id, input) };
  }

  @Get(':orgId')
  @UseGuards(OrgScopeGuard)
  async detail(@Param('orgId') orgId: string) {
    return { organization: await this.organizations.findById(orgId) };
  }

  @Get(':orgId/members')
  @UseGuards(OrgScopeGuard)
  async members(@Param('orgId') orgId: string) {
    return { members: await this.organizations.members(orgId) };
  }

  @Post(':orgId/members')
  @UseGuards(OrgScopeGuard)
  @RequireOrgRole('ORG_ADMIN')
  async addMember(
    @CurrentAuth() auth: RequestAuth,
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(addOrganizationMemberInputSchema))
    input: AddOrganizationMemberInput,
  ) {
    return { member: await this.organizations.addMember(auth.user.id, orgId, input) };
  }

  @Delete(':orgId/members/:userId')
  @UseGuards(OrgScopeGuard)
  @RequireOrgRole('ORG_ADMIN')
  @HttpCode(204)
  async removeMember(
    @CurrentAuth() auth: RequestAuth,
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
  ) {
    await this.organizations.removeMember(auth.user.id, orgId, userId);
  }
}
