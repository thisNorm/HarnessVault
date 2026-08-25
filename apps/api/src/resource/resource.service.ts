import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  CreateResourceInput,
  ResourceSummary,
  ResourceType,
  UpdateResourceInput,
} from '@harnessvault/domain';
import { and, asc, eq } from 'drizzle-orm';
import type { ApprovalRequestContext, ResourceAction } from '@harnessvault/domain';
import { ApprovalService } from '../approval/approval.service';
import { AuditService } from '../audit/audit.service';
import { PolicyService } from '../policy/policy.service';
import { DatabaseService } from '../db/database.service';
import { resources } from '../db/schema';
import {
  type AccessTrace,
  ResourceUnavailableError,
  databaseAdapter,
  fileSystemAdapter,
  gitAdapter,
} from './adapters';
import { assertWriteQuery } from './guards';
import {
  ResourceCredentialError,
  ResourcePathError,
  ResourceQueryError,
  isAllowedCredentialRef,
} from './guards';

type ResourceRow = typeof resources.$inferSelect;

@Injectable()
export class ResourceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly policy: PolicyService,
    private readonly approvals: ApprovalService,
  ) {}

  /** 관리 API·MCP 응답용. credential **값**은 절대 담기지 않는다. */
  private toSummary(row: ResourceRow): ResourceSummary {
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      description: row.description,
      classification: row.classification,
      adapterType: row.adapterType,
      enabled: row.enabled,
      credentialRef: row.credentialRef,
      // 값을 노출하지 않고 갖춰졌는지만 알린다.
      credentialConfigured: row.credentialRef ? Boolean(process.env[row.credentialRef]) : true,
    };
  }

  async list(organizationId: string, type?: ResourceType): Promise<ResourceSummary[]> {
    const rows = await this.database.db
      .select()
      .from(resources)
      .where(
        type
          ? and(eq(resources.organizationId, organizationId), eq(resources.type, type))
          : eq(resources.organizationId, organizationId),
      )
      .orderBy(asc(resources.name));
    return rows.map((row) => this.toSummary(row));
  }

  async create(actorUserId: string, organizationId: string, input: CreateResourceInput) {
    this.assertCredentialRef(input.credentialRef ?? null);

    const [created] = await this.database.db
      .insert(resources)
      .values({
        organizationId,
        type: input.type,
        name: input.name,
        description: input.description,
        classification: input.classification,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        adapterType: input.adapterType,
        config: input.config,
        credentialRef: input.credentialRef ?? null,
        enabled: input.enabled,
        createdBy: actorUserId,
      })
      .onConflictDoNothing({ target: [resources.organizationId, resources.name] })
      .returning();

    if (!created) throw new ConflictException('이미 사용 중인 Resource 이름입니다');

    await this.audit.record({
      organizationId,
      actorUserId,
      eventType: 'resource.created',
      targetType: 'resource',
      targetId: created.id,
      // credentialRef는 이름이라 남겨도 비밀이 새지 않는다. 값은 어디에도 남기지 않는다.
      metadata: {
        type: created.type,
        classification: created.classification,
        credentialRef: created.credentialRef,
      },
    });
    return this.toSummary(created);
  }

  async update(
    actorUserId: string,
    organizationId: string,
    resourceId: string,
    input: UpdateResourceInput,
  ) {
    await this.findRow(organizationId, resourceId);
    if (input.credentialRef !== undefined) this.assertCredentialRef(input.credentialRef ?? null);

    const [updated] = await this.database.db
      .update(resources)
      .set({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.classification === undefined ? {} : { classification: input.classification }),
        ...(input.config === undefined ? {} : { config: input.config }),
        ...(input.credentialRef === undefined ? {} : { credentialRef: input.credentialRef ?? null }),
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      })
      .where(eq(resources.id, resourceId))
      .returning();

    if (!updated) throw new NotFoundException('Resource를 찾을 수 없습니다');

    await this.audit.record({
      organizationId,
      actorUserId,
      eventType: 'resource.updated',
      targetType: 'resource',
      targetId: resourceId,
      metadata: { fields: Object.keys(input) },
    });
    return this.toSummary(updated);
  }

  /**
   * 실행 가능한 Resource를 꺼낸다.
   * 조직 불일치·비활성은 여기서 막는다. 정책 판정은 assertPolicyAllows가 따로 한다.
   */
  private async findRow(organizationId: string, resourceId: string): Promise<ResourceRow> {
    const [found] = await this.database.db
      .select()
      .from(resources)
      .where(and(eq(resources.id, resourceId), eq(resources.organizationId, organizationId)))
      .limit(1);
    if (!found) throw new NotFoundException('Resource를 찾을 수 없습니다');
    return found;
  }

  private async findExecutable(
    organizationId: string,
    resourceId: string,
    expected: ResourceType,
  ): Promise<ResourceRow> {
    const row = await this.findRow(organizationId, resourceId);
    if (!row.enabled) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: '비활성화된 Resource입니다',
      });
    }
    if (row.type !== expected) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: `${expected} Resource가 아닙니다 (실제: ${row.type})`,
      });
    }
    return row;
  }

  private assertCredentialRef(ref: string | null): void {
    if (ref === null) return;
    if (!isAllowedCredentialRef(ref)) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'credentialRef는 HARNESS_RESOURCE_로 시작해야 합니다',
      });
    }
  }

  /** 어댑터 오류를 HTTP·MCP가 이해하는 형태로 바꾼다. 실패를 성공으로 바꾸지 않는다. */
  private translate(error: unknown): never {
    if (error instanceof ResourcePathError) {
      throw new ForbiddenException({ code: error.code, message: error.message });
    }
    if (error instanceof ResourceQueryError) {
      throw new BadRequestException({ code: error.code, message: error.message });
    }
    if (error instanceof ResourceCredentialError) {
      if (error.code === 'PERMISSION_DENIED') {
        throw new ForbiddenException({ code: error.code, message: error.message });
      }
      throw new ServiceUnavailableException({ code: error.code, message: error.message });
    }
    if (error instanceof ResourceUnavailableError) {
      throw new ServiceUnavailableException({ code: error.code, message: error.message });
    }
    throw error;
  }

  /** §39 — 원문 payload를 저장하지 않는다. 지문·개수·이름만 남긴다. */
  private async recordAccess(
    organizationId: string,
    actorUserId: string,
    row: ResourceRow,
    action: string,
    purpose: string,
    trace: AccessTrace,
    traceId: string | null,
  ): Promise<void> {
    await this.audit.record({
      organizationId,
      traceId,
      actorUserId,
      eventType: 'resource.accessed',
      targetType: 'resource',
      targetId: row.id,
      metadata: {
        action,
        purpose,
        classification: row.classification,
        objects: trace.objects.slice(0, 50),
        rowCount: trace.rowCount ?? null,
        byteCount: trace.byteCount ?? null,
        queryFingerprint: trace.queryFingerprint ?? null,
      },
    });
  }

  /**
   * 실행 전 정책 게이트(Phase 7).
   * APPROVAL_REQUIRED는 **실행하지 않고 그대로 반환한다.**
   * 승인 없이 실행하면 §34를 정면으로 어긴다. 승인 흐름은 Phase 8이다.
   */
  private async assertPolicyAllows(
    organizationId: string,
    userId: string,
    projectId: string | null,
    row: ResourceRow,
    action: ResourceAction,
    traceId: string | null = null,
  ): Promise<void> {
    const decision = await this.policy.decide(
      organizationId,
      { userId, projectId, traceId },
      { id: row.id, type: row.type, classification: row.classification },
      action,
    );

    if (decision.decision === 'ALLOW') return;

    if (decision.decision === 'APPROVAL_REQUIRED') {
      throw new ForbiddenException({
        code: 'APPROVAL_REQUIRED',
        message: decision.reason,
        policyIds: decision.policyIds,
        approvalPolicyId: decision.approvalPolicyId,
        // Phase 8이 붙기 전까지는 승인을 만들 수 없다. 그 사실을 숨기지 않는다.
        note: '승인 흐름은 Phase 8에서 열립니다',
      });
    }

    throw new ForbiddenException({
      code: 'POLICY_DENIED',
      message: decision.reason,
      reasonCode: decision.reasonCode,
      policyIds: decision.policyIds,
    });
  }

  private async execute<T>(
    organizationId: string,
    actorUserId: string,
    row: ResourceRow,
    action: string,
    purpose: string,
    handler: () => Promise<{ data: T; trace: AccessTrace }>,
    traceId: string | null = null,
  ): Promise<T> {
    try {
      const { data, trace } = await handler();
      await this.recordAccess(organizationId, actorUserId, row, action, purpose, trace, traceId);
      return data;
    } catch (error) {
      // 실패도 남긴다. 접근 시도 자체가 감사 대상이다.
      await this.audit.record({
        organizationId,
        traceId,
        actorUserId,
        eventType: 'resource.access_failed',
        targetType: 'resource',
        targetId: row.id,
        metadata: {
          action,
          purpose,
          reason: error instanceof Error ? error.message : String(error),
        },
      });
      this.translate(error);
    }
  }

  /* ---------------- 실행 ---------------- */

  async filesSearch(
    organizationId: string,
    userId: string,
    args: { resourceId: string; query: string; limit?: number; purpose: string; projectId?: string | null; traceId?: string | null },
  ) {
    const row = await this.findExecutable(organizationId, args.resourceId, 'FILE_SYSTEM');
    await this.assertPolicyAllows(
      organizationId,
      userId,
      args.projectId ?? null,
      row,
      'files.search',
      args.traceId ?? null,
    );
    return this.execute(
      organizationId,
      userId,
      row,
      'files.search',
      args.purpose,
      () => fileSystemAdapter.search(row.config, { query: args.query, limit: args.limit }),
      args.traceId ?? null,
    );
  }

  async filesRead(
    organizationId: string,
    userId: string,
    args: {
      resourceId: string;
      path: string;
      range?: { start?: number; end?: number };
      purpose: string;
      projectId?: string | null;
      traceId?: string | null;
    },
  ) {
    const row = await this.findExecutable(organizationId, args.resourceId, 'FILE_SYSTEM');
    await this.assertPolicyAllows(
      organizationId,
      userId,
      args.projectId ?? null,
      row,
      'files.read',
      args.traceId ?? null,
    );
    return this.execute(
      organizationId,
      userId,
      row,
      'files.read',
      args.purpose,
      () => fileSystemAdapter.read(row.config, { path: args.path, range: args.range }),
      args.traceId ?? null,
    );
  }

  async dbSchema(
    organizationId: string,
    userId: string,
    args: { resourceId: string; object?: string; purpose: string; projectId?: string | null; traceId?: string | null },
  ) {
    const row = await this.findExecutable(organizationId, args.resourceId, 'DATABASE');
    await this.assertPolicyAllows(
      organizationId,
      userId,
      args.projectId ?? null,
      row,
      'db.schema',
      args.traceId ?? null,
    );
    return this.execute(
      organizationId,
      userId,
      row,
      'db.schema',
      args.purpose,
      () => databaseAdapter.schema(row.credentialRef, { object: args.object }),
      args.traceId ?? null,
    );
  }

  async dbQuery(
    organizationId: string,
    userId: string,
    args: { resourceId: string; query: string; purpose: string; projectId?: string | null; traceId?: string | null },
  ) {
    const row = await this.findExecutable(organizationId, args.resourceId, 'DATABASE');
    await this.assertPolicyAllows(
      organizationId,
      userId,
      args.projectId ?? null,
      row,
      'db.query',
      args.traceId ?? null,
    );
    return this.execute(
      organizationId,
      userId,
      row,
      'db.query',
      args.purpose,
      () => databaseAdapter.query(row.credentialRef, row.config, { query: args.query }),
      args.traceId ?? null,
    );
  }

  async gitStatus(
    organizationId: string,
    userId: string,
    args: { resourceId: string; purpose: string; projectId?: string | null; traceId?: string | null },
  ) {
    const row = await this.findExecutable(organizationId, args.resourceId, 'GIT');
    await this.assertPolicyAllows(
      organizationId,
      userId,
      args.projectId ?? null,
      row,
      'git.status',
      args.traceId ?? null,
    );
    return this.execute(
      organizationId,
      userId,
      row,
      'git.status',
      args.purpose,
      () => gitAdapter.status(row.config),
      args.traceId ?? null,
    );
  }

  /* ---------------- 쓰기 (승인 필요) ---------------- */

  /**
   * 쓰기 Action의 진입점.
   *
   * 정책이 ALLOW면 바로 실행한다 — 승인이 필요 없는 Action에 절차를 붙이면 아무도 쓰지 않는다.
   * APPROVAL_REQUIRED면 요청을 만들고 **실행하지 않는다.**
   */
  async requestWrite(
    organizationId: string,
    userId: string,
    args: {
      resourceId: string;
      action: 'db.update' | 'files.write';
      payload: Record<string, unknown>;
      proposedChange: string;
      purpose: string;
      projectId?: string | null;
      context: ApprovalRequestContext;
      clientName?: string | null;
      clientReportedModel?: string | null;
      traceId?: string | null;
    },
  ): Promise<
    | { executed: true; result: unknown }
    | { executed: false; approvalRequestId: string; status: string; reason: string }
  > {
    const expectedType = args.action === 'db.update' ? 'DATABASE' : 'FILE_SYSTEM';
    const row = await this.findExecutable(organizationId, args.resourceId, expectedType);

    // 실행 가능한 형태인지 먼저 본다. 승인자에게 실행 불가능한 요청을 보내지 않는다.
    if (args.action === 'db.update') assertWriteQuery(String(args.payload.query ?? ''));

    const decision = await this.policy.decide(
      organizationId,
      { userId, projectId: args.projectId ?? null, traceId: args.traceId ?? null },
      { id: row.id, type: row.type, classification: row.classification },
      args.action,
    );

    if (decision.decision === 'DENY') {
      throw new ForbiddenException({
        code: 'POLICY_DENIED',
        message: decision.reason,
        reasonCode: decision.reasonCode,
        policyIds: decision.policyIds,
      });
    }

    if (decision.decision === 'ALLOW') {
      const result = await this.runWrite(
        organizationId,
        userId,
        row,
        args.action,
        args.purpose,
        args.payload,
        args.traceId ?? null,
      );
      return { executed: true, result };
    }

    const created = await this.approvals.createRequest({
      organizationId,
      requesterUserId: userId,
      projectId: args.projectId ?? null,
      resourceId: row.id,
      action: args.action,
      payload: args.payload,
      proposedChange: args.proposedChange,
      context: args.context,
      policyIds: decision.policyIds,
      approvalPolicyId: decision.approvalPolicyId,
      clientName: args.clientName ?? null,
      clientReportedModel: args.clientReportedModel ?? null,
      traceId: args.traceId ?? null,
    });

    return {
      executed: false,
      approvalRequestId: created.id,
      status: created.status,
      reason: decision.reason,
    };
  }

  /**
   * 승인된 요청을 실행한다.
   *
   * **서버가 보관한 payload를 쓴다.** 호출자가 다시 보낸 값을 쓰면
   * "안전한 쿼리로 승인받고 위험한 쿼리로 실행"이 가능해진다(§34).
   */
  async executeApproved(organizationId: string, userId: string, approvalRequestId: string) {
    const request = await this.approvals.beginExecution(organizationId, approvalRequestId, userId);
    const row = await this.findRow(organizationId, request.resourceId);
    const payload = this.approvals.storedPayload(request);

    try {
      const result = await this.runWrite(
        organizationId,
        userId,
        row,
        request.action as 'db.update' | 'files.write',
        `승인 ${approvalRequestId} 실행`,
        payload,
        request.traceId,
      );
      await this.approvals.finishExecution(organizationId, approvalRequestId, userId, {
        ok: true,
        summary: { action: request.action, resourceId: row.id },
      });
      return { status: 'EXECUTED' as const, result };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.approvals.finishExecution(organizationId, approvalRequestId, userId, {
        ok: false,
        reason,
      });
      throw error;
    }
  }

  private async runWrite(
    organizationId: string,
    userId: string,
    row: ResourceRow,
    action: 'db.update' | 'files.write',
    purpose: string,
    payload: Record<string, unknown>,
    traceId: string | null = null,
  ): Promise<unknown> {
    if (action === 'db.update') {
      return this.execute(
        organizationId,
        userId,
        row,
        'db.update',
        purpose,
        () => databaseAdapter.update(row.credentialRef, { query: String(payload.query ?? '') }),
        traceId,
      );
    }
    return this.execute(
      organizationId,
      userId,
      row,
      'files.write',
      purpose,
      () =>
        fileSystemAdapter.write(row.config, {
          path: String(payload.path ?? ''),
          content: String(payload.content ?? ''),
        }),
      traceId,
    );
  }

  async gitRead(
    organizationId: string,
    userId: string,
    args: { resourceId: string; path: string; ref?: string; purpose: string; projectId?: string | null; traceId?: string | null },
  ) {
    const row = await this.findExecutable(organizationId, args.resourceId, 'GIT');
    await this.assertPolicyAllows(
      organizationId,
      userId,
      args.projectId ?? null,
      row,
      'git.read',
      args.traceId ?? null,
    );
    return this.execute(
      organizationId,
      userId,
      row,
      'git.read',
      args.purpose,
      () => gitAdapter.read(row.config, { path: args.path, ref: args.ref }),
      args.traceId ?? null,
    );
  }
}
