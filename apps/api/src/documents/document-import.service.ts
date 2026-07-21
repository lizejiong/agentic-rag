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
  DocumentIngestionRequestedPayload,
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
    const spaceId = await this.documentSpaceId(task.documentId);
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

  private async documentSpaceId(documentId: string): Promise<string> {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { spaceId: true },
    });
    if (!document) {
      throw new NotFoundException('DOCUMENT_NOT_FOUND');
    }
    return document.spaceId;
  }
}
