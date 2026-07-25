import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';

import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { ObjectStorageService } from '../infrastructure/object-storage/object-storage.service';
import { SpacePolicy } from '../spaces/space-policy';

interface NormalizedElementRow {
  element_index: number;
  element_type: string;
  content: string;
}

interface ChunkRow {
  id: string;
  chunk_index: number;
  content: string;
  token_count: number;
  location: unknown;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly spacePolicy: SpacePolicy,
    private readonly storage: ObjectStorageService,
  ) {}

  async list(spaceId: string, filters?: { search?: string; status?: string }) {
    const where: Record<string, unknown> = {
      spaceId,
      availability: { not: 'SOFT_DELETED' },
    };
    if (filters?.search) {
      where.title = { contains: filters.search, mode: 'insensitive' };
    }
    if (filters?.status) {
      where.versions = {
        some: { processingStatus: filters.status },
      };
    }
    const documents = await this.prisma.document.findMany({
      where,
      select: {
        id: true,
        spaceId: true,
        title: true,
        sourceType: true,
        availability: true,
        activeVersionId: true,
        createdBy: { select: { id: true, username: true } },
        createdAt: true,
        updatedAt: true,
        versions: {
          orderBy: { versionNumber: 'desc' },
          take: 1,
          select: {
            id: true,
            documentId: true,
            versionNumber: true,
            sourceType: true,
            sourceUrl: true,
            resolvedUrl: true,
            canonicalUrl: true,
            sourceAuthor: true,
            sourcePublishedAt: true,
            sourceFetchedAt: true,
            sourceCheckedAt: true,
            originalFileName: true,
            declaredMimeType: true,
            detectedMimeType: true,
            sizeBytes: true,
            contentHash: true,
            processingStatus: true,
            errorCode: true,
            errorMessage: true,
            publishedAt: true,
            createdAt: true,
          },
        },
        importTasks: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            documentId: true,
            versionId: true,
            status: true,
            stage: true,
            progress: true,
            attempt: true,
            errorCode: true,
            errorMessage: true,
            startedAt: true,
            completedAt: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return documents.map(({ versions, importTasks, ...document }) => ({
      ...document,
      latestVersion: versions[0] ?? null,
      latestImport: importTasks[0] ?? null,
    }));
  }

  async get(user: AuthenticatedUser, documentId: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        spaceId: true,
        title: true,
        sourceType: true,
        availability: true,
        activeVersionId: true,
        createdBy: { select: { id: true, username: true } },
        createdAt: true,
        updatedAt: true,
        versions: {
          orderBy: { versionNumber: 'desc' },
          select: {
            id: true,
            documentId: true,
            versionNumber: true,
            sourceType: true,
            sourceUrl: true,
            resolvedUrl: true,
            canonicalUrl: true,
            sourceAuthor: true,
            sourcePublishedAt: true,
            sourceFetchedAt: true,
            sourceCheckedAt: true,
            originalFileName: true,
            declaredMimeType: true,
            detectedMimeType: true,
            sizeBytes: true,
            contentHash: true,
            processingStatus: true,
            errorCode: true,
            errorMessage: true,
            publishedAt: true,
            createdAt: true,
          },
        },
        importTasks: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            documentId: true,
            versionId: true,
            status: true,
            stage: true,
            progress: true,
            attempt: true,
            errorCode: true,
            errorMessage: true,
            startedAt: true,
            completedAt: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });
    if (!document || document.availability === 'SOFT_DELETED') {
      throw new NotFoundException('DOCUMENT_NOT_FOUND');
    }
    await this.spacePolicy.require(user, document.spaceId, 'VIEW');
    return document;
  }

  async download(user: AuthenticatedUser, documentId: string, response: Response): Promise<void> {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        availability: true,
        spaceId: true,
        activeVersion: {
          select: {
            originalFileName: true,
            storedObject: {
              select: { bucket: true, objectKey: true, detectedMimeType: true, sizeBytes: true },
            },
          },
        },
      },
    });
    if (!document || document.availability === 'SOFT_DELETED') {
      throw new NotFoundException('DOCUMENT_NOT_FOUND');
    }
    await this.spacePolicy.require(user, document.spaceId, 'VIEW');

    const stored = document.activeVersion?.storedObject;
    if (!stored) {
      throw new NotFoundException('DOCUMENT_FILE_NOT_FOUND');
    }

    const fileName = document.activeVersion!.originalFileName;
    response.set({
      'Content-Type': stored.detectedMimeType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Content-Length': stored.sizeBytes.toString(),
    });
    const stream = await this.storage.getObject(stored.bucket, stored.objectKey);
    stream.pipe(response);
  }

  async getContent(user: AuthenticatedUser, documentId: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { availability: true, spaceId: true, title: true, activeVersionId: true },
    });
    if (!document || document.availability === 'SOFT_DELETED') {
      throw new NotFoundException('DOCUMENT_NOT_FOUND');
    }
    await this.spacePolicy.require(user, document.spaceId, 'VIEW');

    const versionId = document.activeVersionId;
    if (!versionId) {
      throw new NotFoundException('DOCUMENT_NO_ACTIVE_VERSION');
    }

    const rows = await this.prisma.$queryRaw<NormalizedElementRow[]>`
      SELECT e.element_index, e.element_type, e.content
      FROM rag.normalized_elements e
      JOIN rag.normalized_documents d ON d.id = e.normalized_document_id
      WHERE d.version_id = ${versionId}::uuid
      ORDER BY e.element_index
    `;

    if (rows.length === 0) {
      throw new NotFoundException('DOCUMENT_CONTENT_NOT_FOUND');
    }

    const fullText = rows.map((r) => r.content).join('\n\n');
    return {
      documentId,
      title: document.title,
      elementCount: rows.length,
      fullText,
    };
  }

  async delete(user: AuthenticatedUser, documentId: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        availability: true,
        spaceId: true,
        versions: { select: { id: true } },
      },
    });
    if (!document) {
      throw new NotFoundException('DOCUMENT_NOT_FOUND');
    }
    if (document.availability === 'SOFT_DELETED') {
      throw new ConflictException('DOCUMENT_ALREADY_DELETED');
    }
    await this.spacePolicy.require(user, document.spaceId, 'MANAGE');

    const versionIds = document.versions.map((v) => v.id);

    await this.prisma.$transaction(async (transaction) => {
      await transaction.document.update({
        where: { id: documentId },
        data: { availability: 'SOFT_DELETED', deletedAt: new Date() },
      });

      for (const versionId of versionIds) {
        await transaction.$executeRaw`
          DELETE FROM rag.chunk_embeddings
          WHERE chunk_id IN (SELECT id FROM rag.chunks WHERE version_id = ${versionId}::uuid)
        `;
        await transaction.$executeRaw`
          DELETE FROM rag.chunks WHERE version_id = ${versionId}::uuid
        `;
        await transaction.$executeRaw`
          DELETE FROM rag.normalized_elements
          WHERE normalized_document_id IN (
            SELECT id FROM rag.normalized_documents WHERE version_id = ${versionId}::uuid
          )
        `;
        await transaction.$executeRaw`
          DELETE FROM rag.normalized_documents WHERE version_id = ${versionId}::uuid
        `;
      }
    });

    return { documentId, status: 'SOFT_DELETED' };
  }

  async getChunks(user: AuthenticatedUser, documentId: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { availability: true, spaceId: true, activeVersionId: true },
    });
    if (!document || document.availability === 'SOFT_DELETED') {
      throw new NotFoundException('DOCUMENT_NOT_FOUND');
    }
    await this.spacePolicy.require(user, document.spaceId, 'VIEW');

    const versionId = document.activeVersionId;
    if (!versionId) {
      throw new NotFoundException('DOCUMENT_NO_ACTIVE_VERSION');
    }

    const rows = await this.prisma.$queryRaw<ChunkRow[]>`
      SELECT id, chunk_index, content, token_count, location
      FROM rag.chunks
      WHERE version_id = ${versionId}::uuid
      ORDER BY chunk_index
    `;

    return rows.map((row) => ({
      id: row.id,
      index: row.chunk_index,
      content: row.content,
      tokenCount: row.token_count,
      location: row.location,
    }));
  }
}
