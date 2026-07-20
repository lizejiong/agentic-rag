import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { AuthorizationRevisionService } from '../authorization/authorization-revision.service';
import { Prisma } from '../generated/prisma/client';
import type { SystemRole } from '../auth/auth.types';
import { PasswordService } from '../auth/password.service';
import { PrismaService } from '../infrastructure/database/prisma.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly revision: AuthorizationRevisionService,
  ) {}

  async create(input: {
    username: string;
    displayName: string;
    password: string;
    role: SystemRole;
  }) {
    const username = input.username.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { username },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('USERNAME_ALREADY_EXISTS');
    }
    try {
      const passwordHash = await this.passwords.hash(input.password);
      return await this.revision.mutate(
        (transaction) =>
          transaction.user.create({
            data: {
              username,
              displayName: input.displayName.trim(),
              passwordHash,
              role: input.role,
            },
            select: {
              id: true,
              username: true,
              displayName: true,
              role: true,
              status: true,
              createdAt: true,
            },
          }),
        {
          action: 'user.create',
          targetType: 'USER',
          targetId: (user) => user.id,
          eventType: 'user.created',
          resourceId: (user) => user.id,
          payload: (user) => ({ username: user.username, role: user.role }),
        },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('USERNAME_ALREADY_EXISTS');
      }
      throw error;
    }
  }

  async setStatus(id: string, status: 'ACTIVE' | 'DISABLED') {
    const updated = await this.revision.mutate(
      async (transaction) => {
        const result = await transaction.user.updateMany({
          where: { id },
          data: { status, tokenVersion: { increment: 1 } },
        });
        if (result.count === 0) {
          return false;
        }
        await transaction.refreshSession.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        return true;
      },
      {
        action: 'user.status.set',
        targetType: 'USER',
        targetId: id,
        eventType: 'user.status.changed',
        resourceId: id,
        payload: { status },
      },
    );
    if (!updated) {
      throw new NotFoundException('USER_NOT_FOUND');
    }
    return { status };
  }

  async resetPassword(id: string, password: string): Promise<void> {
    const passwordHash = await this.passwords.hash(password);
    const updated = await this.revision.mutate(
      async (transaction) => {
        const result = await transaction.user.updateMany({
          where: { id },
          data: {
            passwordHash,
            tokenVersion: { increment: 1 },
            failedLoginCount: 0,
            lockedUntil: null,
          },
        });
        if (result.count === 0) {
          return false;
        }
        await transaction.refreshSession.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        return true;
      },
      {
        action: 'user.password.reset',
        targetType: 'USER',
        targetId: id,
        eventType: 'user.credentials.changed',
        resourceId: id,
      },
    );
    if (!updated) {
      throw new NotFoundException('USER_NOT_FOUND');
    }
  }
}
