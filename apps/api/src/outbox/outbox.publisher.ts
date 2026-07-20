import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';
import { ENVIRONMENT, type Environment } from '../infrastructure/config/environment';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { RedisService } from '../infrastructure/redis/redis.service';
import type { OutboxEnvelope } from './outbox.types';

const EVENT_STREAM = 'atlas:events';
const DEAD_LETTER_STREAM = 'atlas:events:dead-letter';
const RETRY_DELAYS_MS = [1_000, 5_000, 30_000, 120_000, 600_000] as const;

type ClaimedId = { id: string };

@Injectable()
export class OutboxPublisher implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private polling = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  onModuleInit(): void {
    if (this.environment.NODE_ENV === 'test') {
      return;
    }
    this.timer = setInterval(() => void this.poll(), 1_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async publishBatch(limit = 100): Promise<{ published: number; retried: number; failed: number }> {
    return this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.$queryRaw<ClaimedId[]>`
        SELECT id
        FROM "app"."outbox_events"
        WHERE status = 'PENDING'::"app"."OutboxStatus"
          AND next_attempt_at <= NOW()
        ORDER BY created_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `;
      if (claimed.length === 0) {
        return { published: 0, retried: 0, failed: 0 };
      }
      const events = await transaction.outboxEvent.findMany({
        where: { id: { in: claimed.map(({ id }) => id) } },
        orderBy: { createdAt: 'asc' },
      });

      let published = 0;
      let retried = 0;
      let failed = 0;
      for (const event of events) {
        const envelope = this.toEnvelope(event);
        try {
          await this.redis.streamAdd(EVENT_STREAM, { envelope: JSON.stringify(envelope) });
          await transaction.outboxEvent.update({
            where: { id: event.id },
            data: {
              status: 'PUBLISHED',
              publishedAt: new Date(),
              errorCode: null,
            },
          });
          published += 1;
        } catch (error) {
          const attempt = event.attempt + 1;
          const errorCode = this.errorCode(error);
          if (attempt >= 6) {
            await this.redis.streamAdd(DEAD_LETTER_STREAM, {
              envelope: JSON.stringify({ ...envelope, attempt }),
              errorCode,
              traceId: event.traceId,
            });
            await transaction.outboxEvent.update({
              where: { id: event.id },
              data: { status: 'FAILED', attempt, errorCode },
            });
            failed += 1;
          } else {
            await transaction.outboxEvent.update({
              where: { id: event.id },
              data: {
                attempt,
                errorCode,
                nextAttemptAt: new Date(
                  Date.now() + (RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS.at(-1) ?? 600_000),
                ),
              },
            });
            retried += 1;
          }
        }
      }
      return { published, retried, failed };
    });
  }

  private async poll(): Promise<void> {
    if (this.polling) {
      return;
    }
    this.polling = true;
    try {
      await this.publishBatch();
    } catch {
      // PostgreSQL retains every pending event. The next interval retries safely.
    } finally {
      this.polling = false;
    }
  }

  private toEnvelope(event: {
    eventId: string;
    type: string;
    taskId: string | null;
    resourceId: string;
    resourceVersion: number;
    attempt: number;
    traceId: string;
    payload: Prisma.JsonValue;
    createdAt: Date;
  }): OutboxEnvelope<Record<string, unknown>> {
    const payload =
      event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
        ? (event.payload as Record<string, unknown>)
        : { value: event.payload };
    return {
      eventId: event.eventId,
      type: event.type,
      ...(event.taskId ? { taskId: event.taskId } : {}),
      resourceId: event.resourceId,
      resourceVersion: event.resourceVersion,
      attempt: event.attempt,
      traceId: event.traceId,
      occurredAt: event.createdAt.toISOString(),
      payload,
    };
  }

  private errorCode(error: unknown): string {
    const code =
      error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? error.code
        : error instanceof Error
          ? error.name
          : 'OUTBOX_PUBLISH_ERROR';
    return code.slice(0, 120);
  }
}
