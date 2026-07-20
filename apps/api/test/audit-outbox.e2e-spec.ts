import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../src/app.module';
import { AuthorizationRevisionService } from '../src/authorization/authorization-revision.service';
import { PrismaService } from '../src/infrastructure/database/prisma.service';

const PREFIX = 'audit-outbox-e2e-';

describe('Transactional audit and outbox', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let revision: AuthorizationRevisionService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    prisma = module.get(PrismaService);
    revision = module.get(AuthorizationRevisionService);
    await cleanup(prisma);
    await app.init();
  });

  afterAll(async () => {
    await cleanup(prisma);
    await app.close();
  });

  it('commits business data, audit and outbox together', async () => {
    const department = await revision.mutate(
      (transaction) =>
        transaction.department.create({
          data: { name: `${PREFIX}committed` },
        }),
      {
        action: 'department.create',
        targetType: 'DEPARTMENT',
        targetId: (result) => result.id,
        eventType: 'organization.department.created',
        resourceId: (result) => result.id,
        payload: (result) => ({ name: result.name }),
      },
    );

    const [audit, event] = await Promise.all([
      prisma.auditLog.findFirst({
        where: { action: 'department.create', targetId: department.id },
      }),
      prisma.outboxEvent.findFirst({
        where: { type: 'organization.department.created', resourceId: department.id },
      }),
    ]);

    expect(audit).toMatchObject({
      targetType: 'DEPARTMENT',
      result: 'SUCCESS',
      requestId: 'system',
    });
    expect(event).toMatchObject({
      status: 'PENDING',
      attempt: 0,
      traceId: 'system',
    });
  });

  it('rolls business data back without leaving audit or outbox records', async () => {
    await expect(
      revision.mutate(
        async (transaction) => {
          const department = await transaction.department.create({
            data: { name: `${PREFIX}rolled-back` },
          });
          throw new Error(`ROLLBACK:${department.id}`);
        },
        {
          action: 'department.create.rollback',
          targetType: 'DEPARTMENT',
          targetId: undefined,
          eventType: 'organization.department.created.rollback',
          resourceId: 'rolled-back',
        },
      ),
    ).rejects.toThrow('ROLLBACK');

    const [departments, audits, events] = await Promise.all([
      prisma.department.count({ where: { name: `${PREFIX}rolled-back` } }),
      prisma.auditLog.count({ where: { action: 'department.create.rollback' } }),
      prisma.outboxEvent.count({ where: { type: 'organization.department.created.rollback' } }),
    ]);
    expect({ departments, audits, events }).toEqual({ departments: 0, audits: 0, events: 0 });
  });
});

async function cleanup(prisma: PrismaService): Promise<void> {
  await prisma.auditLog.deleteMany({
    where: { action: { startsWith: 'department.create' }, targetType: 'DEPARTMENT' },
  });
  await prisma.outboxEvent.deleteMany({
    where: { type: { startsWith: 'organization.department.created' } },
  });
  await prisma.department.deleteMany({ where: { name: { startsWith: PREFIX } } });
}
