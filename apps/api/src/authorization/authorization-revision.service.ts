import { Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { RedisService } from '../infrastructure/redis/redis.service';
import { OutboxService } from '../outbox/outbox.service';

type ValueResolver<T, V> = V | ((result: T) => V);

export type AuthorizedMutation<T> = {
  action: string;
  targetType: string;
  targetId: ValueResolver<T, string | undefined>;
  eventType: string;
  resourceId: ValueResolver<T, string>;
  payload?: ValueResolver<T, Record<string, unknown>>;
  reason?: string;
};

function resolve<T, V>(value: ValueResolver<T, V>, result: T): V {
  return typeof value === 'function' ? (value as (result: T) => V)(result) : value;
}

@Injectable()
export class AuthorizationRevisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async mutate<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
    mutation: AuthorizedMutation<T>,
  ): Promise<T> {
    const committed = await this.prisma.$transaction(async (transaction) => {
      const result = await operation(transaction);
      const state = await transaction.authorizationState.upsert({
        where: { id: 1 },
        update: { revision: { increment: 1 } },
        create: { id: 1, revision: 1n },
        select: { revision: true },
      });
      const targetId = resolve(mutation.targetId, result);
      const resourceId = resolve(mutation.resourceId, result);
      const payload = mutation.payload ? resolve(mutation.payload, result) : {};
      await this.audit.write(transaction, {
        action: mutation.action,
        targetType: mutation.targetType,
        ...(targetId ? { targetId } : {}),
        ...(mutation.reason ? { reason: mutation.reason } : {}),
        metadata: payload,
      });
      await this.outbox.enqueue(transaction, {
        type: mutation.eventType,
        resourceId,
        resourceVersion: Number(state.revision),
        payload,
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
