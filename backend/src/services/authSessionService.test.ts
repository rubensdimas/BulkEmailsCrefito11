const mockStrings = new Map<string, string>();
const mockSets = new Map<string, Set<string>>();
const mockRedis = {
  set: jest.fn(async (key: string, value: string) => {
    mockStrings.set(key, value);
    return 'OK';
  }),
  get: jest.fn(async (key: string) => mockStrings.get(key) ?? null),
  del: jest.fn(async (...keys: string[]) => keys.filter((key) => mockStrings.delete(key) || mockSets.delete(key)).length),
  sadd: jest.fn(async (key: string, member: string) => {
    const members = mockSets.get(key) ?? new Set<string>();
    members.add(member);
    mockSets.set(key, members);
    return 1;
  }),
  smembers: jest.fn(async (key: string) => [...(mockSets.get(key) ?? [])]),
  srem: jest.fn(async (key: string, ...members: string[]) => {
    const set = mockSets.get(key);
    if (!set) return 0;
    let removed = 0;
    for (const member of members) if (set.delete(member)) removed += 1;
    if (set.size === 0) mockSets.delete(key);
    return removed;
  }),
  expire: jest.fn(async () => 1),
};

jest.mock('../config/redis', () => ({ getRedisClient: () => mockRedis }));
jest.mock('./oidcService', () => ({
  loadOidcOperationContext: jest.fn().mockResolvedValue({ configuration: { issuer: 'https://a.example' }, configurationFingerprint: 'a' }),
  assertOidcBinding: jest.fn().mockResolvedValue(undefined),
  refreshOidcTokens: jest.fn(),
  validateIdToken: jest.fn(),
  getUserInfo: jest.fn(),
  shouldRefreshToken: jest.fn(() => true),
  encryptRefreshToken: jest.fn((value: string) => `enc:${value}`),
  decryptRefreshToken: jest.fn((value: string) => value.replace(/^enc:/, '')),
}));

import { assertOidcBinding, loadOidcOperationContext, refreshOidcTokens, validateIdToken, getUserInfo } from './oidcService';
import {
  consumeLoginTransaction,
  createLocalSession,
  getSession,
  refreshSessionIfNeeded,
  revokeLocalUserSessions,
  saveLoginTransaction,
} from './authSessionService';

const localUser = { sub: 'local:user-1', name: 'admin' };

