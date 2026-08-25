import { Module } from '@nestjs/common';
import { AuditModule } from './audit/audit.module';
import { DatabaseModule } from './db/database.module';
import { HarnessModule } from './harness/harness.module';
import { HealthModule } from './health/health.module';
import { IdentityModule } from './identity/identity.module';

@Module({
  imports: [DatabaseModule, AuditModule, IdentityModule, HarnessModule, HealthModule],
})
export class AppModule {}
