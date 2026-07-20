import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../infrastructure/database/prisma.service';

export type SpacePermission = 'VIEW' | 'EDIT' | 'MANAGE';

export const permissionRank: Record<SpacePermission, number> = {
  VIEW: 1,
  EDIT: 2,
  MANAGE: 3,
};

@Injectable()
export class SpacePolicy {
  constructor(private readonly prisma: PrismaService) {}

  async require(
    user: AuthenticatedUser,
    spaceId: string,
    required: SpacePermission,
  ): Promise<SpacePermission> {
    const permission = await this.permissionFor(user, spaceId);
    if (!permission || permissionRank[permission] < permissionRank[required]) {
      throw new ForbiddenException('SPACE_PERMISSION_DENIED');
    }
    return permission;
  }

  async permissionFor(user: AuthenticatedUser, spaceId: string): Promise<SpacePermission | null> {
    const space = await this.prisma.knowledgeSpace.findUnique({
      where: { id: spaceId },
      select: { id: true, status: true },
    });
    if (!space) {
      throw new NotFoundException('SPACE_NOT_FOUND');
    }
    if (user.role === 'ADMIN') {
      return 'MANAGE';
    }
    if (space.status === 'ARCHIVED') {
      return null;
    }

    const filters = await this.subjectFilters(user.id);
    const grants = await this.prisma.spaceGrant.findMany({
      where: {
        spaceId,
        OR: filters,
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
      },
      select: { permission: true },
    });
    return this.highest(grants.map((grant) => grant.permission));
  }

  async listVisible(user: AuthenticatedUser) {
    if (user.role === 'ADMIN') {
      const spaces = await this.prisma.knowledgeSpace.findMany({ orderBy: { name: 'asc' } });
      return spaces.map((space) => ({ ...space, effectivePermission: 'MANAGE' as const }));
    }

    const grants = await this.prisma.spaceGrant.findMany({
      where: {
        OR: await this.subjectFilters(user.id),
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
        space: { status: 'ACTIVE' },
      },
      include: { space: true },
    });
    const bySpace = new Map<
      string,
      { space: (typeof grants)[number]['space']; permission: SpacePermission }
    >();
    for (const grant of grants) {
      const current = bySpace.get(grant.spaceId);
      if (!current || permissionRank[grant.permission] > permissionRank[current.permission]) {
        bySpace.set(grant.spaceId, { space: grant.space, permission: grant.permission });
      }
    }
    return [...bySpace.values()]
      .sort((left, right) => left.space.name.localeCompare(right.space.name))
      .map(({ space, permission }) => ({ ...space, effectivePermission: permission }));
  }

  private async subjectFilters(
    userId: string,
  ): Promise<
    Array<
      | { subjectType: 'USER'; subjectId: string }
      | { subjectType: 'DEPARTMENT'; subjectId: string }
      | { subjectType: 'GROUP'; subjectId: string }
    >
  > {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        departmentId: true,
        groupMemberships: { select: { groupId: true } },
      },
    });
    if (!user) {
      throw new ForbiddenException('AUTHENTICATED_USER_NOT_FOUND');
    }
    return [
      { subjectType: 'USER', subjectId: userId },
      ...(user.departmentId
        ? ([{ subjectType: 'DEPARTMENT', subjectId: user.departmentId }] as const)
        : []),
      ...user.groupMemberships.map(
        (membership) => ({ subjectType: 'GROUP', subjectId: membership.groupId }) as const,
      ),
    ];
  }

  private highest(permissions: SpacePermission[]): SpacePermission | null {
    return (
      permissions.reduce<SpacePermission | null>(
        (highest, permission) =>
          !highest || permissionRank[permission] > permissionRank[highest] ? permission : highest,
        null,
      ) ?? null
    );
  }
}
