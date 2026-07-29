import type { ReactNode } from 'react';

import { BrowserRouter, Navigate, Route, Routes } from 'react-router';

import { LoginPage } from '../features/auth/login-page';
import { useAuth } from '../features/auth/auth-provider';
import { ChatPage } from '../features/chat/chat-page';
import { DashboardPage } from '../features/dashboard/dashboard-page';
import { DocumentListPage } from '../features/documents/document-list-page';
import { DocumentDetailPage } from '../features/documents/document-detail-page';
import { SearchTestPage } from '../features/search/search-test-page';
import { SpaceOverviewPage } from '../features/spaces/space-overview-page';
import { SpacesPage } from '../features/spaces/spaces-page';
import { SpaceMembersPage } from '../features/spaces/space-members-page';
import { PcAppShell } from './pc-app-shell';

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
          element={
            <RequireAuthentication>
              <PcAppShell />
            </RequireAuthentication>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="/spaces" element={<SpacesPage />} />
          <Route path="/spaces/:spaceId" element={<SpaceOverviewPage />} />
          <Route path="/spaces/:spaceId/documents" element={<DocumentListPage />} />
          <Route path="/spaces/:spaceId/members" element={<SpaceMembersPage />} />
          <Route path="/documents/:documentId" element={<DocumentDetailPage />} />
          <Route path="/chat" element={<ChatPage />} />
        </Route>
        <Route
          path="/search-test"
          element={
            <RequireAuthentication>
              <SearchTestPage />
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
  return <Navigate replace to={auth.status === 'authenticated' ? '/' : '/login'} />;
}

function AnonymousOnly({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.status === 'loading') {
    return <SessionLoading />;
  }
  return auth.status === 'anonymous' ? children : <Navigate replace to="/" />;
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
