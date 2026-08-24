import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { RequestAuth, AuthenticatedRequest } from './session.guard';

/** `SessionGuard`가 채운 인증 정보를 컨트롤러 인자로 꺼낸다. */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestAuth => {
    return context.switchToHttp().getRequest<AuthenticatedRequest>().auth;
  },
);
