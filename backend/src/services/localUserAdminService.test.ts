import type { LocalUser, LocalUserStore, UserRole } from '../repositories/userRepository';
import { createLocalAdminService, LocalAdminError } from './localUserAdminService';

class InMemoryLocalUsers implements LocalUserStore {
  readonly users = new Map<string, LocalUser>();

  private byId(id: string): LocalUser {
    const user = this.users.get(id);
    if (!user) throw new Error(`Unknown user ${id}`);
    return user;
  }

  async findByUsername(username: string): Promise<LocalUser | null> {
    return [...this.users.values()].find((user) => user.username === username) ?? null;
  }

  async create(input: { username: string; passwordHash: string; role?: UserRole; mustChangePassword?: boolean }): Promise<LocalUser> {
    const user: LocalUser = {
      id: `id-${this.users.size + 1}`, ...input, provider: 'local',
      role: input.role ?? 'admin', mustChangePassword: input.mustChangePassword ?? false,
      oidcSub: null, oidcIssuer: null, credentialVersion: 0,
      email: null, name: null, disabledAt: null, lastLoginAt: null,
    };
    this.users.set(user.id, user);
    return user;
  }

  async updatePassword(id: string, passwordHash: string, mustChangePassword = false): Promise<void> {
    this.byId(id).passwordHash = passwordHash;
    this.byId(id).mustChangePassword = mustChangePassword;
    this.byId(id).credentialVersion++;
  }

  async changePasswordIfCurrent(id: string, expectedHash: string, expectedVersion: number, nextHash: string): Promise<boolean> {
    const user = this.byId(id);
    if (user.passwordHash !== expectedHash || user.credentialVersion !== expectedVersion) return false;
    user.passwordHash = nextHash;
    user.mustChangePassword = false;
    return true;
  }

  async setDisabled(id: string, disabled: boolean): Promise<void> {
    this.byId(id).disabledAt = disabled ? new Date() : null;
  }

  async recordLogin(id: string): Promise<void> {
    this.byId(id).lastLoginAt = new Date();
  }
}

const setup = () => {
  const users = new InMemoryLocalUsers();
  const revokeSessions = jest.fn().mockResolvedValue(2);
  const service = createLocalAdminService({ users, hash: async (password) => `hashed:${password}`, revokeSessions });
  return { users, revokeSessions, service };
};

describe('localUserAdminService', () => {
  it('creates a user with a normalized username and hashed password', async () => {
    const { users, service } = setup();
    const created = await service.create('  Admin ', 'uma senha longa');
    expect(created.username).toBe('admin');
    expect(created).toMatchObject({ role: 'admin', mustChangePassword: false });
    expect((await users.findByUsername('admin'))?.passwordHash).toBe('hashed:uma senha longa');
  });

  it.each(['ab', 'com espaço', 'a'.repeat(65), 'admin@crefito'])('rejects the username %p', async (username) => {
    const { service } = setup();
    await expect(service.create(username, 'uma senha longa')).rejects.toBeInstanceOf(LocalAdminError);
  });

  it('rejects a password outside the policy', async () => {
    const { service } = setup();
    await expect(service.create('admin', 'curta')).rejects.toThrow('A senha deve ter pelo menos 12 caracteres.');
  });

  it('refuses to overwrite an existing user', async () => {
    const { service } = setup();
    await service.create('admin', 'uma senha longa');
    await expect(service.create('ADMIN', 'outra senha longa')).rejects.toThrow('já existe');
  });

  it('reset-password revokes active sessions', async () => {
    const { users, revokeSessions, service } = setup();
    const created = await service.create('admin', 'uma senha longa');
    created.mustChangePassword = true;
    await expect(service.resetPassword('admin', 'nova senha longa')).resolves.toBe(2);
    expect((await users.findByUsername('admin'))?.passwordHash).toBe('hashed:nova senha longa');
    expect(created).toMatchObject({ mustChangePassword: false, credentialVersion: 1 });
    expect(revokeSessions).toHaveBeenCalledWith(created.id);
  });

  it('fails clearly for an unknown user', async () => {
    const { service } = setup();
    await expect(service.resetPassword('ghost', 'nova senha longa')).rejects.toThrow('não existe');
    await expect(service.setDisabled('ghost', true)).rejects.toThrow('não existe');
  });

  it('disables with session revocation and enables without it', async () => {
    const { users, revokeSessions, service } = setup();
    await service.create('admin', 'uma senha longa');
    await expect(service.setDisabled('admin', true)).resolves.toBe(2);
    expect((await users.findByUsername('admin'))?.disabledAt).toBeInstanceOf(Date);

    revokeSessions.mockClear();
    await expect(service.setDisabled('admin', false)).resolves.toBe(0);
    expect((await users.findByUsername('admin'))?.disabledAt).toBeNull();
    expect(revokeSessions).not.toHaveBeenCalled();
  });
});
