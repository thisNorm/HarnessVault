import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CompleteTaskInput,
  ModelSource,
  TraceDetail,
  TraceSummary,
} from '@harnessvault/domain';
import { and, asc, count, desc, eq, isNull } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import { auditEvents, projects, taskTraces, users } from '../db/schema';

type TraceRow = typeof taskTraces.$inferSelect;

export interface StartTraceInput {
  organizationId: string;
  userId: string;
  projectId: string | null;
  purpose: string;
  clientName?: string | null;
  clientVersion?: string | null;
  clientReportedModel?: string | null;
}

@Injectable()
export class TraceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async start(input: StartTraceInput): Promise<TraceRow> {
    // 클라이언트가 모델명을 보고했으면 그 사실을 함께 저장한다.
    // 검증된 값처럼 보여주면 감사가 거짓말을 한다(§59).
    const modelSource: ModelSource = input.clientReportedModel ? 'CLIENT_REPORTED' : 'UNKNOWN';

    const [created] = await this.database.db
      .insert(taskTraces)
      .values({
        organizationId: input.organizationId,
        userId: input.userId,
        projectId: input.projectId,
        purpose: input.purpose,
        clientName: input.clientName ?? null,
        clientVersion: input.clientVersion ?? null,
        modelName: input.clientReportedModel ?? null,
        modelSource,
      })
      .returning();

