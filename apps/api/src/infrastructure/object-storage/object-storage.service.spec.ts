import { Readable } from 'node:stream';

import type { Environment } from '../config/environment';
import { ObjectStorageService, type ObjectStorageClient } from './object-storage.service';

const environment = {
  MINIO_QUARANTINE_BUCKET: 'atlas-rag-quarantine',
  MINIO_DOCUMENT_BUCKET: 'atlas-rag-documents',
} as Environment;

function createClient(): jest.Mocked<ObjectStorageClient> {
  return {
    bucketExists: jest.fn().mockResolvedValue(true),
    getObject: jest.fn(),
    putObject: jest.fn().mockImplementation(async (_bucket, _key, stream: Readable) => {
      for await (const chunk of stream) {
        // Consume the stream like the real SDK.
        void chunk;
      }
    }),
    removeObject: jest.fn().mockResolvedValue(undefined),
    statObject: jest.fn().mockRejectedValue({ code: 'NotFound' }),
    copyObject: jest.fn().mockResolvedValue({}),
  };
}

describe('ObjectStorageService', () => {
  it('streams a quarantine upload and returns its digest', async () => {
    const client = createClient();
    const service = new ObjectStorageService(client, environment);

    await expect(
      service.putQuarantineObject({
        importId: 'import-1',
        source: Readable.from(Buffer.from('atlas')),
        expectedBytes: 5,
        maxBytes: 10,
        contentType: 'text/plain',
      }),
    ).resolves.toEqual({
      objectKey: 'imports/import-1',
      contentHash: '7c82602500857aa6ed0cf38c4c3e4ec645bdcaa82c00b9155eb08be100c778a9',
      sizeBytes: 5,
    });
  });

  it('deletes an incomplete object when actual bytes exceed the limit', async () => {
    const client = createClient();
    const service = new ObjectStorageService(client, environment);

    await expect(
      service.putQuarantineObject({
        importId: 'import-2',
        source: Readable.from(Buffer.from('too-large')),
        expectedBytes: 5,
        maxBytes: 5,
        contentType: 'text/plain',
      }),
    ).rejects.toThrow('OBJECT_SIZE_LIMIT_EXCEEDED');
    expect(client.removeObject.mock.calls).toContainEqual([
      'atlas-rag-quarantine',
      'imports/import-2',
    ]);
  });

  it('deletes an object when actual bytes differ from Content-Length', async () => {
    const client = createClient();
    const service = new ObjectStorageService(client, environment);

    await expect(
      service.putQuarantineObject({
        importId: 'import-3',
        source: Readable.from(Buffer.from('short')),
        expectedBytes: 6,
        maxBytes: 10,
        contentType: 'text/plain',
      }),
    ).rejects.toThrow('OBJECT_SIZE_MISMATCH');
    expect(client.removeObject.mock.calls).toHaveLength(1);
  });

  it('reuses a promoted content-addressed object when it already exists', async () => {
    const client = createClient();
    client.statObject.mockResolvedValue({});
    const service = new ObjectStorageService(client, environment);
    const hash = 'a'.repeat(64);

    await expect(service.promoteByHash('imports/import-4', hash)).resolves.toBe(
      `sha256/aa/${hash}`,
    );
    expect(client.copyObject.mock.calls).toHaveLength(0);
  });

  it('fails startup when a required bucket is missing', async () => {
    const client = createClient();
    client.bucketExists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const service = new ObjectStorageService(client, environment);

    await expect(service.onModuleInit()).rejects.toThrow('atlas-rag-documents');
  });
});
