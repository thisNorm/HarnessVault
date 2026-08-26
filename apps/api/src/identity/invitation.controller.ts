import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { createInvitationInputSchema, type CreateInvitationInput } from '@harnessvault/domain';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentAuth } from './current-user.decorator';
import { SessionGuard, type RequestAuth } from './session.guard';
import { OrgScopeGuard, RequireOrgRole } from './org-scope.guard';
import { InvitationService } from './invitation.service';

@Controller('organizations/:orgId/invitations')
@UseGuards(SessionGuard, OrgScopeGuard)
export class OrganizationInvitationController {
  constructor(private readonly invitations: InvitationService) {}

  @Get()
  @RequireOrgRole('ORG_ADMIN')
  async list(@Param('orgId', ParseUUIDPipe) orgId: string) {
    // 토큰은 여기 나오지 않는다. 생성 응답에서 한 번만 나간다.
    return { invitations: await this.invitations.list(orgId) };
  }

  @Post()
  @RequireOrgRole('ORG_ADMIN')
  async create(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body(new ZodValidationPipe(createInvitationInputSchema)) input: CreateInvitationInput,
    @CurrentAuth() auth: RequestAuth,
  ) {
    const issued = await this.invitations.create(orgId, auth.user.id, input);
    // 이메일을 보내지 않는다. 관리자가 이 링크를 복사해 전달한다.
    return { invitation: issued };
  }

  @Delete(':invitationId')
  @RequireOrgRole('ORG_ADMIN')
  async revoke(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @CurrentAuth() auth: RequestAuth,
  ) {
    return { invitation: await this.invitations.revoke(orgId, auth.user.id, invitationId) };
  }
}

/**
 * 초대받은 사람이 쓰는 경로. 조직 멤버가 아니므로 OrgScopeGuard를 걸지 않는다.
 * 다만 **로그인은 필요하다** — 초대 링크가 가입 절차를 대신하지 않는다.
 */
@Controller('invitations')
@UseGuards(SessionGuard)
export class InvitationController {
  constructor(private readonly invitations: InvitationService) {}

  @Get(':token')
  async preview(@Param('token') token: string) {
    return { invitation: await this.invitations.preview(token) };
  }

  @Post(':token/accept')
  @HttpCode(200)
  async accept(@Param('token') token: string, @CurrentAuth() auth: RequestAuth) {
    return this.invitations.accept(token, auth.user.id);
  }
}
