import { Module } from '@nestjs/common';
import { ContributionModule } from '../contribution/contribution.module';
import { IdentityModule } from '../identity/identity.module';
import { CuratorController } from './curator.controller';
import { CuratorService } from './curator.service';
import { MockCuratorProvider, OllamaCuratorProvider } from './provider';

@Module({
  imports: [IdentityModule, ContributionModule],
  controllers: [CuratorController],
  providers: [CuratorService, MockCuratorProvider, OllamaCuratorProvider],
  exports: [CuratorService],
})
export class CuratorModule {}
