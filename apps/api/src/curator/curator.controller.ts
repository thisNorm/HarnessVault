import { Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../identity/session.guard';
import { OrgScopeGuard, RequireOrgRole } from '../identity/org-scope.guard';
import type { OrgScopedRequest } from '../identity/org-scope.guard';
import { CuratorService } from './curator.service';

@Controller('organizations/:orgId/contributions/:contributionId/curator')
@UseGuards(SessionGuard, OrgScopeGuard)
export class CuratorController {
  constructor(private readonly curator: CuratorService) {}

  @Get()
  async runs(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('contributionId', ParseUUIDPipe) contributionId: string,
  ) {
    return { runs: await this.curator.listRuns(orgId, contributionId) };
  }

  /**
   * 검토자가 요청할 때만 돈다. 실패해도 4xx가 아니라 실패한 실행 기록을 돌려준다 —
   * Curator 장애는 정상적으로 일어나는 일이고, Candidate는 그대로 유지된다(§61).
   */
  @Post()
  @RequireOrgRole('ORG_ADMIN')
  async review(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('contributionId', ParseUUIDPipe) contributionId: string,
    @Req() request: OrgScopedRequest,
  ) {
    return { run: await this.curator.review(orgId, request.auth.user.id, contributionId) };
  }
}
