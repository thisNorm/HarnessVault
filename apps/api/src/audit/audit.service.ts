import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../db/database.service';
import { auditEvents } from '../db/schema';

/**
 * 트랜잭션 안에서 부를 때 넘기는 실행기.
 * 같은 커넥션을 써야 아직 커밋되지 않은 행을 참조할 수 있다.
 */
export type AuditExecutor = Pick<DatabaseService['db'], 'insert'>;

export interface AuditEventInput {
  organizationId?: string | null;
  actorUserId?: string | null;
  eventType: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * 구현원칙 #8 — 모든 중요한 상태 변경은 Audit Event를 남긴다.
 * Phase 9에서 TaskTrace · 정책 결정 · 리소스 접근으로 확장한다.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly database: DatabaseService) {}

  /**
   * 트랜잭션 안에서 호출할 때는 반드시 `tx`를 넘긴다.
   * 넘기지 않으면 다른 커넥션을 타서 아직 커밋되지 않은 행을 참조하지 못하고 실패한다.
   */
  async record(event: AuditEventInput, tx?: AuditExecutor): Promise<void> {
    const executor = tx ?? this.database.db;
    try {
      await executor.insert(auditEvents).values({
        organizationId: event.organizationId ?? null,
        actorUserId: event.actorUserId ?? null,
        eventType: event.eventType,
        targetType: event.targetType ?? null,
        targetId: event.targetId ?? null,
        metadata: event.metadata ?? {},
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Audit 기록 실패 (${event.eventType}): ${reason}`);

      // 트랜잭션의 일부라면 감사 기록도 원자 단위다. 감사만 조용히 잃는 것을 허용하지 않는다.
      if (tx) throw error;
    }
  }
}
