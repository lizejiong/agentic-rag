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
