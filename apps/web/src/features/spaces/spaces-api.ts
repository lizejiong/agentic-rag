import type { Fetcher } from '../../shared/api/request-json';
import { z } from 'zod';
import { requestJson } from '../../shared/api/request-json';
import { visibleSpacesSchema } from './space-contract';

export function listVisibleSpaces(fetcher: Fetcher, signal?: AbortSignal) {
  return requestJson({
    schema: visibleSpacesSchema,
    input: '/api/spaces',
    init: signal ? { signal } : {},
    fetcher,
  });
}

export function createSpace(fetcher: Fetcher, input: { name: string; description?: string }) {
  return requestJson({ schema: z.object({ id: z.uuid() }), input: '/api/spaces', fetcher, init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) } });
}
