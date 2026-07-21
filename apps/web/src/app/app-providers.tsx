import { type PropsWithChildren, useEffect } from 'react';

import { QueryClientProvider } from '@tanstack/react-query';

import { AuthProvider, useAuth } from '../features/auth/auth-provider';
import { queryClient } from './query-client';

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SessionQueryBoundary>{children}</SessionQueryBoundary>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function SessionQueryBoundary({ children }: PropsWithChildren) {
  const auth = useAuth();

  useEffect(() => {
    if (auth.status === 'anonymous') {
      queryClient.clear();
    }
  }, [auth.status]);

  return children;
}
