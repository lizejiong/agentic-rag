import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';

import type { AuthenticatedUser } from '../auth/auth.types';
import type { DocumentAvailability, SubjectType } from '../generated/prisma/enums';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { RedisService } from '../infrastructure/redis/redis.service';
import {
  type AuthorizationSnapshot,
  type DocumentAccessRequest,
  permissionRank,
  type SpacePermission,
} from './authorization.types';
import { AuthorizationRevisionService } from './authorization-revision.service';

const CACHE_TTL_SECONDS = 60;
const cachedSnapshotSchema = z.object({
  userId: z.uuid(),
  revision: z.string().regex(/^\d+$/),
  admin: z.boolean(),
  departmentId: z.uuid().optional(),
  groupIds: z.array(z.uuid()),
  spaces: z.record(z.string(), z.enum(['VIEW', 'EDIT', 'MANAGE'])),
});

@Injectable()
export class AuthorizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly revision: AuthorizationRevisionService,
  ) {}

  async snapshot(user: AuthenticatedUser): Promise<AuthorizationSnapshot> {
    const state = await this.prisma.authorizationState.findUniqueOrThrow({
      where: { id: 1 },
      select: { revision: true },
    });
    const cacheKey = `authz:v1:${state.revision.toString()}:${user.id}`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        const parsed = cachedSnapshotSchema.safeParse(JSON.parse(cached) as unknown);
        if (parsed.success) {
          const { departmentId, ...cachedSnapshot } = parsed.data;
          return {
            ...cachedSnapshot,
            ...(departmentId ? { departmentId } : {}),
            revision: BigInt(parsed.data.revision),
          };
        }
      }
    } catch {
      // PostgreSQL remains the authorization truth source.
    }

    const snapshot = await this.computeSnapshot(user, state.revision);
    try {
      await this.redis.setWithExpiry(
        cacheKey,
        JSON.stringify({ ...snapshot, revision: snapshot.revision.toString() }),
        CACHE_TTL_SECONDS,
      );
    } catch {
      // Cache failure may reduce performance but must not change authorization results.
    }
    return snapshot;
  }

  async requireSpace(
    user: AuthenticatedUser,
    spaceId: string,
    required: SpacePermission,
  ): Promise<SpacePermission> {
    const space = await this.prisma.knowledgeSpace.findUnique({
      where: { id: spaceId },
      select: { status: true },
    });
    if (!space) {
      throw new NotFoundException('SPACE_NOT_FOUND');
    }
    const snapshot = await this.snapshot(user);
    const permission = snapshot.spaces[spaceId];
    if (
      !permission ||
      permissionRank[permission] < permissionRank[required] ||
      (space.status === 'ARCHIVED' && !snapshot.admin)
    ) {
      throw new ForbiddenException('SPACE_PERMISSION_DENIED');
    }
    return permission;
  }

  async authorizeDocument(
    user: AuthenticatedUser,
    request: DocumentAccessRequest,
  ): Promise<{
    documentId: string;
    spaceId: string;
    operation: DocumentAccessRequest['operation'];
  }> {
    const document = await this.prisma.document.findUnique({
      where: { id: request.documentId },
      include: { aclEntries: true, space: { select: { status: true } } },
    });
    if (!document) {
      throw new NotFoundException('DOCUMENT_NOT_FOUND');
    }
    if (document.availability !== 'ACTIVE' || document.space.status !== 'ACTIVE') {
      throw new ForbiddenException('DOCUMENT_NOT_AVAILABLE');
    }

    const snapshot = await this.snapshot(user);
    const spacePermission = snapshot.spaces[document.spaceId];
    if (!spacePermission || permissionRank[spacePermission] < permissionRank.VIEW) {
      throw new ForbiddenException('DOCUMENT_SPACE_PERMISSION_DENIED');
    }

    if (!snapshot.admin && document.aclEntries.length > 0) {
      const allowed = document.aclEntries.some((entry) => {
        if (entry.subjectType === 'USER') {
          return entry.subjectId === snapshot.userId;
        }
        if (entry.subjectType === 'DEPARTMENT') {
          return entry.subjectId === snapshot.departmentId;
        }
        return snapshot.groupIds.includes(entry.subjectId);
      });
      if (!allowed) {
        throw new ForbiddenException('DOCUMENT_ACL_DENIED');
      }
    }
    return {
      documentId: document.id,
      spaceId: document.spaceId,
      operation: request.operation,
    };
  }

  async replaceDocumentAcl(
    user: AuthenticatedUser,
    documentId: string,
    entries: Array<{ subjectType: SubjectType; subjectId: string }>,
  ): Promise<void> {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { spaceId: true },
    });
    if (!document) {
      throw new NotFoundException('DOCUMENT_NOT_FOUND');
    }
    await this.requireSpace(user, document.spaceId, 'MANAGE');
    await this.revision.mutate(async (transaction) => {
      for (const entry of entries) {
        const count =
          entry.subjectType === 'USER'
            ? await transaction.user.count({ where: { id: entry.subjectId } })
            : entry.subjectType === 'DEPARTMENT'
              ? await transaction.department.count({ where: { id: entry.subjectId } })
              : await transaction.userGroup.count({ where: { id: entry.subjectId } });
        if (count === 0) {
          throw new NotFoundException('DOCUMENT_ACL_SUBJECT_NOT_FOUND');
        }
      }
      await transaction.documentAclEntry.deleteMany({ where: { documentId } });
      if (entries.length > 0) {
        await transaction.documentAclEntry.createMany({
          data: entries.map((entry) => ({ documentId, ...entry })),
        });
      }
    });
  }

  async setDocumentAvailability(
    user: AuthenticatedUser,
    documentId: string,
    availability: DocumentAvailability,
  ) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { spaceId: true },
    });
    if (!document) {
      throw new NotFoundException('DOCUMENT_NOT_FOUND');
    }
    await this.requireSpace(
      user,
      document.spaceId,
      availability === 'SOFT_DELETED' ? 'MANAGE' : 'EDIT',
    );
    return this.revision.mutate((transaction) =>
      transaction.document.update({
        where: { id: documentId },
        data: { availability },
      }),
    );
  }

  private async computeSnapshot(
    authenticatedUser: AuthenticatedUser,
    revision: bigint,
  ): Promise<AuthorizationSnapshot> {
    const user = await this.prisma.user.findUnique({
      where: { id: authenticatedUser.id },
      select: {
        id: true,
        role: true,
        status: true,
        departmentId: true,
        groupMemberships: { select: { groupId: true } },
      },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new ForbiddenException('AUTHORIZATION_SUBJECT_DISABLED');
    }

    const groupIds = user.groupMemberships.map((membership) => membership.groupId);
    const spaces: Record<string, SpacePermission> = {};
    if (user.role === 'ADMIN') {
      const allSpaces = await this.prisma.knowledgeSpace.findMany({ select: { id: true } });
      for (const space of allSpaces) {
        spaces[space.id] = 'MANAGE';
      }
    } else {
      const grants = await this.prisma.spaceGrant.findMany({
        where: {
          OR: [
            { subjectType: 'USER', subjectId: user.id },
            ...(user.departmentId
              ? [{ subjectType: 'DEPARTMENT' as const, subjectId: user.departmentId }]
              : []),
            ...groupIds.map((groupId) => ({
              subjectType: 'GROUP' as const,
              subjectId: groupId,
            })),
          ],
          AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
          space: { status: 'ACTIVE' },
        },
        select: { spaceId: true, permission: true },
      });
      for (const grant of grants) {
        const current = spaces[grant.spaceId];
        if (!current || permissionRank[grant.permission] > permissionRank[current]) {
          spaces[grant.spaceId] = grant.permission;
        }
      }
    }
    return {
      userId: user.id,
      revision,
      admin: user.role === 'ADMIN',
      ...(user.departmentId ? { departmentId: user.departmentId } : {}),
      groupIds,
      spaces,
    };
  }
}
