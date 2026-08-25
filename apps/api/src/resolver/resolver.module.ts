import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { TraceModule } from '../trace/trace.module';
import { ResolverController } from './resolver.controller';
import { ResolverService } from './resolver.service';

@Module({
  imports: [IdentityModule, TraceModule],
  controllers: [ResolverController],
  providers: [ResolverService],
  exports: [ResolverService],
})
export class ResolverModule {}
