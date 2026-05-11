import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getSmtpConfig, updateSmtpConfig, testSmtpConfig, SmtpConfig } from '../services/api';

export function SettingsPage() {
  const [config, setConfig] = useState<SmtpConfig>({
    host: '',
    port: 587,
    user: '',
    pass: '',
    secure: false,
    from_address: '',
    from_name: ''
  });

  const [testEmail, setTestEmail] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  useEffect(() => {
    async function loadConfig() {
      try {
        const response = await getSmtpConfig();
        if (response.success) {
          setConfig({
            ...response.data,
            pass: '' // Don't show password
          });
        }
      } catch (error: any) {
        setMessage({ type: 'error', text: 'Erro ao carregar configurações: ' + (error.response?.data?.error || error.message) });
      } finally {
        setIsLoading(false);
      }
    }
    loadConfig();
  }, []);

  useEffect(() => {
    // Auto-configure secure field based on common ports
    if (config.port === 465) {
      if (!config.secure) setConfig(prev => ({ ...prev, secure: true }));
    } else if ([587, 25, 2525].includes(config.port)) {
      if (config.secure) setConfig(prev => ({ ...prev, secure: false }));
    }
  }, [config.port]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setConfig(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : (name === 'port' ? parseInt(value) || 0 : value)
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setMessage(null);
    try {
      const response = await updateSmtpConfig(config);
      if (response.success) {
        setMessage({ type: 'success', text: 'Configurações salvas com sucesso!' });
        setConfig(prev => ({ ...prev, pass: '' })); // Clear password field
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: 'Erro ao salvar: ' + (error.response?.data?.error || error.message) });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    if (!testEmail) {
      setMessage({ type: 'error', text: 'Informe um email de destino para o teste.' });
      return;
    }
    setIsTesting(true);
    setMessage(null);
    try {
      const response = await testSmtpConfig(config, testEmail);
      if (response.success) {
        setMessage({ type: 'success', text: 'Email de teste enviado com sucesso! Verifique sua caixa de entrada.' });
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: 'Falha no teste: ' + (error.response?.data?.details || error.response?.data?.error || error.message) });
    } finally {
      setIsTesting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Configurações</h1>
            <p className="text-gray-600 mt-1">Gerencie as credenciais de envio SMTP</p>
          </div>
          <div className="flex gap-3">
            <Link
              to="/dashboard"
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Dashboard
            </Link>
            <Link
              to="/"
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 shadow-sm transition-colors"
            >
              Novo Envio
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {message && (
          <div className={`mb-6 p-4 rounded-lg border ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
            <div className="flex items-center gap-3">
              {message.type === 'success' ? (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              )}
              <p>{message.text}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="md:col-span-2">
            <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-6">Configuração do Servidor SMTP</h2>
              
              <form onSubmit={handleSave} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div className="sm:col-span-3">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Servidor (Host)</label>
                    <input
                      type="text"
                      name="host"
                      value={config.host}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-primary-500 focus:border-primary-500"
                      placeholder="smtp.exemplo.com"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Porta</label>
                    <input
                      type="number"
                      name="port"
                      value={config.port}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-primary-500 focus:border-primary-500"
                      placeholder="587"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Usuário</label>
                    <input
                      type="text"
                      name="user"
                      value={config.user}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-primary-500 focus:border-primary-500"
                      placeholder="usuario@exemplo.com"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Senha</label>
                    <input
                      type="password"
                      name="pass"
                      value={config.pass}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-primary-500 focus:border-primary-500"
                      placeholder="••••••••"
                    />
                    <p className="text-xs text-gray-500 mt-1">Deixe em branco para manter a senha atual.</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="secure"
                    name="secure"
                    checked={config.secure}
                    onChange={handleChange}
                    className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                  />
                  <label htmlFor="secure" className="text-sm text-gray-700 font-medium">
                    Usar conexão segura (SSL/TLS)
                  </label>
                </div>

                <hr className="my-6 border-gray-100" />
                
                <h3 className="text-md font-medium text-gray-900 mb-4">Informações do Remetente</h3>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email do Remetente</label>
                    <input
                      type="email"
                      name="from_address"
                      value={config.from_address}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-primary-500 focus:border-primary-500"
                      placeholder="no-reply@exemplo.com"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Nome do Remetente</label>
                    <input
                      type="text"
                      name="from_name"
                      value={config.from_name}
                      onChange={handleChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-primary-500 focus:border-primary-500"
                      placeholder="Equipe BulkMail"
                    />
                  </div>
                </div>

                <div className="pt-4 flex justify-end">
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="px-6 py-2 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors shadow-sm"
                  >
                    {isSaving ? 'Salvando...' : 'Salvar Configurações'}
                  </button>
                </div>
              </form>
            </section>
          </div>

          <div>
            <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 sticky top-8">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Testar Conexão</h2>
              <p className="text-sm text-gray-600 mb-4">
                Envie um email de teste para validar se as configurações acima estão corretas antes de salvar.
              </p>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email de Destino</label>
                  <input
                    type="email"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-primary-500 focus:border-primary-500"
                    placeholder="seu-email@exemplo.com"
                  />
                </div>
                
                <button
                  type="button"
                  onClick={handleTest}
                  disabled={isTesting}
                  className="w-full py-2 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-colors"
                >
                  {isTesting ? 'Enviando teste...' : 'Enviar Email de Teste'}
                </button>
              </div>

              <div className="mt-8 p-4 bg-blue-50 rounded-lg">
                <h4 className="text-sm font-semibold text-blue-900 flex items-center gap-2 mb-2">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                  Configuração Recomendada
                </h4>
                <div className="text-xs text-blue-800 space-y-2 leading-relaxed">
                  <p>
                    <strong>Porta 465:</strong> SSL/TLS implícito. O checkbox deve estar <strong>marcado</strong>.
                  </p>
                  <p>
                    <strong>Porta 587 ou 2525:</strong> STARTTLS (recomendado). O checkbox deve estar <strong>desmarcado</strong>.
                  </p>
                  <p>
                    <strong>Gmail:</strong> Use a porta 587 e crie uma "Senha de App" nas configurações da sua conta Google.
                  </p>
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

export default SettingsPage;
