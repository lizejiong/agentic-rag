import { AuditContextService } from '../audit/audit-context.service';
import type { Prisma } from '../generated/prisma/client';
import { OutboxService } from './outbox.service';

describe('OutboxService', () => {
  it('writes the stable event envelope fields to the supplied transaction', async () => {
    const context = new AuditContextService();
    const create = jest.fn().mockResolvedValue({ id: 'row-id' });
    const transaction = {
      outboxEvent: { create },
    } as unknown as Prisma.TransactionClient;
    const service = new OutboxService(context);

    await context.run(
      {
        requestId: 'request-1',
        traceId: 'trace-1',
      },
      () =>
        service.enqueue(transaction, {
          type: 'space.updated',
          resourceId: 'space-1',
          resourceVersion: 7,
          payload: { changedFields: ['name'] },
        }),
    );

    expect(create).toHaveBeenCalledWith({
      // Jest asymmetric matchers are intentionally typed as any.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        eventId: expect.any(String),
        type: 'space.updated',
        resourceId: 'space-1',
        resourceVersion: 7,
        attempt: 0,
        traceId: 'trace-1',
        payload: { changedFields: ['name'] },
      }),
    });
  });
});
