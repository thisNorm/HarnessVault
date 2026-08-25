import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  type CreatePolicyInput,
  type EvaluatePolicyInput,
  type UpdatePolicyInput,
  createPolicyInputSchema,
  evaluatePolicyInputSchema,
  updatePolicyInputSchema,
} from '@harnessvault/domain';
import { NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DatabaseService } from '../db/database.service';
import { resources } from '../db/schema';
import { CurrentAuth } from '../identity/current-user.decorator';
import { OrgScopeGuard, RequireOrgRole } from '../identity/org-scope.guard';
import { type RequestAuth, SessionGuard } from '../identity/session.guard';
import { PolicyService } from './policy.service';

@Controller('organizations/:orgId/policies')
@UseGuards(SessionGuard, OrgScopeGuard)
export class PolicyController {
  constructor(
    private readonly policies: PolicyService,
    private readonly database: DatabaseService,
  ) {}

  @Get()
  async list(@Param('orgId') orgId: string) {
    return { policies: await this.policies.list(orgId) };
  }

  @Post()
  @RequireOrgRole('ORG_ADMIN')
  async create(
    @CurrentAuth() auth: RequestAuth,
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(createPolicyInputSchema)) input: CreatePolicyInput,
  ) {
    return { policy: await this.policies.create(auth.user.id, orgId, input) };
  }

  @Patch(':policyId')
  @RequireOrgRole('ORG_ADMIN')
  async update(
    @CurrentAuth() auth: RequestAuth,
    @Param('orgId') orgId: string,
    @Param('policyId') policyId: string,
    @Body(new ZodValidationPipe(updatePolicyInputSchema)) input: UpdatePolicyInput,
  ) {
    return { policy: await this.policies.update(auth.user.id, orgId, policyId, input) };
  }

  /** 판정만 해 보는 dry-run. 실행하지 않는다. 콘솔이 "지금 어떻게 판정되는지"를 보여준다. */
  @Post('evaluate')
  @HttpCode(200)
  async evaluate(
    @CurrentAuth() auth: RequestAuth,
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(evaluatePolicyInputSchema)) input: EvaluatePolicyInput,
  ) {
    const [resource] = await this.database.db
      .select()
      .from(resources)
      .where(and(eq(resources.id, input.resourceId), eq(resources.organizationId, orgId)))
      .limit(1);
    if (!resource) throw new NotFoundException('Resource를 찾을 수 없습니다');

    const decision = await this.policies.decide(
      orgId,
      { userId: auth.user.id, projectId: input.projectId ?? null },
      { id: resource.id, type: resource.type, classification: resource.classification },
      input.action,
    );
    return { decision };
  }
}
