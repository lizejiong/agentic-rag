import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ApiError } from './api-error';
import { requestJson } from './request-json';

describe('requestJson', () => {
  it('validates a successful response and supplies correlation headers', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('x-request-id')).toBeTruthy();
      expect(headers.get('x-trace-id')).toBeTruthy();
      expect(headers.get('x-client')).toBe('web');
      return Response.json({ id: 'space-1' });
    });

    const result = await requestJson({
      schema: z.object({ id: z.string() }),
      input: '/spaces',
      init: { headers: { 'x-client': 'web' } },
      fetcher,
    });

    expect(result).toEqual({ id: 'space-1' });
  });

  it('normalizes an API error and preserves the server request identifier', async () => {
    const fetcher = vi.fn(async () =>
      Response.json(
        { message: ['INVALID_NAME', 'INVALID_PASSWORD'] },
        { status: 400, headers: { 'x-request-id': 'request-from-server' } },
      ),
    );

    await expect(
      requestJson({ schema: z.object({}), input: '/auth/login', fetcher }),
    ).rejects.toEqual(
      new ApiError(400, 'request-from-server', 'INVALID_NAME, INVALID_PASSWORD'),
    );
  });
});
