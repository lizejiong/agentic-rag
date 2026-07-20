import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AgentEvent, RunRequest } from '@rag/contracts';
import request from 'supertest';
import { z } from 'zod';

import { AI_EVENT_SOURCE, type AiEventSource } from '../src/ai/ai-event-source';
import { AppModule } from '../src/app.module';
import { PasswordService } from '../src/auth/password.service';
import { PrismaService } from '../src/infrastructure/database/prisma.service';

const PREFIX = 'phase1-acceptance-';
const PASSWORD = 'Phase1-Acceptance-Password-01';
const sessionSchema = z.object({
  accessToken: z.string().min(1),
  user: z.object({ id: z.uuid(), username: z.string() }),
});
const idSchema = z.object({ id: z.uuid() });

class CapturingAiSource implements AiEventSource {
  lastRequest: RunRequest | undefined;

  async *run(runRequest: RunRequest): AsyncIterable<AgentEvent> {
    await Promise.resolve();
    this.lastRequest = runRequest;
    const base = {
      requestId: runRequest.requestId,
      traceId: runRequest.traceId,
      occurredAt: '2026-07-19T00:00:00.000Z',
    };
    yield { ...base, seq: 0, type: 'run.started' };
    yield { ...base, seq: 1, type: 'text.delta', text: '验收通过' };
    yield { ...base, seq: 2, type: 'run.completed', finishReason: 'stop' };
  }

  cancel(): Promise<void> {
    return Promise.resolve();
  }
}

describe('Phase 1 authenticated authorization chain', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ai: CapturingAiSource;

  beforeAll(async () => {
    ai = new CapturingAiSource();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_EVENT_SOURCE)
      .useValue(ai)
      .compile();
    app = module.createNestApplication();
    prisma = module.get(PrismaService);
    await cleanup(prisma);
    const passwords = module.get(PasswordService);
    await prisma.user.create({
      data: {
        username: `${PREFIX}admin`,
        displayName: 'Phase 1 Administrator',
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

  it('passes the member identity to AI and rejects access immediately after revoke', async () => {
    const server = app.getHttpServer() as Server;
    const admin = await login(server, `${PREFIX}admin`);
    const memberResponse = await request(server)
      .post('/users')
      .set('authorization', `Bearer ${admin.accessToken}`)
      .send({
        username: `${PREFIX}member`,
        displayName: 'Phase 1 Member',
        password: PASSWORD,
        role: 'MEMBER',
      })
      .expect(201);
    const memberId = idSchema.parse(memberResponse.body as unknown).id;
    const spaceResponse = await request(server)
      .post('/spaces')
      .set('authorization', `Bearer ${admin.accessToken}`)
      .send({ name: `${PREFIX}space` })
      .expect(201);
    const spaceId = idSchema.parse(spaceResponse.body as unknown).id;
    const grantResponse = await request(server)
      .put(`/spaces/${spaceId}/grants`)
      .set('authorization', `Bearer ${admin.accessToken}`)
      .send({
        subjectType: 'USER',
        subjectId: memberId,
        permission: 'VIEW',
      })
      .expect(200);
    const grantId = idSchema.parse(grantResponse.body as unknown).id;
    const member = await login(server, `${PREFIX}member`);

    await request(server)
      .get('/spaces')
      .set('authorization', `Bearer ${member.accessToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual([
          expect.objectContaining({ id: spaceId, effectivePermission: 'VIEW' }),
        ]);
      });

    const requestId = randomUUID();
    await request(server)
      .post('/chat/stream')
      .set('authorization', `Bearer ${member.accessToken}`)
      .set('x-chat-protocol-version', '1')
      .set('x-trace-id', 'phase1-acceptance-trace')
      .send({
        id: 'phase1-acceptance-conversation',
        requestId,
        selectedSpaceIds: [spaceId],
        messages: [
          {
            id: 'phase1-acceptance-question',
            role: 'user',
            parts: [{ type: 'text', text: '验证真实身份链路' }],
          },
        ],
      })
      .expect(200)
      .expect((response) => {
        expect(response.text).toContain('验收通过');
      });
    expect(ai.lastRequest).toMatchObject({
      requestId,
      actorId: memberId,
      selectedSpaceIds: [spaceId],
    });

    await request(server)
      .delete(`/spaces/${spaceId}/grants/${grantId}`)
      .set('authorization', `Bearer ${admin.accessToken}`)
      .expect(204);
    await request(server)
      .get(`/spaces/${spaceId}`)
      .set('authorization', `Bearer ${member.accessToken}`)
      .expect(403);
  });
});

async function login(server: Server, username: string) {
  const response = await request(server)
    .post('/auth/login')
    .send({ username, password: PASSWORD })
    .expect(201);
  return sessionSchema.parse(response.body as unknown);
}

async function cleanup(prisma: PrismaService): Promise<void> {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: PREFIX } },
    select: { id: true },
  });
  const spaces = await prisma.knowledgeSpace.findMany({
    where: { name: { startsWith: PREFIX } },
    select: { id: true },
  });
  const resourceIds = [...users.map(({ id }) => id), ...spaces.map(({ id }) => id)];
  await prisma.spaceGrant.deleteMany({
    where: { spaceId: { in: spaces.map(({ id }) => id) } },
  });
  await prisma.document.deleteMany({
    where: { spaceId: { in: spaces.map(({ id }) => id) } },
  });
  await prisma.knowledgeSpace.deleteMany({
    where: { id: { in: spaces.map(({ id }) => id) } },
  });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [{ actorId: { in: users.map(({ id }) => id) } }, { targetId: { in: resourceIds } }],
    },
  });
  await prisma.outboxEvent.deleteMany({ where: { resourceId: { in: resourceIds } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map(({ id }) => id) } } });
}
