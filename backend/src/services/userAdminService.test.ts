// backend/src/services/userAdminService.test.ts
import {
  LastActiveAdminError, LocalUser, User, UserNotFoundError, UserRole, UserStore,
} from '../repositories/userRepository';
import { createUserAdminService, UserAdminError } from './userAdminService';

const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

class InMemoryUsers implements UserStore {
  readonly users = new Map<string, User>();

  add(user: Partial<User> & { id: string }): User {
    const full: User = {
      provider: 'local', role: 'admin', username: null, oidcSub: null, oidcIssuer: null, credentialVersion: 0, email: null, name: null,
      passwordHash: null, mustChangePassword: false, disabledAt: null, lastLoginAt: null, ...user,
    };
    this.users.set(full.id, full);
    return full;
  }

  async findById(id: string) { return this.users.get(id) ?? null; }
  async findByUsername(username: string) {
    return ([...this.users.values()].find((u) => u.provider === 'local' && u.username === username) as LocalUser) ?? null;
  }
  async findByOidcSub(issuer: string, sub: string) { return [...this.users.values()].find((u) => u.oidcIssuer === issuer && u.oidcSub === sub) ?? null; }
  async upsertOidcUser(): Promise<User> { throw new Error('not used'); }
  async list() { return [...this.users.values()]; }
  async create(input: { username: string; passwordHash: string; role?: UserRole; mustChangePassword?: boolean }) {
    return this.add({
      id: ID(this.users.size + 1), username: input.username, passwordHash: input.passwordHash,
      role: input.role ?? 'admin', mustChangePassword: input.mustChangePassword ?? false,
    }) as LocalUser;
  }
  async updatePassword(id: string, passwordHash: string, mustChangePassword = false) {
    const user = this.users.get(id)!;
    Object.assign(user, { passwordHash, mustChangePassword, credentialVersion: user.credentialVersion + 1 });
  }
  async changePasswordIfCurrent(id: string, expectedHash: string, expectedVersion: number, nextHash: string) {
    const user = this.users.get(id);
    if (!user || user.passwordHash !== expectedHash || user.credentialVersion !== expectedVersion) return false;
    Object.assign(user, { passwordHash: nextHash, mustChangePassword: false });
    return true;
  }
  async setDisabled(id: string, disabled: boolean) { await this.updateAccess(id, { disabled }); }
  async recordLogin() { /* not used */ }
  async updateAccess(id: string, change: { role?: UserRole; disabled?: boolean }) {
    const user = this.users.get(id);
    if (!user) throw new UserNotFoundError();
    const next = { ...user, ...(change.role ? { role: change.role } : {}), ...(change.disabled !== undefined ? { disabledAt: change.disabled ? new Date() : null } : {}) };
    const others = [...this.users.values()].filter((u) => u.id !== id);
    if (![next, ...others].some((u) => u.role === 'admin' && !u.disabledAt)) throw new LastActiveAdminError();
    this.users.set(id, next);
    return next;
  }
}

const setup = () => {
  const users = new InMemoryUsers();
  const deps = {
    users,
    hash: jest.fn(async (password: string) => `hashed:${password}`),
    verify: jest.fn(async (password: string, stored: string) => stored === `hashed:${password}`),
    revokeSessions: jest.fn().mockResolvedValue(1),
    audit: jest.fn(),
  };
  return { users, deps, service: createUserAdminService(deps) };
};

const expectError = async (promise: Promise<unknown>, code: string, status: number) => {
  await expect(promise).rejects.toBeInstanceOf(UserAdminError);
  await expect(promise).rejects.toMatchObject({ code, status });
};

