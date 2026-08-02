import { BarChart3, Database, FlaskConical, LogOut, MessageSquare, Settings } from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-provider';

const navigation = [
  { to: '/', label: '工作台', icon: BarChart3, end: true },
  { to: '/spaces', label: '知识空间', icon: Database },
  { to: '/chat', label: '智能问答', icon: MessageSquare },
];

export function PcAppShell() {
  const auth = useAuth();
  const location = useLocation();
  const isChatPage = location.pathname === '/chat';

  return (
    <div
      className={`min-w-[1180px] bg-slate-50 text-slate-900 ${
        isChatPage ? 'flex h-screen flex-col overflow-hidden' : 'min-h-screen'
      }`}
    >
      <header className="shrink-0 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-8">
          <NavLink className="flex items-center gap-3" to="/">
            <span className="grid size-8 place-items-center rounded-md bg-blue-700 text-sm font-semibold text-white">
              A
            </span>
            <span className="text-sm font-semibold tracking-tight">Atlas RAG</span>
          </NavLink>
          <nav className="flex h-full items-center gap-1" aria-label="主导航">
            {[...navigation, ...(auth.user?.role === 'ADMIN' ? [{ to: '/evaluation', label: '评测中心', icon: FlaskConical }] : [])].map(({ to, label, icon: Icon, end }) => (
              <NavLink
                className={({ isActive }) =>
                  `flex h-full items-center gap-2 border-b-2 px-4 text-sm transition-colors ${
                    isActive
                      ? 'border-blue-700 text-blue-700'
                      : 'border-transparent text-slate-500 hover:text-slate-900'
                  }`
                }
                {...(end ? { end: true } : {})}
                key={to}
                to={to}
              >
                <Icon size={16} aria-hidden="true" />
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-600">{auth.user?.username}</span>
            {auth.user?.role === 'ADMIN' ? (
              <Button aria-label="系统管理" size="icon" variant="ghost">
                <Settings size={17} aria-hidden="true" />
              </Button>
            ) : null}
            <Button aria-label="退出登录" onClick={() => void auth.logout()} size="icon" variant="ghost">
              <LogOut size={17} aria-hidden="true" />
            </Button>
          </div>
        </div>
      </header>
      <main
        className={
          isChatPage
            ? 'min-h-0 flex-1 overflow-hidden'
            : 'mx-auto max-w-[1440px] px-8 py-8'
        }
      >
        <Outlet />
      </main>
    </div>
  );
}
