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
  expire: jest.fn(async () => 1),
};

jest.mock('../config/redis', () => ({ getRedisClient: () => mockRedis }));
jest.mock('./oidcService', () => ({
  refreshOidcTokens: jest.fn(),
  validateIdToken: jest.fn(),
  getUserInfo: jest.fn(),
  shouldRefreshToken: jest.fn(() => true),
  encryptRefreshToken: jest.fn((value: string) => `enc:${value}`),
  decryptRefreshToken: jest.fn((value: string) => value.replace(/^enc:/, '')),
}));

import { refreshOidcTokens } from './oidcService';
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

  it('round-trips a local session', async () => {
    const id = await createLocalSession(localUser, 'user-1');
    await expect(getSession(id)).resolves.toEqual({ provider: 'local', user: localUser, localUserId: 'user-1' });
    expect(mockRedis.set).toHaveBeenCalledWith(`oidc:session:${id}`, expect.any(String), 'EX', 8 * 60 * 60);
  });

  it('never refreshes a local session through OIDC', async () => {
    const id = await createLocalSession(localUser, 'user-1');
    const session = await getSession(id);
    await expect(refreshSessionIfNeeded(id, session!)).resolves.toBe(session);
    expect(refreshOidcTokens).not.toHaveBeenCalled();
  });

  it('revokes every session of a local user', async () => {
    const first = await createLocalSession(localUser, 'user-1');
    const second = await createLocalSession(localUser, 'user-1');
    const other = await createLocalSession({ sub: 'local:user-2', name: 'outro' }, 'user-2');

    await expect(revokeLocalUserSessions('user-1')).resolves.toBe(2);
    await expect(getSession(first)).resolves.toBeNull();
    await expect(getSession(second)).resolves.toBeNull();
    await expect(getSession(other)).resolves.not.toBeNull();
  });

  it('keeps the return path in the OIDC login transaction', async () => {
    const id = await saveLoginTransaction({ state: 's', nonce: 'n', codeVerifier: 'v', returnTo: '/dashboard' });
    await expect(consumeLoginTransaction(id)).resolves.toEqual({ state: 's', nonce: 'n', codeVerifier: 'v', returnTo: '/dashboard' });
  });
});
