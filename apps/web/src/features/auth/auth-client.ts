import { z } from 'zod';

import { createRequestHeaders, requestJson } from '../../shared/api/request-json';

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

let refreshInFlight: Promise<AuthSession> | undefined;

export function login(username: string, password: string): Promise<AuthSession> {
  return requestJson({
    schema: sessionSchema,
    input: '/auth/login',
    init: {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    },
  });
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
    headers: createRequestHeaders(),
  });
}

function requestSessionRefresh(): Promise<AuthSession> {
  return requestJson({
    schema: sessionSchema,
    input: '/auth/refresh',
    init: {
      method: 'POST',
      credentials: 'include',
    },
  });
}
