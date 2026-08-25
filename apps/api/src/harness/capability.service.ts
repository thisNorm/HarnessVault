import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateCapabilityInput } from '@harnessvault/domain';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import { capabilities } from '../db/schema';

@Injectable()
export class CapabilityService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string) {
    return this.database.db
      .select()
      .from(capabilities)
      .where(eq(capabilities.organizationId, organizationId))
      .orderBy(capabilities.key);
  }

  async findById(organizationId: string, capabilityId: string) {
    const [found] = await this.database.db
      .select()
      .from(capabilities)
      .where(and(eq(capabilities.id, capabilityId), eq(capabilities.organizationId, organizationId)))
      .limit(1);
    if (!found) throw new NotFoundException('Capability를 찾을 수 없습니다');
    return found;
  }

  async create(actorUserId: string, organizationId: string, input: CreateCapabilityInput) {
    // 다른 조직의 Capability를 부모로 삼지 못하게 막는다.
    if (input.parentId) await this.findById(organizationId, input.parentId);

    const [created] = await this.database.db
      .insert(capabilities)
      .values({
        organizationId,
        key: input.key,
        name: input.name,
        description: input.description,
        parentId: input.parentId ?? null,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        createdBy: actorUserId,
      })
      .onConflictDoNothing({ target: [capabilities.organizationId, capabilities.key] })
      .returning();

    if (!created) throw new ConflictException('이미 사용 중인 Capability key입니다');

    await this.audit.record({
      organizationId,
      actorUserId,
      eventType: 'capability.created',
      targetType: 'capability',
      targetId: created.id,
      metadata: { key: created.key },
    });
    return created;
  }

  /** 자산이 참조하는 Capability가 같은 조직 것인지 확인한다. */
  async assertBelongsToOrganization(organizationId: string, capabilityId: string): Promise<void> {
    const [found] = await this.database.db
      .select({ id: capabilities.id })
      .from(capabilities)
      .where(and(eq(capabilities.id, capabilityId), eq(capabilities.organizationId, organizationId)))
      .limit(1);
    if (!found) throw new BadRequestException('같은 조직의 Capability가 아닙니다');
  }
}
