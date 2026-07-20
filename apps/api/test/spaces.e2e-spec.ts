import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { z } from 'zod';

import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/auth/password.service';
import { PrismaService } from '../src/infrastructure/database/prisma.service';

const ADMIN_USERNAME = 'spaces-e2e-admin';
const EDITOR_USERNAME = 'spaces-e2e-editor';
const VIEWER_USERNAME = 'spaces-e2e-viewer';
const OUTSIDER_USERNAME = 'spaces-e2e-outsider';
const PASSWORD = 'Spaces-E2E-Password-01';
const DEPARTMENT_NAME = 'Spaces E2E Department';
const GROUP_NAME = 'Spaces E2E Group';
const SPACE_NAME = 'Spaces E2E Knowledge';

const loginSchema = z.object({ accessToken: z.string().min(1) });
const idSchema = z.object({ id: z.uuid() });
const spaceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  llmEnabled: z.boolean(),
  graphExtractionEnabled: z.boolean(),
  status: z.enum(['ACTIVE', 'ARCHIVED']),
  effectivePermission: z.enum(['VIEW', 'EDIT', 'MANAGE']).optional(),
});
const visibleSpacesSchema = z.array(
  z.object({
    id: z.uuid(),
    effectivePermission: z.enum(['VIEW', 'EDIT', 'MANAGE']),
  }),
);

