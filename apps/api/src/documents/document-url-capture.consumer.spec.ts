import { PrismaService } from '../infrastructure/database/prisma.service';
import type { Environment } from '../infrastructure/config/environment';
import { RedisService } from '../infrastructure/redis/redis.service';
import { DocumentUrlCaptureConsumer } from './document-url-capture.consumer';
import { DocumentUrlCaptureService } from './document-url-capture.service';

const envelope = JSON.stringify({
  type: 'document.url.capture.requested.v1',
  traceId: 'trace-1',
  payload: {
    documentId: '1c0078c7-5818-4527-966b-e0663c476374',
    spaceId: 'b7b7cbbd-0d42-40dc-9895-86f7859166ea',
    versionId: 'd57d4f96-82f4-454b-a101-071fcde1f119',
    importId: '89321158-2038-4b7f-a20c-ea92e6b4090c',
    sourceUrl: 'https://example.com/guide',
    actorId: '806fcb79-225b-4ca5-bb67-f94a5b66d9c4',
    aclSnapshot: {
      spaceId: 'b7b7cbbd-0d42-40dc-9895-86f7859166ea',
      documentSubjects: [],
    },
  },
});

describe('DocumentUrlCaptureConsumer', () => {
  it('claims a durable task, captures it, and acknowledges the stream entry', async () => {
    const prisma = {
      importTask: {
        findUnique: jest.fn().mockResolvedValue({
          id: '89321158-2038-4b7f-a20c-ea92e6b4090c',
          status: 'QUEUED',
          stage: 'FETCHING',
          attempt: 0,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const redis = {
      ensureConsumerGroup: jest.fn(),
      streamAutoClaim: jest.fn().mockResolvedValue([]),
      streamReadGroup: jest.fn().mockResolvedValue([{ id: '1-0', message: { envelope } }]),
      streamAck: jest.fn(),
    };
    const capture = { capture: jest.fn().mockResolvedValue('QUEUED') };
    const consumer = new DocumentUrlCaptureConsumer(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
      capture as unknown as DocumentUrlCaptureService,
      { NODE_ENV: 'test' } as Environment,
    );

    await expect(consumer.consumeOnce()).resolves.toBe(1);
    /* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matchers are intentionally untyped. */
    expect(prisma.importTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'RUNNING' }) }),
    );
    expect(capture.capture).toHaveBeenCalledWith(
      expect.objectContaining({ sourceUrl: 'https://example.com/guide' }),
      'trace-1',
    );
    /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    expect(redis.streamAck).toHaveBeenCalledWith('atlas:events', 'atlas-api-url-capture', '1-0');
  });
});
