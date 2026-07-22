import { basename, extname } from 'node:path';
import type { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';

import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  CreateFileImports,
  CreateFileImportsResponse,
  CreateUrlImport,
  CreateUrlImportResponse,
  DocumentIngestionRequestedPayload,
  DocumentUrlCaptureRequestedPayload,
} from '@rag/contracts';

import { AuditContextService } from '../audit/audit-context.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { ObjectStorageService } from '../infrastructure/object-storage/object-storage.service';
import { OutboxService } from '../outbox/outbox.service';
import { SpacePolicy } from '../spaces/space-policy';
import { validateImportFile } from './document-import.validation';

@Injectable()
export class DocumentImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly outbox: OutboxService,
    private readonly spacePolicy: SpacePolicy,
    private readonly context: AuditContextService,
  ) {}

  async createFileImports(
    user: AuthenticatedUser,
    spaceId: string,
    input: CreateFileImports,
  ): Promise<CreateFileImportsResponse> {
    const context = this.context.get();
    const requestId = context?.requestId ?? randomUUID();
    const traceId = context?.traceId ?? requestId;
    const space = await this.prisma.knowledgeSpace.findUnique({
      where: { id: spaceId },
      select: { status: true },
    });
    if (!space) {
      throw new NotFoundException('SPACE_NOT_FOUND');
    }
    if (space.status !== 'ACTIVE') {
      throw new ConflictException('SPACE_NOT_ACTIVE');
    }

    const imports = await this.prisma.$transaction(async (transaction) => {
      const tickets: CreateFileImportsResponse['imports'] = [];
      for (const file of input.files) {
        const { extension } = validateImportFile(file.fileName, file.sizeBytes);
        const title = basename(file.fileName, extname(file.fileName)).trim() || file.fileName;
        const document = await transaction.document.create({
          data: {
            spaceId,
            title,
            sourceType: 'FILE',
            createdById: user.id,
          },
        });
        const version = await transaction.documentVersion.create({
          data: {
            documentId: document.id,
            versionNumber: 1,
            sourceType: 'FILE',
            originalFileName: file.fileName,
            fileExtension: extension,
            declaredMimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            createdById: user.id,
          },
        });
        const importTask = await transaction.importTask.create({
          data: {
            documentId: document.id,
            versionId: version.id,
            requestId,
            traceId,
            createdById: user.id,
          },
        });
        tickets.push({
          clientFileId: file.clientFileId,
          documentId: document.id,
          versionId: version.id,
          importId: importTask.id,
          uploadPath: `/imports/${importTask.id}/content`,
        });
      }
      return tickets;
    });

    return { imports };
  }

  async createUrlImport(
    user: AuthenticatedUser,
    spaceId: string,
    input: CreateUrlImport,
  ): Promise<CreateUrlImportResponse> {
    await this.requireActiveSpace(spaceId);
    const context = this.context.get();
    const requestId = context?.requestId ?? randomUUID();
    const traceId = context?.traceId ?? requestId;
    const url = new URL(input.url);

    return this.prisma.$transaction(async (transaction) => {
      const document = await transaction.document.create({
        data: {
          spaceId,
          title: url.hostname,
          sourceType: 'URL',
          createdById: user.id,
        },
      });
      const version = await transaction.documentVersion.create({
        data: {
          documentId: document.id,
          versionNumber: 1,
          sourceType: 'URL',
          sourceUrl: url.toString(),
          originalFileName: 'captured-page.md',
          fileExtension: 'md',
          declaredMimeType: 'text/markdown',
          processingStatus: 'FETCHING',
          createdById: user.id,
        },
      });
      const importTask = await transaction.importTask.create({
        data: {
          documentId: document.id,
          versionId: version.id,
          status: 'QUEUED',
          stage: 'FETCHING',
          progress: 5,
          requestId,
          traceId,
          createdById: user.id,
        },
      });
      const payload: DocumentUrlCaptureRequestedPayload = {
        documentId: document.id,
        spaceId,
        versionId: version.id,
        importId: importTask.id,
        sourceUrl: url.toString(),
        actorId: user.id,
        aclSnapshot: { spaceId, documentSubjects: [] },
      };
      await this.outbox.enqueue(transaction, {
        type: 'document.url.capture.requested.v1',
        taskId: importTask.id,
        resourceId: version.id,
        resourceVersion: 1,
        traceId,
        payload,
      });
      return {
        documentId: document.id,
        versionId: version.id,
        importId: importTask.id,
        status: 'QUEUED' as const,
      };
    });
  }

  async refreshUrl(user: AuthenticatedUser, documentId: string): Promise<CreateUrlImportResponse> {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: {
        versions: { orderBy: { versionNumber: 'desc' }, take: 1 },
        aclEntries: { select: { subjectType: true, subjectId: true } },
        importTasks: {
          where: { status: { in: ['PENDING_UPLOAD', 'QUEUED', 'RUNNING'] } },
          take: 1,
        },
      },
    });
    if (!document || document.availability === 'SOFT_DELETED') {
      throw new NotFoundException('DOCUMENT_NOT_FOUND');
    }
    await this.spacePolicy.require(user, document.spaceId, 'EDIT');
    const latest = document.versions[0];
    if (document.sourceType !== 'URL' || !latest?.sourceUrl) {
      throw new ConflictException('DOCUMENT_IS_NOT_URL');
    }
    const sourceUrl = latest.sourceUrl;
    if (document.importTasks.length > 0) {
      throw new ConflictException('URL_REFRESH_IN_PROGRESS');
    }
    const context = this.context.get();
    const requestId = context?.requestId ?? randomUUID();
    const traceId = context?.traceId ?? requestId;

    return this.prisma.$transaction(async (transaction) => {
      const version = await transaction.documentVersion.create({
        data: {
          documentId,
          versionNumber: latest.versionNumber + 1,
          sourceType: 'URL',
          sourceUrl,
          originalFileName: 'captured-page.md',
          fileExtension: 'md',
          declaredMimeType: 'text/markdown',
          processingStatus: 'FETCHING',
          createdById: user.id,
        },
      });
      const importTask = await transaction.importTask.create({
        data: {
          documentId,
          versionId: version.id,
          status: 'QUEUED',
          stage: 'FETCHING',
          progress: 5,
          requestId,
          traceId,
          createdById: user.id,
        },
      });
      const payload: DocumentUrlCaptureRequestedPayload = {
        documentId,
        spaceId: document.spaceId,
        versionId: version.id,
        importId: importTask.id,
        sourceUrl,
        actorId: user.id,
        aclSnapshot: {
          spaceId: document.spaceId,
          documentSubjects: document.aclEntries,
        },
      };
      await this.outbox.enqueue(transaction, {
        type: 'document.url.capture.requested.v1',
        taskId: importTask.id,
        resourceId: version.id,
        resourceVersion: 1,
        traceId,
        payload,
      });
      return {
        documentId,
        versionId: version.id,
        importId: importTask.id,
        status: 'QUEUED' as const,
      };
    });
  }

  async uploadContent(input: {
    user: AuthenticatedUser;
    importId: string;
    source: Readable;
    contentLength: number;
    contentType: string;
  }) {
    const task = await this.prisma.importTask.findUnique({
      where: { id: input.importId },
      include: { version: true },
    });
    if (!task) {
      throw new NotFoundException('IMPORT_TASK_NOT_FOUND');
    }
    const documentContext = await this.documentContext(task.documentId);
    const spaceId = documentContext.spaceId;
    await this.spacePolicy.require(input.user, spaceId, 'EDIT');

    const { maxBytes } = validateImportFile(task.version.originalFileName, input.contentLength);
    if (input.contentLength !== task.version.sizeBytes) {
      throw new ConflictException('CONTENT_LENGTH_MISMATCH');
    }
    if (task.status !== 'PENDING_UPLOAD') {
      throw new ConflictException('IMPORT_NOT_UPLOADABLE');
    }

    const claimed = await this.prisma.importTask.updateMany({
      where: { id: task.id, status: 'PENDING_UPLOAD' },
      data: {
        status: 'RUNNING',
        attempt: { increment: 1 },
        errorCode: null,
        errorMessage: null,
        startedAt: new Date(),
      },
    });
    if (claimed.count !== 1) {
      throw new ConflictException('IMPORT_NOT_UPLOADABLE');
    }

    let objectKey: string | undefined;
    try {
      const upload = await this.storage.putQuarantineObject({
        importId: task.id,
        source: input.source,
        expectedBytes: input.contentLength,
        maxBytes,
        contentType: input.contentType,
      });
      objectKey = upload.objectKey;
      const payload: DocumentIngestionRequestedPayload = {
        documentId: task.documentId,
        spaceId,
        versionId: task.versionId,
        importId: task.id,
        objectKey: upload.objectKey,
        contentHash: upload.contentHash,
        sizeBytes: upload.sizeBytes,
        declaredMimeType: task.version.declaredMimeType,
        originalFileName: task.version.originalFileName,
        actorId: input.user.id,
        aclSnapshot: {
          spaceId,
          documentSubjects: documentContext.aclEntries,
        },
      };
      await this.prisma.$transaction(async (transaction) => {
        await transaction.documentVersion.update({
          where: { id: task.versionId },
          data: {
            contentHash: upload.contentHash,
            sizeBytes: upload.sizeBytes,
            processingStatus: 'QUEUED',
            errorCode: null,
            errorMessage: null,
          },
        });
        await transaction.importTask.update({
          where: { id: task.id },
          data: {
            status: 'QUEUED',
            stage: 'QUEUED',
            progress: 5,
            quarantineObjectKey: upload.objectKey,
          },
        });
        await this.outbox.enqueue(transaction, {
          type: 'document.ingestion.requested.v1',
          taskId: task.id,
          resourceId: task.versionId,
          resourceVersion: 1,
          payload,
        });
      });
      return {
        importId: task.id,
        documentId: task.documentId,
        versionId: task.versionId,
        status: 'QUEUED' as const,
        contentHash: upload.contentHash,
        sizeBytes: upload.sizeBytes,
      };
    } catch (error) {
      if (objectKey) {
        await this.storage.deleteQuarantineObject(objectKey).catch(() => undefined);
      }
      await this.prisma.importTask
        .updateMany({
          where: { id: task.id, status: 'RUNNING' },
          data: {
            status: 'PENDING_UPLOAD',
            errorCode: 'UPLOAD_FAILED',
            errorMessage: 'The upload did not complete and can be retried.',
            startedAt: null,
          },
        })
        .catch(() => undefined);
      if (error instanceof ConflictException) {
        throw error;
      }
      throw new ServiceUnavailableException('UPLOAD_FAILED', { cause: error });
    }
  }

  async cancel(user: AuthenticatedUser, importId: string) {
    const task = await this.prisma.importTask.findUnique({
      where: { id: importId },
      include: { document: { select: { spaceId: true } } },
    });
    if (!task) {
      throw new NotFoundException('IMPORT_TASK_NOT_FOUND');
    }
    await this.spacePolicy.require(user, task.document.spaceId, 'EDIT');
    if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(task.status)) {
      throw new ConflictException('IMPORT_ALREADY_FINISHED');
    }
    return this.prisma.$transaction(async (transaction) => {
      await transaction.documentVersion.update({
        where: { id: task.versionId },
        data: { processingStatus: 'CANCELLED' },
      });
      return transaction.importTask.update({
        where: { id: task.id },
        data: {
          status: 'CANCELLED',
          stage: 'CANCELLED',
          completedAt: new Date(),
        },
      });
    });
  }

  async getTask(user: AuthenticatedUser, importId: string) {
    const task = await this.prisma.importTask.findUnique({
      where: { id: importId },
      include: { document: { select: { spaceId: true } } },
    });
    if (!task) {
      throw new NotFoundException('IMPORT_TASK_NOT_FOUND');
    }
    await this.spacePolicy.require(user, task.document.spaceId, 'VIEW');
    return task;
  }

  private async documentContext(documentId: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        spaceId: true,
        aclEntries: { select: { subjectType: true, subjectId: true } },
      },
    });
    if (!document) {
      throw new NotFoundException('DOCUMENT_NOT_FOUND');
    }
    return document;
  }

  private async requireActiveSpace(spaceId: string): Promise<void> {
    const space = await this.prisma.knowledgeSpace.findUnique({
      where: { id: spaceId },
      select: { status: true },
    });
    if (!space) throw new NotFoundException('SPACE_NOT_FOUND');
    if (space.status !== 'ACTIVE') throw new ConflictException('SPACE_NOT_ACTIVE');
  }
}
