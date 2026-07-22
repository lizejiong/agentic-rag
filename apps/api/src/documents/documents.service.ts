import { Injectable, NotFoundException } from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { SpacePolicy } from '../spaces/space-policy';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly spacePolicy: SpacePolicy,
  ) {}

  async list(spaceId: string) {
    const documents = await this.prisma.document.findMany({
      where: { spaceId, availability: { not: 'SOFT_DELETED' } },
      select: {
        id: true,
        spaceId: true,
        title: true,
        sourceType: true,
        availability: true,
        activeVersionId: true,
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
      include: {
        versions: { orderBy: { versionNumber: 'desc' } },
        importTasks: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!document || document.availability === 'SOFT_DELETED') {
      throw new NotFoundException('DOCUMENT_NOT_FOUND');
    }
    await this.spacePolicy.require(user, document.spaceId, 'VIEW');
    return document;
  }
}
