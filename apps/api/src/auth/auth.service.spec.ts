import { UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';

import type { Environment } from '../infrastructure/config/environment';
import type { PrismaService } from '../infrastructure/database/prisma.service';
import { AuthService } from './auth.service';
import type { PasswordService } from './password.service';

const environment = {
  JWT_ACCESS_SECRET: 'access-secret-with-at-least-32-characters',
} as Environment;

const activeUser = {
  id: '00000000-0000-4000-8000-000000000001',
  username: 'admin',
  displayName: 'Administrator',
  passwordHash: '$argon2id$hash',
  role: 'ADMIN',
  status: 'ACTIVE',
  departmentId: null,
  failedLoginCount: 0,
  lockedUntil: null,
  tokenVersion: 2,
  createdAt: new Date(),
  updatedAt: new Date(),
} as const;

describe('AuthService', () => {
  const findUnique = jest.fn();
  const verify = jest.fn();
  let signedPayload: Record<string, unknown> | undefined;
  const signAsync = jest.fn(
    (payload: Record<string, unknown>, options: Record<string, unknown>): Promise<string> => {
      void options;
      signedPayload = payload;
      return Promise.resolve('signed-token');
    },
  );
  const service = new AuthService(
    { user: { findUnique } } as unknown as PrismaService,
    { verify } as unknown as PasswordService,
    { signAsync } as unknown as JwtService,
    environment,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    signedPayload = undefined;
  });

  it('issues a 15-minute access token without password or ACL claims', async () => {
    findUnique.mockResolvedValue(activeUser);
    verify.mockResolvedValue(true);

    const result = await service.login(' ADMIN ', 'correct-password');

    expect(findUnique).toHaveBeenCalledWith({ where: { username: 'admin' } });
    expect(signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'admin',
        role: 'ADMIN',
        tokenVersion: 2,
      }),
      expect.objectContaining({
        subject: activeUser.id,
        secret: environment.JWT_ACCESS_SECRET,
        expiresIn: '15m',
      }),
    );
    expect(typeof signedPayload?.['jti']).toBe('string');
    expect(signedPayload).not.toHaveProperty('passwordHash');
    expect(signedPayload).not.toHaveProperty('acl');
    expect(result).toEqual({
      accessToken: 'signed-token',
      user: {
        id: activeUser.id,
        username: 'admin',
        role: 'ADMIN',
        tokenVersion: 2,
      },
    });
  });

  it('returns the same generic error for unknown and disabled users', async () => {
    findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      ...activeUser,
      status: 'DISABLED',
    });

    await expect(service.login('missing', 'password')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(service.login('admin', 'password')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects an incorrect password', async () => {
    findUnique.mockResolvedValue(activeUser);
    verify.mockResolvedValue(false);

    await expect(service.login('admin', 'wrong-password')).rejects.toMatchObject({
      response: { message: 'INVALID_CREDENTIALS' },
    });
    expect(signAsync).not.toHaveBeenCalled();
  });
});
