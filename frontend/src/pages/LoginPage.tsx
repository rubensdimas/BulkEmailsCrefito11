// frontend/src/pages/LoginPage.tsx
import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import logo from '../assets/crefito11-logo-negativo.png';
import { AuthLoading, useAuth } from '../components/Auth/AuthProvider';
import { getAuthOptions, loginWithPassword } from '../services/api';
import { sanitizeReturnTo } from '../utils/returnTo';

const OIDC_ERROR_MESSAGES: Record<string, string> = {
  unauthorized: 'Acesso não autorizado. Procure um administrador do BulkMail.',
  not_configured: 'O login pela intranet não está configurado.',
  access_denied: 'O acesso pela intranet foi cancelado.',
};
const DEFAULT_OIDC_ERROR = 'Não foi possível concluir o login pela intranet. Tente novamente.';

const loginErrorMessage = (error: unknown): string => {
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  if (status === 401) return 'Usuário ou senha inválidos.';
  if (status === 429) return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  return 'Não foi possível entrar agora. Tente novamente.';
};

const inputClassName = 'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500';

export default function LoginPage() {
  const { enabled, loading, user, setUser, authError } = useAuth();
  const location = useLocation();
  const credentialError = (location.state as { credentialError?: string } | null)?.credentialError;
  const [oidcEnabled, setOidcEnabled] = useState(false);
  const [optionsLoaded, setOptionsLoaded] = useState(false);
  const [params] = useSearchParams();
  const next = sanitizeReturnTo(params.get('next'));
  const oidcError = params.get('auth_error') || authError;
  const [localLoginEnabled, setLocalLoginEnabled] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    getAuthOptions()
      .then((options) => { if (active) { setLocalLoginEnabled(options.localLoginEnabled); setOidcEnabled(options.oidcEnabled); } })
      .catch(() => { if (active) { setLocalLoginEnabled(false); setOidcEnabled(false); } })
      .finally(() => active && setOptionsLoaded(true));
    return () => { active = false; };
  }, [enabled]);

  if (!enabled || user) return <Navigate to={next} replace />;
  if (loading) return <AuthLoading />;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      setUser(await loginWithPassword(username, password));
    } catch (loginError) {
      setError(loginErrorMessage(loginError));
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-100 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md overflow-hidden rounded-lg bg-white shadow-lg">
        <div className="flex justify-center bg-slate-900 px-8 py-8">
          <img src={logo} alt="CREFITO 11" className="h-16 w-auto" />
        </div>

        <div className="space-y-6 px-8 py-8">
          <h1 className="text-center text-xl font-semibold text-gray-900">Acessar o BulkMail</h1>

          {credentialError && <><p role="alert" className="text-red-700">{credentialError}</p><Link to="/login" replace>Entrar novamente</Link></>}
          {!credentialError && oidcError && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {OIDC_ERROR_MESSAGES[oidcError] ?? DEFAULT_OIDC_ERROR}
            </p>
          )}

          {oidcEnabled && <a
            href={`/api/auth/oidc/login?next=${encodeURIComponent(next)}`}
            className="flex w-full items-center justify-center gap-3 rounded-md bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2"
          >
            <img src="/apple-touch-icon.png" alt="" aria-hidden="true" className="h-6 w-6" />
            Entrar no login intranet
          </a>}

          {optionsLoaded && !localLoginEnabled && !oidcEnabled && <p role="alert">Nenhum método de login está disponível. Procure um administrador do BulkMail.</p>}
          {localLoginEnabled && (
            <>
              {oidcEnabled && <div className="flex items-center gap-3 text-xs uppercase text-gray-400">
                <span className="h-px flex-1 bg-gray-200" />
                ou
                <span className="h-px flex-1 bg-gray-200" />
              </div>}

              <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)} noValidate>
                <div>
                  <label htmlFor="username" className="block text-sm font-medium text-gray-700">Usuário</label>
                  <input
                    id="username"
                    name="username"
                    autoComplete="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    className={inputClassName}
                  />
                </div>
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700">Senha</label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className={inputClassName}
                  />
                </div>

                {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

                <button
                  type="submit"
                  disabled={submitting || !username.trim() || !password}
                  className="w-full rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
                >
                  {submitting ? 'Entrando...' : 'Entrar'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
