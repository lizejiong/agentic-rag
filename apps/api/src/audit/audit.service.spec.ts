import type { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../infrastructure/database/prisma.service';
import { AuditContextService } from './audit-context.service';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  it('records request identity and removes sensitive metadata recursively', async () => {
    const context = new AuditContextService();
    const create = jest.fn().mockResolvedValue({ id: 'audit-id' });
    const transaction = {
      auditLog: { create },
    } as unknown as Prisma.TransactionClient;
    const service = new AuditService({} as PrismaService, context);

    await context.run(
      {
        actor: {
          id: '1718f35b-5225-433f-8d62-c5de0d399fea',
          username: 'admin',
          role: 'ADMIN',
          tokenVersion: 0,
        },
        sourceIp: '127.0.0.1',
        requestId: 'request-1',
        traceId: 'trace-1',
      },
      () =>
        service.write(transaction, {
          action: 'user.create',
          targetType: 'USER',
          targetId: 'user-1',
          metadata: {
            username: 'member',
            password: 'must-not-survive',
            nested: { accessToken: 'must-not-survive', safe: true },
          },
        }),
    );

    expect(create).toHaveBeenCalledWith({
      // Jest asymmetric matchers are intentionally typed as any.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: expect.objectContaining({
        actorUsername: 'admin',
        sourceIp: '127.0.0.1',
        requestId: 'request-1',
        traceId: 'trace-1',
        metadata: {
          username: 'member',
          nested: { safe: true },
        },
      }),
    });
  });
});
