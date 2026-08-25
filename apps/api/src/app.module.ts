import { Module } from '@nestjs/common';
import { ApprovalModule } from './approval/approval.module';
import { AuditModule } from './audit/audit.module';
import { CompilerModule } from './compiler/compiler.module';
import { ContributionModule } from './contribution/contribution.module';
import { DatabaseModule } from './db/database.module';
import { HarnessModule } from './harness/harness.module';
import { HealthModule } from './health/health.module';
import { IdentityModule } from './identity/identity.module';
import { McpModule } from './mcp/mcp.module';
import { OutputContractModule } from './output-contract/output-contract.module';
import { PolicyModule } from './policy/policy.module';
import { ResolverModule } from './resolver/resolver.module';
import { ResourceModule } from './resource/resource.module';
import { TraceModule } from './trace/trace.module';

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
    OutputContractModule,
    ContributionModule,
    TraceModule,
    McpModule,
    HealthModule,
  ],
})
export class AppModule {}
