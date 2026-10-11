import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import { AuthUser, getCurrentUser, logout as endSession } from '../../services/api';

interface AuthContextValue {
  enabled: boolean;
  loading: boolean;
  user: AuthUser | null;
  isAdmin: boolean;
  refresh: () => Promise<void>;
  clearUser: (message?: string) => void;
  authError: string | null;
  credentialError: string | null;
  setUser: (user: AuthUser) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const authEnabled = import.meta.env.VITE_AUTH_ENABLED === 'true';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(authEnabled);
  const [user, setUser] = useState<AuthUser | null>(null);

  const [authError, setAuthError] = useState<string | null>(null);
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const generation = useRef(0);
  const invalidate = useCallback(() => { generation.current += 1; setLoading(false); }, []);
  const acceptUser = useCallback((identity: AuthUser) => {
    invalidate(); setUser(identity); setAuthError(null); setCredentialError(null);
  }, [invalidate]);
  const clearUser = useCallback((message?: string) => { invalidate(); setCredentialError(message || null); setUser(null); }, [invalidate]);
  const refresh = useCallback(async () => {
    if (!authEnabled) return;
    const current = ++generation.current;
    try {
      const identity = await getCurrentUser();
      if (current !== generation.current) return;
      setUser(identity); setAuthError(null); setCredentialError(null);
    } catch (error) {
      if (current !== generation.current) return;
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        setUser(null);
        setAuthError(error.response.data?.error === 'not_configured' ? 'not_configured' : null);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const onRefresh = () => { void refresh(); };
    const onInvalid = (event: Event) => {
      invalidate(); setUser(null);
      setAuthError((event as CustomEvent).detail === 'not_configured' ? 'not_configured' : null);
    };
    window.addEventListener('auth-refresh', onRefresh);
    window.addEventListener('auth-invalid', onInvalid);
    return () => {
      window.removeEventListener('auth-refresh', onRefresh);
      window.removeEventListener('auth-invalid', onInvalid);
    };
  }, [refresh, invalidate]);

  const logout = useCallback(async () => {
    if (!authEnabled) return;
    try {
      const { logoutUrl } = await endSession();
      invalidate(); setUser(null);
      window.location.assign(logoutUrl || '/login');
    } catch (error) {
      invalidate(); setUser(null);
      setAuthError(axios.isAxiosError(error) && error.response?.data?.error === 'not_configured' ? 'not_configured' : null);
    }
  }, [invalidate]);
  const isAdmin = !authEnabled || user?.role === 'admin';
  const value = useMemo(() => ({ enabled: authEnabled, loading, user, setUser: acceptUser, logout, refresh, clearUser, isAdmin, authError, credentialError }), [loading, user, acceptUser, logout, refresh, clearUser, isAdmin, authError, credentialError]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}

export function AuthLoading() {
  return <main className="min-h-screen bg-gray-50 flex items-center justify-center"><span className="sr-only">Autenticando</span></main>;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { enabled, loading, user, authError, credentialError } = useAuth();
  const location = useLocation();

  if (enabled && user?.mustChangePassword && location.pathname !== '/account/password') return <Navigate to="/account/password" replace />;
  if (!enabled || user) return <>{children}</>;
  if (loading) return <AuthLoading />;
  if (credentialError) return <Navigate to="/login" replace state={{ credentialError }} />;
  const next = `${location.pathname}${location.search}`;
  return <Navigate to={`/login?next=${encodeURIComponent(next)}${authError ? `&auth_error=${authError}` : ''}`} replace />;
}
