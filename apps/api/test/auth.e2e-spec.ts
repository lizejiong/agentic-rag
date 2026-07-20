import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { z } from 'zod';

import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/auth/password.service';
import { PrismaService } from '../src/infrastructure/database/prisma.service';

const ADMIN_USERNAME = 'phase1-e2e-admin';
const MEMBER_USERNAME = 'phase1-e2e-member';
const ADMIN_PASSWORD = 'Admin-Password-For-E2E-01';
const MEMBER_PASSWORD = 'Member-Password-For-E2E-01';
const NEW_MEMBER_PASSWORD = 'Member-Password-For-E2E-02';

const loginResponseSchema = z.object({
  accessToken: z.string().min(1),
  user: z.object({
    id: z.uuid(),
    username: z.string(),
    role: z.enum(['ADMIN', 'MEMBER']),
    tokenVersion: z.number().int(),
  }),
});
const createdUserSchema = z.object({
  id: z.uuid(),
  username: z.string(),
  role: z.enum(['ADMIN', 'MEMBER']),
  status: z.enum(['ACTIVE', 'DISABLED']),
});

describe('Local account authentication', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    prisma = module.get(PrismaService);
    const passwords = module.get(PasswordService);

    await prisma.user.deleteMany({
      where: { username: { in: [ADMIN_USERNAME, MEMBER_USERNAME] } },
    });
    await prisma.user.create({
      data: {
        username: ADMIN_USERNAME,
        displayName: 'E2E Administrator',
        passwordHash: await passwords.hash(ADMIN_PASSWORD),
        role: 'ADMIN',
      },
    });
    await app.init();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { username: { in: [ADMIN_USERNAME, MEMBER_USERNAME] } },
    });
    await app.close();
  });

  it('creates, authenticates, disables and resets a member account', async () => {
    await request(app.getHttpServer() as Server)
      .post('/auth/login')
      .send({ username: ADMIN_USERNAME, password: 'wrong-password' })
      .expect(401);

    const adminLoginResponse = await request(app.getHttpServer() as Server)
      .post('/auth/login')
      .send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD })
      .expect(201);
    const adminLogin = loginResponseSchema.parse(adminLoginResponse.body as unknown);

    const createResponse = await request(app.getHttpServer() as Server)
      .post('/users')
      .set('authorization', `Bearer ${adminLogin.accessToken}`)
      .set('x-request-id', 'auth-e2e-create-user')
      .set('x-trace-id', 'auth-e2e-trace')
      .send({
        username: MEMBER_USERNAME,
        displayName: 'E2E Member',
        password: MEMBER_PASSWORD,
        role: 'MEMBER',
      })
      .expect(201);
    const member = createdUserSchema.parse(createResponse.body as unknown);
    await expect(
      prisma.auditLog.findFirstOrThrow({
        where: { action: 'user.create', targetId: member.id },
      }),
    ).resolves.toMatchObject({
      actorId: adminLogin.user.id,
      actorUsername: ADMIN_USERNAME,
      requestId: 'auth-e2e-create-user',
      traceId: 'auth-e2e-trace',
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app.getHttpServer() as Server)
        .post('/auth/login')
        .send({ username: MEMBER_USERNAME, password: 'wrong-password' })
        .expect(401);
    }
    await request(app.getHttpServer() as Server)
      .post('/auth/login')
      .send({ username: MEMBER_USERNAME, password: MEMBER_PASSWORD })
      .expect(401);
    const lockedMember = await prisma.user.findUniqueOrThrow({
      where: { id: member.id },
      select: { lockedUntil: true, failedLoginCount: true },
    });
    expect(lockedMember.failedLoginCount).toBe(5);
    expect(lockedMember.lockedUntil).toBeInstanceOf(Date);

    await request(app.getHttpServer() as Server)
      .post(`/users/${member.id}/reset-password`)
      .set('authorization', `Bearer ${adminLogin.accessToken}`)
      .send({ password: MEMBER_PASSWORD })
      .expect(201);

    const memberAgent = request.agent(app.getHttpServer() as Server);
    const memberLoginResponse = await memberAgent
      .post('/auth/login')
      .send({ username: MEMBER_USERNAME, password: MEMBER_PASSWORD })
      .expect(201);
    const memberLogin = loginResponseSchema.parse(memberLoginResponse.body as unknown);

    await request(app.getHttpServer() as Server)
      .post('/users')
      .set('authorization', `Bearer ${memberLogin.accessToken}`)
      .send({
        username: 'unauthorized-user',
        displayName: 'Unauthorized',
        password: MEMBER_PASSWORD,
      })
      .expect(403);

    await request(app.getHttpServer() as Server)
      .get('/auth/me')
      .set('authorization', `Bearer ${memberLogin.accessToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({ id: member.id, username: MEMBER_USERNAME });
      });

    await request(app.getHttpServer() as Server)
      .patch(`/users/${member.id}/status`)
      .set('authorization', `Bearer ${adminLogin.accessToken}`)
      .send({ status: 'DISABLED' })
      .expect(200);

    await request(app.getHttpServer() as Server)
      .get('/auth/me')
      .set('authorization', `Bearer ${memberLogin.accessToken}`)
      .expect(401);

    await request(app.getHttpServer() as Server)
      .patch(`/users/${member.id}/status`)
      .set('authorization', `Bearer ${adminLogin.accessToken}`)
      .send({ status: 'ACTIVE' })
      .expect(200);

    await request(app.getHttpServer() as Server)
      .post(`/users/${member.id}/reset-password`)
      .set('authorization', `Bearer ${adminLogin.accessToken}`)
      .send({ password: NEW_MEMBER_PASSWORD })
      .expect(201);

    await memberAgent.post('/auth/refresh').expect(401);

    await request(app.getHttpServer() as Server)
      .get('/auth/me')
      .set('authorization', `Bearer ${memberLogin.accessToken}`)
      .expect(401);

    await memberAgent
      .post('/auth/login')
      .send({ username: MEMBER_USERNAME, password: NEW_MEMBER_PASSWORD })
      .expect(201);

    const sessionLoginResponse = await memberAgent
      .post('/auth/login')
      .send({ username: MEMBER_USERNAME, password: NEW_MEMBER_PASSWORD })
      .expect(201);
    const sessionLogin = loginResponseSchema.parse(sessionLoginResponse.body as unknown);
    const setCookie = z
      .union([z.string(), z.array(z.string())])
      .optional()
      .parse(sessionLoginResponse.headers['set-cookie']);
    const originalRefreshCookie = Array.isArray(setCookie)
      ? setCookie[0]?.split(';', 1)[0]
      : setCookie?.split(';', 1)[0];
    expect(originalRefreshCookie).toBeTruthy();
    const serializedCookies = Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie ?? '');
    expect(serializedCookies).toContain('HttpOnly');
    expect(serializedCookies).toContain('SameSite=Strict');
    expect(serializedCookies).toContain('Path=/auth');
    const storedSession = await prisma.refreshSession.findFirstOrThrow({
      where: { userId: member.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { tokenHash: true },
    });
    expect(storedSession.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(originalRefreshCookie).not.toContain(storedSession.tokenHash);

    const concurrentRefreshes = await Promise.all([
      request(app.getHttpServer() as Server)
        .post('/auth/refresh')
        .set('cookie', originalRefreshCookie ?? ''),
      request(app.getHttpServer() as Server)
        .post('/auth/refresh')
        .set('cookie', originalRefreshCookie ?? ''),
    ]);
    expect(concurrentRefreshes.map((response) => response.status).sort()).toEqual([201, 401]);
    const successfulRefresh = concurrentRefreshes.find((response) => response.status === 201);
    const refreshed = loginResponseSchema.parse(successfulRefresh?.body as unknown);
    expect(refreshed.accessToken).not.toBe(sessionLogin.accessToken);
    await memberAgent.post('/auth/refresh').expect(401);

    const logoutAllLoginResponse = await memberAgent
      .post('/auth/login')
      .send({ username: MEMBER_USERNAME, password: NEW_MEMBER_PASSWORD })
      .expect(201);
    const logoutAllLogin = loginResponseSchema.parse(logoutAllLoginResponse.body as unknown);
    await memberAgent
      .post('/auth/logout-all')
      .set('authorization', `Bearer ${logoutAllLogin.accessToken}`)
      .expect(204);
    await request(app.getHttpServer() as Server)
      .get('/auth/me')
      .set('authorization', `Bearer ${logoutAllLogin.accessToken}`)
      .expect(401);
    await memberAgent.post('/auth/refresh').expect(401);

    await memberAgent
      .post('/auth/login')
      .send({ username: MEMBER_USERNAME, password: NEW_MEMBER_PASSWORD })
      .expect(201);
    await memberAgent.post('/auth/logout').expect(204);
    await memberAgent.post('/auth/logout').expect(204);

    const unknownUsername = `missing-${randomUUID()}`;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await request(app.getHttpServer() as Server)
        .post('/auth/login')
        .send({ username: unknownUsername, password: 'wrong-password' })
        .expect(401);
    }
    await request(app.getHttpServer() as Server)
      .post('/auth/login')
      .send({ username: unknownUsername, password: 'wrong-password' })
      .expect(429);
  });
});
