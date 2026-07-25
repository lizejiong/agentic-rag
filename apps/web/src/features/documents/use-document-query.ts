import { useQuery } from '@tanstack/react-query';

import type { Fetcher } from '../../shared/api/request-json';
import { getDocument } from './documents-api';

export const documentQueryKey = (documentId: string) => ['document', documentId] as const;

export function useDocumentQuery(fetcher: Fetcher, documentId: string) {
  return useQuery({
    queryKey: documentQueryKey(documentId),
    queryFn: ({ signal }) => getDocument(fetcher, documentId, signal),
    enabled: Boolean(documentId),
    refetchInterval: (query) =>
      query.state.data?.importTasks.some((t) =>
        ['QUEUED', 'RUNNING'].includes(t.status),
      )
        ? 2_000
        : false,
  });
}
