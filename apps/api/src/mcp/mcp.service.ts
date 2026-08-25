import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type {
  ContributeInput,
  HarnessAssetType,
  PublicUser,
  ResolveTaskInput,
} from '@harnessvault/domain';
import { and, eq } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../db/database.service';
import { organizationMemberships, organizations } from '../db/schema';
import { renderStructuredContent } from '../compiler/render';
import { AssetService } from '../harness/asset.service';
import { AuthService } from '../identity/auth.service';
import { ResolverService } from '../resolver/resolver.service';
import { ContributionService } from '../contribution/contribution.service';
import { rankAssets } from './similarity';

export interface McpIdentity {
  user: PublicUser;
  organizationId: string;
  organizationName: string;
}

export interface SearchAssetArgs {
  query: string;
  types?: HarnessAssetType[];
  capability?: string;
  limit?: number;
}

export interface GetAssetArgs {
  assetId: string;
  versionId?: string;
  level?: 0 | 1 | 2 | 3;
}

export interface FindSimilarArgs {
  title: string;
  description: string;
  capability?: string;
  structuredContent?: unknown;
}

@Injectable()
export class McpService {
  constructor(
    private readonly database: DatabaseService,
    private readonly auth: AuthService,
    private readonly assets: AssetService,
    private readonly resolver: ResolverService,
    private readonly audit: AuditService,
    private readonly contributions: ContributionService,
  ) {}

