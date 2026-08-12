import type { ReactNode } from 'react';

import { BrowserRouter, Navigate, Route, Routes } from 'react-router';

import { LoginPage } from '../features/auth/login-page';
import { useAuth } from '../features/auth/auth-provider';
import { ChatPage } from '../features/chat/chat-page';
import { DashboardPage } from '../features/dashboard/dashboard-page';
import { DocumentDetailPage } from '../features/documents/document-detail-page';
import { DocumentListPage } from '../features/documents/document-list-page';
import { EvaluationPage } from '../features/evaluation/evaluation-page';
import { GraphPage } from '../features/graph/graph-page';
import { SearchTestPage } from '../features/search/search-test-page';
import { SpaceMembersPage } from '../features/spaces/space-members-page';
import { SpaceOverviewPage } from '../features/spaces/space-overview-page';
import { SpacesPage } from '../features/spaces/spaces-page';
import { PcAppShell } from './pc-app-shell';

export function AppRouter() {
  return <BrowserRouter><Routes><Route element={<SessionRedirect />} path="/" /><Route element={<AnonymousOnly><LoginPage /></AnonymousOnly>} path="/login" /><Route element={<RequireAuthentication><PcAppShell /></RequireAuthentication>}><Route element={<DashboardPage />} index /><Route element={<SpacesPage />} path="/spaces" /><Route element={<SpaceOverviewPage />} path="/spaces/:spaceId" /><Route element={<DocumentListPage />} path="/spaces/:spaceId/documents" /><Route element={<SpaceMembersPage />} path="/spaces/:spaceId/members" /><Route element={<GraphPage />} path="/spaces/:spaceId/graph" /><Route element={<DocumentDetailPage />} path="/documents/:documentId" /><Route element={<ChatPage />} path="/chat" /><Route element={<EvaluationPage />} path="/evaluation" /></Route><Route element={<RequireAuthentication><SearchTestPage /></RequireAuthentication>} path="/search-test" /><Route element={<SessionRedirect />} path="*" /></Routes></BrowserRouter>;
}
function SessionRedirect() { const auth = useAuth(); if (auth.status === 'loading') return <SessionLoading />; return <Navigate replace to={auth.status === 'authenticated' ? '/' : '/login'} />; }
function AnonymousOnly({ children }: { children: ReactNode }) { const auth = useAuth(); if (auth.status === 'loading') return <SessionLoading />; return auth.status === 'anonymous' ? children : <Navigate replace to="/" />; }
function RequireAuthentication({ children }: { children: ReactNode }) { const auth = useAuth(); if (auth.status === 'loading') return <SessionLoading />; return auth.status === 'authenticated' ? children : <Navigate replace to="/login" />; }
function SessionLoading() { return <main aria-live="polite" className="grid min-h-screen place-items-center bg-slate-50 p-6 text-slate-700"><div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm shadow-sm"><span className="size-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-700" />正在恢复安全会话…</div></main>; }
