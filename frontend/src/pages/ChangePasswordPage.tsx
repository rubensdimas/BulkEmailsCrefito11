import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { AppHeader } from '../components/Layout/AppHeader';
import { useAuth } from '../components/Auth/AuthProvider';
import { apiErrorMessage, changeOwnPassword } from '../services/api';

export default function ChangePasswordPage() {
  const { user, refresh, clearUser } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (user && user.provider !== 'local') return <Navigate to="/" replace />;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (newPassword !== confirmation) { setError('As senhas não conferem.'); return; }
    setError(null); setSaving(true);
    try {
      await changeOwnPassword(currentPassword, newPassword);
      await refresh();
      navigate('/', { replace: true });
    } catch (failure) {
      const message = apiErrorMessage(failure, 'Não foi possível alterar a senha. Tente novamente.');
      if (axios.isAxiosError(failure) && (failure.response?.status === 401 || (failure.response?.status === 409 && failure.response.data?.error === 'credentials_changed'))) {
        clearUser(message);
        const authError = failure.response?.data?.error === 'not_configured' ? '?auth_error=not_configured' : '';
        navigate(`/login${authError}`, { replace: true, state: { credentialError: message } });
      } else { setError(message); }
    } finally { setSaving(false); }
  };
  return <div className="min-h-screen bg-gray-50"><AppHeader /><main className="mx-auto max-w-lg px-4 py-8">
    <h1 className="text-2xl font-bold text-gray-900">Minha senha</h1>
    {user?.mustChangePassword && <p className="mt-3 text-gray-700">Defina uma nova senha para continuar.</p>}
    <form onSubmit={event => void submit(event)} className="mt-6 space-y-4">
      {[{ id: 'current-password', label: 'Senha atual', value: currentPassword, change: setCurrentPassword, complete: 'current-password' },
        { id: 'new-password', label: 'Nova senha', value: newPassword, change: setNewPassword, complete: 'new-password' },
        { id: 'confirm-password', label: 'Confirme a nova senha', value: confirmation, change: setConfirmation, complete: 'new-password' }].map(field => <div key={field.id}>
          <label htmlFor={field.id} className="block text-sm font-medium text-gray-700">{field.label}</label>
          <input id={field.id} type="password" required autoComplete={field.complete} value={field.value} onChange={event => field.change(event.target.value)} className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900" />
        </div>)}
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <button disabled={saving} className="rounded-md bg-primary-600 px-4 py-2 text-white disabled:opacity-60">{saving ? 'Salvando...' : 'Salvar senha'}</button>
    </form></main></div>;
}
