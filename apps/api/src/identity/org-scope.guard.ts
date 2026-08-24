import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { OrganizationRole } from '@harnessvault/domain';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service';
import { organizationMemberships } from '../db/schema';
import type { AuthenticatedRequest } from './session.guard';

const REQUIRED_ROLE = 'harness:requiredOrgRole';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 컨트롤러 핸들러에 필요한 조직 역할을 표시한다. 없으면 멤버이기만 하면 된다. */
export const RequireOrgRole = (role: OrganizationRole) => SetMetadata(REQUIRED_ROLE, role);

export type OrgScopedRequest = AuthenticatedRequest & {
  orgRole: OrganizationRole;
};

/**
 * `:orgId` 경로 파라미터가 가리키는 조직의 멤버십을 확인한다.
 * 멤버가 아니면 조직의 존재 자체를 알려주지 않기 위해 404를 준다.
 */
@Injectable()
export class OrgScopeGuard implements CanActivate {
  constructor(
    private readonly database: DatabaseService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const raw = request.params.orgId;
    const orgId = typeof raw === 'string' ? raw : undefined;
    // 잘못된 형식이면 DB에 던지지 않는다. Postgres uuid 캐스팅 오류가 500으로 새어나가는 것을 막는다.
    if (!orgId || !UUID_PATTERN.test(orgId)) {
      throw new NotFoundException('조직을 찾을 수 없습니다');
    }

    const [membership] = await this.database.db
      .select({ role: organizationMemberships.role })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, orgId),
          eq(organizationMemberships.userId, request.auth.user.id),
        ),
      )
      .limit(1);

    if (!membership) throw new NotFoundException('조직을 찾을 수 없습니다');

    const required = this.reflector.getAllAndOverride<OrganizationRole | undefined>(REQUIRED_ROLE, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (required === 'ORG_ADMIN' && membership.role !== 'ORG_ADMIN') {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: '조직 관리자만 수행할 수 있습니다',
      });
    }

    (request as OrgScopedRequest).orgRole = membership.role;
    return true;
  }
}
