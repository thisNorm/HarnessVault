import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../identity/session.guard';
import { OrgScopeGuard } from '../identity/org-scope.guard';
import { AnalyticsService } from './analytics.service';

@Controller('organizations/:orgId/analytics')
@UseGuards(SessionGuard, OrgScopeGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get()
  async bundle(@Param('orgId', ParseUUIDPipe) orgId: string, @Query('days') days?: string) {
    // 기본 30일. 0이면 전 구간이다.
    const parsed = days === undefined ? 30 : Number(days);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3650) {
      throw new BadRequestException('days는 0 이상 3650 이하의 정수여야 합니다');
    }
    return { analytics: await this.analytics.bundle(orgId, parsed === 0 ? null : parsed) };
  }
}
