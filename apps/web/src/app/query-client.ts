import { QueryClient } from '@tanstack/react-query';

function hasHttpStatus(error: unknown): error is { status: number } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
  );
}

export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) =>
          failureCount < 1 && (!hasHttpStatus(error) || error.status >= 500),
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export const queryClient = createAppQueryClient();
