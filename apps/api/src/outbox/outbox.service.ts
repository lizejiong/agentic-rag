import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { AuditContextService } from '../audit/audit-context.service';
import type { Prisma } from '../generated/prisma/client';
import type { EnqueueOutboxInput, OutboxEnvelope } from './outbox.types';

@Injectable()
export class OutboxService {
  constructor(private readonly context: AuditContextService) {}

  enqueue<T extends Record<string, unknown>>(
    transaction: Prisma.TransactionClient,
    input: EnqueueOutboxInput<T>,
  ) {
    const eventId = randomUUID();
    const occurredAt = new Date();
    const envelope: OutboxEnvelope<T> = {
      eventId,
      type: input.type,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      resourceId: input.resourceId,
      resourceVersion: input.resourceVersion,
      attempt: 0,
      traceId: input.traceId ?? this.context.get()?.traceId ?? 'system',
      occurredAt: occurredAt.toISOString(),
      payload: input.payload,
    };

    return transaction.outboxEvent.create({
      data: {
        eventId,
        type: envelope.type,
        taskId: envelope.taskId ?? null,
        resourceId: envelope.resourceId,
        resourceVersion: envelope.resourceVersion,
        attempt: envelope.attempt,
        traceId: envelope.traceId,
        payload: envelope.payload as Prisma.InputJsonValue,
        createdAt: occurredAt,
      },
    });
  }
}
