import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ResolveTaskInput, ResolvedHarnessManifest } from '@harnessvault/domain';
import { and, eq, inArray } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import {
  assetRelations,
  assetVersions,
  harnessAssets,
  projectMemberships,
  projects,
  teamMemberships,
} from '../db/schema';
import {
  type CandidateAsset,
  ResolutionConflictError,
  resolveHarness,
} from './resolve';

@Injectable()
export class ResolverService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /**
   * 명세 §19의 1~4단계(로딩)와 16단계(Audit)를 맡는다.
   * 5~15단계는 순수 함수 `resolveHarness`가 처리한다.
   */
  async resolve(
    organizationId: string,
    userId: string,
    input: ResolveTaskInput,
  ): Promise<ResolvedHarnessManifest> {
    const traceId = randomUUID();

    // 2단계 — 요청한 프로젝트가 이 조직 것이고 요청자가 속해 있는지 확인한다.
    const projectId = await this.resolveProjectId(organizationId, userId, input.projectId ?? null);

    // 3단계 — 팀 멤버십
    const teamRows = await this.database.db
      .select({ teamId: teamMemberships.teamId })
      .from(teamMemberships)
      .where(eq(teamMemberships.userId, userId));
    const teamIds = teamRows.map((row) => row.teamId);

    // 4단계 — ACTIVE 자산과 그 ACTIVE 버전
    const assetRows = await this.database.db
      .select()
      .from(harnessAssets)
      .where(
        and(eq(harnessAssets.organizationId, organizationId), eq(harnessAssets.status, 'ACTIVE')),
      );

    const assetIds = assetRows.map((row) => row.id);
    const versionRows =
      assetIds.length === 0
        ? []
        : await this.database.db
            .select({
              id: assetVersions.id,
              assetId: assetVersions.assetId,
              version: assetVersions.version,
              estimatedTokens: assetVersions.estimatedTokens,
            })
            .from(assetVersions)
            .where(
              and(
                inArray(assetVersions.assetId, assetIds),
                eq(assetVersions.status, 'ACTIVE'),
              ),
            );

    const versionsByAsset = new Map<string, CandidateAsset['activeVersions']>();
    for (const row of versionRows) {
      const list = versionsByAsset.get(row.assetId) ?? [];
      list.push({ id: row.id, version: row.version, estimatedTokens: row.estimatedTokens });
      versionsByAsset.set(row.assetId, list);
    }
    // 버전 순서를 고정한다. 충돌 보고 문구까지 결정론적이어야 한다.
    for (const list of versionsByAsset.values()) {
      list.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));
    }

    const candidates: CandidateAsset[] = assetRows.map((row) => ({
      id: row.id,
      key: row.key,
      name: row.name,
      type: row.type,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      inheritanceMode: row.inheritanceMode,
      selector: row.selector,
      activeVersions: versionsByAsset.get(row.id) ?? [],
    }));

    const relationRows =
      assetIds.length === 0
        ? []
        : await this.database.db
            .select({
              fromAssetId: assetRelations.fromAssetId,
              toAssetId: assetRelations.toAssetId,
              type: assetRelations.type,
            })
            .from(assetRelations)
            .where(inArray(assetRelations.fromAssetId, assetIds));

    try {
      const manifest = resolveHarness({
        traceId,
        context: {
          organizationId,
          userId,
          projectId,
          teamIds,
          task: {
            description: input.task.description,
            domain: input.task.domain,
            type: input.task.type,
          },
          environment: input.environment,
          contextBudget: input.contextBudget ?? null,
        },
        candidates,
        relations: relationRows,
      });

      await this.audit.record({
        organizationId,
        actorUserId: userId,
        eventType: 'harness.resolved',
        targetType: 'trace',
        targetId: traceId,
        metadata: {
          projectId,
          // 클라이언트가 스스로 보고한 값이다. 신뢰하지 않고 기록만 한다.
          clientName: input.client?.name ?? null,
          clientReportedModel: input.client?.model ?? null,
          candidateCount: manifest.resolution.candidateCount,
          selectedCount: manifest.resolution.selectedCount,
          excludedCount: manifest.resolution.excludedCount,
          estimatedInjectedTokens: manifest.resolution.estimatedInjectedTokens,
        },
      });

      return manifest;
    } catch (error) {
      if (error instanceof ResolutionConflictError) {
        await this.audit.record({
          organizationId,
          actorUserId: userId,
          eventType: 'harness.resolution_conflict',
          targetType: 'trace',
          targetId: traceId,
          metadata: { projectId, conflicts: error.conflicts },
        });
        // 실패를 정상 상태로 숨기지 않는다. 어느 자산이 충돌인지 그대로 알린다.
        throw new ConflictException({
          code: error.code,
          message: error.message,
          traceId,
          conflicts: error.conflicts,
        });
      }
      throw error;
    }
  }

  /** 요청자가 속하지 않은 프로젝트를 컨텍스트로 쓰지 못하게 막는다. */
  private async resolveProjectId(
    organizationId: string,
    userId: string,
    projectId: string | null,
  ): Promise<string | null> {
    if (!projectId) return null;

    const [membership] = await this.database.db
      .select({ id: projects.id })
      .from(projects)
      .innerJoin(projectMemberships, eq(projectMemberships.projectId, projects.id))
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.organizationId, organizationId),
          eq(projectMemberships.userId, userId),
        ),
      )
      .limit(1);

    // 조용히 null로 떨어뜨리면 요청자는 프로젝트 Harness가 적용됐다고 착각한다.
    // 존재 여부를 흘리지 않기 위해 없음과 권한 없음을 구분하지 않는다.
    if (!membership) {
      throw new NotFoundException({
        code: 'PROJECT_NOT_ACCESSIBLE',
        message: '프로젝트를 찾을 수 없거나 접근할 수 없습니다',
      });
    }
    return membership.id;
  }
}
