import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../db/database.service';
import { auditEvents } from '../db/schema';

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

  async record(event: AuditEventInput): Promise<void> {
    try {
      await this.database.db.insert(auditEvents).values({
        organizationId: event.organizationId ?? null,
        actorUserId: event.actorUserId ?? null,
        eventType: event.eventType,
        targetType: event.targetType ?? null,
        targetId: event.targetId ?? null,
        metadata: event.metadata ?? {},
      });
    } catch (error) {
      // 감사 기록 실패를 조용히 삼키지 않는다. 다만 본 동작을 되돌리지도 않는다.
      this.logger.error(
        `Audit 기록 실패 (${event.eventType}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