describe('userAdminService', () => {
  it('lists users without password hashes', async () => {
    const { users, service } = setup();
    users.add({ id: ID(1), username: 'admin', passwordHash: 'hashed:x', lastLoginAt: new Date('2026-10-10T12:00:00Z') });
    const [view] = await service.list();
    expect(view).toEqual({
      id: ID(1), provider: 'local', username: 'admin', name: null, email: null, role: 'admin',
      disabled: false, mustChangePassword: false, lastLoginAt: '2026-10-10T12:00:00.000Z',
    });
  });

  it('creates local users that must change the initial password', async () => {
    const { deps, service } = setup();
    const view = await service.createLocal('admin', { username: ' Maria.Silva ', password: 'senha-inicial-123', role: 'operator' });
    expect(view).toMatchObject({ username: 'maria.silva', role: 'operator', mustChangePassword: true });
    expect(deps.audit).toHaveBeenCalledWith({ actor: 'admin', action: 'user.create', target: 'maria.silva', fields: ['role'] });
    expect(JSON.stringify(deps.audit.mock.calls)).not.toContain('senha-inicial-123');
  });

  it('creates admins by default', async () => {
    const { service } = setup();
    await expect(service.createLocal('admin', { username: 'joao', password: 'senha-inicial-123' })).resolves.toMatchObject({ role: 'admin' });
  });

  it.each([
    [{ username: 'a b', password: 'senha-inicial-123' }, 'invalid_username'],
    [{ username: 'joao', password: 'curta' }, 'invalid_password'],
    [{ username: 'joao', password: 'senha-inicial-123', role: 'root' }, 'invalid_role'],
    [{ username: 42, password: 'senha-inicial-123' }, 'invalid_request'],
  ])('rejects invalid creation input %p', async (input, code) => {
    const { service } = setup();
    await expectError(service.createLocal('admin', input as Record<string, unknown>), code, 400);
  });

  it('refuses duplicated usernames', async () => {
    const { users, service } = setup();
    users.add({ id: ID(1), username: 'joao', passwordHash: 'h' });
    await expectError(service.createLocal('admin', { username: 'JOAO', password: 'senha-inicial-123' }), 'username_taken', 409);
  });

  it('changes roles and status and revokes sessions of disabled local users', async () => {
    const { users, deps, service } = setup();
    users.add({ id: ID(1), username: 'admin', passwordHash: 'h' });
    users.add({ id: ID(2), username: 'joao', passwordHash: 'h', role: 'operator' });
    await expect(service.updateAccess('admin', ID(2), { role: 'admin' })).resolves.toMatchObject({ role: 'admin' });
    await expect(service.updateAccess('admin', ID(2), { disabled: true })).resolves.toMatchObject({ disabled: true });
    expect(deps.revokeSessions).toHaveBeenCalledWith(ID(2));
    expect(deps.audit).toHaveBeenLastCalledWith({ actor: 'admin', action: 'user.update_access', target: 'joao', fields: ['disabled'] });
  });

  it('rejects demoting or disabling the last active admin', async () => {
    const { users, service } = setup();
    users.add({ id: ID(1), username: 'admin', passwordHash: 'h' });
    await expectError(service.updateAccess('admin', ID(1), { role: 'operator' }), 'last_active_admin', 409);
    await expectError(service.updateAccess('admin', ID(1), { disabled: true }), 'last_active_admin', 409);
  });

  it.each([
    [ID(9), { role: 'admin' }, 'not_found', 404],
    ['not-a-uuid', { role: 'admin' }, 'not_found', 404],
    [ID(1), {}, 'invalid_request', 400],
    [ID(1), { disabled: 'yes' }, 'invalid_request', 400],
    [ID(1), { role: 'root' }, 'invalid_role', 400],
  ])('rejects invalid access changes (%s %p)', async (id, change, code, status) => {
    const { users, service } = setup();
    users.add({ id: ID(1), username: 'admin', passwordHash: 'h' });
    await expectError(service.updateAccess('admin', id, change as Record<string, unknown>), code, status);
  });

  it('resets local passwords, forcing a change and ending sessions', async () => {
    const { users, deps, service } = setup();
    users.add({ id: ID(1), username: 'joao', passwordHash: 'h' });
    await service.resetPassword('admin', ID(1), 'nova-senha-1234');
    expect(users.users.get(ID(1))).toMatchObject({ passwordHash: 'hashed:nova-senha-1234', mustChangePassword: true });
    expect(deps.revokeSessions).toHaveBeenCalledWith(ID(1));
  });

  it('does not manage intranet passwords', async () => {
    const { users, service } = setup();
    users.add({ id: ID(1), provider: 'oidc', oidcSub: 's', role: 'operator' });
    await expectError(service.resetPassword('admin', ID(1), 'nova-senha-1234'), 'not_local', 400);
  });

  it('changes the own password after checking the current one', async () => {
    const { users, service } = setup();
    const me = users.add({ id: ID(1), username: 'joao', passwordHash: 'hashed:senha-atual-123', mustChangePassword: true });
    await expectError(service.changeOwnPassword(me, 'errada-errada-1', 'nova-senha-1234'), 'invalid_current_password', 400);
    await expectError(service.changeOwnPassword(me, 'senha-atual-123', 'senha-atual-123'), 'same_password', 400);
    await expectError(service.changeOwnPassword(me, 'senha-atual-123', 'curta'), 'invalid_password', 400);
    await service.changeOwnPassword(me, 'senha-atual-123', 'nova-senha-1234');
    expect(users.users.get(ID(1))).toMatchObject({ passwordHash: 'hashed:nova-senha-1234', mustChangePassword: false });
  });
  it('does not overwrite reset during hashing or audit a failed own change', async () => {
    const { users, deps, service } = setup();
    const me = { ...users.add({ id: ID(1), username: 'joao', passwordHash: 'hashed:senha-atual-123', mustChangePassword: true }) };
    let release!: () => void;
    let entered!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const hashing = new Promise<void>(resolve => { entered = resolve; });
    deps.hash.mockImplementationOnce(async password => { entered(); await barrier; return `hashed:${password}`; });
    const ownChange = service.changeOwnPassword(me, 'senha-atual-123', 'nova-senha-1234');
    await hashing;
    await users.updatePassword(me.id, 'hashed:reset-password-123', true);
    release();
    await expectError(ownChange, 'credentials_changed', 409);
    expect(users.users.get(me.id)).toMatchObject({ passwordHash: 'hashed:reset-password-123', credentialVersion: 1, mustChangePassword: true });
    expect(deps.audit).not.toHaveBeenCalled();
  });

});
