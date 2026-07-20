import { Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../auth/auth.types';
import { AuthorizationService } from '../authorization/authorization.service';
import { permissionRank, type SpacePermission } from '../authorization/authorization.types';
import { PrismaService } from '../infrastructure/database/prisma.service';

export { permissionRank };
export type { SpacePermission };

@Injectable()
export class SpacePolicy {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  require(
    user: AuthenticatedUser,
    spaceId: string,
    required: SpacePermission,
  ): Promise<SpacePermission> {
    return this.authorization.requireSpace(user, spaceId, required);
  }

  async listVisible(user: AuthenticatedUser) {
    const snapshot = await this.authorization.snapshot(user);
    const spaces = await this.prisma.knowledgeSpace.findMany({
      where: { id: { in: Object.keys(snapshot.spaces) } },
      orderBy: { name: 'asc' },
    });
    return spaces
      .filter((space) => snapshot.admin || space.status === 'ACTIVE')
      .map((space) => ({
        ...space,
        effectivePermission: snapshot.spaces[space.id] as SpacePermission,
      }));
  }
}
