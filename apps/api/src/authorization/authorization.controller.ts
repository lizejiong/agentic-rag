import { Body, Controller, Inject, NotFoundException, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ENVIRONMENT, type Environment } from '../infrastructure/config/environment';
import { AuthorizationService } from './authorization.service';

const probeSchema = z.discriminatedUnion('resourceType', [
  z.object({
    resourceType: z.literal('SPACE'),
    spaceId: z.uuid(),
    permission: z.enum(['VIEW', 'EDIT', 'MANAGE']),
  }),
  z.object({
    resourceType: z.literal('DOCUMENT'),
    documentId: z.uuid(),
    operation: z.enum(['SEARCH', 'CITATION', 'PREVIEW', 'DOWNLOAD']),
  }),
]);

@Controller('authorization')
@UseGuards(AccessTokenGuard)
export class AuthorizationController {
  constructor(
    private readonly authorization: AuthorizationService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  @Post('probe')
  async probe(@CurrentUser() user: AuthenticatedUser, @Body() input: unknown) {
    if (this.environment.NODE_ENV === 'production') {
      throw new NotFoundException();
    }
    const parsed = probeSchema.safeParse(input);
    if (!parsed.success) {
      throw new NotFoundException();
    }
    if (parsed.data.resourceType === 'SPACE') {
      return {
        allowed: true,
        permission: await this.authorization.requireSpace(
          user,
          parsed.data.spaceId,
          parsed.data.permission,
        ),
      };
    }
    return {
      allowed: true,
      ...(await this.authorization.authorizeDocument(user, parsed.data)),
    };
  }
}
