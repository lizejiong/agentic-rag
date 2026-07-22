import type { DocumentUrlCaptureRequestedPayload } from '@rag/contracts';

import { PrismaService } from '../infrastructure/database/prisma.service';
import { ObjectStorageService } from '../infrastructure/object-storage/object-storage.service';
import { OutboxService } from '../outbox/outbox.service';
import { DocumentUrlCaptureService } from './document-url-capture.service';
import { UrlContentExtractor } from './url-content-extractor';
import { UrlHttpFetcher } from './url-http-fetcher';

const payload: DocumentUrlCaptureRequestedPayload = {
  documentId: '1c0078c7-5818-4527-966b-e0663c476374',
  spaceId: 'b7b7cbbd-0d42-40dc-9895-86f7859166ea',
  versionId: 'd57d4f96-82f4-454b-a101-071fcde1f119',
  importId: '89321158-2038-4b7f-a20c-ea92e6b4090c',
  sourceUrl: 'https://example.com/guide',
  actorId: '806fcb79-225b-4ca5-bb67-f94a5b66d9c4',
  aclSnapshot: { spaceId: 'b7b7cbbd-0d42-40dc-9895-86f7859166ea', documentSubjects: [] },
};

function createDependencies(activeContentHash: string | null = null) {
  const transaction = {
    document: { update: jest.fn() },
    documentVersion: { update: jest.fn() },
    importTask: { update: jest.fn() },
  };
  const prisma = {
    importTask: {
      findUnique: jest.fn().mockResolvedValue({
        id: payload.importId,
        documentId: payload.documentId,
        versionId: payload.versionId,
        version: { originalFileName: 'captured-page.md' },
        document: {
          activeVersion: activeContentHash
            ? { id: 'active-version', contentHash: activeContentHash }
            : null,
        },
      }),
    },
    $transaction: jest.fn((operation: (client: typeof transaction) => Promise<unknown>) =>
      operation(transaction),
    ),
  };
  const storage = {
    putQuarantineBuffer: jest.fn().mockResolvedValue({
      objectKey: `imports/${payload.importId}`,
      contentHash: '',
      sizeBytes: 0,
    }),
    deleteQuarantineObject: jest.fn(),
  };
  const fetcher = {
    fetch: jest.fn().mockResolvedValue({
      body: Buffer.from('<html></html>'),
      contentType: 'text/html',
      finalUrl: 'https://example.com/final',
      fetchedAt: new Date('2026-07-22T00:00:00.000Z'),
    }),
  };
  const extractor = {
    extract: jest.fn().mockReturnValue({
      title: 'Example guide',
      markdown: '# Example guide\n\nUseful content.',
      canonicalUrl: 'https://example.com/canonical',
      author: 'Atlas',
      publishedAt: null,
      siteName: 'Example',
      excerpt: null,
    }),
  };
  const outbox = { enqueue: jest.fn() };
  const service = new DocumentUrlCaptureService(
    prisma as unknown as PrismaService,
    storage as unknown as ObjectStorageService,
    fetcher as unknown as UrlHttpFetcher,
    extractor as unknown as UrlContentExtractor,
    outbox as unknown as OutboxService,
  );
  return { service, transaction, storage, outbox, extractor };
}

describe('DocumentUrlCaptureService', () => {
  it('stores extracted Markdown and queues the existing ingestion pipeline', async () => {
    const dependencies = createDependencies();
    const body = Buffer.from('# Example guide\n\nUseful content.');
    dependencies.storage.putQuarantineBuffer.mockResolvedValue({
      objectKey: `imports/${payload.importId}`,
      contentHash: 'a'.repeat(64),
      sizeBytes: body.length,
    });

    await expect(dependencies.service.capture(payload, 'trace-1')).resolves.toBe('QUEUED');
    expect(dependencies.storage.putQuarantineBuffer).toHaveBeenCalledWith(
      expect.objectContaining({
        importId: payload.importId,
        contentType: 'text/markdown; charset=utf-8',
      }),
    );
    expect(dependencies.outbox.enqueue).toHaveBeenCalledWith(
      dependencies.transaction,
      expect.objectContaining({ type: 'document.ingestion.requested.v1', traceId: 'trace-1' }),
    );
  });

  it('does not create another stored object when a refresh is unchanged', async () => {
    const body = '# Example guide\n\nUseful content.';
    const hash = (await import('node:crypto')).createHash('sha256').update(body).digest('hex');
    const dependencies = createDependencies(hash);

    await expect(dependencies.service.capture(payload, 'trace-1')).resolves.toBe('UNCHANGED');
    expect(dependencies.storage.putQuarantineBuffer).not.toHaveBeenCalled();
    expect(dependencies.outbox.enqueue).not.toHaveBeenCalled();
    /* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matchers are intentionally untyped. */
    expect(dependencies.transaction.documentVersion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: payload.versionId },
        data: expect.objectContaining({
          processingStatus: 'CANCELLED',
          errorCode: 'URL_CONTENT_UNCHANGED',
        }),
      }),
    );
    /* eslint-enable @typescript-eslint/no-unsafe-assignment */
  });
});
