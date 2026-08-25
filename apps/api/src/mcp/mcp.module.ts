import { Module } from '@nestjs/common';
import { HarnessModule } from '../harness/harness.module';
import { IdentityModule } from '../identity/identity.module';
import { ResolverModule } from '../resolver/resolver.module';
import { ApprovalModule } from '../approval/approval.module';
import { ResourceModule } from '../resource/resource.module';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';

@Module({
  imports: [IdentityModule, HarnessModule, ResolverModule, ResourceModule, ApprovalModule],
  controllers: [McpController],
  providers: [McpService],
})
export class McpModule {}