  /**
   * Bearer 토큰과 조직 헤더로 호출자를 확정한다.
   * MCP 전용 인증을 따로 만들지 않고 REST와 같은 세션을 쓴다.
   */
  async authenticate(token: string | null, requestedOrgId: string | null): Promise<McpIdentity> {
    if (!token) {
      throw new UnauthorizedException({
        code: 'AUTH_REQUIRED',
        message: 'Authorization: Bearer <session token> 헤더가 필요합니다',
      });
    }

    const identity = await this.auth.resolveSession(token);
    if (!identity) {
      await this.audit.record({
        eventType: 'mcp.auth_failed',
        metadata: { reason: 'INVALID_SESSION' },
      });
      throw new UnauthorizedException({
        code: 'AUTH_REQUIRED',
        message: '세션이 유효하지 않습니다',
      });
    }

    const memberships = await this.auth.organizationsOf(identity.user.id);
    if (memberships.length === 0) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: '소속된 조직이 없습니다',
      });
    }

    if (requestedOrgId) {
      const found = memberships.find((org) => org.id === requestedOrgId);
      if (!found) {
        throw new ForbiddenException({
          code: 'PERMISSION_DENIED',
          message: '해당 조직의 멤버가 아닙니다',
        });
      }
      return { user: identity.user, organizationId: found.id, organizationName: found.name };
    }

    // 여러 조직에 속했는데 임의로 하나를 고르면
    // 사용자는 어느 조직 Harness를 받았는지 모른 채 일하게 된다.
    if (memberships.length > 1) {
      throw new ForbiddenException({
        code: 'ORGANIZATION_REQUIRED',
        message: 'X-Harness-Organization 헤더로 조직을 지정해야 합니다',
        organizations: memberships.map((org) => ({ id: org.id, name: org.name, slug: org.slug })),
      });
    }

    const only = memberships[0];
    if (!only) throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: '소속 조직 없음' });
    return { user: identity.user, organizationId: only.id, organizationName: only.name };
  }

  async organizationName(organizationId: string): Promise<string> {
    const [row] = await this.database.db
      .select({ name: organizations.name })
      .from(organizations)
      .innerJoin(
        organizationMemberships,
        eq(organizationMemberships.organizationId, organizations.id),
      )
      .where(and(eq(organizations.id, organizationId)))
      .limit(1);
    return row?.name ?? organizationId;
  }

  /* ---------------- 툴 ---------------- */

  /** Resolver를 다시 구현하지 않는다. REST와 완전히 같은 결과가 나와야 한다. */
  async resolveTask(identity: McpIdentity, input: ResolveTaskInput) {
    const manifest = await this.resolver.resolve(identity.organizationId, identity.user.id, input);
    return { traceId: manifest.traceId, manifest };
  }

  async searchAsset(identity: McpIdentity, args: SearchAssetArgs) {
    const all = await this.assets.list(identity.organizationId, {
      ...(args.types && args.types.length === 1 ? { type: args.types[0] } : {}),
      status: 'ACTIVE',
    });

    const filtered =
      args.types && args.types.length > 1
        ? all.filter((asset) => args.types?.includes(asset.type))
        : all;

    const ranked = rankAssets(
      filtered.map((asset) => ({
        key: asset.key,
        name: asset.name,
        description: asset.description,
        capabilityId: asset.capabilityId,
        assetId: asset.id,
        type: asset.type,
        scope: asset.scopeType,
        status: asset.status,
      })),
      { text: args.query, capabilityId: args.capability ?? null },
      Math.min(args.limit ?? 10, 50),
    );

    return {
      // 어휘 기반이다. 의미 검색인 척하지 않는다.
      method: 'LEXICAL' as const,
      assets: ranked.map((item) => ({
        assetId: item.assetId,
        key: item.key,
        name: item.name,
        type: item.type,
        scope: item.scope,
        status: item.status,
        score: item.score,
      })),
    };
  }

  /**
   * 명세 §21 progressive disclosure를 level로 표현한다.
   * 한 번에 전부 주지 않는 이유는 context budget이다.
   */
  async getAsset(identity: McpIdentity, args: GetAssetArgs) {
    const level = args.level ?? 1;
    const detail = await this.assets.detail(identity.organizationId, args.assetId);
    const { asset, versions, relations } = detail;

    const version = args.versionId
      ? versions.find((row) => row.id === args.versionId)
      : (versions.find((row) => row.status === 'ACTIVE') ?? versions[0]);

    const base = {
      assetId: asset.id,
      key: asset.key,
      name: asset.name,
      type: asset.type,
      scope: asset.scopeType,
      inheritanceMode: asset.inheritanceMode,
      status: asset.status,
      selector: asset.selector,
      level,
      version: version
        ? { versionId: version.id, version: version.version, status: version.status, summary: version.summary }
        : null,
      // 충돌 상태를 감추지 않는다. Resolver가 거부하게 될 자산임을 미리 알린다.
      activeVersionCount: detail.activeVersionCount,
    };

    if (level === 0 || !version) return base;

    const rendered =
      version.renderedMarkdown?.trim() || renderStructuredContent(version.structuredContent);
    const withBody = { ...base, body: rendered };

    if (level === 1) return withBody;

    const withRelations = {
      ...withBody,
      relations: {
        outgoing: relations.outgoing.map((r) => ({ type: r.type, key: r.key, assetId: r.assetId })),
        incoming: relations.incoming.map((r) => ({ type: r.type, key: r.key, assetId: r.assetId })),
      },
    };

    if (level === 2) return withRelations;

    return { ...withRelations, structuredContent: version.structuredContent };
  }

  async findSimilar(identity: McpIdentity, args: FindSimilarArgs) {
    // 벡터·어휘 판정은 ContributionService 한 곳에 있다. 두 곳에서 다르게 고르면 결과가 갈린다.
    const { candidates, method } = await this.contributions.similarTo(identity.organizationId, {
      title: args.title,
      description: [args.description, JSON.stringify(args.structuredContent ?? '')].join(' '),
      capabilityId: args.capability ?? null,
    });
    return { method, candidates };
  }

  async contribute(identity: McpIdentity, args: ContributeInput) {
    return this.contributions.submit(identity.organizationId, identity.user.id, args);
  }

  async recordToolCall(
    identity: McpIdentity,
    toolName: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record({
      organizationId: identity.organizationId,
      actorUserId: identity.user.id,
      eventType: 'mcp.tool_called',
      targetType: 'mcp_tool',
      targetId: toolName,
      metadata,
    });
  }
}
