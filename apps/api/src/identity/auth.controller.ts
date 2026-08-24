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
  type LoginInput,
  type RegisterInput,
  loginInputSchema,
  registerInputSchema,
} from '@harnessvault/domain';
import type { CookieOptions, Response } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { getEnv } from '../env';
import { AuthService } from './auth.service';
import { CurrentAuth } from './current-user.decorator';
import { SESSION_COOKIE_NAME } from './session-token';
import { type RequestAuth, SessionGuard } from './session.guard';

function sessionCookieOptions(expires?: Date): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: getEnv().NODE_ENV === 'production',
    path: '/',
    expires,
  };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  async register(@Body(new ZodValidationPipe(registerInputSchema)) input: RegisterInput) {
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
