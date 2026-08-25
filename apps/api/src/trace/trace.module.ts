import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { OutputContractModule } from '../output-contract/output-contract.module';
import { TraceController } from './trace.controller';
import { TraceService } from './trace.service';

@Module({
  imports: [IdentityModule, OutputContractModule],
  controllers: [TraceController],
  providers: [TraceService],
  exports: [TraceService],
})
export class TraceModule {}