describe('authSessionService', () => {
  beforeEach(() => {
    mockStrings.clear();
    mockSets.clear();
    jest.clearAllMocks();
  });

  it('accepts legacy sessions without provider as OIDC', async () => {
    mockStrings.set('oidc:session:legacy', JSON.stringify({
      user: { sub: 'oidc-user' },
      refreshToken: 'enc:refresh',
      accessTokenExpiresAt: Date.now() + 60_000,
    }));
    await expect(getSession('legacy')).resolves.toEqual(expect.objectContaining({
      provider: 'oidc',
      user: { sub: 'oidc-user' },
    }));
  });

  it('rejects sessions with an unknown provider', async () => {
    mockStrings.set('oidc:session:odd', JSON.stringify({ provider: 'saml', user: { sub: 'x' } }));
    await expect(getSession('odd')).resolves.toBeNull();
  });

  it.each([null, -1, 0.5, '0'])('rejects malformed local credential version %p', async (credentialVersion) => {
    mockStrings.set('oidc:session:malformed', JSON.stringify({ provider: 'local', localUserId: 'user-1', user: localUser, credentialVersion }));
    await expect(getSession('malformed')).resolves.toBeNull();
  });

  it('round-trips a local session', async () => {
    const id = await createLocalSession(localUser, 'user-1', 0);
    await expect(getSession(id)).resolves.toEqual({ provider: 'local', user: localUser, localUserId: 'user-1', credentialVersion: 0 });
    expect(mockRedis.set).toHaveBeenCalledWith(`oidc:session:${id}`, expect.any(String), 'EX', 8 * 60 * 60);
  });

  it('never refreshes a local session through OIDC', async () => {
    const id = await createLocalSession(localUser, 'user-1', 0);
    const session = await getSession(id);
    await expect(refreshSessionIfNeeded(id, session!)).resolves.toBe(session);
    expect(refreshOidcTokens).not.toHaveBeenCalled();
  });

  it('revokes every session of a local user', async () => {
    const first = await createLocalSession(localUser, 'user-1', 0);
    const second = await createLocalSession(localUser, 'user-1', 0);
    const other = await createLocalSession({ sub: 'local:user-2', name: 'outro' }, 'user-2', 0);

    await expect(revokeLocalUserSessions('user-1')).resolves.toBe(2);
    await expect(getSession(first)).resolves.toBeNull();
    await expect(getSession(second)).resolves.toBeNull();
    await expect(getSession(other)).resolves.not.toBeNull();
  });

  it('removes only the read ids from the index so concurrent sessions stay indexed', async () => {
    const first = await createLocalSession(localUser, 'user-1', 0);
    const indexKey = [...mockSets.keys()].find((key) => mockSets.get(key)!.has(first))!;
    mockRedis.del.mockClear();
    mockRedis.srem.mockClear();
    mockRedis.smembers.mockImplementationOnce(async (key: string) => {
      const ids = [...(mockSets.get(key) ?? [])];
      mockSets.get(key)!.add('late-session');
      return ids;
    });

    await expect(revokeLocalUserSessions('user-1')).resolves.toBe(1);
    expect(mockRedis.srem).toHaveBeenCalledWith(indexKey, first);
    expect(mockRedis.del.mock.calls.flat()).not.toContain(indexKey);
    expect([...mockSets.get(indexKey)!]).toEqual(['late-session']);
  });

  it('keeps the return path in the OIDC login transaction', async () => {
    const id = await saveLoginTransaction({ state: 's', nonce: 'n', codeVerifier: 'v', returnTo: '/dashboard' });
    await expect(consumeLoginTransaction(id)).resolves.toEqual({ state: 's', nonce: 'n', codeVerifier: 'v', returnTo: '/dashboard' });
  });
});

describe('OIDC refresh operation', () => {
 it('deletes incompatible sessions before token transport', async () => {
  (assertOidcBinding as jest.Mock).mockRejectedValueOnce(new Error('changed'));
  mockStrings.set('oidc:session:incompatible', 'stored');
  await expect(refreshSessionIfNeeded('incompatible', { provider: 'oidc', user: { sub: 'u' }, refreshToken: 'enc:r', accessTokenExpiresAt: 1, issuer: 'https://old.example', configurationFingerprint: 'old' })).resolves.toBeNull();
  expect(mockStrings.has('oidc:session:incompatible')).toBe(false);
  expect(refreshOidcTokens).not.toHaveBeenCalled();
 });
 it('passes one loaded context to every refresh helper', async () => {
  jest.clearAllMocks();
  (refreshOidcTokens as jest.Mock).mockResolvedValueOnce({ refresh_token: 'next', id_token: 'i', access_token: 'a', expires_in: 300 });
  (validateIdToken as jest.Mock).mockResolvedValueOnce({ sub: 'u' });
  (getUserInfo as jest.Mock).mockResolvedValueOnce({ sub: 'u' });
  const result = await refreshSessionIfNeeded('snapshot', { provider: 'oidc', user: { sub: 'u' }, refreshToken: 'enc:r', accessTokenExpiresAt: 1 });
  const context = (loadOidcOperationContext as jest.Mock).mock.results[0].value;
  const resolved = await context;
  expect(loadOidcOperationContext).toHaveBeenCalledTimes(1);
  expect(refreshOidcTokens).toHaveBeenCalledWith(resolved, 'r');
  expect(validateIdToken).toHaveBeenCalledWith(resolved, 'i');
  expect(getUserInfo).toHaveBeenCalledWith(resolved, 'a');
  expect(result).toMatchObject({ issuer: 'https://a.example', configurationFingerprint: 'a' });
 });
});
