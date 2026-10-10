import type { LocalUser, LocalUserStore } from '../repositories/localUserRepository';
import { normalizeUsername } from './localAuthService';
import { validatePasswordPolicy } from './passwordHasher';

export const USERNAME_PATTERN = /^[a-z0-9._-]{3,64}$/;

export class LocalAdminError extends Error {}

export interface LocalAdminDependencies {
  users: LocalUserStore;
  hash: (password: string) => Promise<string>;
  revokeSessions: (localUserId: string) => Promise<number>;
}

const assertPassword = (password: string): void => {
  const problem = validatePasswordPolicy(password);
  if (problem) throw new LocalAdminError(problem);
};

export const createLocalAdminService = (deps: LocalAdminDependencies) => {
  const existing = async (username: string): Promise<LocalUser> => {
    const normalized = normalizeUsername(username);
    const user = await deps.users.findByUsername(normalized);
    if (!user) throw new LocalAdminError(`O usuário "${normalized}" não existe.`);
    return user;
  };

  return {
    async create(username: string, password: string): Promise<LocalUser> {
      const normalized = normalizeUsername(username);
      if (!USERNAME_PATTERN.test(normalized)) {
        throw new LocalAdminError('Nome de usuário inválido: use de 3 a 64 caracteres entre a-z, 0-9, ".", "_" e "-".');
      }
      assertPassword(password);
      if (await deps.users.findByUsername(normalized)) {
        throw new LocalAdminError(`O usuário "${normalized}" já existe. Use reset-password para trocar a senha.`);
      }
      return deps.users.create({ username: normalized, passwordHash: await deps.hash(password) });
    },

    async resetPassword(username: string, password: string): Promise<number> {
      const user = await existing(username);
      assertPassword(password);
      await deps.users.updatePassword(user.id, await deps.hash(password));
      return deps.revokeSessions(user.id);
    },

    async setDisabled(username: string, disabled: boolean): Promise<number> {
      const user = await existing(username);
      await deps.users.setDisabled(user.id, disabled);
      return disabled ? deps.revokeSessions(user.id) : 0;
    },
  };
};
