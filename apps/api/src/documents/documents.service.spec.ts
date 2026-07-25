import { Readable, Writable } from 'node:stream';

import { NotFoundException } from '@nestjs/common';
import type { Response } from 'express';

import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { ObjectStorageService } from '../infrastructure/object-storage/object-storage.service';
import { OutboxService } from '../outbox/outbox.service';
import { SpacePolicy } from '../spaces/space-policy';
import { DocumentsService } from './documents.service';

const user: AuthenticatedUser = {
  id: '8af3ea14-c2a4-40bc-824c-20b4b8d3a787',
  username: 'viewer',
  role: 'MEMBER',
  tokenVersion: 0,
};

const activeDocument = {
  id: 'document-1',
  spaceId: 'space-1',
  title: 'Test Document',
  sourceType: 'FILE' as const,
  availability: 'ACTIVE' as const,
  activeVersionId: 'version-1',
  createdBy: { id: 'user-1', username: 'uploader' },
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-02'),
  versions: [
    {
      id: 'version-1',
      documentId: 'document-1',
      versionNumber: 1,
      sourceType: 'FILE' as const,
      sourceUrl: null,
      resolvedUrl: null,
      canonicalUrl: null,
      sourceAuthor: null,
      sourcePublishedAt: null,
      sourceFetchedAt: null,
      sourceCheckedAt: null,
      originalFileName: 'report.pdf',
      declaredMimeType: 'application/pdf',
      detectedMimeType: 'application/pdf',
      sizeBytes: 2048,
      contentHash: 'a'.repeat(64),
      processingStatus: 'READY' as const,
      errorCode: null,
      errorMessage: null,
      publishedAt: new Date('2026-01-01'),
      createdAt: new Date('2026-01-01'),
    },
  ],
  importTasks: [
    {
      id: 'import-1',
      documentId: 'document-1',
      versionId: 'version-1',
      status: 'SUCCEEDED' as const,
      stage: 'READY' as const,
      progress: 100,
      attempt: 1,
      errorCode: null,
      errorMessage: null,
      startedAt: new Date('2026-01-01'),
      completedAt: new Date('2026-01-02'),
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'),
    },
  ],
};

const softDeletedDocument = {
  ...activeDocument,
  availability: 'SOFT_DELETED' as const,
};

const missingDocument = null;

const downloadDocument = {
  availability: 'ACTIVE' as const,
  spaceId: 'space-1',
  activeVersion: {
    originalFileName: 'report.pdf',
    storedObject: {
      bucket: 'atlas-rag-documents',
      objectKey: 'sha256/aa/hash',
      detectedMimeType: 'application/pdf',
      sizeBytes: 2048,
    },
  },
};

function createDependencies() {
  const prisma = {
    document: {
      findUnique: jest.fn().mockResolvedValue(activeDocument),
    },
    $queryRaw: jest.fn().mockResolvedValue([
      { element_index: 0, element_type: 'paragraph', content: 'Hello' },
      { element_index: 1, element_type: 'paragraph', content: 'World' },
    ]),
  };
  const policy = { require: jest.fn().mockResolvedValue('VIEW') };
  const storage = {
    getObject: jest.fn().mockResolvedValue(Readable.from(Buffer.from('test'))),
  };
  const outbox = { enqueue: jest.fn().mockResolvedValue({}) };
  const service = new DocumentsService(
    prisma as unknown as PrismaService,
    policy as unknown as SpacePolicy,
    storage as unknown as ObjectStorageService,
    outbox as unknown as OutboxService,
  );
  return { prisma, policy, storage, service };
}

describe('DocumentsService.get()', () => {
  it('returns a document with public fields only', async () => {
    const { service } = createDependencies();
    const result = await service.get(user, 'document-1');

    expect(result).toBeDefined();
    expect(result.id).toBe('document-1');
    expect(result.title).toBe('Test Document');
    expect(result.versions).toHaveLength(1);
    expect(result.importTasks).toHaveLength(1);
  });

  it('uses explicit select without internal fields', async () => {
    const { prisma, service } = createDependencies();
    await service.get(user, 'document-1');

    const query = prisma.document.findUnique.mock.calls[0]?.[0] as {
      select: Record<string, unknown>;
    };
    expect(query.select).toBeDefined();
    expect(query.select).not.toHaveProperty('deletedAt');
    expect(query.select).not.toHaveProperty('createdById');
    const taskSelect = query.select.importTasks as { select: Record<string, unknown> };
    expect(taskSelect.select).not.toHaveProperty('quarantineObjectKey');
    expect(taskSelect.select).not.toHaveProperty('requestId');
    expect(taskSelect.select).not.toHaveProperty('traceId');
    expect(taskSelect.select).not.toHaveProperty('createdById');
  });

  it('throws NotFoundException for a soft-deleted document', async () => {
    const { prisma, service } = createDependencies();
    prisma.document.findUnique.mockResolvedValueOnce(softDeletedDocument);

    await expect(service.get(user, 'document-1')).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException for a missing document', async () => {
    const { prisma, service } = createDependencies();
    prisma.document.findUnique.mockResolvedValueOnce(missingDocument);

    await expect(service.get(user, 'document-1')).rejects.toThrow(NotFoundException);
  });

  it('enforces space VIEW permission', async () => {
    const { policy, service } = createDependencies();

    await service.get(user, 'document-1');

    expect(policy.require).toHaveBeenCalledWith(user, 'space-1', 'VIEW');
  });
});

describe('DocumentsService.download()', () => {
  it('streams a file from object storage', async () => {
    const { prisma, policy, storage, service } = createDependencies();
    prisma.document.findUnique.mockResolvedValueOnce(downloadDocument);

    const headers: Record<string, string> = {};
    const response = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    (response as unknown as Record<string, unknown>).set = (obj: Record<string, string>) =>
      Object.assign(headers, obj);
    await service.download(user, 'document-1', response as unknown as Response);

    expect(policy.require).toHaveBeenCalledWith(user, 'space-1', 'VIEW');
    expect(storage.getObject).toHaveBeenCalledWith('atlas-rag-documents', 'sha256/aa/hash');
    expect(headers['Content-Type']).toBe('application/pdf');
    expect(headers['Content-Length']).toBe('2048');
  });

  it('throws NotFoundException when no stored object exists', async () => {
    const { prisma, service } = createDependencies();
    prisma.document.findUnique.mockResolvedValueOnce({
      availability: 'ACTIVE',
      spaceId: 'space-1',
      activeVersion: { originalFileName: 'test.txt', storedObject: null },
    });

    const response = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    await expect(
      service.download(user, 'document-1', response as unknown as Response),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('DocumentsService.getContent()', () => {
  it('returns the full text of a parsed document', async () => {
    const { service } = createDependencies();
    const result = await service.getContent(user, 'document-1');

    expect(result).toEqual({
      documentId: 'document-1',
      title: 'Test Document',
      elementCount: 2,
      fullText: 'Hello\n\nWorld',
    });
  });

  it('throws NotFoundException when no active version exists', async () => {
    const { prisma, service } = createDependencies();
    prisma.document.findUnique.mockResolvedValueOnce({
      availability: 'ACTIVE' as const,
      spaceId: 'space-1',
      title: 'Test',
      activeVersionId: null,
    });

    await expect(service.getContent(user, 'document-1')).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException when no elements found', async () => {
    const { prisma, service } = createDependencies();
    prisma.$queryRaw.mockResolvedValueOnce([]);

    await expect(service.getContent(user, 'document-1')).rejects.toThrow(NotFoundException);
  });
});
