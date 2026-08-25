import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { CompilerModule } from './compiler/compiler.module';
import { DatabaseModule } from './db/database.module';
import { HarnessModule } from './harness/harness.module';
import { HealthModule } from './health/health.module';
import { IdentityModule } from './identity/identity.module';
import { ResolverModule } from './resolver/resolver.module';

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    IdentityModule,
    HarnessModule,
    ResolverModule,
    CompilerModule,
    HealthModule,
  ],
})
export class AppModule {}
