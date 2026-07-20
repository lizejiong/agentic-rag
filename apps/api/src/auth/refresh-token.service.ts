import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';

import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';

import { ENVIRONMENT, type Environment } from '../infrastructure/config/environment';
import { PrismaService } from '../infrastructure/database/prisma.service';
import type { AuthenticatedUser } from './auth.types';

export const REFRESH_COOKIE_NAME = 'rag_refresh_token';
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type RequestMetadata = {
  ip?: string;
  userAgent?: string;
};

type IssuedRefreshToken = {
  refreshToken: string;
  user: AuthenticatedUser;
};

@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  async create(user: AuthenticatedUser, metadata: RequestMetadata): Promise<string> {
    const refreshToken = this.generate();
    await this.prisma.refreshSession.create({
      data: {
        userId: user.id,
        familyId: randomUUID(),
        tokenHash: this.hash(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        ...this.metadataHashes(metadata),
      },
    });
    return refreshToken;
  }

  async rotate(refreshToken: string, metadata: RequestMetadata): Promise<IssuedRefreshToken> {
    const nextToken = this.generate();
    const now = new Date();
    const outcome = await this.prisma.$transaction(async (transaction) => {
      const session = await transaction.refreshSession.findUnique({
        where: { tokenHash: this.hash(refreshToken) },
        include: { user: true },
      });

      if (!session) {
        return { kind: 'invalid' } as const;
      }
      if (session.revokedAt || session.expiresAt <= now || session.user.status !== 'ACTIVE') {
        return { kind: 'reuse', familyId: session.familyId } as const;
      }

      const revoked = await transaction.refreshSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: now, lastUsedAt: now },
      });
      if (revoked.count !== 1) {
        return { kind: 'reuse', familyId: session.familyId } as const;
      }

      await transaction.refreshSession.create({
        data: {
          userId: session.userId,
          familyId: session.familyId,
          tokenHash: this.hash(nextToken),
          expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
          ...this.metadataHashes(metadata),
        },
      });

      return {
        kind: 'success',
        user: {
          id: session.user.id,
          username: session.user.username,
          role: session.user.role,
          tokenVersion: session.user.tokenVersion,
        } satisfies AuthenticatedUser,
      } as const;
    });

    if (outcome.kind === 'reuse') {
      await this.prisma.refreshSession.updateMany({
        where: { familyId: outcome.familyId, revokedAt: null },
        data: { revokedAt: now },
      });
      throw new UnauthorizedException('REFRESH_TOKEN_REUSED');
    }
    if (outcome.kind === 'invalid') {
      throw new UnauthorizedException('REFRESH_TOKEN_INVALID');
    }
    return { refreshToken: nextToken, user: outcome.user };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) {
      return;
    }
    await this.prisma.refreshSession.updateMany({
      where: { tokenHash: this.hash(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async logoutAll(userId: string): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { tokenVersion: { increment: 1 } },
      }),
      this.prisma.refreshSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);
  }

  private generate(): string {
    return randomBytes(32).toString('base64url');
  }

  private hash(token: string): string {
    return createHmac('sha256', this.environment.JWT_REFRESH_PEPPER).update(token).digest('hex');
  }

  private metadataHashes(metadata: RequestMetadata): {
    ipHash?: string;
    userAgentHash?: string;
  } {
    return {
      ...(metadata.ip ? { ipHash: createHash('sha256').update(metadata.ip).digest('hex') } : {}),
      ...(metadata.userAgent
        ? { userAgentHash: createHash('sha256').update(metadata.userAgent).digest('hex') }
        : {}),
    };
  }
}
