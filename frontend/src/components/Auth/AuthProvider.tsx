import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AuthUser, getCurrentUser, logout as endSession } from '../../services/api';

interface AuthContextValue {
  enabled: boolean;
  loading: boolean;
  user: AuthUser | null;
  setUser: (user: AuthUser) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const authEnabled = import.meta.env.VITE_AUTH_ENABLED === 'true';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(authEnabled);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    if (!authEnabled) return;
    let active = true;
    getCurrentUser()
      .then((identity) => active && setUser(identity))
      .catch(() => active && setUser(null))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const logout = useCallback(async () => {
    if (!authEnabled) return;
    const { logoutUrl } = await endSession();
    window.location.assign(logoutUrl || '/login');
  }, []);

  const value = useMemo(() => ({ enabled: authEnabled, loading, user, setUser, logout }), [loading, user, logout]);
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
  const { enabled, loading, user } = useAuth();
  const location = useLocation();

  if (!enabled || user) return <>{children}</>;
  if (loading) return <AuthLoading />;
  const next = `${location.pathname}${location.search}`;
  return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
}
