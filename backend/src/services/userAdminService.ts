import { LastActiveAdminError, UserNotFoundError } from '../repositories/userRepository';
import type { User, UserRole, UserStore } from '../repositories/userRepository';
import { USERNAME_PATTERN } from './localUserAdminService';
import { normalizeUsername } from './localAuthService';
import { validatePasswordPolicy } from './passwordHasher';
import type { SettingsAuditEvent } from './settingsAudit';

export class UserAdminError extends Error {
  constructor(public readonly code: string, public readonly status: number, message: string) {
    super(message);
    this.name = 'UserAdminError';
  }
}
export interface UserView {
  id: string;
  provider: User['provider'];
  username: string | null;
  name: string | null;
  email: string | null;
  role: UserRole;
  disabled: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
}
export interface UserAdminDependencies {
  users: UserStore;
  hash: (password: string) => Promise<string>;
  verify: (password: string, stored: string) => Promise<boolean>;
  revokeSessions: (id: string) => Promise<number>;
  audit: (event: SettingsAuditEvent) => void;
}
export const accountLabel = (account: User): string => account.username || account.email || account.id;
const view = (user: User): UserView => ({
  id: user.id, provider: user.provider, username: user.username, name: user.name, email: user.email,
  role: user.role, disabled: Boolean(user.disabledAt), mustChangePassword: user.mustChangePassword,
  lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
});
const fail = (code: string, status: number, message: string): never => { throw new UserAdminError(code, status, message); };
const passwordValue = (password: unknown): string => {
  if (typeof password !== 'string') return fail('invalid_request', 400, 'Informe uma senha válida.');
  const problem = validatePasswordPolicy(password);
  if (problem) return fail('invalid_password', 400, problem);
  return password;
};
const roleValue = (role: unknown): UserRole => {
  if (role !== 'admin' && role !== 'operator') return fail('invalid_role', 400, 'Selecione administrador ou operador.');
  return role;
};
const missingUser = (): never => fail('not_found', 404, 'Usuário não encontrado.');

export const createUserAdminService = (deps: UserAdminDependencies) => {
  const existing = async (id: string): Promise<User> => {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) return missingUser();
    const user = await deps.users.findById(id);
    return user ?? missingUser();
  };
  const local = (user: User): string => {
    if (user.provider !== 'local' || !user.passwordHash) return fail('not_local', 400, 'A senha deste usuário é gerenciada pela intranet.');
    return user.passwordHash;
  };
  return {
    async list(): Promise<UserView[]> { return (await deps.users.list()).map(view); },
    async createLocal(actor: string, input: Record<string, unknown>): Promise<UserView> {
      if (typeof input.username !== 'string') return fail('invalid_request', 400, 'Informe um nome de usuário.');
      const username = normalizeUsername(input.username);
      if (!USERNAME_PATTERN.test(username)) return fail('invalid_username', 400, 'Use de 3 a 64 caracteres entre a-z, 0-9, ponto, sublinhado e hífen.');
      const password = passwordValue(input.password);
      const role = input.role === undefined ? 'admin' : roleValue(input.role);
      const taken = (): never => fail('username_taken', 409, 'Este nome de usuário já está em uso.');
      if (await deps.users.findByUsername(username)) return taken();
      let user: User;
      try {
        user = await deps.users.create({ username, passwordHash: await deps.hash(password), role, mustChangePassword: true });
      } catch (error) {
        if ((error as { code?: string }).code === '23505') return taken();
        throw error;
      }
      deps.audit({ actor, action: 'user.create', target: username, fields: ['role'] });
      return view(user);
    },
    async updateAccess(actor: string, id: string, change: Record<string, unknown>): Promise<UserView> {
      await existing(id);
      if (change.role === undefined && change.disabled === undefined) return fail('invalid_request', 400, 'Informe perfil ou situação do usuário.');
      const access: { role?: UserRole; disabled?: boolean } = {};
      if (change.role !== undefined) access.role = roleValue(change.role);
      if (change.disabled !== undefined) {
        if (typeof change.disabled !== 'boolean') return fail('invalid_request', 400, 'Informe uma situação válida.');
        access.disabled = change.disabled;
      }
      let user: User;
      try { user = await deps.users.updateAccess(id, access); }
      catch (error) {
        if (error instanceof LastActiveAdminError) return fail('last_active_admin', 409, 'Não é possível remover o último administrador ativo.');
        if (error instanceof UserNotFoundError) return missingUser();
        throw error;
      }
      if (access.disabled && user.provider === 'local') await deps.revokeSessions(id);
      deps.audit({ actor, action: 'user.update_access', target: accountLabel(user), fields: Object.keys(access) });
      return view(user);
    },
    async resetPassword(actor: string, id: string, password: unknown): Promise<void> {
      const user = await existing(id);
      local(user);
      const valid = passwordValue(password);
      await deps.users.updatePassword(id, await deps.hash(valid), true);
      await deps.revokeSessions(id);
      deps.audit({ actor, action: 'user.reset_password', target: accountLabel(user), fields: ['password'] });
    },
    async changeOwnPassword(account: User, currentPassword: unknown, newPassword: unknown): Promise<void> {
      const expectedHash = local(account);
      const expectedVersion = account.credentialVersion;
      if (typeof currentPassword !== 'string') return fail('invalid_request', 400, 'Informe a senha atual.');
      if (!(await deps.verify(currentPassword, expectedHash))) return fail('invalid_current_password', 400, 'A senha atual está incorreta.');
      const next = passwordValue(newPassword);
      if (next === currentPassword) return fail('same_password', 400, 'A nova senha deve ser diferente da senha atual.');
      const nextHash = await deps.hash(next);
      const changed = await deps.users.changePasswordIfCurrent(account.id, expectedHash, expectedVersion, nextHash);
      if (!changed) return fail('credentials_changed', 409, 'Sua senha foi alterada. Entre novamente para continuar.');
      deps.audit({ actor: accountLabel(account), action: 'user.change_password', target: accountLabel(account), fields: ['password'] });
    },
  };
};
