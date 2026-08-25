import { Body, Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { type ResolveTaskInput, resolveTaskInputSchema } from '@harnessvault/domain';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentAuth } from '../identity/current-user.decorator';
import { OrgScopeGuard } from '../identity/org-scope.guard';
import { type RequestAuth, SessionGuard } from '../identity/session.guard';
import { ResolverService } from './resolver.service';

@Controller('organizations/:orgId')
@UseGuards(SessionGuard, OrgScopeGuard)
export class ResolverController {
  constructor(private readonly resolver: ResolverService) {}

  /**
   * 조직 멤버면 호출할 수 있다. 결과는 호출자 자신의 컨텍스트로 계산된다.
   * Phase 5의 MCP `company.resolve_task`가 같은 서비스를 호출한다.
   */
  @Post('resolve')
  @HttpCode(200)
  async resolve(
    @CurrentAuth() auth: RequestAuth,
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(resolveTaskInputSchema)) input: ResolveTaskInput,
  ) {
    return { manifest: await this.resolver.resolve(orgId, auth.user.id, input) };
  }
}
