import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';

import type { Environment } from '../infrastructure/config/environment';
import type { PrismaService } from '../infrastructure/database/prisma.service';
import { AccessTokenGuard } from './access-token.guard';
import type { AuthenticatedRequest } from './current-user.decorator';

const claims = {
  sub: '00000000-0000-4000-8000-000000000001',
  username: 'admin',
  role: 'ADMIN',
  tokenVersion: 3,
  jti: '00000000-0000-4000-8000-000000000002',
};

function executionContext(request: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as ExecutionContext;
}

describe('AccessTokenGuard', () => {
  const verifyAsync = jest.fn();
  const findUnique = jest.fn();
  const guard = new AccessTokenGuard(
    { verifyAsync } as unknown as JwtService,
    { user: { findUnique } } as unknown as PrismaService,
    { JWT_ACCESS_SECRET: 'access-secret-with-at-least-32-characters' } as Environment,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('attaches the current active user', async () => {
    verifyAsync.mockResolvedValue(claims);
    findUnique.mockResolvedValue({
      id: claims.sub,
      username: claims.username,
      role: claims.role,
      status: 'ACTIVE',
      tokenVersion: claims.tokenVersion,
    });
    const request = {
      header: jest.fn().mockReturnValue('Bearer signed-token'),
    } as unknown as AuthenticatedRequest;

    await expect(guard.canActivate(executionContext(request))).resolves.toBe(true);
    expect(request.user).toEqual({
      id: claims.sub,
      username: claims.username,
      role: claims.role,
      tokenVersion: claims.tokenVersion,
    });
  });

  it('rejects tokens after tokenVersion changes', async () => {
    verifyAsync.mockResolvedValue(claims);
    findUnique.mockResolvedValue({
      id: claims.sub,
      username: claims.username,
      role: claims.role,
      status: 'ACTIVE',
      tokenVersion: claims.tokenVersion + 1,
    });
    const request = {
      header: jest.fn().mockReturnValue('Bearer signed-token'),
    } as unknown as AuthenticatedRequest;

    await expect(guard.canActivate(executionContext(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects malformed signed claims before querying the database', async () => {
    verifyAsync.mockResolvedValue({ ...claims, sub: 'not-a-uuid' });
    const request = {
      header: jest.fn().mockReturnValue('Bearer signed-token'),
    } as unknown as AuthenticatedRequest;

    await expect(guard.canActivate(executionContext(request))).rejects.toMatchObject({
      response: { message: 'ACCESS_TOKEN_INVALID' },
    });
    expect(findUnique).not.toHaveBeenCalled();
  });
});
