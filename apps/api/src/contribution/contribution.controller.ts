import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  contributeInputSchema,
  contributionStatusSchema,
  promoteContributionInputSchema,
  rejectContributionInputSchema,
} from '@harnessvault/domain';
import { z } from 'zod';
import { SessionGuard } from '../identity/session.guard';
import { OrgScopeGuard, RequireOrgRole } from '../identity/org-scope.guard';
import type { OrgScopedRequest } from '../identity/org-scope.guard';
import { ContributionService } from './contribution.service';

function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    // 어디가 틀렸는지 그대로 돌려준다. 에이전트가 스스로 고칠 수 있어야 한다.
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: '입력이 올바르지 않습니다',
      details: z.treeifyError(result.error),
    });
  }
  return result.data;
}

@Controller('organizations/:orgId/contributions')
@UseGuards(SessionGuard, OrgScopeGuard)
export class ContributionController {
  constructor(private readonly contributions: ContributionService) {}

  @Get()
  async list(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('status') status?: string,
    @Query('mine') mine?: string,
    @Req() request?: OrgScopedRequest,
  ) {
    const parsedStatus = status ? contributionStatusSchema.safeParse(status) : null;
    if (parsedStatus && !parsedStatus.success) {
      throw new BadRequestException('알 수 없는 status입니다');
    }
    return {
      contributions: await this.contributions.list(orgId, {
        status: parsedStatus?.data,
        submittedBy: mine === 'true' ? request?.auth.user.id : undefined,
      }),
    };
  }

  @Get(':contributionId')
  async detail(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('contributionId', ParseUUIDPipe) contributionId: string,
  ) {
    return { contribution: await this.contributions.detail(orgId, contributionId) };
  }

  @Post()
  async submit(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: unknown,
    @Req() request: OrgScopedRequest,
  ) {
    return this.contributions.submit(
      orgId,
      request.auth.user.id,
      parse(contributeInputSchema, body),
    );
  }

  // 승격은 조직 관리자만 한다. 자동 승격은 어떤 경로로도 없다.
  @Post(':contributionId/promote')
  @RequireOrgRole('ORG_ADMIN')
  async promote(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('contributionId', ParseUUIDPipe) contributionId: string,
    @Body() body: unknown,
    @Req() request: OrgScopedRequest,
  ) {
    return {
      contribution: await this.contributions.promote(
        orgId,
        request.auth.user.id,
        contributionId,
        parse(promoteContributionInputSchema, body ?? {}),
      ),
    };
  }

  @Post(':contributionId/reject')
  @RequireOrgRole('ORG_ADMIN')
  async reject(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('contributionId', ParseUUIDPipe) contributionId: string,
    @Body() body: unknown,
    @Req() request: OrgScopedRequest,
  ) {
    const { note } = parse(rejectContributionInputSchema, body);
    return {
      contribution: await this.contributions.reject(
        orgId,
        request.auth.user.id,
        contributionId,
        note,
      ),
    };
  }

  @Post(':contributionId/withdraw')
  async withdraw(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('contributionId', ParseUUIDPipe) contributionId: string,
    @Req() request: OrgScopedRequest,
  ) {
    return {
      contribution: await this.contributions.withdraw(
        orgId,
        request.auth.user.id,
        contributionId,
      ),
    };
  }

  /** 기존 자산에 임베딩을 채운다. 임베딩 제공자가 없으면 0건으로 끝난다. */
  @Post('embeddings/backfill')
  @RequireOrgRole('ORG_ADMIN')
  async backfill(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.contributions.backfillEmbeddings(orgId);
  }
}
