import { Injectable } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { RedisService } from '../infrastructure/redis/redis.service';

@Injectable()
export class AuthorizationRevisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async mutate<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const committed = await this.prisma.$transaction(async (transaction) => {
      const result = await operation(transaction);
      const state = await transaction.authorizationState.upsert({
        where: { id: 1 },
        update: { revision: { increment: 1 } },
        create: { id: 1, revision: 1n },
        select: { revision: true },
      });
      return { result, revision: state.revision };
    });

    try {
      await this.redis.publish(
        'authz:invalidate',
        JSON.stringify({
          type: 'authorization.revision.changed',
          revision: committed.revision.toString(),
        }),
      );
    } catch {
      // Revision is the correctness boundary. Publishing only reduces stale-cache
      // memory and latency; a failed publish never rolls back committed business data.
    }
    return committed.result;
  }
}
