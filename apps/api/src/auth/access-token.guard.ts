import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { z } from 'zod';

import { PrismaService } from '../infrastructure/database/prisma.service';
import { ENVIRONMENT, type Environment } from '../infrastructure/config/environment';
import type { AccessTokenClaims, AuthenticatedUser } from './auth.types';
import type { AuthenticatedRequest } from './current-user.decorator';

const accessTokenClaimsSchema = z.object({
  sub: z.uuid(),
  username: z.string().min(1).max(80),
  role: z.enum(['ADMIN', 'MEMBER']),
  tokenVersion: z.number().int().nonnegative(),
  jti: z.uuid(),
  iat: z.number().int().optional(),
  exp: z.number().int().optional(),
});

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.header('authorization');
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';

    if (!token) {
      throw new UnauthorizedException('ACCESS_TOKEN_REQUIRED');
    }

    try {
      const claims = accessTokenClaimsSchema.parse(
        await this.jwt.verifyAsync<AccessTokenClaims>(token, {
          secret: this.environment.JWT_ACCESS_SECRET,
        }),
      );
      const user = await this.prisma.user.findUnique({
        where: { id: claims.sub },
        select: { id: true, username: true, role: true, status: true, tokenVersion: true },
      });

      if (
        !user ||
        user.status !== 'ACTIVE' ||
        user.tokenVersion !== claims.tokenVersion ||
        user.username !== claims.username ||
        user.role !== claims.role
      ) {
        throw new UnauthorizedException('ACCESS_TOKEN_REVOKED');
      }

      request.user = {
        id: user.id,
        username: user.username,
        role: user.role,
        tokenVersion: user.tokenVersion,
      } satisfies AuthenticatedUser;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('ACCESS_TOKEN_INVALID');
    }
  }
}