    if (!created) throw new ConflictException('작업 흐름을 만들지 못했습니다');
    return created;
  }

  /** Resolver 결과를 흐름에 받아 적는다(§41). 전부 추정치다. */
  async recordResolution(
    traceId: string,
    stats: {
      candidateCount: number;
      selectedCount: number;
      estimatedAvailableTokens: number | null;
      estimatedInjectedTokens: number;
    },
  ): Promise<void> {
    await this.database.db
      .update(taskTraces)
      .set({
        candidateAssetCount: stats.candidateCount,
        selectedAssetCount: stats.selectedCount,
        estimatedAvailableTokens: stats.estimatedAvailableTokens,
        estimatedInjectedTokens: stats.estimatedInjectedTokens,
        harnessInputTokens: stats.estimatedInjectedTokens,
      })
      .where(eq(taskTraces.id, traceId));
  }

  /**
   * 이 흐름에 이벤트를 붙여도 되는지 확인한다.
   * 남의 trace id를 주면 붙이지 않는다 — 잘못 이어진 감사 기록은 없는 것보다 나쁘다.
   */
  async resolveTraceId(
    organizationId: string,
    userId: string,
    traceId: string | null | undefined,
  ): Promise<string | null> {
    if (!traceId) return null;
    const [found] = await this.database.db
      .select({ id: taskTraces.id })
      .from(taskTraces)
      .where(
        and(
          eq(taskTraces.id, traceId),
          eq(taskTraces.organizationId, organizationId),
          eq(taskTraces.userId, userId),
        ),
      )
      .limit(1);
    return found?.id ?? null;
  }

  async complete(
    organizationId: string,
    userId: string,
    input: CompleteTaskInput,
  ): Promise<TraceSummary> {
    const traceId = await this.resolveTraceId(organizationId, userId, input.traceId);
    if (!traceId) throw new NotFoundException('작업 흐름을 찾을 수 없습니다');

    const [row] = await this.database.db
      .select()
      .from(taskTraces)
      .where(eq(taskTraces.id, traceId))
      .limit(1);
    if (!row) throw new NotFoundException('작업 흐름을 찾을 수 없습니다');
    if (row.status !== 'OPEN') {
      throw new ConflictException({
        code: 'INVALID_STATE',
        message: `${row.status} 상태의 흐름은 다시 종료할 수 없습니다`,
      });
    }

    await this.database.db
      .update(taskTraces)
      .set({
        status: input.status,
        summary: input.summary ?? null,
        completedAt: new Date(),
        // 보고하지 않으면 NULL로 남긴다. 0으로 채우면 "안 썼다"는 거짓 진술이다(§40).
        clientReportedInputTokens: input.clientReportedInputTokens ?? null,
        clientReportedOutputTokens: input.clientReportedOutputTokens ?? null,
      })
      .where(eq(taskTraces.id, traceId));

    await this.audit.record({
      organizationId,
      traceId,
      actorUserId: userId,
      eventType: 'task.completed',
      targetType: 'trace',
      targetId: traceId,
      metadata: {
        status: input.status,
        // 클라이언트 자가 보고임을 기록에도 남긴다.
        clientReportedInputTokens: input.clientReportedInputTokens ?? null,
        clientReportedOutputTokens: input.clientReportedOutputTokens ?? null,
      },
    });

    return this.summaryOf(traceId);
  }

  private async toSummary(row: TraceRow): Promise<TraceSummary> {
    const [user] = await this.database.db
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, row.userId))
      .limit(1);

    const project = row.projectId
      ? (
          await this.database.db
            .select({ name: projects.name })
            .from(projects)
            .where(eq(projects.id, row.projectId))
            .limit(1)
        )[0]
      : undefined;

    const [eventCount] = await this.database.db
      .select({ value: count() })
      .from(auditEvents)
      .where(eq(auditEvents.traceId, row.id));

    return {
      id: row.id,
      organizationId: row.organizationId,
      userId: row.userId,
      userDisplayName: user?.displayName ?? '알 수 없음',
      projectId: row.projectId,
      projectName: project?.name ?? null,
      clientName: row.clientName,
      clientVersion: row.clientVersion,
      modelName: row.modelName,
      modelSource: row.modelSource,
      purpose: row.purpose,
      status: row.status,
      startedAt: row.startedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      summary: row.summary,
      candidateAssetCount: row.candidateAssetCount,
      selectedAssetCount: row.selectedAssetCount,
      estimatedAvailableTokens: row.estimatedAvailableTokens,
      estimatedInjectedTokens: row.estimatedInjectedTokens,
      harnessInputTokens: row.harnessInputTokens,
      harnessOutputTokens: row.harnessOutputTokens,
      curatorInputTokens: row.curatorInputTokens,
      curatorReasoningTokens: row.curatorReasoningTokens,
      curatorOutputTokens: row.curatorOutputTokens,
      clientReportedInputTokens: row.clientReportedInputTokens,
      clientReportedOutputTokens: row.clientReportedOutputTokens,
      eventCount: eventCount?.value ?? 0,
    };
  }

  private async summaryOf(traceId: string): Promise<TraceSummary> {
    const [row] = await this.database.db
      .select()
      .from(taskTraces)
      .where(eq(taskTraces.id, traceId))
      .limit(1);
    if (!row) throw new NotFoundException('작업 흐름을 찾을 수 없습니다');
    return this.toSummary(row);
  }

  async list(organizationId: string): Promise<TraceSummary[]> {
    const rows = await this.database.db
      .select()
      .from(taskTraces)
      .where(eq(taskTraces.organizationId, organizationId))
      .orderBy(desc(taskTraces.startedAt))
      .limit(100);

    const summaries: TraceSummary[] = [];
    for (const row of rows) summaries.push(await this.toSummary(row));
    return summaries;
  }

  async detail(organizationId: string, traceId: string): Promise<TraceDetail> {
    const [row] = await this.database.db
      .select()
      .from(taskTraces)
      .where(and(eq(taskTraces.id, traceId), eq(taskTraces.organizationId, organizationId)))
      .limit(1);
    if (!row) throw new NotFoundException('작업 흐름을 찾을 수 없습니다');

    const events = await this.database.db
      .select({
        id: auditEvents.id,
        eventType: auditEvents.eventType,
        actorUserId: auditEvents.actorUserId,
        actorDisplayName: users.displayName,
        targetType: auditEvents.targetType,
        targetId: auditEvents.targetId,
        metadata: auditEvents.metadata,
        createdAt: auditEvents.createdAt,
      })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorUserId))
      // 시간순. 같은 시각이면 id로 안정 정렬한다.
      .orderBy(asc(auditEvents.createdAt), asc(auditEvents.id))
      .where(eq(auditEvents.traceId, traceId));

    return {
      ...(await this.toSummary(row)),
      events: events.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        actorUserId: event.actorUserId,
        actorDisplayName: event.actorDisplayName,
        targetType: event.targetType,
        targetId: event.targetId,
        metadata: event.metadata,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  }

  /** 흐름에 묶이지 않은 이벤트. 추측해서 붙이지 않고 따로 보여준다. */
  async untracked(organizationId: string, limit = 50) {
    const rows = await this.database.db
      .select({
        id: auditEvents.id,
        eventType: auditEvents.eventType,
        targetType: auditEvents.targetType,
        targetId: auditEvents.targetId,
        createdAt: auditEvents.createdAt,
        actorDisplayName: users.displayName,
      })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorUserId))
      .where(and(eq(auditEvents.organizationId, organizationId), isNull(auditEvents.traceId)))
      .orderBy(desc(auditEvents.createdAt))
      .limit(limit);
    return rows;
  }
}
