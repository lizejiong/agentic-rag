import type { Fetcher } from '../../shared/api/request-json';
import { z } from 'zod';
import { requestJson } from '../../shared/api/request-json';
import { visibleSpaceSchema, visibleSpacesSchema } from './space-contract';

export function listVisibleSpaces(fetcher: Fetcher, signal?: AbortSignal) {
  return requestJson({
    schema: visibleSpacesSchema,
    input: '/api/spaces',
    init: signal ? { signal } : {},
    fetcher,
  });
}

export function createSpace(fetcher: Fetcher, input: { name: string; description?: string }) {
  return requestJson({
    schema: z.object({ id: z.uuid() }),
    input: '/api/spaces',
    fetcher,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  });
}

export function updateSpace(
  fetcher: Fetcher,
  spaceId: string,
  input: { embeddingEnabled?: boolean; rerankerEnabled?: boolean; llmEnabled?: boolean; graphExtractionEnabled?: boolean },
) {
  return requestJson({
    schema: visibleSpaceSchema,
    input: `/api/spaces/${spaceId}`,
    fetcher,
    init: {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  });
}

export async function deleteSpace(fetcher: Fetcher, spaceId: string): Promise<void> {
  const response = await fetcher(`/api/spaces/${spaceId}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(`DELETE_SPACE_HTTP_${response.status}`);
}
