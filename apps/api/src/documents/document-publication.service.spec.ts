import type { Prisma } from '../generated/prisma/client';
import type { Environment } from '../infrastructure/config/environment';
import { ObjectStorageService } from '../infrastructure/object-storage/object-storage.service';
import { DocumentPublicationService } from './document-publication.service';

const documentId = '1c0078c7-5818-4527-966b-e0663c476374';
const spaceId = 'b7b7cbbd-0d42-40dc-9895-86f7859166ea';
const versionId = 'd57d4f96-82f4-454b-a101-071fcde1f119';
const importId = '89321158-2038-4b7f-a20c-ea92e6b4090c';

function createService() {
  const storage = {
    promoteByHash: jest.fn().mockResolvedValue(`sha256/aa/${'a'.repeat(64)}`),
    deleteQuarantineObject: jest.fn().mockResolvedValue(undefined),
  };
  const service = new DocumentPublicationService(
    storage as unknown as ObjectStorageService,
    { MINIO_DOCUMENT_BUCKET: 'atlas-rag-documents' } as Environment,
  );
  return { service, storage };
}

describe('DocumentPublicationService', () => {
  it('publishes a completed candidate only after promoting its content object', async () => {
    const { service, storage } = createService();
    const transaction = {
      importTask: {
        findUnique: jest.fn().mockResolvedValue({
          id: importId,
          documentId,
          versionId,
          status: 'RUNNING',
          quarantineObjectKey: `imports/${importId}`,
          document: { id: documentId },
          version: { contentHash: 'a'.repeat(64), sizeBytes: 1024 },
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      storedObject: {
        upsert: jest.fn().mockResolvedValue({ id: 'stored-object-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      documentVersion: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      document: { update: jest.fn().mockResolvedValue({}) },
    };

    await service.publishCompleted(transaction as unknown as Prisma.TransactionClient, {
      documentId,
      spaceId,
      versionId,
      importId,
      normalizedDocumentId: '806fcb79-225b-4ca5-bb67-f94a5b66d9c4',
      chunkCount: 3,
      detectedMimeType: 'application/pdf',
      parserVersion: 'docling/2',
    });

    expect(storage.promoteByHash).toHaveBeenCalledWith(`imports/${importId}`, 'a'.repeat(64));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const refCountUpdate = transaction.storedObject.update.mock.calls[0]?.[0] as {
      data: { refCount: { increment: number } };
    };
    expect(refCountUpdate.data.refCount).toEqual({ increment: 1 });
    expect(transaction.document.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { activeVersionId: versionId, availability: 'ACTIVE' } }),
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const taskUpdate = transaction.importTask.update.mock.calls[0]?.[0] as {
      data: { status: string };
    };
    expect(taskUpdate.data.status).toBe('SUCCEEDED');
  });

  it('marks only the failed candidate and leaves the active document pointer unchanged', async () => {
    const { service } = createService();
    const transaction = {
      importTask: {
        findUnique: jest.fn().mockResolvedValue({
          documentId,
          versionId,
          status: 'RUNNING',
          document: { activeVersionId: '11111111-1111-4111-8111-111111111111' },
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      documentVersion: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      document: { update: jest.fn() },
    };

    await service.publishFailed(transaction as unknown as Prisma.TransactionClient, {
      documentId,
      spaceId,
      versionId,
      importId,
      stage: 'PARSING',
      code: 'DOCUMENT_PARSE_FAILED',
      message: 'The document could not be parsed.',
      retryable: false,
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const versionUpdate = transaction.documentVersion.updateMany.mock.calls[0]?.[0] as {
      data: { processingStatus: string };
    };
    expect(versionUpdate.data.processingStatus).toBe('FAILED');
    expect(transaction.document.update).not.toHaveBeenCalled();
  });
});
