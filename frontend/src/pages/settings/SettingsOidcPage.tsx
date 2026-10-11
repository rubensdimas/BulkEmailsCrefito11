import { useEffect, useState, type FormEvent } from 'react';
import axios from 'axios';
import {
  apiErrorMessage, getOidcConfig, saveOidcConfig, testOidcConfig,
  type OidcConfig, type OidcConfigInput,
} from '../../services/api';

type Feedback = { type: 'success' | 'error'; text: string };

const inputClass = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-primary-500';
const labelClass = 'block text-sm font-medium text-gray-700 mb-1';

export default function SettingsOidcPage() {
  const [config, setConfig] = useState<OidcConfig | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [issuer, setIssuer] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [backchannelOrigin, setBackchannelOrigin] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const data = await getOidcConfig(controller.signal);
        setConfig(data);
        setEnabled(data.enabled);
        setIssuer(data.issuer);
        setClientId(data.clientId);
        setBackchannelOrigin(data.backchannelOrigin);
      } catch (error) {
        if (!axios.isCancel(error)) {
          setFeedback({ type: 'error', text: apiErrorMessage(error, 'Não foi possível carregar as configurações.') });
        }
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  const backchannelAllowed = Boolean(config?.backchannelAllowed);
  const input = (): OidcConfigInput => ({
    enabled, issuer, clientId, clientSecret,
    backchannelOrigin: backchannelAllowed ? backchannelOrigin : '',
  });

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const text = await saveOidcConfig(input());
      setFeedback({ type: 'success', text });
      if (clientSecret) setConfig(prev => (prev ? { ...prev, clientSecretConfigured: true } : prev));
      setClientSecret('');
    } catch (error) {
      setFeedback({ type: 'error', text: apiErrorMessage(error, 'Não foi possível salvar a configuração.') });
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      setFeedback({ type: 'success', text: await testOidcConfig(input()) });
    } catch (error) {
      setFeedback({ type: 'error', text: apiErrorMessage(error, 'Não foi possível testar a conexão.') });
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(config?.callbackUrl ?? '');
      setFeedback({ type: 'success', text: 'URL de callback copiada.' });
    } catch {
      setFeedback({ type: 'error', text: 'Não foi possível copiar. Selecione a URL e copie manualmente.' });
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900">Login intranet</h2>
      <p className="text-sm text-gray-600 mt-1 mb-6">Configuração do login pela intranet (OpenID Connect).</p>

      {feedback && (
        <div
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`mb-6 rounded-lg border p-4 text-sm ${feedback.type === 'success' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}
        >
          {feedback.text}
        </div>
      )}

      <form onSubmit={handleSave} className="max-w-2xl space-y-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          Ativar login pela intranet
        </label>

        <div>
          <label htmlFor="oidc-issuer" className={labelClass}>Issuer</label>
          <input id="oidc-issuer" type="text" value={issuer} onChange={e => setIssuer(e.target.value)} className={inputClass} placeholder="https://intranet.exemplo.gov.br" />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="oidc-client-id" className={labelClass}>Client ID</label>
            <input id="oidc-client-id" type="text" value={clientId} onChange={e => setClientId(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="oidc-client-secret" className={labelClass}>Client secret</label>
            <input
              id="oidc-client-secret"
              type="password"
              autoComplete="new-password"
              value={clientSecret}
              onChange={e => setClientSecret(e.target.value)}
              className={inputClass}
              placeholder={config?.clientSecretConfigured ? 'Configurado — deixe em branco para manter' : ''}
            />
          </div>
        </div>

        {backchannelAllowed && (
          <div>
            <label htmlFor="oidc-backchannel" className={labelClass}>Backchannel origin</label>
            <input id="oidc-backchannel" type="text" value={backchannelOrigin} onChange={e => setBackchannelOrigin(e.target.value)} className={inputClass} placeholder="http://host.docker.internal:9000" />
            <p className="mt-1 text-xs text-gray-500">Somente ambiente local: origem usada pelo backend para falar com o provedor.</p>
          </div>
        )}

        <div>
          <label htmlFor="oidc-callback" className={labelClass}>URL de callback</label>
          <div className="flex gap-2">
            <input id="oidc-callback" type="text" readOnly value={config?.callbackUrl ?? ''} className={`${inputClass} bg-gray-50 text-gray-600`} />
            <button type="button" onClick={handleCopy} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Copiar
            </button>
          </div>
          <p className="mt-1 text-xs text-gray-500">Cadastre esta URL como redirect URI no provedor.</p>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={handleTest} disabled={busy} className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50">
            Testar
          </button>
          <button type="submit" disabled={busy} className="rounded-lg bg-primary-600 px-6 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            Salvar
          </button>
        </div>
      </form>
    </div>
  );
}
