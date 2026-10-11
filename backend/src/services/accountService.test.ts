import { resolveAccount, toAccountView } from './accountService';
import type { User } from '../repositories/userRepository';
import type { AuthSession } from './authSessionService';
const account: User = { id: 'u', provider: 'local', role: 'admin', username: 'admin', oidcSub: null, oidcIssuer: null, credentialVersion: 0, email: null, name: null, passwordHash: 'secret', mustChangePassword: true, disabledAt: null, lastLoginAt: null };
const session: AuthSession = { provider: 'local', localUserId: 'u', credentialVersion: 0, user: { sub: 'local:u' } };
const store = () => ({ findById: jest.fn().mockResolvedValue(account), findByOidcSub: jest.fn().mockResolvedValue(null), upsertOidcUser: jest.fn().mockResolvedValue({ ...account, provider: 'oidc' }) });
it('loads local account and rejects changed credentials', async () => {
  const users = store();
  await expect(resolveAccount(session, users)).resolves.toEqual(account);
  users.findById.mockResolvedValue({ ...account, credentialVersion: 1 });
  await expect(resolveAccount(session, users)).resolves.toBeNull();
});
it('resolves OIDC only using bound issuer and subject and registers older accounts', async () => {
  const users = store();
  const oidc: AuthSession = { provider: 'oidc', issuer: 'https://idp.example', user: { sub: 'sub', name: 'Ana' }, refreshToken: 'r', accessTokenExpiresAt: 1 };
  await resolveAccount(oidc, users);
  expect(users.findByOidcSub).toHaveBeenCalledWith('https://idp.example', 'sub');
  expect(users.upsertOidcUser).toHaveBeenCalledWith({ issuer: 'https://idp.example', sub: 'sub', name: 'Ana', email: undefined });
  await expect(resolveAccount({ ...oidc, issuer: undefined }, users)).resolves.toBeNull();
});
it('returns an allowlisted account view', () => {
  expect(toAccountView(session, account)).toEqual({ userId: 'u', sub: 'local:u', name: 'admin', provider: 'local', role: 'admin', mustChangePassword: true });
});

it('preserves existing OIDC disabled account without reactivation', async () => {
  const users = store();
  const disabled = { ...account, provider: 'oidc', disabledAt: new Date() };
  users.findByOidcSub.mockResolvedValue(disabled);
  await expect(resolveAccount({ provider: 'oidc', issuer: 'https://idp.example', user: { sub: 'sub' }, refreshToken: 'r', accessTokenExpiresAt: 1 }, users)).resolves.toEqual(disabled);
  expect(users.upsertOidcUser).not.toHaveBeenCalled();
});
