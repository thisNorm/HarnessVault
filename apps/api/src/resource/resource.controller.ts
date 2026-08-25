import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  type CreateResourceInput,
  type UpdateResourceInput,
  createResourceInputSchema,
  resourceTypeSchema,
  updateResourceInputSchema,
} from '@harnessvault/domain';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentAuth } from '../identity/current-user.decorator';
import { OrgScopeGuard, RequireOrgRole } from '../identity/org-scope.guard';
import { type RequestAuth, SessionGuard } from '../identity/session.guard';
import { ResourceService } from './resource.service';

const listQuerySchema = z.object({ type: resourceTypeSchema.optional() });

@Controller('organizations/:orgId/resources')
@UseGuards(SessionGuard, OrgScopeGuard)
export class ResourceController {
  constructor(private readonly resources: ResourceService) {}

  @Get()
  async list(
    @Param('orgId') orgId: string,
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ) {
    return { resources: await this.resources.list(orgId, query.type) };
  }

  @Post()
  @RequireOrgRole('ORG_ADMIN')
  async create(
    @CurrentAuth() auth: RequestAuth,
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(createResourceInputSchema)) input: CreateResourceInput,
  ) {
    return { resource: await this.resources.create(auth.user.id, orgId, input) };
  }

  @Patch(':resourceId')
  @RequireOrgRole('ORG_ADMIN')
  async update(
    @CurrentAuth() auth: RequestAuth,
    @Param('orgId') orgId: string,
    @Param('resourceId') resourceId: string,
    @Body(new ZodValidationPipe(updateResourceInputSchema)) input: UpdateResourceInput,
  ) {
    return { resource: await this.resources.update(auth.user.id, orgId, resourceId, input) };
  }
}
