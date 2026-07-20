import { HttpException, ServiceUnavailableException } from '@nestjs/common';

import type { RedisService } from '../infrastructure/redis/redis.service';
import { LoginRateLimiter } from './login-rate-limiter';

describe('LoginRateLimiter', () => {
  const incrementWithExpiry = jest.fn<Promise<number>, [string, number]>();
  const deleteKey = jest.fn<Promise<void>, [string]>();
  const limiter = new LoginRateLimiter({
    incrementWithExpiry,
    delete: deleteKey,
  } as unknown as RedisService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows ten attempts and rejects the eleventh without storing identity data', async () => {
    incrementWithExpiry.mockResolvedValueOnce(10).mockResolvedValueOnce(11);

    await expect(limiter.consume('192.0.2.10', 'Alice')).resolves.toBeUndefined();
    await expect(limiter.consume('192.0.2.10', 'Alice')).rejects.toMatchObject({
      status: 429,
    });

    const key = String(incrementWithExpiry.mock.calls[0]?.[0]);
    expect(key).toMatch(/^auth:login-attempt:[a-f0-9]{64}$/);
    expect(key).not.toContain('Alice');
    expect(key).not.toContain('192.0.2.10');
  });

  it('fails closed with a retryable 503 when Redis is unavailable', async () => {
    incrementWithExpiry.mockRejectedValue(new Error('redis unavailable'));

    await expect(limiter.consume('192.0.2.10', 'alice')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('clears the attempt window after successful authentication', async () => {
    deleteKey.mockResolvedValue(undefined);

    await limiter.reset('192.0.2.10', 'Alice');

    expect(deleteKey).toHaveBeenCalledWith(expect.stringMatching(/^auth:login-attempt:/));
  });

  it('preserves the explicit 429 instead of converting it to 503', async () => {
    incrementWithExpiry.mockResolvedValue(11);

    await expect(limiter.consume('192.0.2.10', 'alice')).rejects.toBeInstanceOf(HttpException);
    await expect(limiter.consume('192.0.2.10', 'alice')).rejects.not.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
