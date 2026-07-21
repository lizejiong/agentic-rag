import type { Fetcher } from '../../shared/api/request-json';
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
