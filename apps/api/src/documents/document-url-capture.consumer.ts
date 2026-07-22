import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { documentUrlCaptureRequestedPayloadSchema } from '@rag/contracts';
import { z } from 'zod';

import { PrismaService } from '../infrastructure/database/prisma.service';
import { ENVIRONMENT, type Environment } from '../infrastructure/config/environment';
import { RedisService } from '../infrastructure/redis/redis.service';
import { DocumentUrlCaptureService } from './document-url-capture.service';
import { UrlCaptureError } from './url-capture.error';

const STREAM = 'atlas:events';
const GROUP = 'atlas-api-url-capture';
const envelopeSchema = z.object({
  type: z.string(),
  traceId: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

@Injectable()
export class DocumentUrlCaptureConsumer implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private polling = false;
  private readonly consumerName = `url-api-${process.pid}`;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly captureService: DocumentUrlCaptureService,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  onModuleInit(): void {
    if (this.environment.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.poll(), 500);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async consumeOnce(): Promise<number> {
    await this.redis.ensureConsumerGroup(STREAM, GROUP);
    let entries = await this.redis.streamAutoClaim({
      stream: STREAM,
      group: GROUP,
      consumer: this.consumerName,
      minIdleMilliseconds: 60_000,
      count: 20,
    });
    if (entries.length === 0) {
      entries = await this.redis.streamReadGroup({
        stream: STREAM,
        group: GROUP,
        consumer: this.consumerName,
        count: 20,
      });
    }
    for (const entry of entries) await this.handle(entry);
    return entries.length;
  }

  private async handle(entry: { id: string; message: Record<string, string> }): Promise<void> {
    const rawEnvelope = entry.message.envelope;
    if (!rawEnvelope) {
      await this.redis.streamAck(STREAM, GROUP, entry.id);
      return;
    }
    let envelope: z.infer<typeof envelopeSchema>;
    try {
      envelope = envelopeSchema.parse(JSON.parse(rawEnvelope) as unknown);
    } catch {
      await this.redis.streamAck(STREAM, GROUP, entry.id);
      return;
    }
    if (envelope.type !== 'document.url.capture.requested.v1') {
      await this.redis.streamAck(STREAM, GROUP, entry.id);
      return;
    }
    const parsedPayload = documentUrlCaptureRequestedPayloadSchema.safeParse(envelope.payload);
    if (!parsedPayload.success) {
      await this.redis.streamAck(STREAM, GROUP, entry.id);
      return;
    }
    const payload = parsedPayload.data;
    const task = await this.prisma.importTask.findUnique({ where: { id: payload.importId } });
    if (!task || ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(task.status)) {
      await this.redis.streamAck(STREAM, GROUP, entry.id);
      return;
    }
    if (task.stage !== 'FETCHING') {
      await this.redis.streamAck(STREAM, GROUP, entry.id);
      return;
    }
    if (task.status === 'QUEUED') {
      const claimed = await this.prisma.importTask.updateMany({
        where: { id: task.id, status: 'QUEUED', stage: 'FETCHING' },
        data: {
          status: 'RUNNING',
          progress: 10,
          attempt: { increment: 1 },
          startedAt: new Date(),
          errorCode: null,
          errorMessage: null,
        },
      });
      if (claimed.count !== 1) return;
    } else if (task.status !== 'RUNNING') {
      await this.redis.streamAck(STREAM, GROUP, entry.id);
      return;
    }

    try {
      await this.captureService.capture(payload, envelope.traceId);
      await this.redis.streamAck(STREAM, GROUP, entry.id);
    } catch (error) {
      const current = await this.prisma.importTask.findUnique({ where: { id: task.id } });
      const captureError =
        error instanceof UrlCaptureError
          ? error
          : new UrlCaptureError(
              'URL_CAPTURE_INTERNAL_ERROR',
              'The page capture failed because of an internal error.',
              true,
              { cause: error },
            );
      if (captureError.retryable && (current?.attempt ?? 1) < 3) {
        await this.prisma.importTask.updateMany({
          where: { id: task.id, status: 'RUNNING', stage: 'FETCHING' },
          data: {
            status: 'QUEUED',
            errorCode: captureError.code,
            errorMessage: captureError.message,
          },
        });
        return;
      }
      await this.prisma.$transaction(async (transaction) => {
        await transaction.documentVersion.updateMany({
          where: { id: payload.versionId, processingStatus: 'FETCHING' },
          data: {
            processingStatus: 'FAILED',
            errorCode: captureError.code,
            errorMessage: captureError.message,
            sourceCheckedAt: new Date(),
          },
        });
        await transaction.importTask.updateMany({
          where: { id: task.id, status: { in: ['QUEUED', 'RUNNING'] } },
          data: {
            status: 'FAILED',
            stage: 'FAILED',
            errorCode: captureError.code,
            errorMessage: captureError.message,
            completedAt: new Date(),
          },
        });
      });
      await this.redis.streamAck(STREAM, GROUP, entry.id);
    }
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      await this.consumeOnce();
    } catch {
      // Pending entries are reclaimed after the idle timeout; PostgreSQL keeps task state durable.
    } finally {
      this.polling = false;
    }
  }
}
