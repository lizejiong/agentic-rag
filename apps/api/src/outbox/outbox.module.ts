import { Global, Module } from '@nestjs/common';

import { OutboxService } from './outbox.service';
import { OutboxPublisher } from './outbox.publisher';
import { StreamConsumer } from './stream.consumer';

@Global()
@Module({
  providers: [OutboxService, OutboxPublisher, StreamConsumer],
  exports: [OutboxService, OutboxPublisher, StreamConsumer],
})
export class OutboxModule {}
