import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../../components/Auth/AuthProvider';
import {
  apiErrorMessage, createLocalUser, listUsers, resetUserPassword, updateUserAccess,
  type ManagedUser, type UserRole,
} from '../../services/api';

type Feedback = { type: 'success' | 'error'; text: string };

const roleLabel = (role: UserRole) => (role === 'admin' ? 'Administrador' : 'Operador');
const displayName = (user: ManagedUser) => user.username || user.name || user.email || user.id;
const lastAccess = (value: string | null) => (value ? new Date(value).toLocaleString('pt-BR') : 'Nunca');
const inputClass = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-primary-500';
const actionClass = 'rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50';

export default function SettingsUsersPage() {
  const { user: current, refresh } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('operator');
  const [resetId, setResetId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const load = useCallback(async () => {
    try {
      setUsers(await listUsers());
    } catch (error) {
      setFeedback({ type: 'error', text: apiErrorMessage(error, 'Não foi possível carregar os usuários.') });
    } finally {
      setIsLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const replaceUser = (updated: ManagedUser) => setUsers((list) => list.map((item) => (item.id === updated.id ? updated : item)));

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setFeedback(null);
    try {
      const created = await createLocalUser({ username, password, role });
      setUsers((list) => [...list, created]);
      setUsername(''); setPassword(''); setRole('operator');
      setFeedback({ type: 'success', text: `Usuário "${created.username ?? username}" criado. A senha deverá ser trocada no primeiro acesso.` });
    } catch (error) {
      setFeedback({ type: 'error', text: apiErrorMessage(error, 'Não foi possível criar o usuário.') });
    } finally {
      setBusy(false);
    }
  };

  const handleAccess = async (target: ManagedUser, change: { role?: UserRole; disabled?: boolean }) => {
    setBusy(true); setFeedback(null);
    try {
      replaceUser(await updateUserAccess(target.id, change));
      if (current?.userId && current.userId === target.id) await refresh();
    } catch (error) {
      setFeedback({ type: 'error', text: apiErrorMessage(error, 'Não foi possível atualizar o usuário.') });
    } finally {
      setBusy(false);
    }
  };

  const openReset = (target: ManagedUser) => {
    setResetId(target.id); setNewPassword(''); setConfirmPassword(''); setFeedback(null);
  };

  const handleReset = async (event: FormEvent, target: ManagedUser) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setFeedback({ type: 'error', text: 'As senhas não conferem.' });
      return;
    }
    setBusy(true); setFeedback(null);
    try {
      await resetUserPassword(target.id, newPassword);
      setResetId(null); setNewPassword(''); setConfirmPassword('');
      replaceUser({ ...target, mustChangePassword: true });
      setFeedback({ type: 'success', text: `Senha de "${displayName(target)}" redefinida. O usuário deverá trocá-la no próximo acesso.` });
    } catch (error) {
      setFeedback({ type: 'error', text: apiErrorMessage(error, 'Não foi possível redefinir a senha.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Usuários</h2>
        <p className="mt-1 text-sm text-gray-600">Gerencie quem acessa o sistema e com qual perfil.</p>
      </div>

      {feedback && (
        <div
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`rounded-lg border p-4 text-sm ${feedback.type === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-green-200 bg-green-50 text-green-700'}`}
        >{feedback.text}</div>
      )}

      <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 rounded-xl border border-gray-200 bg-white p-4 sm:grid-cols-4 sm:items-end">
        <div>
          <label htmlFor="new-username" className="mb-1 block text-sm font-medium text-gray-700">Novo usuário</label>
          <input id="new-username" className={inputClass} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" required />
        </div>
        <div>
          <label htmlFor="new-password" className="mb-1 block text-sm font-medium text-gray-700">Senha inicial</label>
          <input id="new-password" type="password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
        </div>
        <div>
          <label htmlFor="new-role" className="mb-1 block text-sm font-medium text-gray-700">Perfil</label>
          <select id="new-role" className={inputClass} value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            <option value="operator">Operador</option>
            <option value="admin">Administrador</option>
          </select>
        </div>
        <button type="submit" disabled={busy} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">Criar usuário</button>
      </form>

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="h-12 w-12 animate-spin rounded-full border-b-2 border-primary-600"></div></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-3">Usuário</th>
                <th scope="col" className="px-4 py-3">Origem</th>
                <th scope="col" className="px-4 py-3">Perfil</th>
                <th scope="col" className="px-4 py-3">Situação</th>
                <th scope="col" className="px-4 py-3">Último acesso</th>
                <th scope="col" className="px-4 py-3">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((item) => (
                <tr key={item.id} className="align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{displayName(item)}</div>
                    {item.email && <div className="text-xs text-gray-500">{item.email}</div>}
                  </td>
                  <td className="px-4 py-3">{item.provider === 'local' ? 'Local' : 'Intranet'}</td>
                  <td className="px-4 py-3">{roleLabel(item.role)}</td>
                  <td className="px-4 py-3">{item.disabled ? 'Desativado' : 'Ativo'}</td>
                  <td className="px-4 py-3">{lastAccess(item.lastLoginAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={busy} className={actionClass} onClick={() => handleAccess(item, { role: item.role === 'admin' ? 'operator' : 'admin' })}>
                        {item.role === 'admin' ? 'Tornar operador' : 'Tornar administrador'}
                      </button>
                      <button type="button" disabled={busy} className={actionClass} onClick={() => handleAccess(item, { disabled: !item.disabled })}>
                        {item.disabled ? 'Ativar' : 'Desativar'}
                      </button>
                      {item.provider === 'local' && (
                        <button type="button" disabled={busy} className={actionClass} onClick={() => openReset(item)}>Definir senha</button>
                      )}
                    </div>
                    {resetId === item.id && (
                      <form onSubmit={(event) => handleReset(event, item)} className="mt-3 space-y-2">
                        <div>
                          <label htmlFor={`reset-${item.id}`} className="mb-1 block text-xs font-medium text-gray-700">Nova senha</label>
                          <input id={`reset-${item.id}`} type="password" className={inputClass} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" required />
                        </div>
                        <div>
                          <label htmlFor={`confirm-${item.id}`} className="mb-1 block text-xs font-medium text-gray-700">Confirmar senha</label>
                          <input id={`confirm-${item.id}`} type="password" className={inputClass} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" required />
                        </div>
                        <div className="flex gap-2">
                          <button type="submit" disabled={busy} className="rounded-md bg-primary-600 px-3 py-1 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50">Salvar senha</button>
                          <button type="button" className={actionClass} onClick={() => setResetId(null)}>Cancelar</button>
                        </div>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
