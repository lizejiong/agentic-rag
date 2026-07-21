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

  list(spaceId: string) {
    return this.prisma.document.findMany({
      where: { spaceId, availability: { not: 'SOFT_DELETED' } },
      include: {
        versions: { orderBy: { versionNumber: 'desc' }, take: 1 },
        importTasks: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
    });
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
