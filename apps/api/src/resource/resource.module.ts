import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ResourceController } from './resource.controller';
import { ResourceService } from './resource.service';

@Module({
  imports: [IdentityModule],
  controllers: [ResourceController],
  providers: [ResourceService],
  exports: [ResourceService],
})
export class ResourceModule {}
