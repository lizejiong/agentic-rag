import type { PrismaService } from '../infrastructure/database/prisma.service';
import type { RedisService } from '../infrastructure/redis/redis.service';
import type { AuthorizationRevisionService } from './authorization-revision.service';
import { AuthorizationService } from './authorization.service';

describe('AuthorizationService', () => {
  it('builds a highest-permission snapshot and caches it under the revision key', async () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const departmentId = '00000000-0000-4000-8000-000000000002';
    const groupId = '00000000-0000-4000-8000-000000000003';
    const spaceId = '00000000-0000-4000-8000-000000000004';
    const cacheGet = jest.fn<Promise<string | null>, [string]>().mockResolvedValue(null);
    const cacheSet = jest.fn<Promise<void>, [string, string, number]>().mockResolvedValue();
    const prisma = {
      authorizationState: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ revision: 7n }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: userId,
          role: 'MEMBER',
          status: 'ACTIVE',
          departmentId,
          groupMemberships: [{ groupId }],
        }),
      },
      spaceGrant: {
        findMany: jest.fn().mockResolvedValue([
          { spaceId, permission: 'VIEW' },
          { spaceId, permission: 'EDIT' },
        ]),
      },
    } as unknown as PrismaService;
    const service = new AuthorizationService(
      prisma,
      {
        get: cacheGet,
        setWithExpiry: cacheSet,
      } as unknown as RedisService,
      {} as AuthorizationRevisionService,
    );

    const snapshot = await service.snapshot({
      id: userId,
      username: 'member',
      role: 'MEMBER',
      tokenVersion: 0,
    });

    expect(snapshot).toEqual({
      userId,
      revision: 7n,
      admin: false,
      departmentId,
      groupIds: [groupId],
      spaces: { [spaceId]: 'EDIT' },
    });
    expect(cacheGet).toHaveBeenCalledWith(`authz:v1:7:${userId}`);
    expect(cacheSet).toHaveBeenCalledWith(
      `authz:v1:7:${userId}`,
      expect.stringContaining('"revision":"7"'),
      60,
    );
  });

  it('uses a valid cached snapshot without recomputing grants', async () => {
    const userId = '00000000-0000-4000-8000-000000000001';
    const findUser = jest.fn();
    const service = new AuthorizationService(
      {
        authorizationState: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({ revision: 9n }),
        },
        user: { findUnique: findUser },
      } as unknown as PrismaService,
      {
        get: jest.fn().mockResolvedValue(
          JSON.stringify({
            userId,
            revision: '9',
            admin: false,
            groupIds: [],
            spaces: {},
          }),
        ),
      } as unknown as RedisService,
      {} as AuthorizationRevisionService,
    );

    await expect(
      service.snapshot({
        id: userId,
        username: 'member',
        role: 'MEMBER',
        tokenVersion: 0,
      }),
    ).resolves.toMatchObject({ revision: 9n });
    expect(findUser).not.toHaveBeenCalled();
  });
});
