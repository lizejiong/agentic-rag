import type { ReactNode } from 'react';

import { BrowserRouter, Navigate, Route, Routes } from 'react-router';

import { LoginPage } from '../features/auth/login-page';
import { useAuth } from '../features/auth/auth-provider';
import { ChatPage } from '../features/chat/chat-page';

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<SessionRedirect />} />
        <Route
          path="/login"
          element={
            <AnonymousOnly>
              <LoginPage />
            </AnonymousOnly>
          }
        />
        <Route
          path="/chat"
          element={
            <RequireAuthentication>
              <ChatPage />
            </RequireAuthentication>
          }
        />
        <Route path="*" element={<SessionRedirect />} />
      </Routes>
    </BrowserRouter>
  );
}

function SessionRedirect() {
  const auth = useAuth();
  if (auth.status === 'loading') {
    return <SessionLoading />;
  }
  return <Navigate replace to={auth.status === 'authenticated' ? '/chat' : '/login'} />;
}

function AnonymousOnly({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.status === 'loading') {
    return <SessionLoading />;
  }
  return auth.status === 'anonymous' ? children : <Navigate replace to="/chat" />;
}

function RequireAuthentication({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.status === 'loading') {
    return <SessionLoading />;
  }
  return auth.status === 'authenticated' ? children : <Navigate replace to="/login" />;
}

function SessionLoading() {
  return (
    <main className="session-loading" aria-live="polite">
      正在恢复安全会话…
    </main>
  );
}
