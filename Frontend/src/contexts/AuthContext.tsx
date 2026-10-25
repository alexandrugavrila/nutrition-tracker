import React, {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from 'react';

import { createAccountScope, type AccountScope } from '@/contexts/AccountScope';
import { clearLegacyStorage } from '@/utils/accountStorage';
import apiClient from '@/apiClient';

export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
  is_active: boolean;
  is_admin: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  scope: AccountScope | null;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

interface AuthStatusResponse {
  authenticated: boolean;
  user: AuthUser | null;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used within an AuthProvider.');
  }
  return value;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<AccountScope | null>(null);
  const scopeRef = useRef<AccountScope | null>(null);
  const revision = useRef(0);
  const mutating = useRef(false);
  const mounted = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);

  const suspend = useCallback(() => {
    scopeRef.current?.invalidate();
    scopeRef.current = null;
    setScope(null);
    setLoading(true);
    return ++revision.current;
  }, []);

  const refresh = useCallback(async function refreshSession(): Promise<void> {
    if (mutating.current) return;
    const ticket = suspend();
    try {
      const { data } = await apiClient.path('/api/auth/me').method('get').create()({});
      if (!mounted.current || ticket !== revision.current) return;
      const status = data as AuthStatusResponse;
      const next = status.authenticated ? status.user : null;
      setUser(next);
      if (next) {
        const active = createAccountScope(next.id, () => {
          void refreshSession();
        });
        scopeRef.current = active;
        setScope(active);
      }
    } catch {
      // An unavailable identity check must never expose previously loaded content.
      if (mounted.current && ticket === revision.current) setUser(null);
    } finally {
      if (mounted.current && ticket === revision.current) setLoading(false);
    }
  }, [suspend]);

  const announce = useCallback(() => {
    try {
      channel.current?.postMessage('session-changed');
    } catch {
      /* use storage fallback */
    }
    try {
      localStorage.setItem('nutrition:session-change', crypto.randomUUID());
    } catch {
      /* storage can be unavailable */
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    clearLegacyStorage();
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel.current = new BroadcastChannel('nutrition-session');
        channel.current.onmessage = () => {
          void refresh();
        };
      } catch {
        channel.current = null;
      }
    }
    const focus = () => {
      if (document.visibilityState !== 'hidden') void refresh();
    };
    const hidden = () => {
      if (document.visibilityState === 'hidden') suspend();
      else void refresh();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === 'nutrition:session-change') void refresh();
    };
    window.addEventListener('focus', focus);
    window.addEventListener('pageshow', focus);
    window.addEventListener('pagehide', suspend);
    window.addEventListener('storage', storage);
    document.addEventListener('visibilitychange', hidden);
    void refresh();
    return () => {
      mounted.current = false;
      ++revision.current;
      scopeRef.current?.invalidate();
      channel.current?.close();
      channel.current = null;
      window.removeEventListener('focus', focus);
      window.removeEventListener('pageshow', focus);
      window.removeEventListener('pagehide', suspend);
      window.removeEventListener('storage', storage);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [refresh, suspend]);

  const login = useCallback(
    async (email: string, password: string) => {
      setError(null);
      mutating.current = true;
      ++revision.current;
      scopeRef.current?.invalidate();
      try {
        await apiClient.path('/api/auth/login').method('post').create()({
          body: { email, password },
        });
        announce();
      } finally {
        mutating.current = false;
      }
      await refresh();
    },
    [announce, refresh],
  );

  const logout = useCallback(async () => {
    setError(null);
    const outgoing = scopeRef.current;
    suspend();
    setUser(null);
    mutating.current = true;
    announce();
    try {
      // Keep the expected identity even after invalidating all application requests.
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: outgoing ? { 'X-Account-ID': outgoing.userId } : {},
      });
      if (!response.ok) throw new Error('Sign out could not be confirmed. Please try again.');
    } catch {
      setError('Sign out could not be confirmed. Please try again.');
    } finally {
      mutating.current = false;
      announce();
      await refresh();
    }
  }, [announce, refresh, suspend]);

  return (
    <AuthContext.Provider value={{ user, loading, scope, error, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}
