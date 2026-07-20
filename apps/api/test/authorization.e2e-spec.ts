import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { z } from 'zod';

import { AppModule } from '../src/app.module';
import { AuthorizationRevisionService } from '../src/authorization/authorization-revision.service';
import { AuthorizationService } from '../src/authorization/authorization.service';
import { PasswordService } from '../src/auth/password.service';
import { PrismaService } from '../src/infrastructure/database/prisma.service';

const PREFIX = 'authz-e2e-';
const PASSWORD = 'Authorization-E2E-Password-01';
const loginSchema = z.object({ accessToken: z.string().min(1) });

describe('Unified resource authorization', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let revision: AuthorizationRevisionService;
  let authorization: AuthorizationService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    prisma = module.get(PrismaService);
    revision = module.get(AuthorizationRevisionService);
    authorization = module.get(AuthorizationService);
    await cleanup(prisma);
    await app.init();
  });

  afterAll(async () => {
    await cleanup(prisma);
    await app.close();
  });

  it('never lets document ACL expand space access and invalidates cached grants by revision', async () => {
    const passwords = app.get(PasswordService);
    const passwordHash = await passwords.hash(PASSWORD);
    const [admin, directUser, departmentUser, groupUser, outsider] = await prisma.$transaction([
      prisma.user.create({
        data: {
          username: `${PREFIX}admin`,
          displayName: 'Authorization Admin',
          passwordHash,
          role: 'ADMIN',
        },
      }),
      prisma.user.create({
        data: {
          username: `${PREFIX}direct`,
          displayName: 'Direct User',
          passwordHash,
        },
      }),
      prisma.user.create({
        data: {
          username: `${PREFIX}department`,
          displayName: 'Department User',
          passwordHash,
        },
      }),
      prisma.user.create({
        data: {
          username: `${PREFIX}group`,
          displayName: 'Group User',
          passwordHash,
        },
      }),
      prisma.user.create({
        data: {
          username: `${PREFIX}outsider`,
          displayName: 'Outsider',
          passwordHash,
        },
      }),
    ]);
    const department = await prisma.department.create({
      data: { name: `${PREFIX}department` },
    });
    const group = await prisma.userGroup.create({ data: { name: `${PREFIX}group` } });
    await prisma.$transaction([
      prisma.user.update({
        where: { id: departmentUser.id },
        data: { departmentId: department.id },
      }),
      prisma.groupMember.create({ data: { groupId: group.id, userId: groupUser.id } }),
    ]);
    const space = await prisma.knowledgeSpace.create({
      data: { name: `${PREFIX}space`, createdById: admin.id },
    });
    await prisma.spaceGrant.createMany({
      data: [
        {
          spaceId: space.id,
          subjectType: 'USER',
          subjectId: directUser.id,
          permission: 'VIEW',
        },
        {
          spaceId: space.id,
          subjectType: 'DEPARTMENT',
          subjectId: department.id,
          permission: 'VIEW',
        },
        {
          spaceId: space.id,
          subjectType: 'GROUP',
          subjectId: group.id,
          permission: 'VIEW',
        },
      ],
    });
    const [inheritedDocument, directDocument, departmentDocument, groupDocument, deletedDocument] =
      await prisma.$transaction([
        prisma.document.create({
          data: {
            spaceId: space.id,
            title: `${PREFIX}inherited`,
            availability: 'ACTIVE',
          },
        }),
        prisma.document.create({
          data: {
            spaceId: space.id,
            title: `${PREFIX}direct`,
            availability: 'ACTIVE',
          },
        }),
        prisma.document.create({
          data: {
            spaceId: space.id,
            title: `${PREFIX}department`,
            availability: 'ACTIVE',
          },
        }),
        prisma.document.create({
          data: {
            spaceId: space.id,
            title: `${PREFIX}group`,
            availability: 'ACTIVE',
          },
        }),
        prisma.document.create({
          data: {
            spaceId: space.id,
            title: `${PREFIX}deleted`,
            availability: 'ACTIVE',
          },
        }),
      ]);
    await prisma.documentAclEntry.createMany({
      data: [
        {
          documentId: directDocument.id,
          subjectType: 'USER',
          subjectId: directUser.id,
        },
        {
          documentId: directDocument.id,
          subjectType: 'USER',
          subjectId: outsider.id,
        },
        {
          documentId: departmentDocument.id,
          subjectType: 'DEPARTMENT',
          subjectId: department.id,
        },
        {
          documentId: groupDocument.id,
          subjectType: 'GROUP',
          subjectId: group.id,
        },
      ],
    });

    const server = app.getHttpServer() as Server;
    const tokens = {
      admin: await login(server, admin.username),
      direct: await login(server, directUser.username),
      department: await login(server, departmentUser.username),
      group: await login(server, groupUser.username),
      outsider: await login(server, outsider.username),
    };

    await authorization.setDocumentAvailability(
      {
        id: admin.id,
        username: admin.username,
        role: 'ADMIN',
        tokenVersion: admin.tokenVersion,
      },
      deletedDocument.id,
      'SOFT_DELETED',
    );

    for (const operation of ['SEARCH', 'CITATION', 'PREVIEW', 'DOWNLOAD'] as const) {
      await probeDocument(server, tokens.direct, inheritedDocument.id, 201, operation);
    }
    await probeDocument(server, tokens.department, inheritedDocument.id, 201);
    await probeDocument(server, tokens.group, inheritedDocument.id, 201);
    await probeDocument(server, tokens.direct, directDocument.id, 201);
    await probeDocument(server, tokens.department, departmentDocument.id, 201);
    await probeDocument(server, tokens.group, groupDocument.id, 201);
    await probeDocument(server, tokens.group, directDocument.id, 403);
    await probeDocument(server, tokens.outsider, directDocument.id, 403);
    await probeDocument(server, tokens.admin, directDocument.id, 201);
    await probeDocument(server, tokens.admin, deletedDocument.id, 403);

    await authorization.replaceDocumentAcl(
      {
        id: admin.id,
        username: admin.username,
        role: 'ADMIN',
        tokenVersion: admin.tokenVersion,
      },
      inheritedDocument.id,
      [{ subjectType: 'USER', subjectId: directUser.id }],
    );
    await probeDocument(server, tokens.direct, inheritedDocument.id, 201);
    await probeDocument(server, tokens.department, inheritedDocument.id, 403);
    await probeDocument(server, tokens.group, inheritedDocument.id, 403);

    const beforeRevoke = await prisma.authorizationState.findUniqueOrThrow({
      where: { id: 1 },
      select: { revision: true },
    });
    await revision.mutate(async (transaction) => {
      await transaction.spaceGrant.deleteMany({
        where: {
          spaceId: space.id,
          subjectType: 'USER',
          subjectId: directUser.id,
        },
      });
    });
    const afterRevoke = await prisma.authorizationState.findUniqueOrThrow({
      where: { id: 1 },
      select: { revision: true },
    });
    expect(afterRevoke.revision).toBe(beforeRevoke.revision + 1n);
    await probeDocument(server, tokens.direct, inheritedDocument.id, 403);

    await revision.mutate((transaction) =>
      transaction.knowledgeSpace.update({
        where: { id: space.id },
        data: { status: 'ARCHIVED' },
      }),
    );
    await probeDocument(server, tokens.department, inheritedDocument.id, 403);
    await probeDocument(server, tokens.admin, inheritedDocument.id, 403);

    await revision.mutate((transaction) =>
      transaction.user.update({
        where: { id: groupUser.id },
        data: { status: 'DISABLED', tokenVersion: { increment: 1 } },
      }),
    );
    await probeDocument(server, tokens.group, groupDocument.id, 401);
  });
});

async function login(server: Server, username: string): Promise<string> {
  const response = await request(server)
    .post('/auth/login')
    .send({ username, password: PASSWORD })
    .expect(201);
  return loginSchema.parse(response.body as unknown).accessToken;
}

async function probeDocument(
  server: Server,
  accessToken: string,
  documentId: string,
  expectedStatus: number,
  operation: 'SEARCH' | 'CITATION' | 'PREVIEW' | 'DOWNLOAD' = 'PREVIEW',
): Promise<void> {
  await request(server)
    .post('/authorization/probe')
    .set('authorization', `Bearer ${accessToken}`)
    .send({ resourceType: 'DOCUMENT', documentId, operation })
    .expect(expectedStatus);
}

async function cleanup(prisma: PrismaService): Promise<void> {
  await prisma.document.deleteMany({
    where: { space: { name: `${PREFIX}space` } },
  });
  await prisma.knowledgeSpace.deleteMany({ where: { name: `${PREFIX}space` } });
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  await prisma.userGroup.deleteMany({ where: { name: `${PREFIX}group` } });
  await prisma.department.deleteMany({ where: { name: `${PREFIX}department` } });
}
