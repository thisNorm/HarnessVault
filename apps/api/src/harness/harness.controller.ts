import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  type CreateAssetInput,
  type CreateAssetRelationInput,
  type CreateAssetVersionInput,
  type CreateCapabilityInput,
  type ListAssetsQuery,
  type UpdateAssetInput,
  createAssetInputSchema,
  createAssetRelationInputSchema,
  createAssetVersionInputSchema,
  createCapabilityInputSchema,
  listAssetsQuerySchema,
  updateAssetInputSchema,
} from '@harnessvault/domain';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentAuth } from '../identity/current-user.decorator';
import { OrgScopeGuard, RequireOrgRole } from '../identity/org-scope.guard';
import { type RequestAuth, SessionGuard } from '../identity/session.guard';
import { AssetService } from './asset.service';
import { CapabilityService } from './capability.service';

@Controller('organizations/:orgId')
@UseGuards(SessionGuard, OrgScopeGuard)
export class HarnessController {
  constructor(
    private readonly capabilities: CapabilityService,
    private readonly assets: AssetService,
  ) {}

  /* ---------------- Capability ---------------- */

  @Get('capabilities')
  async listCapabilities(@Param('orgId') orgId: string) {
    return { capabilities: await this.capabilities.list(orgId) };
  }

  @Post('capabilities')
  @RequireOrgRole('ORG_ADMIN')
  async createCapability(
    @CurrentAuth() auth: RequestAuth,
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(createCapabilityInputSchema)) input: CreateCapabilityInput,
  ) {
    return { capability: await this.capabilities.create(auth.user.id, orgId, input) };
  }

  @Get('capabilities/:capabilityId')
  async capabilityDetail(
    @Param('orgId') orgId: string,
    @Param('capabilityId') capabilityId: string,
  ) {
    return { capability: await this.capabilities.findById(orgId, capabilityId) };
  }

  /* ---------------- Asset ---------------- */

  @Get('assets')
  async listAssets(
    @Param('orgId') orgId: string,
    @Query(new ZodValidationPipe(listAssetsQuerySchema)) query: ListAssetsQuery,
  ) {
    return { assets: await this.assets.list(orgId, query) };
  }

  @Post('assets')
  @RequireOrgRole('ORG_ADMIN')
  async createAsset(
    @CurrentAuth() auth: RequestAuth,
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(createAssetInputSchema)) input: CreateAssetInput,
  ) {
    return { asset: await this.assets.create(auth.user.id, orgId, input) };
  }

  @Get('assets/:assetId')
  async assetDetail(@Param('orgId') orgId: string, @Param('assetId') assetId: string) {
    return this.assets.detail(orgId, assetId);
  }

  @Patch('assets/:assetId')
  @RequireOrgRole('ORG_ADMIN')
  async updateAsset(
    @CurrentAuth() auth: RequestAuth,
    @Param('orgId') orgId: string,
    @Param('assetId') assetId: string,
    @Body(new ZodValidationPipe(updateAssetInputSchema)) input: UpdateAssetInput,
  ) {
    return { asset: await this.assets.update(auth.user.id, orgId, assetId, input) };
  }

  /* ---------------- Version ---------------- */

  @Post('assets/:assetId/versions')
  @RequireOrgRole('ORG_ADMIN')
  async createVersion(
    @CurrentAuth() auth: RequestAuth,
    @Param('orgId') orgId: string,
    @Param('assetId') assetId: string,
    @Body(new ZodValidationPipe(createAssetVersionInputSchema)) input: CreateAssetVersionInput,
  ) {
    return { version: await this.assets.createVersion(auth.user.id, orgId, assetId, input) };
  }

  @Get('assets/:assetId/versions/:versionId')
  async versionDetail(
    @Param('orgId') orgId: string,
    @Param('assetId') assetId: string,
    @Param('versionId') versionId: string,
  ) {
    return { version: await this.assets.findVersion(orgId, assetId, versionId) };
  }

  @Post('assets/:assetId/versions/:versionId/promote')
  @RequireOrgRole('ORG_ADMIN')
  async promoteVersion(
    @CurrentAuth() auth: RequestAuth,
    @Param('orgId') orgId: string,
    @Param('assetId') assetId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.assets.promoteVersion(auth.user.id, orgId, assetId, versionId);
  }

  /* ---------------- Relation ---------------- */

  @Post('assets/:assetId/relations')
  @RequireOrgRole('ORG_ADMIN')
  async createRelation(
    @CurrentAuth() auth: RequestAuth,
    @Param('orgId') orgId: string,
    @Param('assetId') assetId: string,
    @Body(new ZodValidationPipe(createAssetRelationInputSchema)) input: CreateAssetRelationInput,
  ) {
    return { relation: await this.assets.createRelation(auth.user.id, orgId, assetId, input) };
  }

  @Delete('assets/:assetId/relations/:relationId')
  @RequireOrgRole('ORG_ADMIN')
  @HttpCode(204)
  async removeRelation(
    @CurrentAuth() auth: RequestAuth,
    @Param('orgId') orgId: string,
    @Param('assetId') assetId: string,
    @Param('relationId') relationId: string,
  ) {
    await this.assets.removeRelation(auth.user.id, orgId, assetId, relationId);
  }
}
