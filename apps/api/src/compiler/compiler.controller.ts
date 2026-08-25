import { Body, Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { type CompileRequestInput, compileInputSchema } from '@harnessvault/domain';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentAuth } from '../identity/current-user.decorator';
import { OrgScopeGuard } from '../identity/org-scope.guard';
import { type RequestAuth, SessionGuard } from '../identity/session.guard';
import { CompilerService } from './compiler.service';

@Controller('organizations/:orgId')
@UseGuards(SessionGuard, OrgScopeGuard)
export class CompilerController {
  constructor(private readonly compiler: CompilerService) {}

  /** 해석과 컴파일을 한 번에 한다. 웹 `/resolve` 화면의 컴파일 탭이 이것을 쓴다. */
  @Post('compile')
  @HttpCode(200)
  async compile(
    @CurrentAuth() auth: RequestAuth,
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(compileInputSchema)) input: CompileRequestInput,
  ) {
    return this.compiler.compile(orgId, auth.user.id, input);
  }
}
