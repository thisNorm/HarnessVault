import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreatePolicyInput,
  PolicyDecision,
  ResourceAction,
  UpdatePolicyInput,
} from '@harnessvault/domain';
import { and, asc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import {
  groupMemberships,
  organizationMemberships,
  resourcePolicies,
  teamMemberships,
} from '../db/schema';
import { type PolicyRow, decidePolicy } from './decide';

type PolicyDbRow = typeof resourcePolicies.$inferSelect;

export interface PolicySubject {
  userId: string;
  projectId: string | null;
}

export interface ResourceTarget {
  id: string;
  type: PolicyRow['resourceType'];
  classification: PolicyRow['classification'];
}

@Injectable()
export class PolicyService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  private toRow(row: PolicyDbRow): PolicyRow {
    return {
      id: row.id,
      name: row.name,
      effect: row.effect,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      inheritanceMode: row.inheritanceMode,
      resourceId: row.resourceId,
      resourceType: row.resourceType,
      classification: row.classification,
      actions: row.actions,
      subjectOrgRole: row.subjectOrgRole,
      subjectGroupId: row.subjectGroupId,
      approvalPolicyId: row.approvalPolicyId,
      enabled: row.enabled,
    };
  }

  async list(organizationId: string) {
    const rows = await this.database.db
      .select()
      .from(resourcePolicies)
      .where(eq(resourcePolicies.organizationId, organizationId))
      .orderBy(asc(resourcePolicies.name));
    return rows;
  }

  async create(actorUserId: string, organizationId: string, input: CreatePolicyInput) {
    const scopeId = input.scopeType === 'COMPANY' ? organizationId : input.scopeId;
    if (!scopeId) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: `${input.scopeType} 스코프에는 scopeId가 필요합니다`,
      });
    }

    const [created] = await this.database.db
      .insert(resourcePolicies)
      .values({
        organizationId,
        name: input.name,
        description: input.description,
        effect: input.effect,
        scopeType: input.scopeType,
        scopeId,
        inheritanceMode: input.inheritanceMode,
        resourceId: input.resourceId ?? null,
        resourceType: input.resourceType ?? null,
        classification: input.classification ?? null,
        actions: input.actions,
        subjectOrgRole: input.subjectOrgRole ?? null,
        subjectGroupId: input.subjectGroupId ?? null,
        approvalPolicyId: input.approvalPolicyId ?? null,
        enabled: input.enabled,
        createdBy: actorUserId,
      })
      .onConflictDoNothing({ target: [resourcePolicies.organizationId, resourcePolicies.name] })
      .returning();

    if (!created) throw new ConflictException('이미 사용 중인 정책 이름입니다');

    await this.audit.record({
      organizationId,
      actorUserId,
      eventType: 'policy.created',
      targetType: 'resource_policy',
      targetId: created.id,
      metadata: { effect: created.effect, scopeType: created.scopeType, actions: created.actions },
    });
    return created;
  }

  async update(
    actorUserId: string,
    organizationId: string,
    policyId: string,
    input: UpdatePolicyInput,
  ) {
    const [existing] = await this.database.db
      .select()
      .from(resourcePolicies)
      .where(
        and(
          eq(resourcePolicies.id, policyId),
          eq(resourcePolicies.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!existing) throw new NotFoundException('정책을 찾을 수 없습니다');

    const [updated] = await this.database.db
      .update(resourcePolicies)
      .set({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.effect === undefined ? {} : { effect: input.effect }),
        ...(input.inheritanceMode === undefined ? {} : { inheritanceMode: input.inheritanceMode }),
        ...(input.resourceId === undefined ? {} : { resourceId: input.resourceId ?? null }),
        ...(input.resourceType === undefined ? {} : { resourceType: input.resourceType ?? null }),
        ...(input.classification === undefined
          ? {}
          : { classification: input.classification ?? null }),
        ...(input.actions === undefined ? {} : { actions: input.actions }),
        ...(input.subjectOrgRole === undefined
          ? {}
          : { subjectOrgRole: input.subjectOrgRole ?? null }),
        ...(input.subjectGroupId === undefined
          ? {}
          : { subjectGroupId: input.subjectGroupId ?? null }),
        ...(input.approvalPolicyId === undefined
          ? {}
          : { approvalPolicyId: input.approvalPolicyId ?? null }),
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      })
      .where(eq(resourcePolicies.id, policyId))
      .returning();

    if (!updated) throw new NotFoundException('정책을 찾을 수 없습니다');

    await this.audit.record({
      organizationId,
      actorUserId,
      eventType: 'policy.updated',
      targetType: 'resource_policy',
      targetId: policyId,
      metadata: { fields: Object.keys(input) },
    });
    return updated;
  }

  /**
   * 모든 Resource Action은 세 값 중 하나로 결정된다.
   * "판정하지 않음"이라는 상태를 남기지 않는다.
   */
  async decide(
    organizationId: string,
    subject: PolicySubject,
    resource: ResourceTarget,
    action: ResourceAction,
  ): Promise<PolicyDecision> {
    const [membership] = await this.database.db
      .select({ role: organizationMemberships.role })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.userId, subject.userId),
        ),
      )
      .limit(1);

    const teams = await this.database.db
      .select({ teamId: teamMemberships.teamId })
      .from(teamMemberships)
      .where(eq(teamMemberships.userId, subject.userId));

    const groups = await this.database.db
      .select({ groupId: groupMemberships.groupId })
      .from(groupMemberships)
      .where(eq(groupMemberships.userId, subject.userId));

    const rows = await this.database.db
      .select()
      .from(resourcePolicies)
      .where(eq(resourcePolicies.organizationId, organizationId));

    const result = decidePolicy(
      rows.map((row) => this.toRow(row)),
      {
        organizationId,
        userId: subject.userId,
        teamIds: teams.map((team) => team.teamId),
        groupIds: groups.map((group) => group.groupId),
        projectId: subject.projectId,
        orgRole: membership?.role ?? 'ORG_MEMBER',
        resourceId: resource.id,
        resourceType: resource.type ?? 'FILE_SYSTEM',
        classification: resource.classification ?? 'INTERNAL',
        action,
      },
    );

    // 판정은 실행 여부와 무관하게 남긴다. 거부된 시도가 기록되지 않으면 감사가 반쪽이 된다.
    await this.audit.record({
      organizationId,
      actorUserId: subject.userId,
      eventType: 'policy.evaluated',
      targetType: 'resource',
      targetId: resource.id,
      metadata: {
        action,
        decision: result.decision.decision,
        policyIds: result.decision.policyIds,
        reasonCode: 'reasonCode' in result.decision ? result.decision.reasonCode : null,
        blockedByLocked: result.blockedByLocked,
      },
    });

    return result.decision;
  }
}
