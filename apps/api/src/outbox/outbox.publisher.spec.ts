import type { Prisma } from '../generated/prisma/client';
import type { Environment } from '../infrastructure/config/environment';
import type { PrismaService } from '../infrastructure/database/prisma.service';
import type { RedisService } from '../infrastructure/redis/redis.service';
import { OutboxPublisher } from './outbox.publisher';

describe('OutboxPublisher', () => {
  it('does not start its polling timer in the test environment', () => {
    const publisher = new OutboxPublisher(
      {} as PrismaService,
      {} as RedisService,
      { NODE_ENV: 'test' } as Environment,
    );

    expect(() => publisher.onModuleInit()).not.toThrow();
    expect(() => publisher.onModuleDestroy()).not.toThrow();
  });

  it('retries transient failures and dead-letters the sixth failure', async () => {
    const event = {
      id: '7f3af69a-ff66-4557-87c9-f4ca02355dbc',
      eventId: 'd21fab99-ae43-4a99-b0e3-c1372397ba52',
      type: 'test.event',
      taskId: null,
      resourceId: 'resource-1',
      resourceVersion: 1,
      attempt: 5,
      traceId: 'trace-1',
      payload: {},
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const update = jest.fn(() => Promise.resolve(event));
    const transaction = {
      $queryRaw: jest.fn(() => Promise.resolve([{ id: event.id }])),
      outboxEvent: {
        findMany: jest.fn(() => Promise.resolve([event])),
        update,
      },
    } as unknown as Prisma.TransactionClient;
    const prisma = {
      $transaction: async <T>(
        operation: (transaction: Prisma.TransactionClient) => Promise<T>,
      ): Promise<T> => operation(transaction),
    } as PrismaService;
    const streamAdd = jest.fn((stream: string): Promise<string> =>
      stream === 'atlas:events'
        ? Promise.reject(Object.assign(new Error('stream failed'), { code: 'STREAM_WRITE_FAILED' }))
        : Promise.resolve('1-0'),
    );
    const redis = { streamAdd } as unknown as RedisService;
    const publisher = new OutboxPublisher(prisma, redis, { NODE_ENV: 'test' } as Environment);

    await expect(publisher.publishBatch()).resolves.toEqual({
      published: 0,
      retried: 0,
      failed: 1,
    });
    expect(streamAdd).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith({
      where: { id: event.id },
      data: {
        status: 'FAILED',
        attempt: 6,
        errorCode: 'STREAM_WRITE_FAILED',
      },
    });
  });
});
