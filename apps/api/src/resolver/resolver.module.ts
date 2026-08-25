import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ResolverController } from './resolver.controller';
import { ResolverService } from './resolver.service';

@Module({
  imports: [IdentityModule],
  controllers: [ResolverController],
  providers: [ResolverService],
  exports: [ResolverService],
})
export class ResolverModule {}
