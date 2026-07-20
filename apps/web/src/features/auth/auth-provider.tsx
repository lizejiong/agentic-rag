import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  type AuthSession,
  type AuthUser,
  login as requestLogin,
  logout as requestLogout,
  refreshSession,
} from './auth-client';

type AuthStatus = 'loading' | 'anonymous' | 'authenticated';

type AuthContextValue = {
  status: AuthStatus;
  user?: AuthUser;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  getAccessToken: () => string | undefined;
  refreshAccessToken: () => Promise<string | undefined>;
  authorizedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser>();
  const accessToken = useRef<string | undefined>(undefined);

  const applySession = useCallback((session: AuthSession) => {
    accessToken.current = session.accessToken;
    setUser(session.user);
    setStatus('authenticated');
    return session.accessToken;
  }, []);

  const clearSession = useCallback(() => {
    accessToken.current = undefined;
    setUser(undefined);
    setStatus('anonymous');
  }, []);

  const refreshAccessToken = useCallback(async (): Promise<string | undefined> => {
    try {
      return applySession(await refreshSession());
    } catch {
      clearSession();
      return undefined;
    }
  }, [applySession, clearSession]);

  useEffect(() => {
    void refreshAccessToken();
  }, [refreshAccessToken]);

  const login = useCallback(
    async (username: string, password: string) => {
      applySession(await requestLogin(username, password));
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    try {
      await requestLogout();
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const getAccessToken = useCallback(() => accessToken.current, []);

  const authorizedFetch = useCallback(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const send = (token: string | undefined) =>
        fetch(input, {
          ...init,
          credentials: 'include',
          headers: {
            ...Object.fromEntries(new Headers(init.headers).entries()),
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
        });
      const first = await send(accessToken.current);
      if (first.status !== 401) {
        return first;
      }
      const refreshed = await refreshAccessToken();
      return refreshed ? send(refreshed) : first;
    },
    [refreshAccessToken],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      ...(user ? { user } : {}),
      login,
      logout,
      getAccessToken,
      refreshAccessToken,
      authorizedFetch,
    }),
    [authorizedFetch, getAccessToken, login, logout, refreshAccessToken, status, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
