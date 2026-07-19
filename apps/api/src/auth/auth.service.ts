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
    if (
      !user ||
      user.status !== 'ACTIVE' ||
      !(await this.passwords.verify(user.passwordHash, password))
    ) {
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }

    const subject: AuthenticatedUser = {
      id: user.id,
      username: user.username,
      role: user.role,
      tokenVersion: user.tokenVersion,
    };
    const accessToken = await this.jwt.signAsync(
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
    return { accessToken, user: subject };
  }
}
