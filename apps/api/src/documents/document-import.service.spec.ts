import { Readable } from 'node:stream';

import { BadRequestException, ConflictException } from '@nestjs/common';

import { AuditContextService } from '../audit/audit-context.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { ObjectStorageService } from '../infrastructure/object-storage/object-storage.service';
import { OutboxService } from '../outbox/outbox.service';
import { SpacePolicy } from '../spaces/space-policy';
import { DocumentImportService } from './document-import.service';
import { parseCreateFileImports } from './document-import.validation';

const user: AuthenticatedUser = {
  id: '8af3ea14-c2a4-40bc-824c-20b4b8d3a787',
  username: 'editor',
  role: 'MEMBER',
  tokenVersion: 0,
};

const transaction = {
  document: {
    create: jest.fn().mockResolvedValue({ id: 'document-1' }),
  },
  documentVersion: {
    create: jest.fn().mockResolvedValue({ id: 'version-1' }),
    update: jest.fn().mockResolvedValue({}),
  },
  importTask: {
    create: jest.fn().mockResolvedValue({ id: 'import-1' }),
    update: jest.fn().mockResolvedValue({}),
  },
};

type TransactionOperation = (client: typeof transaction) => Promise<unknown>;

function createDependencies() {
  const prisma = {
    knowledgeSpace: {
      findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }),
    },
    document: {
      findUnique: jest.fn().mockResolvedValue({ spaceId: 'space-1' }),
    },
    importTask: {
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest
      .fn()
      .mockImplementation((operation: TransactionOperation) => operation(transaction)),
  };
  const storage = {
    putQuarantineObject: jest.fn().mockResolvedValue({
      objectKey: 'imports/import-1',
      contentHash: 'a'.repeat(64),
      sizeBytes: 1024,
    }),
    deleteQuarantineObject: jest.fn().mockResolvedValue(undefined),
  };
  const outbox = { enqueue: jest.fn().mockResolvedValue({}) };
  const policy = { require: jest.fn().mockResolvedValue('EDIT') };
  const context = {
    get: jest.fn().mockReturnValue({ requestId: 'request-1', traceId: 'trace-1' }),
  };
  const service = new DocumentImportService(
    prisma as unknown as PrismaService,
    storage as unknown as ObjectStorageService,
    outbox as unknown as OutboxService,
    policy as unknown as SpacePolicy,
    context as unknown as AuditContextService,
  );
  return { service, prisma, storage, outbox, policy };
}

describe('DocumentImportService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a document, immutable version, and upload task in one transaction', async () => {
    const { service } = createDependencies();
    const result = await service.createFileImports(user, 'space-1', {
      files: [
        {
          clientFileId: '76ef25d3-eaa5-4759-b6a3-71347d809b2f',
          fileName: '产品手册.pdf',
          sizeBytes: 1024,
          mimeType: 'application/pdf',
        },
      ],
    });

    expect(result.imports).toEqual([
      {
        clientFileId: '76ef25d3-eaa5-4759-b6a3-71347d809b2f',
        documentId: 'document-1',
        versionId: 'version-1',
        importId: 'import-1',
        uploadPath: '/imports/import-1/content',
      },
    ]);
    expect(transaction.documentVersion.create).toHaveBeenCalledTimes(1);
  });

  it('queues ingestion and writes the command through the transactional outbox', async () => {
    const { service, prisma, storage, outbox, policy } = createDependencies();
    prisma.importTask.findUnique.mockResolvedValue({
      id: 'import-1',
      documentId: 'document-1',
      versionId: 'version-1',
      status: 'PENDING_UPLOAD',
      version: {
        documentId: 'document-1',
        originalFileName: '产品手册.pdf',
        sizeBytes: 1024,
        declaredMimeType: 'application/pdf',
      },
    });

    await expect(
      service.uploadContent({
        user,
        importId: 'import-1',
        source: Readable.from(Buffer.alloc(1024)),
        contentLength: 1024,
        contentType: 'application/pdf',
      }),
    ).resolves.toMatchObject({ status: 'QUEUED', contentHash: 'a'.repeat(64) });
    expect(policy.require).toHaveBeenCalledWith(user, 'space-1', 'EDIT');
    expect(storage.putQuarantineObject).toHaveBeenCalled();
    expect(outbox.enqueue).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        type: 'document.ingestion.requested.v1',
        taskId: 'import-1',
        resourceId: 'version-1',
      }),
    );
  });

  it('rejects a Content-Length that differs from the declared file size', async () => {
    const { service, prisma, storage } = createDependencies();
    prisma.importTask.findUnique.mockResolvedValue({
      id: 'import-1',
      documentId: 'document-1',
      versionId: 'version-1',
      status: 'PENDING_UPLOAD',
      version: {
        documentId: 'document-1',
        originalFileName: '产品手册.pdf',
        sizeBytes: 1024,
        declaredMimeType: 'application/pdf',
      },
    });

    await expect(
      service.uploadContent({
        user,
        importId: 'import-1',
        source: Readable.from(Buffer.alloc(100)),
        contentLength: 100,
        contentType: 'application/pdf',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(storage.putQuarantineObject).not.toHaveBeenCalled();
  });
});

describe('parseCreateFileImports', () => {
  it('applies the 100 MiB limit to text formats', () => {
    expect(() =>
      parseCreateFileImports({
        files: [
          {
            clientFileId: '76ef25d3-eaa5-4759-b6a3-71347d809b2f',
            fileName: 'huge.json',
            sizeBytes: 100 * 1024 * 1024 + 1,
            mimeType: 'application/json',
          },
        ],
      }),
    ).toThrow(BadRequestException);
  });
});
