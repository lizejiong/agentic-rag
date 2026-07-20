import { createHash } from 'node:crypto';

import { HttpException, HttpStatus, Injectable, ServiceUnavailableException } from '@nestjs/common';

import { RedisService } from '../infrastructure/redis/redis.service';

const WINDOW_SECONDS = 5 * 60;
const MAX_ATTEMPTS = 10;

@Injectable()
export class LoginRateLimiter {
  constructor(private readonly redis: RedisService) {}

  async consume(ip: string, username: string): Promise<void> {
    try {
      const attempts = await this.redis.incrementWithExpiry(this.key(ip, username), WINDOW_SECONDS);
      if (attempts > MAX_ATTEMPTS) {
        throw new HttpException('LOGIN_RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS);
      }
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 429) {
        throw error;
      }
      throw new ServiceUnavailableException('LOGIN_RATE_LIMIT_UNAVAILABLE');
    }
  }

  async reset(ip: string, username: string): Promise<void> {
    try {
      await this.redis.delete(this.key(ip, username));
    } catch {
      throw new ServiceUnavailableException('LOGIN_RATE_LIMIT_UNAVAILABLE');
    }
  }

  private key(ip: string, username: string): string {
    const subject = `${ip.trim() || 'unknown'}\0${username.trim().toLowerCase()}`;
    const digest = createHash('sha256').update(subject).digest('hex');
    return `auth:login-attempt:${digest}`;
  }
}
