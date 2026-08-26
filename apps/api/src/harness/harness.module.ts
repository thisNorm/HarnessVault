import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { AssetService } from './asset.service';
import { CapabilityService } from './capability.service';
import { EmbeddingService } from '../contribution/embedding.service';
import { HarnessController } from './harness.controller';

@Module({
  imports: [IdentityModule],
  controllers: [HarnessController],
  // EmbeddingService는 주입 의존성이 없다. ContributionModule을 끌어오면
  // 순환이 생기므로 여기서 직접 제공한다.
  providers: [CapabilityService, AssetService, EmbeddingService],
  exports: [CapabilityService, AssetService],
})
export class HarnessModule {}
