import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { OutputContractController } from './output-contract.controller';
import { OutputContractService } from './output-contract.service';

@Module({
  imports: [IdentityModule],
  controllers: [OutputContractController],
  providers: [OutputContractService],
  exports: [OutputContractService],
})
export class OutputContractModule {}
