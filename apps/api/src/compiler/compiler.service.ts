import { Injectable } from '@nestjs/common';
import type {
  CompileRequestInput,
  CompiledHarness,
  ResolvedHarnessManifest,
} from '@harnessvault/domain';
import { and, eq, inArray } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import { assetRelations, assetVersions } from '../db/schema';
import { ResolverService } from '../resolver/resolver.service';
import { type CompilerAssetContent, compileHarness } from './compile';

@Injectable()
export class CompilerService {
  constructor(
    private readonly database: DatabaseService,
    private readonly resolver: ResolverService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Resolver를 다시 구현하지 않는다. 같은 서비스를 호출해 Manifest를 얻고,
   * 선택된 버전의 본문만 추가로 읽어 순수 함수에 넘긴다.
   */
  async compile(
    organizationId: string,
    userId: string,
    input: CompileRequestInput,
  ): Promise<{ manifest: ResolvedHarnessManifest; compiled: CompiledHarness }> {
    const { target, ...resolveInput } = input;
    const manifest = await this.resolver.resolve(organizationId, userId, resolveInput);

    const selected = [
      ...manifest.rules,
      ...manifest.policies,
      ...manifest.validations,
      ...manifest.workflows,
      ...manifest.skills,
      ...manifest.variants,
      ...manifest.scripts,
      ...manifest.templates,
      ...manifest.knowledge,
    ];

    const versionIds = selected.map((ref) => ref.versionId);
    const rows =
      versionIds.length === 0
        ? []
        : await this.database.db
            .select({
              id: assetVersions.id,
              structuredContent: assetVersions.structuredContent,
              renderedMarkdown: assetVersions.renderedMarkdown,
              summary: assetVersions.summary,
            })
            .from(assetVersions)
            .where(inArray(assetVersions.id, versionIds));

    const contents = new Map<string, CompilerAssetContent>(
      rows.map((row) => [
        row.id,
        {
          versionId: row.id,
          structuredContent: row.structuredContent,
          renderedMarkdown: row.renderedMarkdown,
          summary: row.summary,
        },
      ]),
    );

    // Variant를 core Skill 문서에 합치려면 관계가 필요하다.
    const variantIds = manifest.variants.map((ref) => ref.assetId);
    const variantRows =
      variantIds.length === 0
        ? []
        : await this.database.db
            .select({
              fromAssetId: assetRelations.fromAssetId,
              toAssetId: assetRelations.toAssetId,
            })
            .from(assetRelations)
            .where(
              and(
                inArray(assetRelations.fromAssetId, variantIds),
                eq(assetRelations.type, 'VARIANT_OF'),
              ),
            );

    const compiled = compileHarness({
      target,
      manifest,
      contents,
      variantOf: new Map(variantRows.map((row) => [row.fromAssetId, row.toAssetId])),
      generatedAt: new Date(),
    });

    await this.audit.record({
      organizationId,
      actorUserId: userId,
      eventType: 'harness.compiled',
      targetType: 'trace',
      targetId: manifest.traceId,
      metadata: {
        target,
        fileCount: compiled.files.length,
        selectedCount: manifest.resolution.selectedCount,
      },
    });

    return { manifest, compiled };
  }
}
