import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getEnv } from '../env';
import * as schema from './schema';

export type PingResult = { ok: true } | { ok: false; reason: string };

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly sql = postgres(getEnv().DATABASE_URL, { max: 10 });

  readonly db = drizzle(this.sql, { schema });

  async onModuleDestroy(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }

  /** 연결 가능 여부를 확인한다. 실패 사유를 삼키지 않고 그대로 돌려준다. */
  async ping(): Promise<PingResult> {
    try {
      await this.sql`select 1`;
      return { ok: true };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`데이터베이스 연결 실패: ${reason}`);
      return { ok: false, reason };
    }
  }
}
