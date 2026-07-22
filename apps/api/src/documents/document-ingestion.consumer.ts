import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { ENVIRONMENT, type Environment } from '../infrastructure/config/environment';
import type { Prisma } from '../generated/prisma/client';
import { StreamConsumer } from '../outbox/stream.consumer';
import type { OutboxEnvelope } from '../outbox/outbox.types';
import { DocumentPublicationService } from './document-publication.service';

const GROUP = 'atlas-api-document-ingestion';

@Injectable()
export class DocumentIngestionConsumer implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;
  private polling = false;
  private readonly consumerName = `api-${process.pid}`;

  constructor(
    private readonly stream: StreamConsumer,
    private readonly publication: DocumentPublicationService,
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

  consumeOnce() {
    return this.stream.consumeOnce({
      group: GROUP,
      consumer: this.consumerName,
      handler: async (transaction, envelope) => this.handle(transaction, envelope),
    });
  }

  private async handle(
    transaction: Prisma.TransactionClient,
    envelope: OutboxEnvelope<Record<string, unknown>>,
  ): Promise<void> {
    if (envelope.type === 'document.ingestion.progressed.v1') {
      await this.publication.applyProgress(transaction, envelope.payload);
    } else if (envelope.type === 'document.ingestion.completed.v1') {
      await this.publication.publishCompleted(transaction, envelope.payload);
    } else if (envelope.type === 'document.ingestion.failed.v1') {
      await this.publication.publishFailed(transaction, envelope.payload);
    }
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      await this.consumeOnce();
    } catch {
      // Redis keeps unacknowledged events pending; the next poll retries safely.
    } finally {
      this.polling = false;
    }
  }
}
