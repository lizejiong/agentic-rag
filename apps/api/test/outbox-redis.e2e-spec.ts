import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../src/app.module';
import type { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { RedisService } from '../src/infrastructure/redis/redis.service';
import { OutboxPublisher } from '../src/outbox/outbox.publisher';
import { StreamConsumer } from '../src/outbox/stream.consumer';
import type { OutboxEnvelope } from '../src/outbox/outbox.types';

const PREFIX = 'outbox-redis-e2e-';
const GROUP = 'outbox-redis-e2e-consumer';

describe('PostgreSQL outbox and Redis Streams', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let publisher: OutboxPublisher;
  let consumer: StreamConsumer;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    prisma = module.get(PrismaService);
    redis = module.get(RedisService);
    publisher = module.get(OutboxPublisher);
    consumer = module.get(StreamConsumer);
    await cleanupDatabase(prisma);
    await redis.flushDatabase();
    await app.init();
  });

  afterAll(async () => {
    await redis.flushDatabase();
    await cleanupDatabase(prisma);
    await app.close();
  });

  it('publishes, deduplicates, and keeps permanent state after Redis is cleared', async () => {
    const user = await prisma.user.create({
      data: {
        username: `${PREFIX}user`,
        displayName: 'Outbox User',
        passwordHash: 'not-used-by-this-test',
      },
    });
    const space = await prisma.knowledgeSpace.create({
      data: { name: `${PREFIX}space`, createdById: user.id },
    });
    const grant = await prisma.spaceGrant.create({
      data: {
        spaceId: space.id,
        subjectType: 'USER',
        subjectId: user.id,
        permission: 'MANAGE',
      },
    });
    const event = await prisma.outboxEvent.create({
      data: {
        eventId: randomUUID(),
        type: 'test.side-effect.requested',
        resourceId: space.id,
        resourceVersion: 1,
        traceId: 'outbox-redis-e2e-trace',
        payload: { auditAction: `${PREFIX}side-effect` },
        createdAt: new Date('2000-01-01T00:00:00.000Z'),
        nextAttemptAt: new Date('2000-01-01T00:00:00.000Z'),
      },
    });

    await expect(publisher.publishBatch(1)).resolves.toEqual({
      published: 1,
      retried: 0,
      failed: 0,
    });
    const envelope: OutboxEnvelope<Record<string, unknown>> = {
      eventId: event.eventId,
      type: event.type,
      resourceId: event.resourceId,
      resourceVersion: event.resourceVersion,
      attempt: event.attempt,
      traceId: event.traceId,
      occurredAt: event.createdAt.toISOString(),
      payload: { auditAction: `${PREFIX}side-effect` },
    };
    await redis.streamAdd('atlas:events', { envelope: JSON.stringify(envelope) });

    await expect(
      consumer.consumeOnce({
        group: GROUP,
        consumer: 'worker-1',
        count: 10,
        handler: writeSideEffect,
      }),
    ).resolves.toEqual({ delivered: 2, processed: 1, duplicates: 1 });
    await expect(
      prisma.auditLog.count({ where: { action: `${PREFIX}side-effect` } }),
    ).resolves.toBe(1);

    await redis.flushDatabase();

    const [users, spaces, grants, outboxEvents, processedEvents] = await Promise.all([
      prisma.user.count({ where: { id: user.id } }),
      prisma.knowledgeSpace.count({ where: { id: space.id } }),
      prisma.spaceGrant.count({ where: { id: grant.id } }),
      prisma.outboxEvent.count({ where: { id: event.id, status: 'PUBLISHED' } }),
      prisma.processedEvent.count({
        where: { eventId: event.eventId, consumer: GROUP },
      }),
    ]);
    expect({ users, spaces, grants, outboxEvents, processedEvents }).toEqual({
      users: 1,
      spaces: 1,
      grants: 1,
      outboxEvents: 1,
      processedEvents: 1,
    });
  });
});

async function writeSideEffect(
  transaction: Prisma.TransactionClient,
  envelope: OutboxEnvelope<Record<string, unknown>>,
): Promise<void> {
  await transaction.auditLog.create({
    data: {
      action: String(envelope.payload.auditAction),
      targetType: 'OUTBOX_EVENT',
      targetId: envelope.eventId,
      result: 'SUCCESS',
      requestId: 'outbox-consumer',
      traceId: envelope.traceId,
    },
  });
}

async function cleanupDatabase(prisma: PrismaService): Promise<void> {
  const events = await prisma.outboxEvent.findMany({
    where: { type: 'test.side-effect.requested' },
    select: { eventId: true },
  });
  await prisma.processedEvent.deleteMany({
    where: { eventId: { in: events.map(({ eventId }) => eventId) } },
  });
  await prisma.auditLog.deleteMany({ where: { action: { startsWith: PREFIX } } });
  await prisma.outboxEvent.deleteMany({ where: { type: 'test.side-effect.requested' } });
  const spaces = await prisma.knowledgeSpace.findMany({
    where: { name: { startsWith: PREFIX } },
    select: { id: true },
  });
  await prisma.spaceGrant.deleteMany({
    where: { spaceId: { in: spaces.map(({ id }) => id) } },
  });
  await prisma.knowledgeSpace.deleteMany({
    where: { id: { in: spaces.map(({ id }) => id) } },
  });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
}
