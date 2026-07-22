import { Inject, Injectable } from '@nestjs/common';
import {
  documentIngestionCompletedPayloadSchema,
  documentIngestionFailedPayloadSchema,
  documentIngestionProgressedPayloadSchema,
} from '@rag/contracts';

import type { Prisma } from '../generated/prisma/client';
import type { Environment } from '../infrastructure/config/environment';
import { ENVIRONMENT } from '../infrastructure/config/environment';
import { ObjectStorageService } from '../infrastructure/object-storage/object-storage.service';

@Injectable()
export class DocumentPublicationService {
  constructor(
    private readonly storage: ObjectStorageService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  async applyProgress(transaction: Prisma.TransactionClient, payloadValue: unknown): Promise<void> {
    const payload = documentIngestionProgressedPayloadSchema.parse(payloadValue);
    const task = await transaction.importTask.findUnique({
      where: { id: payload.importId },
      select: { documentId: true, versionId: true, status: true, progress: true },
    });
    if (!task || task.documentId !== payload.documentId || task.versionId !== payload.versionId) {
      return;
    }
    if (
      ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(task.status) ||
      payload.progress <= task.progress
    ) {
      return;
    }
    await transaction.importTask.update({
      where: { id: payload.importId },
      data: { status: 'RUNNING', stage: payload.stage, progress: payload.progress },
    });
    await transaction.documentVersion.updateMany({
      where: {
        id: payload.versionId,
        documentId: payload.documentId,
        processingStatus: { notIn: ['READY', 'FAILED', 'CANCELLED'] },
      },
      data: { processingStatus: payload.stage },
    });
  }

  async publishCompleted(
    transaction: Prisma.TransactionClient,
    payloadValue: unknown,
  ): Promise<void> {
    const payload = documentIngestionCompletedPayloadSchema.parse(payloadValue);
    const task = await transaction.importTask.findUnique({
      where: { id: payload.importId },
      include: { version: true, document: { select: { id: true } } },
    });
    if (
      !task ||
      task.documentId !== payload.documentId ||
      task.versionId !== payload.versionId ||
      task.document.id !== payload.documentId ||
      task.status === 'CANCELLED'
    ) {
      return;
    }
    if (task.status === 'SUCCEEDED') {
      return;
    }
    if (!task.quarantineObjectKey || !task.version.contentHash || !task.version.sizeBytes) {
      throw new Error('INGESTION_PUBLICATION_METADATA_MISSING');
    }

    const objectKey = await this.storage.promoteByHash(
      task.quarantineObjectKey,
      task.version.contentHash,
    );
    const storedObject = await transaction.storedObject.upsert({
      where: { contentHash: task.version.contentHash },
      create: {
        contentHash: task.version.contentHash,
        bucket: this.environment.MINIO_DOCUMENT_BUCKET,
        objectKey,
        sizeBytes: task.version.sizeBytes,
        detectedMimeType: payload.detectedMimeType,
      },
      update: {},
      select: { id: true },
    });
    const attached = await transaction.documentVersion.updateMany({
      where: { id: payload.versionId, documentId: payload.documentId, storedObjectId: null },
      data: {
        storedObjectId: storedObject.id,
        detectedMimeType: payload.detectedMimeType,
        parserVersion: payload.parserVersion,
        processingStatus: 'READY',
        publishedAt: new Date(),
        errorCode: null,
        errorMessage: null,
      },
    });
    if (attached.count === 1) {
      await transaction.storedObject.update({
        where: { id: storedObject.id },
        data: { refCount: { increment: 1 } },
      });
    }
    await transaction.document.update({
      where: { id: payload.documentId },
      data: { activeVersionId: payload.versionId, availability: 'ACTIVE' },
    });
    await transaction.importTask.update({
      where: { id: payload.importId },
      data: {
        status: 'SUCCEEDED',
        stage: 'READY',
        progress: 100,
        completedAt: new Date(),
        errorCode: null,
        errorMessage: null,
      },
    });
    await this.storage.deleteQuarantineObject(task.quarantineObjectKey).catch(() => undefined);
  }

  async publishFailed(transaction: Prisma.TransactionClient, payloadValue: unknown): Promise<void> {
    const payload = documentIngestionFailedPayloadSchema.parse(payloadValue);
    const task = await transaction.importTask.findUnique({
      where: { id: payload.importId },
      include: { document: { select: { activeVersionId: true } } },
    });
    if (
      !task ||
      task.documentId !== payload.documentId ||
      task.versionId !== payload.versionId ||
      ['SUCCEEDED', 'CANCELLED'].includes(task.status)
    ) {
      return;
    }
    await transaction.documentVersion.updateMany({
      where: {
        id: payload.versionId,
        documentId: payload.documentId,
        processingStatus: { not: 'READY' },
      },
      data: { processingStatus: 'FAILED', errorCode: payload.code, errorMessage: payload.message },
    });
    await transaction.importTask.update({
      where: { id: payload.importId },
      data: {
        status: 'FAILED',
        stage: 'FAILED',
        errorCode: payload.code,
        errorMessage: payload.message,
        completedAt: new Date(),
      },
    });
  }
}
