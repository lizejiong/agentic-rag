import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';

import { AccessTokenGuard } from '../auth/access-token.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { SpacesService } from './spaces.service';

const settingsFields = {
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(5_000).nullable(),
  tags: z.array(z.string().trim().min(1).max(80)).max(50),
  defaultLanguage: z.string().trim().min(2).max(20),
  egressPolicy: z.enum(['LOCAL_ONLY', 'REDACTED_CLOUD', 'CLOUD_ALLOWED']),
  llmEnabled: z.boolean(),
  embeddingEnabled: z.boolean(),
  rerankerEnabled: z.boolean(),
  asrEnabled: z.boolean(),
  ttsEnabled: z.boolean(),
  graphExtractionEnabled: z.boolean(),
};
const createSchema = z.object({
  name: settingsFields.name,
  description: settingsFields.description.optional(),
  tags: settingsFields.tags.optional(),
  defaultLanguage: settingsFields.defaultLanguage.optional(),
  egressPolicy: settingsFields.egressPolicy.optional(),
  llmEnabled: settingsFields.llmEnabled.optional(),
  embeddingEnabled: settingsFields.embeddingEnabled.optional(),
  rerankerEnabled: settingsFields.rerankerEnabled.optional(),
  asrEnabled: settingsFields.asrEnabled.optional(),
  ttsEnabled: settingsFields.ttsEnabled.optional(),
  graphExtractionEnabled: settingsFields.graphExtractionEnabled.optional(),
});
const updateSchema = z
  .object(
    Object.fromEntries(
      Object.entries(settingsFields).map(([key, schema]) => [key, schema.optional()]),
    ) as { [K in keyof typeof settingsFields]: z.ZodOptional<(typeof settingsFields)[K]> },
  )
  .refine((input) => Object.keys(input).length > 0);
const statusSchema = z.object({ status: z.enum(['ACTIVE', 'ARCHIVED']) });
const grantSchema = z.object({
  subjectType: z.enum(['USER', 'DEPARTMENT', 'GROUP']),
  subjectId: z.uuid(),
  permission: z.enum(['VIEW', 'EDIT', 'MANAGE']),
  expiresAt: z.coerce.date().nullable().optional(),
});

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException('INVALID_SPACE_REQUEST');
  }
  return result.data;
}

@Controller('spaces')
@UseGuards(AccessTokenGuard)
export class SpacesController {
  constructor(private readonly spaces: SpacesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.spaces.list(user);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.spaces.get(user, id);
  }

  @Post()
  @UseGuards(AdminGuard)
  create(@CurrentUser() user: AuthenticatedUser, @Body() input: unknown) {
    return this.spaces.create(user, parse(createSchema, input));
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
  ) {
    return this.spaces.update(user, id, parse(updateSchema, input));
  }

  @Patch(':id/status')
  setStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
  ) {
    return this.spaces.setStatus(user, id, parse(statusSchema, input).status);
  }

  @Put(':id/grants')
  upsertGrant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
  ) {
    return this.spaces.upsertGrant(user, id, parse(grantSchema, input));
  }

  @Delete(':id/grants/:grantId')
  @HttpCode(204)
  deleteGrant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('grantId', ParseUUIDPipe) grantId: string,
  ): Promise<void> {
    return this.spaces.deleteGrant(user, id, grantId);
  }
}
