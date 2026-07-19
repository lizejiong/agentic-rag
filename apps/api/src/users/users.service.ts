import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';
import type { SystemRole } from '../auth/auth.types';
import { PasswordService } from '../auth/password.service';
import { PrismaService } from '../infrastructure/database/prisma.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
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
      return await this.prisma.user.create({
        data: {
          username,
          displayName: input.displayName.trim(),
          passwordHash: await this.passwords.hash(input.password),
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
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('USERNAME_ALREADY_EXISTS');
      }
      throw error;
    }
  }

  async setStatus(id: string, status: 'ACTIVE' | 'DISABLED') {
    const result = await this.prisma.user.updateMany({
      where: { id },
      data: { status, tokenVersion: { increment: 1 } },
    });
    if (result.count === 0) {
      throw new NotFoundException('USER_NOT_FOUND');
    }
    return { status };
  }

  async resetPassword(id: string, password: string): Promise<void> {
    const result = await this.prisma.user.updateMany({
      where: { id },
      data: {
        passwordHash: await this.passwords.hash(password),
        tokenVersion: { increment: 1 },
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    if (result.count === 0) {
      throw new NotFoundException('USER_NOT_FOUND');
    }
  }
}
