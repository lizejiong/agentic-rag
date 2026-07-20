import { z } from 'zod';

const userSchema = z.object({
  id: z.uuid(),
  username: z.string(),
  role: z.enum(['ADMIN', 'MEMBER']),
  tokenVersion: z.number().int().nonnegative(),
});
const sessionSchema = z.object({
  accessToken: z.string().min(1),
  user: userSchema,
});

export type AuthUser = z.infer<typeof userSchema>;
export type AuthSession = z.infer<typeof sessionSchema>;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly requestId: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let refreshInFlight: Promise<AuthSession> | undefined;

export async function login(username: string, password: string): Promise<AuthSession> {
  const requestId = crypto.randomUUID();
  const response = await fetch('/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      'x-request-id': requestId,
      'x-trace-id': crypto.randomUUID(),
    },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) {
    throw new ApiError(response.status, requestId, await readErrorCode(response));
  }
  return sessionSchema.parse(await response.json());
}

export function refreshSession(): Promise<AuthSession> {
  refreshInFlight ??= requestSessionRefresh().finally(() => {
    refreshInFlight = undefined;
  });
  return refreshInFlight;
}

export async function logout(): Promise<void> {
  await fetch('/auth/logout', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'x-request-id': crypto.randomUUID(),
      'x-trace-id': crypto.randomUUID(),
    },
  });
}

async function requestSessionRefresh(): Promise<AuthSession> {
  const response = await fetch('/auth/refresh', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'x-request-id': crypto.randomUUID(),
      'x-trace-id': crypto.randomUUID(),
    },
  });
  if (!response.ok) {
    throw new ApiError(response.status, 'session-refresh', await readErrorCode(response));
  }
  return sessionSchema.parse(await response.json());
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
