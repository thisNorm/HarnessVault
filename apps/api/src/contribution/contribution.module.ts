import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ContributionController } from './contribution.controller';
import { ContributionService } from './contribution.service';
import { EmbeddingService } from './embedding.service';

@Module({
  imports: [IdentityModule],
  controllers: [ContributionController],
  providers: [ContributionService, EmbeddingService],
  exports: [ContributionService],
})
export class ContributionModule {}
