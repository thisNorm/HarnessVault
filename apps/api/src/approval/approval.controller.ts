import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import {
  type ApprovalDecisionInput,
  type CreateApprovalPolicyInput,
  approvalDecisionInputSchema,
  createApprovalPolicyInputSchema,
} from '@harnessvault/domain';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentAuth } from '../identity/current-user.decorator';
import {
  OrgScopeGuard,
  RequireOrgRole,
  type OrgScopedRequest,
} from '../identity/org-scope.guard';
import { type RequestAuth, SessionGuard } from '../identity/session.guard';
import { ApprovalService } from './approval.service';

@Controller('organizations/:orgId')
@UseGuards(SessionGuard, OrgScopeGuard)
export class ApprovalController {
  constructor(private readonly approvals: ApprovalService) {}

  @Get('approval-policies')
  async listPolicies(@Param('orgId') orgId: string) {
    return { policies: await this.approvals.listPolicies(orgId) };
  }

  @Post('approval-policies')
  @RequireOrgRole('ORG_ADMIN')
  async createPolicy(
    @CurrentAuth() auth: RequestAuth,
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(createApprovalPolicyInputSchema)) input: CreateApprovalPolicyInput,
  ) {
    return { policy: await this.approvals.createPolicy(auth.user.id, orgId, input) };
  }

  @Get('approvals')
  async list(@Param('orgId') orgId: string, @Req() request: OrgScopedRequest) {
    return {
      approvals: await this.approvals.list(orgId, request.auth.user.id, request.orgRole),
    };
  }

  @Get('approvals/:requestId')
  async detail(
    @Param('orgId') orgId: string,
    @Param('requestId') requestId: string,
    @Req() request: OrgScopedRequest,
  ) {
    return {
      approval: await this.approvals.detail(
        orgId,
        requestId,
        request.auth.user.id,
        request.orgRole,
      ),
    };
  }

  @Post('approvals/:requestId/approve')
  @HttpCode(200)
  async approve(
    @CurrentAuth() auth: RequestAuth,
    @Param('orgId') orgId: string,
    @Param('requestId') requestId: string,
    @Body(new ZodValidationPipe(approvalDecisionInputSchema)) input: ApprovalDecisionInput,
  ) {
    return {
      approval: await this.approvals.decide(orgId, requestId, auth.user.id, 'APPROVE', input),
    };
  }

  @Post('approvals/:requestId/reject')
  @HttpCode(200)
  async reject(
    @CurrentAuth() auth: RequestAuth,
    @Param('orgId') orgId: string,
    @Param('requestId') requestId: string,
    @Body(new ZodValidationPipe(approvalDecisionInputSchema)) input: ApprovalDecisionInput,
  ) {
    return {
      approval: await this.approvals.decide(orgId, requestId, auth.user.id, 'REJECT', input),
    };
  }

  @Post('approvals/:requestId/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentAuth() auth: RequestAuth,
    @Param('orgId') orgId: string,
    @Param('requestId') requestId: string,
  ) {
    return { approval: await this.approvals.cancel(orgId, requestId, auth.user.id) };
  }
}