describe('Organizations and knowledge spaces', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    prisma = module.get(PrismaService);
    const passwords = module.get(PasswordService);

    await cleanup(prisma);
    await prisma.user.create({
      data: {
        username: ADMIN_USERNAME,
        displayName: 'Spaces Administrator',
        passwordHash: await passwords.hash(PASSWORD),
        role: 'ADMIN',
      },
    });
    await app.init();
  });

  afterAll(async () => {
    await cleanup(prisma);
    await app.close();
  });

  it('enforces organization subjects and the three-level space permission ladder', async () => {
    const server = app.getHttpServer() as Server;
    const adminToken = await login(server, ADMIN_USERNAME);
    const editorId = await createMember(server, adminToken, EDITOR_USERNAME);
    const viewerId = await createMember(server, adminToken, VIEWER_USERNAME);
    const outsiderId = await createMember(server, adminToken, OUTSIDER_USERNAME);
    const editorToken = await login(server, EDITOR_USERNAME);
    const viewerToken = await login(server, VIEWER_USERNAME);
    const outsiderToken = await login(server, OUTSIDER_USERNAME);

    const departmentResponse = await request(server)
      .post('/departments')
      .set('authorization', `Bearer ${adminToken}`)
      .send({ name: DEPARTMENT_NAME })
      .expect(201);
    const departmentId = idSchema.parse(departmentResponse.body as unknown).id;

    const groupResponse = await request(server)
      .post('/groups')
      .set('authorization', `Bearer ${adminToken}`)
      .send({ name: GROUP_NAME })
      .expect(201);
    const groupId = idSchema.parse(groupResponse.body as unknown).id;

    await request(server)
      .put(`/departments/${departmentId}/users/${viewerId}`)
      .set('authorization', `Bearer ${adminToken}`)
      .expect(204);
    await request(server)
      .put(`/groups/${groupId}/users/${editorId}`)
      .set('authorization', `Bearer ${adminToken}`)
      .expect(204);
    await request(server)
      .get('/departments')
      .set('authorization', `Bearer ${editorToken}`)
      .expect(403);

    const createSpaceResponse = await request(server)
      .post('/spaces')
      .set('authorization', `Bearer ${adminToken}`)
      .send({
        name: SPACE_NAME,
        llmEnabled: false,
        graphExtractionEnabled: true,
        tags: ['rag', 'rag'],
        egressPolicy: 'LOCAL_ONLY',
      })
      .expect(201);
    const createdSpace = spaceSchema.parse(createSpaceResponse.body as unknown);
    expect(createdSpace).toMatchObject({
      name: SPACE_NAME,
      llmEnabled: true,
      graphExtractionEnabled: true,
    });

    await request(server)
      .put(`/spaces/${createdSpace.id}/grants`)
      .set('authorization', `Bearer ${adminToken}`)
      .send({ subjectType: 'USER', subjectId: editorId, permission: 'VIEW' })
      .expect(200);
    await request(server)
      .put(`/spaces/${createdSpace.id}/grants`)
      .set('authorization', `Bearer ${adminToken}`)
      .send({ subjectType: 'GROUP', subjectId: groupId, permission: 'EDIT' })
      .expect(200);
    await request(server)
      .put(`/spaces/${createdSpace.id}/grants`)
      .set('authorization', `Bearer ${adminToken}`)
      .send({
        subjectType: 'DEPARTMENT',
        subjectId: departmentId,
        permission: 'VIEW',
      })
      .expect(200);

    const editorSpacesResponse = await request(server)
      .get('/spaces')
      .set('authorization', `Bearer ${editorToken}`)
      .expect(200);
    expect(visibleSpacesSchema.parse(editorSpacesResponse.body as unknown)).toContainEqual({
      id: createdSpace.id,
      effectivePermission: 'EDIT',
    });

    await request(server)
      .patch(`/spaces/${createdSpace.id}`)
      .set('authorization', `Bearer ${editorToken}`)
      .send({ description: 'Edited by group permission', llmEnabled: false })
      .expect(200);
    await request(server)
      .put(`/spaces/${createdSpace.id}/grants`)
      .set('authorization', `Bearer ${editorToken}`)
      .send({ subjectType: 'USER', subjectId: viewerId, permission: 'EDIT' })
      .expect(403);
    await request(server)
      .patch(`/spaces/${createdSpace.id}/status`)
      .set('authorization', `Bearer ${editorToken}`)
      .send({ status: 'ARCHIVED' })
      .expect(403);

    await request(server)
      .get(`/spaces/${createdSpace.id}`)
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    await request(server)
      .patch(`/spaces/${createdSpace.id}`)
      .set('authorization', `Bearer ${viewerToken}`)
      .send({ description: 'not allowed' })
      .expect(403);
    await request(server)
      .get(`/spaces/${createdSpace.id}`)
      .set('authorization', `Bearer ${outsiderToken}`)
      .expect(403);

    await request(server)
      .delete(`/groups/${groupId}`)
      .set('authorization', `Bearer ${adminToken}`)
      .expect(409);
    await request(server)
      .delete(`/departments/${departmentId}`)
      .set('authorization', `Bearer ${adminToken}`)
      .expect(409);

    await request(server)
      .put(`/spaces/${createdSpace.id}/grants`)
      .set('authorization', `Bearer ${adminToken}`)
      .send({ subjectType: 'USER', subjectId: editorId, permission: 'MANAGE' })
      .expect(200);
    await request(server)
      .put(`/spaces/${createdSpace.id}/grants`)
      .set('authorization', `Bearer ${editorToken}`)
      .send({
        subjectType: 'USER',
        subjectId: outsiderId,
        permission: 'VIEW',
      })
      .expect(200);
    await request(server)
      .patch(`/spaces/${createdSpace.id}/status`)
      .set('authorization', `Bearer ${editorToken}`)
      .send({ status: 'ARCHIVED' })
      .expect(200);
    const archivedEditorSpaces = await request(server)
      .get('/spaces')
      .set('authorization', `Bearer ${editorToken}`)
      .expect(200);
    expect(visibleSpacesSchema.parse(archivedEditorSpaces.body as unknown)).toEqual([]);
    await request(server)
      .get(`/spaces/${createdSpace.id}`)
      .set('authorization', `Bearer ${editorToken}`)
      .expect(403);

    const archivedAdminResponse = await request(server)
      .get(`/spaces/${createdSpace.id}`)
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(spaceSchema.parse(archivedAdminResponse.body as unknown)).toMatchObject({
      status: 'ARCHIVED',
      effectivePermission: 'MANAGE',
    });
    await request(server)
      .patch(`/spaces/${createdSpace.id}/status`)
      .set('authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' })
      .expect(200);
  });
});

async function login(server: Server, username: string): Promise<string> {
  const response = await request(server)
    .post('/auth/login')
    .send({ username, password: PASSWORD })
    .expect(201);
  return loginSchema.parse(response.body as unknown).accessToken;
}

async function createMember(server: Server, adminToken: string, username: string): Promise<string> {
  const response = await request(server)
    .post('/users')
    .set('authorization', `Bearer ${adminToken}`)
    .send({
      username,
      displayName: username,
      password: PASSWORD,
      role: 'MEMBER',
    })
    .expect(201);
  return idSchema.parse(response.body as unknown).id;
}

async function cleanup(prisma: PrismaService): Promise<void> {
  await prisma.knowledgeSpace.deleteMany({ where: { name: SPACE_NAME } });
  await prisma.user.deleteMany({
    where: {
      username: {
        in: [ADMIN_USERNAME, EDITOR_USERNAME, VIEWER_USERNAME, OUTSIDER_USERNAME],
      },
    },
  });
  await prisma.userGroup.deleteMany({ where: { name: GROUP_NAME } });
  await prisma.department.deleteMany({ where: { name: DEPARTMENT_NAME } });
}
