import { Body, Controller, HttpException, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { AccessTokenGuard } from '../auth/access-token.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AuthorizationService } from '../authorization/authorization.service';

const searchTestRequestSchema = z.object({
  query: z.string().min(1).max(2000),
  spaceIds: z.array(z.string().uuid()).min(1).max(10),
});

const searchTestResponseSchema = z.unknown();

@Controller('search-test')
@UseGuards(AccessTokenGuard)
export class SearchTestController {
  // Fallback exists for local development only. Production must set AI_SERVICE_URL.
  private readonly aiServiceUrl = process.env.AI_SERVICE_URL ?? 'http://127.0.0.1:8001';

  constructor(private readonly authorization: AuthorizationService) {}

  @Post()
  async test(@CurrentUser() user: AuthenticatedUser, @Body() input: unknown) {
    const parsed = searchTestRequestSchema.parse(input);

    for (const spaceId of parsed.spaceIds) {
      await this.authorization.requireSpace(user, spaceId, 'VIEW');
    }

    const snapshot = await this.authorization.snapshot(user);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`${this.aiServiceUrl}/v1/retrieval/test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: parsed.query,
          selectedSpaceIds: parsed.spaceIds,
          aclSnapshot: {
            userId: snapshot.userId,
            admin: snapshot.admin,
            groupIds: snapshot.groupIds,
            departmentId: snapshot.departmentId,
            spaces: snapshot.spaces,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new HttpException(
          'Retrieval service unavailable',
          response.status >= 500 ? 502 : response.status,
        );
      }

      const body: unknown = await response.json();
      return searchTestResponseSchema.parse(body);
    } finally {
      clearTimeout(timeout);
    }
  }
}
