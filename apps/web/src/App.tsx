import { AuthProvider, useAuth } from './features/auth/auth-provider';
import { LoginPage } from './features/auth/login-page';
import { ChatPage } from './features/chat/chat-page';

export function App() {
  return (
    <AuthProvider>
      <AuthenticatedApplication />
    </AuthProvider>
  );
}

function AuthenticatedApplication() {
  const auth = useAuth();
  if (auth.status === 'loading') {
    return (
      <main className="session-loading" aria-live="polite">
        正在恢复安全会话…
      </main>
    );
  }
  return auth.status === 'authenticated' ? <ChatPage /> : <LoginPage />;
}
