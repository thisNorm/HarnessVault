import { Module } from '@nestjs/common';
import { ApprovalModule } from './approval/approval.module';
import { AuditModule } from './audit/audit.module';
import { CompilerModule } from './compiler/compiler.module';
import { DatabaseModule } from './db/database.module';
import { HarnessModule } from './harness/harness.module';
import { HealthModule } from './health/health.module';
import { IdentityModule } from './identity/identity.module';
import { McpModule } from './mcp/mcp.module';
import { PolicyModule } from './policy/policy.module';
import { ResolverModule } from './resolver/resolver.module';
import { ResourceModule } from './resource/resource.module';

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    IdentityModule,
    HarnessModule,
    ResolverModule,
    CompilerModule,
    PolicyModule,
    ApprovalModule,
    ResourceModule,
    McpModule,
    HealthModule,
  ],
})
export class AppModule {}
