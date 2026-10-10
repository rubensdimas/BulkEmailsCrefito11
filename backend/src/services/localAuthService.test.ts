import type { LocalUser } from '../repositories/userRepository';
import { createLocalAuthService, LocalAuthDependencies } from './localAuthService';

const activeAdmin: LocalUser = {
  provider: 'local', role: 'admin',
  oidcSub: null, oidcIssuer: null, credentialVersion: 0,
  email: null, name: null, mustChangePassword: false,
  id: 'user-1',
  username: 'admin',
  passwordHash: 'hash:correct password',
  disabledAt: null,
  lastLoginAt: null,
};

const setup = (user: LocalUser | null = activeAdmin, blocked = false) => {
  const deps = {
    users: {
      findByUsername: jest.fn(async (username: string) => (user && username === user.username ? user : null)),
      recordLogin: jest.fn(async () => undefined),
    },
    attempts: {
      isBlocked: jest.fn(async () => blocked),
      registerFailure: jest.fn(async () => undefined),
      clear: jest.fn(async () => undefined),
    },
    passwords: {
      verify: jest.fn(async (password: string, stored: string) => stored === `hash:${password}`),
      verifyDummy: jest.fn(async () => undefined),
    },
    log: jest.fn(),
  } satisfies LocalAuthDependencies;
  return { deps, service: createLocalAuthService(deps) };
};

const ip = '203.0.113.7';

describe('localAuthService.authenticate', () => {
  it('normalizes the username before every lookup', async () => {
    const { deps, service } = setup();
    const result = await service.authenticate({ username: '  Admin ', password: 'correct password', ip });
    expect(result).toEqual({ ok: true, user: activeAdmin });
    expect(deps.attempts.isBlocked).toHaveBeenCalledWith('admin', ip);
    expect(deps.users.findByUsername).toHaveBeenCalledWith('admin');
    expect(deps.attempts.clear).toHaveBeenCalledWith('admin', ip);
    expect(deps.users.recordLogin).toHaveBeenCalledWith('user-1');
    expect(deps.log).toHaveBeenCalledWith({ outcome: 'success', username: 'admin', ip });
  });

  it('rejects a wrong password and counts the failure', async () => {
    const { deps, service } = setup();
    await expect(service.authenticate({ username: 'admin', password: 'wrong password', ip }))
      .resolves.toEqual({ ok: false, reason: 'invalid_credentials' });
    expect(deps.attempts.registerFailure).toHaveBeenCalledWith('admin', ip);
    expect(deps.users.recordLogin).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith({ outcome: 'failure', username: 'admin', ip, reason: 'wrong_password' });
  });

  it('answers an unknown user like a wrong password and still spends hashing time', async () => {
    const { deps, service } = setup(null);
    await expect(service.authenticate({ username: 'ghost', password: 'any password', ip }))
      .resolves.toEqual({ ok: false, reason: 'invalid_credentials' });
    expect(deps.passwords.verifyDummy).toHaveBeenCalledWith('any password');
    expect(deps.attempts.registerFailure).toHaveBeenCalledWith('ghost', ip);
    expect(deps.log).toHaveBeenCalledWith({ outcome: 'failure', username: 'ghost', ip, reason: 'unknown_user' });
  });

  it('rejects a disabled user even with the right password', async () => {
    const { deps, service } = setup({ ...activeAdmin, disabledAt: new Date() });
    await expect(service.authenticate({ username: 'admin', password: 'correct password', ip }))
      .resolves.toEqual({ ok: false, reason: 'invalid_credentials' });
    expect(deps.attempts.registerFailure).toHaveBeenCalledWith('admin', ip);
    expect(deps.log).toHaveBeenCalledWith({ outcome: 'failure', username: 'admin', ip, reason: 'disabled' });
  });

  it('refuses blocked attempts without checking the password', async () => {
    const { deps, service } = setup(activeAdmin, true);
    await expect(service.authenticate({ username: 'admin', password: 'correct password', ip }))
      .resolves.toEqual({ ok: false, reason: 'blocked' });
    expect(deps.users.findByUsername).not.toHaveBeenCalled();
    expect(deps.passwords.verify).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith({ outcome: 'blocked', username: 'admin', ip, reason: 'too_many_attempts' });
  });

  it('never writes the password to the log', async () => {
    const { deps, service } = setup();
    await service.authenticate({ username: 'admin', password: 'wrong password', ip });
    await service.authenticate({ username: 'admin', password: 'correct password', ip });
    const logged = JSON.stringify(deps.log.mock.calls);
    expect(logged).not.toContain('wrong password');
    expect(logged).not.toContain('correct password');
  });
});
