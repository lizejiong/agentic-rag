import type { Server } from 'node:http';

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
      .send({
        username: MEMBER_USERNAME,
        displayName: 'E2E Member',
        password: MEMBER_PASSWORD,
        role: 'MEMBER',
      })
      .expect(201);
    const member = createdUserSchema.parse(createResponse.body as unknown);

    const memberLoginResponse = await request(app.getHttpServer() as Server)
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

    await request(app.getHttpServer() as Server)
      .get('/auth/me')
      .set('authorization', `Bearer ${memberLogin.accessToken}`)
      .expect(401);

    await request(app.getHttpServer() as Server)
      .post('/auth/login')
      .send({ username: MEMBER_USERNAME, password: NEW_MEMBER_PASSWORD })
      .expect(201);
  });
});
