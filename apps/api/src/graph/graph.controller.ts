import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';

import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { GraphService } from './graph.service';

@Controller('spaces/:spaceId/graph')
@UseGuards(AccessTokenGuard)
export class GraphController {
  constructor(private readonly graph: GraphService) {}

  @Get('relations')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Query('status') status?: string,
    @Query('q') query?: string,
  ) {
    return this.graph.list(user, spaceId, {
      ...(status ? { status } : {}),
      ...(query ? { query } : {}),
    });
  }

  @Post('paths')
  paths(
    @CurrentUser() user: AuthenticatedUser,
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Body() input: unknown,
  ) {
    const value = z
      .object({
        sourceId: z.uuid(),
        targetId: z.uuid(),
        maxHops: z.number().int().min(1).max(3).default(3),
      })
      .parse(input);
    return this.graph.paths(user, spaceId, value);
  }

  @Post('relations/:relationId/publish')
  publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Param('relationId', ParseUUIDPipe) relationId: string,
  ) {
    return this.graph.publish(user, spaceId, relationId);
  }

  @Post('relations/:relationId/reject')
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Param('relationId', ParseUUIDPipe) relationId: string,
  ): Promise<void> {
    await this.graph.reject(user, spaceId, relationId);
  }

  @Post('relations/:relationId/correct')
  @HttpCode(204)
  correct(
    @CurrentUser() user: AuthenticatedUser,
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Param('relationId', ParseUUIDPipe) relationId: string,
    @Body() input: unknown,
  ) {
    const value = z.object({ predicate: z.string().trim().min(1).max(120) }).parse(input);
    return this.graph.mutate(
      user,
      spaceId,
      `/v1/graph/relations/${relationId}:correct`,
      'graph.relation.correct',
      relationId,
      value,
    );
  }

  @Post('relations/:relationId/rollback')
  @HttpCode(204)
  rollback(
    @CurrentUser() user: AuthenticatedUser,
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Param('relationId', ParseUUIDPipe) relationId: string,
  ) {
    return this.graph.mutate(
      user,
      spaceId,
      `/v1/graph/relations/${relationId}:rollback`,
      'graph.relation.rollback',
      relationId,
      {},
    );
  }

  @Post('entities/:entityId/merge')
  @HttpCode(204)
  merge(
    @CurrentUser() user: AuthenticatedUser,
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Body() input: unknown,
  ) {
    const value = z.object({ targetEntityId: z.uuid() }).parse(input);
    return this.graph.mutate(
      user,
      spaceId,
      `/v1/graph/entities/${entityId}:merge`,
      'graph.entity.merge',
      entityId,
      value,
    );
  }

  @Post('entities/:entityId/split')
  split(
    @CurrentUser() user: AuthenticatedUser,
    @Param('spaceId', ParseUUIDPipe) spaceId: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Body() input: unknown,
  ) {
    const value = z
      .object({
        entities: z
          .array(
            z.object({
              name: z.string().trim().min(1).max(240),
              entityType: z.string().trim().min(1).max(80),
              relationIds: z.array(z.uuid()).min(1),
            }),
          )
          .min(1),
      })
      .parse(input);
    return this.graph.mutate(
      user,
      spaceId,
      `/v1/graph/entities/${entityId}:split`,
      'graph.entity.split',
      entityId,
      value,
    );
  }
}
