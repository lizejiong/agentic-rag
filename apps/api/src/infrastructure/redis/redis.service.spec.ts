import type { Environment } from '../config/environment';
import { RedisService } from './redis.service';

describe('RedisService', () => {
  it('allows API initialization but rejects commands while Redis is unavailable', async () => {
    const redis = new RedisService({
      REDIS_URL: 'redis://127.0.0.1:1',
    } as Environment);

    await expect(redis.onModuleInit()).resolves.toBeUndefined();
    await expect(redis.incrementWithExpiry('test:key', 30)).rejects.toBeDefined();
    await redis.onModuleDestroy();
  });
});
