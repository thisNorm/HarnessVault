import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../db/database.service';

@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  async check(): Promise<{ status: 'ok'; db: 'ok' }> {
    const ping = await this.database.ping();
    if (!ping.ok) {
      // 실패를 200 응답으로 감추지 않는다.
      throw new ServiceUnavailableException({ status: 'error', db: 'down', reason: ping.reason });
    }
    return { status: 'ok', db: 'ok' };
  }
}
