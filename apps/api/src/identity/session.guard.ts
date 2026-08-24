import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { PublicUser } from '@harnessvault/domain';
import { AuthService } from './auth.service';
import { SESSION_COOKIE_NAME, parseBearerToken, readCookie } from './session-token';

export interface RequestAuth {
  user: PublicUser;
  sessionId: string;
  token: string;
}

export type AuthenticatedRequest = Request & { auth: RequestAuth };

/** 웹 콘솔의 쿠키와 MCP·API의 Bearer 토큰을 같은 경로로 처리한다. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token =
      parseBearerToken(request.header('authorization')) ??
      readCookie(request.header('cookie'), SESSION_COOKIE_NAME);

    if (!token) {
      throw new UnauthorizedException({ code: 'AUTH_REQUIRED', message: '인증이 필요합니다' });
    }

    const identity = await this.auth.resolveSession(token);
    if (!identity) {
      throw new UnauthorizedException({
        code: 'AUTH_REQUIRED',
        message: '세션이 유효하지 않습니다',
      });
    }

    (request as AuthenticatedRequest).auth = { ...identity, token };
    return true;
  }
}
