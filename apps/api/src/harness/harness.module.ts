import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { AssetService } from './asset.service';
import { CapabilityService } from './capability.service';
import { HarnessController } from './harness.controller';

@Module({
  imports: [IdentityModule],
  controllers: [HarnessController],
  providers: [CapabilityService, AssetService],
  exports: [CapabilityService, AssetService],
})
export class HarnessModule {}
