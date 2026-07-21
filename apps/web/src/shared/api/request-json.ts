import { z, type ZodType } from 'zod';

import { ApiError } from './api-error';

export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createRequestHeaders(headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  if (!result.has('x-request-id')) {
    result.set('x-request-id', crypto.randomUUID());
  }
  if (!result.has('x-trace-id')) {
    result.set('x-trace-id', crypto.randomUUID());
  }
  return result;
}

export async function requestJson<T>({
  schema,
  input,
  init = {},
  fetcher = fetch,
}: {
  schema: ZodType<T>;
  input: RequestInfo | URL;
  init?: RequestInit;
  fetcher?: Fetcher;
}): Promise<T> {
  const headers = createRequestHeaders(init.headers);
  const response = await fetcher(input, { ...init, headers });
  if (!response.ok) {
    throw new ApiError(
      response.status,
      response.headers.get('x-request-id') ?? headers.get('x-request-id') ?? 'unknown-request',
      await readErrorCode(response),
    );
  }
  return schema.parse(await response.json());
}

async function readErrorCode(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => undefined);
  const parsed = z
    .object({ message: z.union([z.string(), z.array(z.string())]).optional() })
    .safeParse(body);
  if (!parsed.success || !parsed.data.message) {
    return `HTTP_${response.status}`;
  }
  return Array.isArray(parsed.data.message) ? parsed.data.message.join(', ') : parsed.data.message;
}
