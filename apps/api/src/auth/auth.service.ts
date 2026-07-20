import { randomUUID } from 'node:crypto';

import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { PrismaService } from '../infrastructure/database/prisma.service';
import { ENVIRONMENT, type Environment } from '../infrastructure/config/environment';
import type { AuthenticatedUser } from './auth.types';
import { PasswordService } from './password.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  async login(
    username: string,
    password: string,
  ): Promise<{ accessToken: string; user: AuthenticatedUser }> {
    const user = await this.prisma.user.findUnique({
      where: { username: username.trim().toLowerCase() },
    });
    const now = new Date();
    const isLocked = Boolean(user?.lockedUntil && user.lockedUntil > now);
    if (
      !user ||
      user.status !== 'ACTIVE' ||
      isLocked ||
      !(await this.passwords.verify(user.passwordHash, password))
    ) {
      if (user && user.status === 'ACTIVE' && !isLocked) {
        await this.prisma.$executeRaw`
          UPDATE "app"."users"
          SET
            "failed_login_count" = CASE
              WHEN "locked_until" IS NOT NULL AND "locked_until" <= NOW() THEN 1
              ELSE "failed_login_count" + 1
            END,
            "locked_until" = CASE
              WHEN "locked_until" IS NOT NULL AND "locked_until" <= NOW() THEN NULL
              WHEN "failed_login_count" + 1 >= 5
              THEN NOW() + INTERVAL '15 minutes'
              ELSE "locked_until"
            END
          WHERE "id" = ${user.id}::uuid
        `;
      }
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }

    if (user.failedLoginCount > 0 || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
    }

    const subject: AuthenticatedUser = {
      id: user.id,
      username: user.username,
      role: user.role,
      tokenVersion: user.tokenVersion,
    };
    const accessToken = await this.issueAccessToken(subject);
    return { accessToken, user: subject };
  }

  issueAccessToken(subject: AuthenticatedUser): Promise<string> {
    return this.jwt.signAsync(
      {
        username: subject.username,
        role: subject.role,
        tokenVersion: subject.tokenVersion,
        jti: randomUUID(),
      },
      {
        subject: subject.id,
        secret: this.environment.JWT_ACCESS_SECRET,
        expiresIn: '15m',
      },
    );
  }
}
