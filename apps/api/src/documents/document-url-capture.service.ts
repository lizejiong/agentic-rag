import { createHash } from 'node:crypto';

import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  DocumentIngestionRequestedPayload,
  DocumentUrlCaptureRequestedPayload,
} from '@rag/contracts';

import { PrismaService } from '../infrastructure/database/prisma.service';
import { ObjectStorageService } from '../infrastructure/object-storage/object-storage.service';
import { OutboxService } from '../outbox/outbox.service';
import { UrlContentExtractor } from './url-content-extractor';
import { UrlHttpFetcher } from './url-http-fetcher';

@Injectable()
export class DocumentUrlCaptureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorageService,
    private readonly fetcher: UrlHttpFetcher,
    private readonly extractor: UrlContentExtractor,
    private readonly outbox: OutboxService,
  ) {}

  async capture(
    payload: DocumentUrlCaptureRequestedPayload,
    traceId: string,
  ): Promise<'QUEUED' | 'UNCHANGED'> {
    const task = await this.prisma.importTask.findUnique({
      where: { id: payload.importId },
      include: {
        version: true,
        document: { include: { activeVersion: { select: { id: true, contentHash: true } } } },
      },
    });
    if (!task || task.documentId !== payload.documentId || task.versionId !== payload.versionId) {
      throw new NotFoundException('URL_IMPORT_TASK_NOT_FOUND');
    }

    const fetched = await this.fetcher.fetch(payload.sourceUrl);
    const extracted = this.extractor.extract(fetched);
    const body = Buffer.from(extracted.markdown, 'utf8');
    const contentHash = createHash('sha256').update(body).digest('hex');
    const metadata = {
      resolvedUrl: fetched.finalUrl,
      canonicalUrl: extracted.canonicalUrl,
      sourceAuthor: extracted.author,
      sourcePublishedAt: extracted.publishedAt,
      sourceFetchedAt: fetched.fetchedAt,
      sourceCheckedAt: fetched.fetchedAt,
    };

    if (task.document.activeVersion?.contentHash === contentHash) {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.documentVersion.update({
          where: { id: task.document.activeVersion!.id },
          data: metadata,
        });
        await transaction.documentVersion.update({
          where: { id: task.versionId },
          data: {
            ...metadata,
            contentHash,
            sizeBytes: body.length,
            processingStatus: 'CANCELLED',
            errorCode: 'URL_CONTENT_UNCHANGED',
            errorMessage: 'The page content has not changed since the active version.',
          },
        });
        await transaction.importTask.update({
          where: { id: task.id },
          data: {
            status: 'SUCCEEDED',
            stage: 'READY',
            progress: 100,
            completedAt: new Date(),
            errorCode: null,
            errorMessage: null,
          },
        });
      });
      return 'UNCHANGED';
    }

    const upload = await this.storage.putQuarantineBuffer({
      importId: task.id,
      body,
      maxBytes: 100 * 1024 * 1024,
      contentType: 'text/markdown; charset=utf-8',
    });
    const ingestionPayload: DocumentIngestionRequestedPayload = {
      documentId: payload.documentId,
      spaceId: payload.spaceId,
      versionId: payload.versionId,
      importId: payload.importId,
      objectKey: upload.objectKey,
      contentHash: upload.contentHash,
      sizeBytes: upload.sizeBytes,
      declaredMimeType: 'text/markdown',
      originalFileName: task.version.originalFileName,
      actorId: payload.actorId,
      aclSnapshot: payload.aclSnapshot,
    };

    try {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.document.update({
          where: { id: payload.documentId },
          data: { title: extracted.title },
        });
        await transaction.documentVersion.update({
          where: { id: payload.versionId },
          data: {
            ...metadata,
            contentHash: upload.contentHash,
            sizeBytes: upload.sizeBytes,
            processingStatus: 'QUEUED',
            errorCode: null,
            errorMessage: null,
          },
        });
        await transaction.importTask.update({
          where: { id: payload.importId },
          data: {
            status: 'QUEUED',
            stage: 'QUEUED',
            progress: 20,
            quarantineObjectKey: upload.objectKey,
            errorCode: null,
            errorMessage: null,
          },
        });
        await this.outbox.enqueue(transaction, {
          type: 'document.ingestion.requested.v1',
          taskId: payload.importId,
          resourceId: payload.versionId,
          resourceVersion: 1,
          traceId,
          payload: ingestionPayload,
        });
      });
    } catch (error) {
      await this.storage.deleteQuarantineObject(upload.objectKey).catch(() => undefined);
      throw error;
    }
    return 'QUEUED';
  }
}
