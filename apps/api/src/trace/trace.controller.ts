import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { OrgScopeGuard } from '../identity/org-scope.guard';
import { SessionGuard } from '../identity/session.guard';
import { TraceService } from './trace.service';

@Controller('organizations/:orgId/traces')
@UseGuards(SessionGuard, OrgScopeGuard)
export class TraceController {
  constructor(private readonly traces: TraceService) {}

  @Get()
  async list(@Param('orgId') orgId: string) {
    return {
      traces: await this.traces.list(orgId),
      // 흐름에 묶이지 않은 이벤트를 감추지 않는다.
      untracked: await this.traces.untracked(orgId),
    };
  }

  @Get(':traceId')
  async detail(@Param('orgId') orgId: string, @Param('traceId') traceId: string) {
    return { trace: await this.traces.detail(orgId, traceId) };
  }
}
