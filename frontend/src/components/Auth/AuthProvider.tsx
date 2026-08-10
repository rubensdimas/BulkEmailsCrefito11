import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AuthUser, getCurrentUser, logout as endSession } from '../../services/api';

interface AuthContextValue {
  enabled: boolean;
  loading: boolean;
  user: AuthUser | null;
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
    window.location.assign(logoutUrl || '/');
  }, []);

  const value = useMemo(() => ({ enabled: authEnabled, loading, user, logout }), [loading, user, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { enabled, loading, user } = useAuth();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled || loading || user || failed) return;
    const query = new URLSearchParams(window.location.search);
    if (query.has('auth_error')) {
      setFailed(true);
      return;
    }
    window.location.assign('/api/auth/oidc/login');
  }, [enabled, loading, user, failed]);

  if (!enabled || user) return <>{children}</>;
  if (failed) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-gray-700">Não foi possível concluir a autenticação.</p>
          <a className="mt-4 inline-flex px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700" href="/api/auth/oidc/login">Entrar novamente</a>
        </div>
      </main>
    );
  }
  return <main className="min-h-screen bg-gray-50 flex items-center justify-center"><span className="sr-only">Autenticando</span></main>;
}
