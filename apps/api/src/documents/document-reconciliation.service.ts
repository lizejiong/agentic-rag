import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { ENVIRONMENT, type Environment } from '../infrastructure/config/environment';
import { PrismaService } from '../infrastructure/database/prisma.service';

type RagRun = { status: string };

@Injectable()
export class DocumentReconciliationService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  onModuleInit(): void {
    if (this.environment.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.reconcileOnce().catch(() => undefined), 5 * 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async reconcileOnce(staleBefore = new Date(Date.now() - 30 * 60_000)): Promise<number> {
    const tasks = await this.prisma.importTask.findMany({
      where: { status: { in: ['QUEUED', 'RUNNING'] }, updatedAt: { lt: staleBefore } },
      take: 100,
      orderBy: { updatedAt: 'asc' },
    });
    let reconciled = 0;
    for (const task of tasks) {
      const event = await this.prisma.outboxEvent.findFirst({
        where: { taskId: task.id, type: 'document.ingestion.requested.v1' },
        orderBy: { createdAt: 'desc' },
      });
      if (!event || event.status === 'FAILED' || task.attempt >= 3) {
        await this.failStaleTask(task.id, task.versionId);
        reconciled += 1;
        continue;
      }
      const runs = await this.prisma.$queryRaw<RagRun[]>`
        SELECT status FROM "rag"."ingestion_runs"
        WHERE source_event_id = ${event.eventId}::uuid
        ORDER BY updated_at DESC LIMIT 1
      `;
      if (
        runs[0]?.status === 'RUNNING' ||
        runs[0]?.status === 'SUCCEEDED' ||
        runs[0]?.status === 'FAILED'
      ) {
        continue;
      }
      await this.prisma.$transaction([
        this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: 'PENDING',
            nextAttemptAt: new Date(),
            errorCode: 'RECONCILIATION_REPLAY',
          },
        }),
        this.prisma.importTask.update({
          where: { id: task.id },
          data: { attempt: { increment: 1 } },
        }),
      ]);
      reconciled += 1;
    }
    return reconciled;
  }

  private async failStaleTask(taskId: string, versionId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.importTask.update({
        where: { id: taskId },
        data: {
          status: 'FAILED',
          stage: 'FAILED',
          errorCode: 'INGESTION_STALLED',
          errorMessage: 'Document processing did not recover within the retry policy.',
          completedAt: new Date(),
        },
      }),
      this.prisma.documentVersion.updateMany({
        where: { id: versionId, processingStatus: { not: 'READY' } },
        data: {
          processingStatus: 'FAILED',
          errorCode: 'INGESTION_STALLED',
          errorMessage: 'Document processing did not recover within the retry policy.',
        },
      }),
    ]);
  }
}
