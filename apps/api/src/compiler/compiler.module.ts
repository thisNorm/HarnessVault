import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ResolverModule } from '../resolver/resolver.module';
import { CompilerController } from './compiler.controller';
import { CompilerService } from './compiler.service';

@Module({
  imports: [IdentityModule, ResolverModule],
  controllers: [CompilerController],
  providers: [CompilerService],
  exports: [CompilerService],
})
export class CompilerModule {}
