import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  type CreateOutputContractInput,
  type ResolveOutputContractInput,
  createOutputContractInputSchema,
  resolveOutputContractInputSchema,
} from '@harnessvault/domain';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentAuth } from '../identity/current-user.decorator';
import { OrgScopeGuard, RequireOrgRole } from '../identity/org-scope.guard';
import { type RequestAuth, SessionGuard } from '../identity/session.guard';
import { OutputContractService } from './output-contract.service';

@Controller('organizations/:orgId/output-contracts')
@UseGuards(SessionGuard, OrgScopeGuard)
export class OutputContractController {
  constructor(private readonly contracts: OutputContractService) {}

  @Get()
  async list(@Param('orgId') orgId: string) {
    return { contracts: await this.contracts.list(orgId) };
  }

  @Post()
  @RequireOrgRole('ORG_ADMIN')
  async create(
    @CurrentAuth() auth: RequestAuth,
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(createOutputContractInputSchema)) input: CreateOutputContractInput,
  ) {
    return { contract: await this.contracts.create(auth.user.id, orgId, input) };
  }

  /** 지금 적용되는 계약을 확인한다. 콘솔과 에이전트가 같은 값을 본다. */
  @Post('resolve')
  @HttpCode(200)
  async resolve(
    @CurrentAuth() auth: RequestAuth,
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(resolveOutputContractInputSchema))
    input: ResolveOutputContractInput,
  ) {
    return {
      outputContract: await this.contracts.resolve(orgId, auth.user.id, input.projectId ?? null),
    };
  }
}
