import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type CreateAssetInput,
  type CreateAssetRelationInput,
  type CreateAssetVersionInput,
  type ListAssetsQuery,
  type UpdateAssetInput,
  canTransitionAsset,
  canTransitionAssetVersion,
  estimateTokens,
} from '@harnessvault/domain';
import { and, asc, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import { assetRelations, assetVersions, harnessAssets } from '../db/schema';
import { CapabilityService } from './capability.service';
import { EmbeddingService } from '../contribution/embedding.service';

@Injectable()
export class AssetService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
    private readonly capabilityService: CapabilityService,
    private readonly embeddings: EmbeddingService,
  ) {}

  /**
   * 자산의 임베딩을 만든다. 제공자가 없으면 null이다.
   *
   * **자산이 생기거나 이름·설명이 바뀔 때마다 갱신해야 한다.** 안 그러면
   * 임베딩이 있는 자산과 없는 자산이 섞이고, 벡터 검색은 없는 쪽을 조용히 건너뛴다 —
   * 자산이 어떻게 만들어졌는지에 따라 검색 결과가 달라진다.
   */
  private async embedFor(input: {
    key: string;
    name: string;
    description: string;
  }): Promise<number[] | null> {
    const { vector } = await this.embeddings.embed(EmbeddingService.describe(input));
    return vector;
  }

  async list(organizationId: string, query: ListAssetsQuery) {
    const filters: SQL[] = [eq(harnessAssets.organizationId, organizationId)];
    if (query.type) filters.push(eq(harnessAssets.type, query.type));
    if (query.scopeType) filters.push(eq(harnessAssets.scopeType, query.scopeType));
    if (query.status) filters.push(eq(harnessAssets.status, query.status));
    if (query.capabilityId) filters.push(eq(harnessAssets.capabilityId, query.capabilityId));
    if (query.q) {
      const pattern = `%${query.q}%`;
      const search = or(
        ilike(harnessAssets.key, pattern),
        ilike(harnessAssets.name, pattern),
        ilike(harnessAssets.description, pattern),
      );
      if (search) filters.push(search);
    }

    return this.database.db
      .select()
      .from(harnessAssets)
      .where(and(...filters))
      .orderBy(asc(harnessAssets.key), asc(harnessAssets.scopeType));
  }

  async findById(organizationId: string, assetId: string) {
    const [found] = await this.database.db
      .select()
      .from(harnessAssets)
      .where(
        and(eq(harnessAssets.id, assetId), eq(harnessAssets.organizationId, organizationId)),
      )
      .limit(1);
    if (!found) throw new NotFoundException('자산을 찾을 수 없습니다');
    return found;
  }

  /** 자산 상세 — 버전 이력과 관계를 함께 준다. */
  async detail(organizationId: string, assetId: string) {
    const asset = await this.findById(organizationId, assetId);

    const versions = await this.database.db
      .select()
      .from(assetVersions)
      .where(eq(assetVersions.assetId, assetId))
      .orderBy(desc(assetVersions.createdAt));

    const outgoing = await this.database.db
      .select({
        id: assetRelations.id,
        type: assetRelations.type,
        assetId: harnessAssets.id,
        key: harnessAssets.key,
        name: harnessAssets.name,
        assetType: harnessAssets.type,
      })
      .from(assetRelations)
      .innerJoin(harnessAssets, eq(harnessAssets.id, assetRelations.toAssetId))
      .where(eq(assetRelations.fromAssetId, assetId));

    const incoming = await this.database.db
      .select({
        id: assetRelations.id,
        type: assetRelations.type,
        assetId: harnessAssets.id,
        key: harnessAssets.key,
        name: harnessAssets.name,
        assetType: harnessAssets.type,
      })
      .from(assetRelations)
      .innerJoin(harnessAssets, eq(harnessAssets.id, assetRelations.fromAssetId))
      .where(eq(assetRelations.toAssetId, assetId));

    // ACTIVE 버전이 둘 이상인 상태는 DB가 막지 않는다(명세 §63 Case 3).
    // Resolver가 RESOLUTION_CONFLICT로 보고해야 하므로 여기서도 감추지 않고 그대로 노출한다.
    const activeVersions = versions.filter((version) => version.status === 'ACTIVE');

    return {
      asset,
      versions,
      relations: { outgoing, incoming },
      activeVersionCount: activeVersions.length,
    };
  }

  async create(actorUserId: string, organizationId: string, input: CreateAssetInput) {
    if (input.capabilityId) {
      await this.capabilityService.assertBelongsToOrganization(organizationId, input.capabilityId);
    }

    // COMPANY 스코프는 조직 자신을 가리킨다. 나머지는 대상 id를 반드시 받는다.
    const scopeId = input.scopeType === 'COMPANY' ? organizationId : input.scopeId;
    if (!scopeId) {
      throw new BadRequestException(`${input.scopeType} 스코프에는 scopeId가 필요합니다`);
    }

    const [created] = await this.database.db
      .insert(harnessAssets)
      .values({
        organizationId,
        capabilityId: input.capabilityId ?? null,
        type: input.type,
        key: input.key,
        name: input.name,
        description: input.description,
        scopeType: input.scopeType,
        scopeId,
        inheritanceMode: input.inheritanceMode,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        selector: input.selector,
        reviewAfter: input.reviewAfter ? new Date(input.reviewAfter) : null,
        createdBy: actorUserId,
        embedding: await this.embedFor(input),
      })
      .onConflictDoNothing({
        target: [
          harnessAssets.organizationId,
          harnessAssets.key,
          harnessAssets.scopeType,
          harnessAssets.scopeId,
        ],
      })
      .returning();

    if (!created) {
      throw new ConflictException('같은 스코프에 같은 key의 자산이 이미 있습니다');
    }

    await this.audit.record({
      organizationId,
      actorUserId,
      eventType: 'asset.created',
      targetType: 'asset',
      targetId: created.id,
      metadata: { key: created.key, type: created.type, scopeType: created.scopeType },
    });
    return created;
  }

  async update(
    actorUserId: string,
    organizationId: string,
    assetId: string,
    input: UpdateAssetInput,
  ) {
    const asset = await this.findById(organizationId, assetId);

    if (input.status && input.status !== asset.status) {
      if (!canTransitionAsset(asset.status, input.status)) {
        throw new ConflictException(
          `자산 상태를 ${asset.status}에서 ${input.status}로 바꿀 수 없습니다`,
        );
      }
    }
    if (input.capabilityId) {
      await this.capabilityService.assertBelongsToOrganization(organizationId, input.capabilityId);
    }

    // 이름·설명이 바뀌면 임베딩도 바뀌어야 한다. 안 그러면 옛 뜻으로 검색된다.
    const textChanged = input.name !== undefined || input.description !== undefined;
    const embedding = textChanged
      ? await this.embedFor({
          key: asset.key,
          name: input.name ?? asset.name,
          description: input.description ?? asset.description,
        })
      : null;

    const [updated] = await this.database.db
      .update(harnessAssets)
      .set({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.description === undefined ? {} : { description: input.description }),
        // 새로 만들지 못했으면 옛 값을 남긴다. 지우면 검색에서 아예 빠진다.
        ...(embedding === null ? {} : { embedding }),
        ...(input.capabilityId === undefined ? {} : { capabilityId: input.capabilityId ?? null }),
        ...(input.inheritanceMode === undefined
          ? {}
          : { inheritanceMode: input.inheritanceMode }),
        ...(input.selector === undefined ? {} : { selector: input.selector }),
        ...(input.reviewAfter === undefined
          ? {}
          : { reviewAfter: input.reviewAfter ? new Date(input.reviewAfter) : null }),
        ...(input.status === undefined ? {} : { status: input.status }),
      })
      .where(eq(harnessAssets.id, assetId))
      .returning();

    if (!updated) throw new NotFoundException('자산을 찾을 수 없습니다');

    await this.audit.record({
      organizationId,
      actorUserId,
      eventType: input.status ? 'asset.status_changed' : 'asset.updated',
      targetType: 'asset',
      targetId: assetId,
      metadata: input.status ? { from: asset.status, to: input.status } : { fields: Object.keys(input) },
    });
    return updated;
  }

  /* ---------------- Version ---------------- */

  async createVersion(
    actorUserId: string,
    organizationId: string,
    assetId: string,
    input: CreateAssetVersionInput,
  ) {
    await this.findById(organizationId, assetId);

    // 실제 토크나이저가 아니다. Context Budget 계획용 추정치다.
    const serialized = JSON.stringify(input.structuredContent ?? null);
    const estimated = estimateTokens(`${serialized}\n${input.renderedMarkdown ?? ''}`);

    const [created] = await this.database.db
      .insert(assetVersions)
      .values({
        assetId,
        version: input.version,
        status: input.status,
        structuredContent: input.structuredContent ?? null,
        renderedMarkdown: input.renderedMarkdown ?? null,
        summary: input.summary,
        estimatedTokens: estimated,
        createdBy: actorUserId,
      })
      .onConflictDoNothing({ target: [assetVersions.assetId, assetVersions.version] })
      .returning();

    if (!created) throw new ConflictException('이미 존재하는 버전입니다');

    await this.audit.record({
      organizationId,
      actorUserId,
      eventType: 'asset_version.created',
      targetType: 'asset_version',
      targetId: created.id,
      metadata: { assetId, version: created.version, status: created.status },
    });
    return created;
  }

  async findVersion(organizationId: string, assetId: string, versionId: string) {
    await this.findById(organizationId, assetId);
    const [found] = await this.database.db
      .select()
      .from(assetVersions)
      .where(and(eq(assetVersions.id, versionId), eq(assetVersions.assetId, assetId)))
      .limit(1);
    if (!found) throw new NotFoundException('버전을 찾을 수 없습니다');
    return found;
  }

  /**
   * CANDIDATE 버전을 ACTIVE로 승격하고 기존 ACTIVE를 SUPERSEDED로 내린다.
   * 기존 버전을 삭제하지 않는다(명세 §51).
   */
  async promoteVersion(
    actorUserId: string,
    organizationId: string,
    assetId: string,
    versionId: string,
  ) {
    const target = await this.findVersion(organizationId, assetId, versionId);

    if (!canTransitionAssetVersion(target.status, 'ACTIVE')) {
      throw new ConflictException(`${target.status} 버전은 승격할 수 없습니다`);
    }

    return this.database.db.transaction(async (tx) => {
      const superseded = await tx
        .update(assetVersions)
        .set({ status: 'SUPERSEDED' })
        .where(and(eq(assetVersions.assetId, assetId), eq(assetVersions.status, 'ACTIVE')))
        .returning({ id: assetVersions.id, version: assetVersions.version });

      const [promoted] = await tx
        .update(assetVersions)
        .set({ status: 'ACTIVE' })
        .where(eq(assetVersions.id, versionId))
        .returning();

      if (!promoted) throw new NotFoundException('버전을 찾을 수 없습니다');

      await this.audit.record(
        {
          organizationId,
          actorUserId,
          eventType: 'asset_version.promoted',
          targetType: 'asset_version',
          targetId: promoted.id,
          metadata: {
            assetId,
            version: promoted.version,
            supersededVersions: superseded.map((row) => row.version),
          },
        },
        tx,
      );

      return { promoted, superseded };
    });
  }

  /* ---------------- Relation ---------------- */

  async createRelation(
    actorUserId: string,
    organizationId: string,
    assetId: string,
    input: CreateAssetRelationInput,
  ) {
    await this.findById(organizationId, assetId);
    // 다른 조직 자산과 관계를 맺지 못하게 막는다.
    await this.findById(organizationId, input.toAssetId);

    if (assetId === input.toAssetId) {
      throw new BadRequestException('자기 자신과 관계를 맺을 수 없습니다');
    }

    const [created] = await this.database.db
      .insert(assetRelations)
      .values({
        fromAssetId: assetId,
        toAssetId: input.toAssetId,
        type: input.type,
        createdBy: actorUserId,
      })
      .onConflictDoNothing({
        target: [assetRelations.fromAssetId, assetRelations.toAssetId, assetRelations.type],
      })
      .returning();

    if (!created) throw new ConflictException('이미 존재하는 관계입니다');

    await this.audit.record({
      organizationId,
      actorUserId,
      eventType: 'asset_relation.created',
      targetType: 'asset_relation',
      targetId: created.id,
      metadata: { fromAssetId: assetId, toAssetId: input.toAssetId, type: input.type },
    });
    return created;
  }

  async removeRelation(
    actorUserId: string,
    organizationId: string,
    assetId: string,
    relationId: string,
  ): Promise<void> {
    await this.findById(organizationId, assetId);

    const [deleted] = await this.database.db
      .delete(assetRelations)
      .where(and(eq(assetRelations.id, relationId), eq(assetRelations.fromAssetId, assetId)))
      .returning();

    if (!deleted) throw new NotFoundException('관계를 찾을 수 없습니다');

    await this.audit.record({
      organizationId,
      actorUserId,
      eventType: 'asset_relation.removed',
      targetType: 'asset_relation',
      targetId: relationId,
      metadata: { fromAssetId: assetId, toAssetId: deleted.toAssetId, type: deleted.type },
    });
  }
}
