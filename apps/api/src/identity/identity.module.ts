import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import {
  InvitationController,
  OrganizationInvitationController,
} from './invitation.controller';
import { InvitationService } from './invitation.service';
import { OrgScopeGuard } from './org-scope.guard';
import { SessionPurgeService } from './session-purge.service';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';
import { SessionGuard } from './session.guard';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';

@Module({
  controllers: [
    AuthController,
    OrganizationController,
    WorkspaceController,
    OrganizationInvitationController,
    InvitationController,
  ],
  providers: [
    AuthService,
    OrganizationService,
    WorkspaceService,
    SessionGuard,
    OrgScopeGuard,
    SessionPurgeService,
    InvitationService,
  ],
  exports: [AuthService, SessionGuard, OrgScopeGuard],
})
export class IdentityModule {}
