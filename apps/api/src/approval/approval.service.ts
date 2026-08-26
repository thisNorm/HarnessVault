import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ApprovalDecisionInput,
  ApprovalMode,
  ApprovalRequestContext,
  ApprovalRequestView,
  ApprovalStatus,
  ApproverSpec,
  OrganizationRole,
  CreateApprovalPolicyInput,
} from '@harnessvault/domain';
import { canTransitionApproval, executionBlockedCode, isExecutable } from '@harnessvault/domain';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import {
  approvalDecisions,
  approvalPolicies,
  approvalRequests,
  groupMemberships,
  organizationMemberships,
  projectMemberships,
  projects,
  resources,
  teamMemberships,
  users,
} from '../db/schema';
import {
  type ResolvedApproverSpec,
  effectiveStatus,
  evaluateSatisfaction,
  isEligibleApprover,
} from './satisfy';

type RequestRow = typeof approvalRequests.$inferSelect;
type PolicyRow = typeof approvalPolicies.$inferSelect;

export interface CreateRequestInput {
  organizationId: string;
  requesterUserId: string;
  projectId: string | null;
  resourceId: string;
  action: string;
  payload: Record<string, unknown>;
  proposedChange: string;
  context: ApprovalRequestContext;
  policyIds: string[];
  approvalPolicyId: string | null;
  clientName?: string | null;
  clientReportedModel?: string | null;
  traceId?: string | null;
}

