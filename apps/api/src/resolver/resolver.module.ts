import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { OutputContractModule } from '../output-contract/output-contract.module';
import { TraceModule } from '../trace/trace.module';
import { ResolverController } from './resolver.controller';
import { ResolverService } from './resolver.service';

@Module({
  imports: [IdentityModule, TraceModule, OutputContractModule],
  controllers: [ResolverController],
  providers: [ResolverService],
  exports: [ResolverService],
})
export class ResolverModule {}
