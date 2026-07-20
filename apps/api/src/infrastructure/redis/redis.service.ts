import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createClient } from 'redis';

import { ENVIRONMENT, type Environment } from '../config/environment';

const incrementWithExpiryScript = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`;

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly client;
  private connectionAttempt: Promise<void> | undefined;

  constructor(@Inject(ENVIRONMENT) environment: Environment) {
    this.client = createClient({
      url: environment.REDIS_URL,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 1_000,
        reconnectStrategy: false,
      },
    });
    this.client.on('error', () => {
      // Command callers handle failures explicitly. The event listener prevents an
      // unhandled EventEmitter error from terminating the API process.
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureConnected();
    } catch {
      // The API remains available, but rate-limited authentication fails closed with
      // a retryable 503 until a later command reconnects successfully.
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.isReady) {
      await this.client.close();
    } else if (this.client.isOpen) {
      this.client.destroy();
    }
  }

  async incrementWithExpiry(key: string, ttlSeconds: number): Promise<number> {
    await this.ensureConnected();
    const result = await this.client.eval(incrementWithExpiryScript, {
      keys: [key],
      arguments: [String(ttlSeconds)],
    });
    return Number(result);
  }

  async delete(key: string): Promise<void> {
    await this.ensureConnected();
    await this.client.del(key);
  }

  async get(key: string): Promise<string | null> {
    await this.ensureConnected();
    return this.client.get(key);
  }

  async setWithExpiry(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.ensureConnected();
    await this.client.set(key, value, { EX: ttlSeconds });
  }

  async publish(channel: string, message: string): Promise<void> {
    await this.ensureConnected();
    await this.client.publish(channel, message);
  }

  async streamAdd(stream: string, fields: Record<string, string>): Promise<string> {
    await this.ensureConnected();
    return this.client.xAdd(stream, '*', fields);
  }

  async ensureConsumerGroup(stream: string, group: string): Promise<void> {
    await this.ensureConnected();
    try {
      await this.client.xGroupCreate(stream, group, '0', { MKSTREAM: true });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('BUSYGROUP')) {
        throw error;
      }
    }
  }

  async streamReadGroup(input: {
    stream: string;
    group: string;
    consumer: string;
    count?: number;
    blockMilliseconds?: number;
  }): Promise<Array<{ id: string; message: Record<string, string> }>> {
    await this.ensureConnected();
    const response: unknown = await this.client.xReadGroup(
      input.group,
      input.consumer,
      { key: input.stream, id: '>' },
      {
        COUNT: input.count ?? 100,
        BLOCK: input.blockMilliseconds ?? 100,
      },
    );
    if (!Array.isArray(response)) {
      return [];
    }
    const entries: Array<{ id: string; message: Record<string, string> }> = [];
    for (const streamItem of response) {
      const stream: unknown = streamItem;
      if (!stream || typeof stream !== 'object' || !('messages' in stream)) {
        continue;
      }
      const messages: unknown = stream.messages;
      if (!Array.isArray(messages)) {
        continue;
      }
      for (const messageItem of messages) {
        const entry: unknown = messageItem;
        if (
          !entry ||
          typeof entry !== 'object' ||
          !('id' in entry) ||
          typeof entry.id !== 'string' ||
          !('message' in entry) ||
          !entry.message ||
          typeof entry.message !== 'object'
        ) {
          continue;
        }
        const message = Object.fromEntries(
          Object.entries(entry.message).filter(
            (field): field is [string, string] => typeof field[1] === 'string',
          ),
        );
        entries.push({ id: entry.id, message });
      }
    }
    return entries;
  }

  async streamAck(stream: string, group: string, id: string): Promise<void> {
    await this.ensureConnected();
    await this.client.xAck(stream, group, id);
  }

  async flushDatabase(): Promise<void> {
    await this.ensureConnected();
    await this.client.flushDb();
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.isReady) {
      return;
    }
    this.connectionAttempt ??= this.client.connect().then(() => undefined);
    try {
      await this.connectionAttempt;
    } finally {
      this.connectionAttempt = undefined;
    }
  }
}
