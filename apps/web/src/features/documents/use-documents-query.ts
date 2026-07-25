import { useQuery } from '@tanstack/react-query';

import type { Fetcher } from '../../shared/api/request-json';
import { listDocuments } from './documents-api';

export const documentsQueryKey = (
  spaceId: string,
  filters?: { search?: string; status?: string },
) => ['spaces', spaceId, 'documents', filters] as const;

export function useDocumentsQuery(
  fetcher: Fetcher,
  spaceId: string,
  filters?: { search?: string; status?: string },
) {
  return useQuery({
    queryKey: documentsQueryKey(spaceId, filters),
    queryFn: ({ signal }) => listDocuments(fetcher, spaceId, filters, signal),
    enabled: Boolean(spaceId),
    refetchInterval: (query) =>
      query.state.data?.some((document) =>
        ['QUEUED', 'RUNNING'].includes(document.latestImport?.status ?? ''),
      )
        ? 2_000
        : false,
  });
}
