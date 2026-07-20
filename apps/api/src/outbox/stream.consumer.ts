import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { RedisService } from '../infrastructure/redis/redis.service';
import type { OutboxEnvelope } from './outbox.types';

const envelopeSchema = z.object({
  eventId: z.uuid(),
  type: z.string().min(1),
  taskId: z.uuid().optional(),
  resourceId: z.string().min(1),
  resourceVersion: z.number().int().positive(),
  attempt: z.number().int().nonnegative(),
  traceId: z.string().min(1),
  occurredAt: z.iso.datetime(),
  payload: z.record(z.string(), z.unknown()),
});

export type StreamEventHandler = (
  transaction: Prisma.TransactionClient,
  envelope: OutboxEnvelope<Record<string, unknown>>,
) => Promise<void>;

@Injectable()
export class StreamConsumer {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async consumeOnce(input: {
    stream?: string;
    group: string;
    consumer: string;
    handler: StreamEventHandler;
    count?: number;
  }): Promise<{ delivered: number; processed: number; duplicates: number }> {
    const stream = input.stream ?? 'atlas:events';
    await this.redis.ensureConsumerGroup(stream, input.group);
    const entries = await this.redis.streamReadGroup({
      stream,
      group: input.group,
      consumer: input.consumer,
      ...(input.count ? { count: input.count } : {}),
    });
    let processed = 0;
    let duplicates = 0;

    for (const entry of entries) {
      const parsed = envelopeSchema.parse(JSON.parse(entry.message.envelope ?? '') as unknown);
      const { taskId, ...requiredEnvelope } = parsed;
      const envelope: OutboxEnvelope<Record<string, unknown>> = {
        ...requiredEnvelope,
        ...(taskId ? { taskId } : {}),
      };
      const wasProcessed = await this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.processedEvent.findUnique({
          where: {
            eventId_consumer: {
              eventId: envelope.eventId,
              consumer: input.group,
            },
          },
          select: { eventId: true },
        });
        if (existing) {
          return false;
        }
        await input.handler(transaction, envelope);
        await transaction.processedEvent.create({
          data: { eventId: envelope.eventId, consumer: input.group },
        });
        return true;
      });
      await this.redis.streamAck(stream, input.group, entry.id);
      if (wasProcessed) {
        processed += 1;
      } else {
        duplicates += 1;
      }
    }
    return { delivered: entries.length, processed, duplicates };
  }
}
