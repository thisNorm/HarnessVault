import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  DEVELOPMENT_MIN_PASSWORD_LENGTH,
  PRODUCTION_MIN_PASSWORD_LENGTH,
  type LoginInput,
  loginInputSchema,
  makeRegisterInputSchema,
} from '@harnessvault/domain';
import type { CookieOptions, Response } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { cookieSecure, getEnv } from '../env';
import { AuthService } from './auth.service';
import { CurrentAuth } from './current-user.decorator';
import { SESSION_COOKIE_NAME } from './session-token';
import { type RequestAuth, SessionGuard } from './session.guard';

/**
 * 개발 중에는 `test@test.com` / `1234` 같은 계정으로 바로 확인할 수 있게 완화한다.
 * 운영에서는 완화되지 않는다 — 이 분기가 유일한 차이다.
 */
const registerSchema = makeRegisterInputSchema(
  getEnv().NODE_ENV === 'production'
    ? PRODUCTION_MIN_PASSWORD_LENGTH
    : DEVELOPMENT_MIN_PASSWORD_LENGTH,
);

type RegisterBody = ReturnType<typeof registerSchema.parse>;

function sessionCookieOptions(expires?: Date): CookieOptions {
  const env = getEnv();
  return {
    httpOnly: true,
    // 웹과 API 도메인이 갈리는 배포에서는 none이 필요하다. env가 조합을 검증한다.
    sameSite: env.SESSION_COOKIE_SAMESITE,
    secure: cookieSecure(env),
    ...(env.SESSION_COOKIE_DOMAIN ? { domain: env.SESSION_COOKIE_DOMAIN } : {}),
    path: '/',
    expires,
  };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  async register(@Body(new ZodValidationPipe(registerSchema)) input: RegisterBody) {
    return { user: await this.auth.register(input) };
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginInputSchema)) input: LoginInput,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { user, session } = await this.auth.login(input);
    response.cookie(SESSION_COOKIE_NAME, session.token, sessionCookieOptions(session.expiresAt));
    return { user };
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async logout(@CurrentAuth() auth: RequestAuth, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(auth.token);
    response.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions());
  }

  @Get('me')
  @UseGuards(SessionGuard)
  async me(@CurrentAuth() auth: RequestAuth) {
    return {
      user: auth.user,
      organizations: await this.auth.organizationsOf(auth.user.id),
    };
  }
}
