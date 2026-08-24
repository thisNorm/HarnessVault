import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getEnv } from '../env';
import * as schema from './schema';

export type PingResult = { ok: true } | { ok: false; reason: string };

/** postgres.js는 연결 오류에서 message가 비어 있는 경우가 있어 name·code까지 합쳐 진단 가능하게 만든다. */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const code = (error as { code?: string }).code;
  const parts = [error.name, code, error.message].filter((part) => Boolean(part));
  return [...new Set(parts)].join(' ') || 'unknown error';
}

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
      const reason = describeError(error);
      this.logger.error(`데이터베이스 연결 실패: ${reason}`);
      return { ok: false, reason };
    }
  }
}
