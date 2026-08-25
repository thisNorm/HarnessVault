import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type {
  CreateOutputContractInput,
  OutputContractCandidate,
  ResolvedOutputContract,
} from '@harnessvault/domain';
import { mergeOutputContracts } from '@harnessvault/domain';
import { and, asc, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import { outputContracts, projectMemberships, projects, teamMemberships } from '../db/schema';

@Injectable()
export class OutputContractService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string) {
    return this.database.db
      .select()
      .from(outputContracts)
      .where(eq(outputContracts.organizationId, organizationId))
      .orderBy(asc(outputContracts.scopeType), asc(outputContracts.name));
  }

  async create(actorUserId: string, organizationId: string, input: CreateOutputContractInput) {
    const scopeId = input.scopeType === 'COMPANY' ? organizationId : input.scopeId;
    if (!scopeId) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: `${input.scopeType} 스코프에는 scopeId가 필요합니다`,
      });
    }

    // 같은 항목을 두 번 적어도 계약이 갈라지지 않게 정리한다.
    const fields = [...new Set(input.fields)];

    const [created] = await this.database.db
      .insert(outputContracts)
      .values({
        organizationId,
        name: input.name,
        description: input.description,
        scopeType: input.scopeType,
        scopeId,
        fields,
        enabled: input.enabled,
        createdBy: actorUserId,
      })
      .onConflictDoNothing({ target: [outputContracts.organizationId, outputContracts.name] })
      .returning();

    if (!created) throw new ConflictException('이미 사용 중인 계약 이름입니다');

    await this.audit.record({
      organizationId,
      actorUserId,
      eventType: 'output_contract.created',
      targetType: 'output_contract',
      targetId: created.id,
      metadata: { scopeType: created.scopeType, fieldCount: fields.length },
    });
    return created;
  }

  /**
   * 현재 컨텍스트에 적용되는 계약을 병합한다.
   * 스코프 매칭 규칙은 Resolver·Policy와 같다.
   */
  async resolve(
    organizationId: string,
    userId: string,
    projectId: string | null,
  ): Promise<ResolvedOutputContract> {
    const teams = await this.database.db
      .select({ teamId: teamMemberships.teamId })
      .from(teamMemberships)
      .where(eq(teamMemberships.userId, userId));
    const teamIds = new Set(teams.map((team) => team.teamId));

    // 요청자가 속하지 않은 프로젝트 계약은 적용하지 않는다.
    let effectiveProjectId: string | null = null;
    if (projectId) {
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
      effectiveProjectId = membership?.id ?? null;
    }

    const rows = await this.database.db
      .select()
      .from(outputContracts)
      .where(
        and(
          eq(outputContracts.organizationId, organizationId),
          eq(outputContracts.enabled, true),
        ),
      );

    const candidates: OutputContractCandidate[] = rows
      .filter((row) => {
        switch (row.scopeType) {
          case 'COMPANY':
            return true;
          case 'TEAM':
            return teamIds.has(row.scopeId);
          case 'PROJECT':
            return effectiveProjectId !== null && row.scopeId === effectiveProjectId;
          case 'PERSONAL':
            return row.scopeId === userId;
        }
      })
      .map((row) => ({
        id: row.id,
        name: row.name,
        scopeType: row.scopeType,
        fields: row.fields,
      }));

    return mergeOutputContracts(candidates);
  }
}