@Injectable()
export class ApprovalService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /* ---------------- 정책 ---------------- */

  async listPolicies(organizationId: string) {
    return this.database.db
      .select()
      .from(approvalPolicies)
      .where(eq(approvalPolicies.organizationId, organizationId))
      .orderBy(approvalPolicies.name);
  }

  async createPolicy(
    actorUserId: string,
    organizationId: string,
    input: CreateApprovalPolicyInput,
  ) {
    const [created] = await this.database.db
      .insert(approvalPolicies)
      .values({
        organizationId,
        name: input.name,
        description: input.description,
        mode: input.mode,
        requiredCount: input.requiredCount ?? null,
        approvers: input.approvers,
        resourceId: input.resourceId ?? null,
        resourceType: input.resourceType ?? null,
        classification: input.classification ?? null,
        expiresInMinutes: input.expiresInMinutes,
        enabled: input.enabled,
        createdBy: actorUserId,
      })
      .onConflictDoNothing({ target: [approvalPolicies.organizationId, approvalPolicies.name] })
      .returning();

    if (!created) throw new ConflictException('이미 사용 중인 승인 정책 이름입니다');

    await this.audit.record({
      organizationId,
      actorUserId,
      eventType: 'approval_policy.created',
      targetType: 'approval_policy',
      targetId: created.id,
      metadata: { mode: created.mode, approverCount: input.approvers.length },
    });
    return created;
  }

  /**
   * 승인자 해석(§31). 코드에 하드코딩하지 않는다.
   * 각 approver 항목을 사용자 목록으로 펼친다.
   */
  async resolveApprovers(
    organizationId: string,
    approvers: ApproverSpec[],
    projectId: string | null,
    resourceId: string,
  ): Promise<ResolvedApproverSpec[]> {
    const resolved: ResolvedApproverSpec[] = [];

    for (const [index, spec] of approvers.entries()) {
      let userIds: string[] = [];
      let label = spec.kind as string;

      switch (spec.kind) {
        case 'USER':
          userIds = spec.refId ? [spec.refId] : [];
          label = `USER`;
          break;

        case 'GROUP': {
          if (!spec.refId) break;
          const rows = await this.database.db
            .select({ userId: groupMemberships.userId })
            .from(groupMemberships)
            .where(eq(groupMemberships.groupId, spec.refId));
          userIds = rows.map((row) => row.userId);
          label = 'GROUP';
          break;
        }

        case 'ORG_ROLE': {
          if (!spec.orgRole) break;
          const rows = await this.database.db
            .select({ userId: organizationMemberships.userId })
            .from(organizationMemberships)
            .where(
              and(
                eq(organizationMemberships.organizationId, organizationId),
                eq(organizationMemberships.role, spec.orgRole),
              ),
            );
          userIds = rows.map((row) => row.userId);
          label = `ORG_ROLE:${spec.orgRole}`;
          break;
        }

        case 'PROJECT_ROLE': {
          // 프로젝트가 없는 요청에는 프로젝트 역할 승인자가 해석되지 않는다.
          if (!spec.projectRole || !projectId) break;
          const rows = await this.database.db
            .select({ userId: projectMemberships.userId })
            .from(projectMemberships)
            .where(
              and(
                eq(projectMemberships.projectId, projectId),
                eq(projectMemberships.role, spec.projectRole),
              ),
            );
          userIds = rows.map((row) => row.userId);
          label = `PROJECT_ROLE:${spec.projectRole}`;
          break;
        }

        case 'RESOURCE_OWNER': {
          const [resource] = await this.database.db
            .select({ ownerType: resources.ownerType, ownerId: resources.ownerId })
            .from(resources)
            .where(eq(resources.id, resourceId))
            .limit(1);
          if (!resource) break;
          userIds = await this.expandOwner(resource.ownerType, resource.ownerId);
          label = `RESOURCE_OWNER:${resource.ownerType}`;
          break;
        }
      }

      resolved.push({ specIndex: index, kind: spec.kind, label, userIds: [...new Set(userIds)] });
    }

    return resolved;
  }

  private async expandOwner(ownerType: string, ownerId: string): Promise<string[]> {
    switch (ownerType) {
      case 'USER':
        return [ownerId];
      case 'TEAM': {
        const rows = await this.database.db
          .select({ userId: teamMemberships.userId })
          .from(teamMemberships)
          .where(eq(teamMemberships.teamId, ownerId));
        return rows.map((row) => row.userId);
      }
      case 'GROUP': {
        const rows = await this.database.db
          .select({ userId: groupMemberships.userId })
          .from(groupMemberships)
          .where(eq(groupMemberships.groupId, ownerId));
        return rows.map((row) => row.userId);
      }
      case 'PROJECT': {
        const rows = await this.database.db
          .select({ userId: projectMemberships.userId })
          .from(projectMemberships)
          .where(eq(projectMemberships.projectId, ownerId));
        return rows.map((row) => row.userId);
      }
      default:
        return [];
    }
  }

  /** 요청에 적용할 승인 정책을 고른다. 더 구체적인 매칭이 이긴다. */
  private async findApprovalPolicy(
    organizationId: string,
    explicitId: string | null,
    resourceId: string,
  ): Promise<PolicyRow | null> {
    if (explicitId) {
      const [found] = await this.database.db
        .select()
        .from(approvalPolicies)
        .where(
          and(
            eq(approvalPolicies.id, explicitId),
            eq(approvalPolicies.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (found) return found;
    }

    const [resource] = await this.database.db
      .select()
      .from(resources)
      .where(eq(resources.id, resourceId))
      .limit(1);
    if (!resource) return null;

    const candidates = await this.database.db
      .select()
      .from(approvalPolicies)
      .where(
        and(
          eq(approvalPolicies.organizationId, organizationId),
          eq(approvalPolicies.enabled, true),
        ),
      );

    const matching = candidates.filter(
      (policy) =>
        (policy.resourceId === null || policy.resourceId === resourceId) &&
        (policy.resourceType === null || policy.resourceType === resource.type) &&
        (policy.classification === null || policy.classification === resource.classification),
    );

    // 구체적인 것 우선 — resourceId > classification > resourceType > 전체.
    const score = (policy: PolicyRow) =>
      (policy.resourceId ? 4 : 0) + (policy.classification ? 2 : 0) + (policy.resourceType ? 1 : 0);
    matching.sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
    return matching[0] ?? null;
  }

  /* ---------------- 요청 ---------------- */

  async createRequest(input: CreateRequestInput): Promise<{ id: string; status: ApprovalStatus }> {
    const policy = await this.findApprovalPolicy(
      input.organizationId,
      input.approvalPolicyId,
      input.resourceId,
    );

    const expiresAt = new Date(Date.now() + (policy?.expiresInMinutes ?? 1440) * 60_000);

    const [created] = await this.database.db
      .insert(approvalRequests)
      .values({
        organizationId: input.organizationId,
        traceId: input.traceId ?? null,
        requesterUserId: input.requesterUserId,
        clientName: input.clientName ?? null,
        clientReportedModel: input.clientReportedModel ?? null,
        projectId: input.projectId,
        resourceId: input.resourceId,
        action: input.action,
        // 서버가 보관한다. 실행 시 이 값을 쓴다(§34).
        requestPayload: input.payload,
        proposedChange: input.proposedChange,
        reason: input.context.reason,
        risk: input.context.risk ?? null,
        rollbackPlan: input.context.rollbackPlan ?? null,
        verificationPlan: input.context.verificationPlan ?? null,
        policyIds: input.policyIds,
        approvalPolicyId: policy?.id ?? null,
        expiresAt,
      })
      .returning();

    if (!created) throw new ConflictException('승인 요청을 만들지 못했습니다');

    await this.audit.record({
      organizationId: input.organizationId,
      traceId: input.traceId ?? null,
      actorUserId: input.requesterUserId,
      eventType: 'approval.requested',
      targetType: 'approval_request',
      targetId: created.id,
      // payload 원문은 남기지 않는다(§39). 요청 테이블에만 둔다.
      metadata: {
        resourceId: input.resourceId,
        action: input.action,
        policyIds: input.policyIds,
        approvalPolicyId: policy?.id ?? null,
      },
    });

    return { id: created.id, status: created.status };
  }

  private async loadRequest(organizationId: string, requestId: string): Promise<RequestRow> {
    const [found] = await this.database.db
      .select()
      .from(approvalRequests)
      .where(
        and(
          eq(approvalRequests.id, requestId),
          eq(approvalRequests.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!found) throw new NotFoundException('승인 요청을 찾을 수 없습니다');
    return found;
  }

  /** 만료를 조회 시점에 반영한다. 배치가 없어도 만료된 요청이 승인되지 않는다. */
  private async syncExpiry(row: RequestRow): Promise<RequestRow> {
    const effective = effectiveStatus(row.status, row.expiresAt);
    if (effective === row.status) return row;

    const [updated] = await this.database.db
      .update(approvalRequests)
      .set({ status: effective })
      .where(eq(approvalRequests.id, row.id))
      .returning();
    return updated ?? { ...row, status: effective };
  }

  /**
   * 볼 자격이 있는 요청만 돌려준다.
   *
   * 요청 본문에는 실행하려는 SQL·파일 내용이 그대로 들어 있다(§55가 요구한다 —
   * 승인자가 판단하려면 무엇을 바꾸는지 봐야 한다). 그런데 그것을 조직원 전체에게
   * 보이면 **RESTRICTED를 보안팀으로 라우팅한 의미가 사라진다.**
   * 결정 권한은 막아 두고 내용만 보여 주는 것은 절반만 막은 것이다.
   */
  async list(
    organizationId: string,
    userId: string,
    orgRole: OrganizationRole,
  ): Promise<ApprovalRequestView[]> {
    const rows = await this.database.db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.organizationId, organizationId))
      .orderBy(desc(approvalRequests.createdAt))
      .limit(100);

    const views: ApprovalRequestView[] = [];
    for (const row of rows) {
      const view = await this.toView(await this.syncExpiry(row), userId);
      if (this.mayView(view, row, userId, orgRole)) views.push(view);
    }
    return views;
  }

  /** 가시성 검사 없이 본다. 이미 자격이 확인된 내부 경로 전용이다. */
  private async viewOf(
    organizationId: string,
    requestId: string,
    userId: string,
  ): Promise<ApprovalRequestView> {
    const row = await this.syncExpiry(await this.loadRequest(organizationId, requestId));
    return this.toView(row, userId);
  }

  async detail(
    organizationId: string,
    requestId: string,
    userId: string,
    orgRole: OrganizationRole,
  ): Promise<ApprovalRequestView> {
    const row = await this.syncExpiry(await this.loadRequest(organizationId, requestId));
    const view = await this.toView(row, userId);
    if (!this.mayView(view, row, userId, orgRole)) {
      // 존재 여부를 흘리지 않기 위해 권한 없음과 없음을 구분하지 않는다.
      throw new NotFoundException('승인 요청을 찾을 수 없습니다');
    }
    return view;
  }

  /**
   * 요청자 본인, 판단할 수 있는 사람, 그리고 조직 관리자만 본다.
   * 관리자를 넣는 이유는 감사·운영이 막히면 안 되기 때문이다 —
   * 누가 무엇을 요청했는지 조직이 아예 볼 수 없으면 거버넌스가 성립하지 않는다.
   */
  private mayView(
    view: ApprovalRequestView,
    row: RequestRow,
    userId: string,
    orgRole: OrganizationRole,
  ): boolean {
    if (orgRole === 'ORG_ADMIN') return true;
    if (row.requesterUserId === userId) return true;
    // 이미 판단한 사람도 계속 볼 수 있어야 한다. canDecide는 판단 후 false가 된다.
    return view.canDecide || view.decisions.some((decision) => decision.userId === userId);
  }

  private async toView(row: RequestRow, viewerId: string): Promise<ApprovalRequestView> {
    const [requester] = await this.database.db
      .select({ id: users.id, displayName: users.displayName, email: users.email })
      .from(users)
      .where(eq(users.id, row.requesterUserId))
      .limit(1);

    const [resource] = await this.database.db
      .select({ name: resources.name, classification: resources.classification })
      .from(resources)
      .where(eq(resources.id, row.resourceId))
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

    const policy = row.approvalPolicyId
      ? (
          await this.database.db
            .select()
            .from(approvalPolicies)
            .where(eq(approvalPolicies.id, row.approvalPolicyId))
            .limit(1)
        )[0]
      : undefined;

    const decisionRows = await this.database.db
      .select({
        userId: approvalDecisions.approverUserId,
        decision: approvalDecisions.decision,
        comment: approvalDecisions.comment,
        createdAt: approvalDecisions.createdAt,
        displayName: users.displayName,
      })
      .from(approvalDecisions)
      .innerJoin(users, eq(users.id, approvalDecisions.approverUserId))
      .where(eq(approvalDecisions.requestId, row.id));

    const specs = policy
      ? await this.resolveApprovers(
          row.organizationId,
          policy.approvers,
          row.projectId,
          row.resourceId,
        )
      : [];

    const alreadyDecided = decisionRows.some((decision) => decision.userId === viewerId);
    const canDecide =
      row.status === 'PENDING' &&
      // 자기 요청을 자기가 승인하면 게이트가 아니다.
      viewerId !== row.requesterUserId &&
      !alreadyDecided &&
      isEligibleApprover(specs, viewerId);

    return {
      id: row.id,
      organizationId: row.organizationId,
      traceId: row.traceId,
      status: row.status,
      requester: {
        userId: row.requesterUserId,
        displayName: requester?.displayName ?? '알 수 없음',
        email: requester?.email ?? '',
      },
      clientName: row.clientName,
      clientReportedModel: row.clientReportedModel,
      projectId: row.projectId,
      projectName: project?.name ?? null,
      resourceId: row.resourceId,
      resourceName: resource?.name ?? '알 수 없음',
      resourceClassification: resource?.classification ?? 'INTERNAL',
      action: row.action,
      proposedChange: row.proposedChange,
      reason: row.reason,
      risk: row.risk,
      rollbackPlan: row.rollbackPlan,
      verificationPlan: row.verificationPlan,
      policyIds: row.policyIds,
      approvalPolicyId: row.approvalPolicyId,
      approvalPolicyName: policy?.name ?? null,
      mode: (policy?.mode as ApprovalMode | undefined) ?? null,
      requiredCount: policy?.requiredCount ?? null,
      decisions: decisionRows.map((decision) => ({
        userId: decision.userId,
        displayName: decision.displayName,
        decision: decision.decision,
        comment: decision.comment,
        decidedAt: decision.createdAt.toISOString(),
      })),
      canDecide,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      executedAt: row.executedAt?.toISOString() ?? null,
      failureReason: row.failureReason,
    };
  }

  /* ---------------- 판단 ---------------- */

  async decide(
    organizationId: string,
    requestId: string,
    approverUserId: string,
    decision: 'APPROVE' | 'REJECT',
    input: ApprovalDecisionInput,
  ): Promise<ApprovalRequestView> {
    const row = await this.syncExpiry(await this.loadRequest(organizationId, requestId));

    if (row.status !== 'PENDING') {
      throw new ConflictException({
        code: 'INVALID_STATE',
        message: `${row.status} 상태의 요청은 판단할 수 없습니다`,
      });
    }
    if (row.requesterUserId === approverUserId) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: '자기 요청을 스스로 승인할 수 없습니다',
      });
    }

    const policy = row.approvalPolicyId
      ? (
          await this.database.db
            .select()
            .from(approvalPolicies)
            .where(eq(approvalPolicies.id, row.approvalPolicyId))
            .limit(1)
        )[0]
      : undefined;

    if (!policy) {
      throw new ConflictException({
        code: 'NO_APPROVAL_POLICY',
        message: '승인 정책이 없어 판단할 수 없습니다',
      });
    }

    const specs = await this.resolveApprovers(
      organizationId,
      policy.approvers,
      row.projectId,
      row.resourceId,
    );
    if (!isEligibleApprover(specs, approverUserId)) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: '이 요청의 승인자가 아닙니다',
      });
    }

    const [recorded] = await this.database.db
      .insert(approvalDecisions)
      .values({ requestId, approverUserId, decision, comment: input.comment })
      .onConflictDoNothing({
        target: [approvalDecisions.requestId, approvalDecisions.approverUserId],
      })
      .returning();
    if (!recorded) {
      throw new ConflictException({ code: 'ALREADY_DECIDED', message: '이미 판단했습니다' });
    }

    const all = await this.database.db
      .select({
        userId: approvalDecisions.approverUserId,
        decision: approvalDecisions.decision,
      })
      .from(approvalDecisions)
      .where(eq(approvalDecisions.requestId, requestId));

    const result = evaluateSatisfaction(policy.mode, policy.requiredCount, specs, all);

    let nextStatus: ApprovalStatus = 'PENDING';
    if (result.status === 'REJECTED') nextStatus = 'REJECTED';
    else if (result.status === 'APPROVED') nextStatus = 'APPROVED';

    if (nextStatus !== 'PENDING') {
      if (!canTransitionApproval(row.status, nextStatus)) {
        throw new ConflictException({
          code: 'INVALID_TRANSITION',
          message: `${row.status}에서 ${nextStatus}로 바꿀 수 없습니다`,
        });
      }
      await this.database.db
        .update(approvalRequests)
        .set({ status: nextStatus, decidedAt: new Date() })
        .where(eq(approvalRequests.id, requestId));
    }

    await this.audit.record({
      organizationId,
      traceId: row.traceId,
      actorUserId: approverUserId,
      eventType: 'approval.decided',
      targetType: 'approval_request',
      targetId: requestId,
      metadata: { decision, resultStatus: nextStatus, mode: policy.mode },
    });

    // 방금 판단한 본인이다. 가시성 검사를 다시 돌릴 이유가 없다.
    return this.viewOf(organizationId, requestId, approverUserId);
  }

  async cancel(organizationId: string, requestId: string, userId: string) {
    const row = await this.syncExpiry(await this.loadRequest(organizationId, requestId));
    if (row.requesterUserId !== userId) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: '요청자만 취소할 수 있습니다',
      });
    }
    if (!canTransitionApproval(row.status, 'CANCELLED')) {
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        message: `${row.status} 상태는 취소할 수 없습니다`,
      });
    }
    await this.database.db
      .update(approvalRequests)
      .set({ status: 'CANCELLED' })
      .where(eq(approvalRequests.id, requestId));

    await this.audit.record({
      organizationId,
      actorUserId: userId,
      eventType: 'approval.cancelled',
      targetType: 'approval_request',
      targetId: requestId,
    });
    return this.viewOf(organizationId, requestId, userId);
  }

  /* ---------------- 실행 ---------------- */

  /**
   * 실행 준비. **오직 서버 상태만 본다**(§34).
   * 클라이언트가 "승인 받았다"고 말해도 여기서 확인한다.
   *
   * 상태를 EXECUTING으로 옮기는 것도 여기서 한다 —
   * 조건부 UPDATE라 동시에 두 번 실행되지 않는다.
   */
  async beginExecution(
    organizationId: string,
    requestId: string,
    userId: string,
  ): Promise<RequestRow> {
    const row = await this.syncExpiry(await this.loadRequest(organizationId, requestId));

    if (row.requesterUserId !== userId) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: '요청자만 실행할 수 있습니다',
      });
    }
    if (!isExecutable(row.status)) {
      // 거절·만료·대기를 각각 다른 코드로 알린다(§61). 하나로 뭉개면 에이전트가
      // "접근을 바꿔야 한다"와 "기다리면 된다"를 구분하지 못한다.
      throw new ConflictException({
        code: executionBlockedCode(row.status),
        message: `승인되지 않은 요청은 실행할 수 없습니다 (현재: ${row.status})`,
        status: row.status,
      });
    }

    // 조건부 UPDATE — 두 번 호출해도 한 번만 EXECUTING으로 넘어간다.
    const [claimed] = await this.database.db
      .update(approvalRequests)
      .set({ status: 'EXECUTING' })
      .where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.status, 'APPROVED')))
      .returning();

    if (!claimed) {
      throw new ConflictException({
        code: 'ALREADY_EXECUTING',
        message: '이미 실행 중이거나 실행된 요청입니다',
      });
    }
    return claimed;
  }

  async finishExecution(
    organizationId: string,
    requestId: string,
    userId: string,
    outcome: { ok: true; summary: Record<string, unknown> } | { ok: false; reason: string },
  ): Promise<void> {
    const next: ApprovalStatus = outcome.ok ? 'EXECUTED' : 'FAILED';
    const [existing] = await this.database.db
      .select({ traceId: approvalRequests.traceId })
      .from(approvalRequests)
      .where(eq(approvalRequests.id, requestId))
      .limit(1);
    await this.database.db
      .update(approvalRequests)
      .set({
        status: next,
        executedAt: new Date(),
        failureReason: outcome.ok ? null : outcome.reason,
      })
      .where(eq(approvalRequests.id, requestId));

    await this.audit.record({
      organizationId,
      traceId: existing?.traceId ?? null,
      actorUserId: userId,
      eventType: outcome.ok ? 'approval.executed' : 'approval.failed',
      targetType: 'approval_request',
      targetId: requestId,
      metadata: outcome.ok ? outcome.summary : { reason: outcome.reason },
    });
  }

  /** 요청자가 자기 요청 상태를 확인한다. */
  async status(organizationId: string, requestId: string, userId: string) {
    const row = await this.syncExpiry(await this.loadRequest(organizationId, requestId));
    if (row.requesterUserId !== userId) {
      const [membership] = await this.database.db
        .select({ role: organizationMemberships.role })
        .from(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.userId, userId),
          ),
        )
        .limit(1);
      if (!membership) throw new NotFoundException('승인 요청을 찾을 수 없습니다');
    }
    return {
      approvalRequestId: row.id,
      status: row.status,
      action: row.action,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      failureReason: row.failureReason,
    };
  }

  /** 여러 요청의 상태를 한 번에. 감사 화면이 쓴다. */
  async statusesOf(requestIds: string[]): Promise<Map<string, ApprovalStatus>> {
    if (requestIds.length === 0) return new Map();
    const rows = await this.database.db
      .select({ id: approvalRequests.id, status: approvalRequests.status })
      .from(approvalRequests)
      .where(inArray(approvalRequests.id, requestIds));
    return new Map(rows.map((row) => [row.id, row.status]));
  }

  /** 요청 payload는 서버 보관본만 쓴다. 호출자가 다시 보낸 값을 쓰지 않는다. */
  storedPayload(row: RequestRow): Record<string, unknown> {
    return row.requestPayload;
  }

  assertActionMatches(row: RequestRow, expected: string): void {
    if (row.action !== expected) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: `이 요청의 Action은 ${row.action}입니다`,
      });
    }
  }
}
