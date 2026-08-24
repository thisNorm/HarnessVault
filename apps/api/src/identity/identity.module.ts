import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OrgScopeGuard } from './org-scope.guard';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';
import { SessionGuard } from './session.guard';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';

@Module({
  controllers: [AuthController, OrganizationController, WorkspaceController],
  providers: [AuthService, OrganizationService, WorkspaceService, SessionGuard, OrgScopeGuard],
  exports: [AuthService, SessionGuard, OrgScopeGuard],
})
export class IdentityModule {}
