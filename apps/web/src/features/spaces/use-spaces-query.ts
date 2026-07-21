import { useQuery } from '@tanstack/react-query';

import type { Fetcher } from '../../shared/api/request-json';
import { listVisibleSpaces } from './spaces-api';

export const visibleSpacesQueryKey = ['spaces', 'visible'] as const;

export function useSpacesQuery(fetcher: Fetcher) {
  return useQuery({
    queryKey: visibleSpacesQueryKey,
    queryFn: ({ signal }) => listVisibleSpaces(fetcher, signal),
  });
}
