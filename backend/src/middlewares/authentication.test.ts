const mockStrings = new Map<string, string>();
const mockSets = new Map<string, Set<string>>();
const mockRedis = {
  set: jest.fn(async (key: string, value: string) => { mockStrings.set(key, value); return 'OK'; }),
  get: jest.fn(async (key: string) => mockStrings.get(key) ?? null),
  del: jest.fn(async (...keys: string[]) => { keys.forEach(key => mockStrings.delete(key)); return keys.length; }),
  sadd: jest.fn(async (key: string, id: string) => { const set = mockSets.get(key) ?? new Set<string>(); set.add(id); mockSets.set(key, set); return 1; }),
  expire: jest.fn(async () => 1),
  smembers: jest.fn(async (key: string) => [...(mockSets.get(key) ?? [])]),
  srem: jest.fn(async (key: string, ...ids: string[]) => { ids.forEach(id => mockSets.get(key)?.delete(id)); return ids.length; }),
};
jest.mock('../config/redis', () => ({ getRedisClient: () => mockRedis }));
const mockUsers = { findById: jest.fn(), findByOidcSub: jest.fn(), upsertOidcUser: jest.fn() };
const mockLegacyOidcBinding = jest.fn();
jest.mock('../services/databaseService', () => ({ getUserRepository: () => mockUsers, getConfigService: () => ({ getLegacyOidcBinding: mockLegacyOidcBinding }) }));
import { Request, Response } from 'express';
import { requireAuthentication, requireAdmin, requirePasswordCurrent, requireTrustedOrigin, SESSION_COOKIE } from './authentication';
import { deleteSession, getSession, refreshSessionIfNeeded } from '../services/authSessionService';

jest.mock('../services/authSessionService', () => ({
  deleteSession: jest.fn(),
  getSession: jest.fn(),
  refreshSessionIfNeeded: jest.fn(),
}));

describe('trusted origin middleware', () => {
  const next = jest.fn();
  const status = jest.fn();
  const json = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.APP_ORIGIN = 'http://localhost:5173';
    status.mockReturnValue({ json });
  });

  it('allows safe methods without an Origin header', () => {
    requireTrustedOrigin({ method: 'GET' } as Request, { status } as unknown as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects a cross-origin state-changing request', () => {
    requireTrustedOrigin({ method: 'POST', get: jest.fn().mockReturnValue('https://untrusted.example') } as unknown as Request, { status } as unknown as Response, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ success: false, error: 'Untrusted request origin' });
  });

  it('accepts an authenticated state-changing request from the app origin', () => {
    requireTrustedOrigin({ method: 'POST', get: jest.fn().mockReturnValue('http://localhost:5173') } as unknown as Request, { status } as unknown as Response, next);
    expect(next).toHaveBeenCalled();
  });
});

describe('authentication middleware', () => {
  const next = jest.fn();
  const status = jest.fn();
  const json = jest.fn();
  const clearCookie = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    status.mockReturnValue({ json });
  });

  it('rejects a request without a session cookie', async () => {
    await requireAuthentication({ headers: {} } as Request, { status, clearCookie } as unknown as Response, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ success: false, error: 'Authentication required' });
  });

  it('attaches a verified session to the request', async () => {
    mockUsers.findByOidcSub.mockResolvedValue({ id: 'u', disabledAt: null, role: 'operator' });
    const session = {
      provider: 'oidc', issuer: 'https://idp.example',
      user: { sub: 'user-1', name: 'User One' },
      refreshToken: 'encrypted-refresh',
      accessTokenExpiresAt: Date.now() + 60_000,
    };
    (getSession as jest.Mock).mockResolvedValue(session);
    (refreshSessionIfNeeded as jest.Mock).mockResolvedValue(session);
    const request = { headers: { cookie: `${SESSION_COOKIE}=session-id` } } as Request;

    await requireAuthentication(request, { status, clearCookie } as unknown as Response, next);
    expect(next).toHaveBeenCalled();
    expect((request as Request & { auth?: { sessionId: string } }).auth?.sessionId).toBe('session-id');
  });
});


describe('account guards', () => {
  it.each(['disabled', 'missing'])('rejects %s account despite failed Redis cleanup', async (reason) => {
    const session = { provider: 'local', localUserId: 'u', credentialVersion: 0, user: { sub: 'local:u' } };
    (getSession as jest.Mock).mockResolvedValue(session);
    (refreshSessionIfNeeded as jest.Mock).mockResolvedValue(session);
    mockUsers.findById.mockResolvedValue(reason === 'missing' ? null : { provider: 'local', credentialVersion: 0, disabledAt: new Date() });
    (deleteSession as jest.Mock).mockRejectedValueOnce(new Error('Redis down'));
    const response = { status: jest.fn(), json: jest.fn(), clearCookie: jest.fn() };
    response.status.mockReturnValue(response);
    const next = jest.fn();
    await requireAuthentication({ headers: { cookie: `${SESSION_COOKIE}=sid` } } as Request, response as unknown as Response, next);
    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.clearCookie).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
  it.each(['operator', 'admin'])('checks current %s role', (role) => {
    const response = { status: jest.fn(), json: jest.fn() }; response.status.mockReturnValue(response);
    const next = jest.fn();
    requireAdmin({ auth: { account: { role } } } as unknown as Request, response as unknown as Response, next);
    if (role === 'operator') expect(response.json).toHaveBeenCalledWith({ success: false, error: 'forbidden' });
    else expect(next).toHaveBeenCalled();
  });
  it('requires password change', () => {
    const response = { status: jest.fn(), json: jest.fn() }; response.status.mockReturnValue(response);
    const next = jest.fn();
    requirePasswordCurrent({ auth: { account: { mustChangePassword: true } } } as unknown as Request, response as unknown as Response, next);
    expect(response.json).toHaveBeenCalledWith({ success: false, error: 'password_change_required' });
    expect(next).not.toHaveBeenCalled();
  });
});


describe('real local authentication and session lifecycle', () => {
  const sessions = jest.requireActual<typeof import('../services/authSessionService')>('../services/authSessionService');
  const { createLocalAuthService } = jest.requireActual<typeof import('../services/localAuthService')>('../services/localAuthService');
  const { hashPassword, verifyPassword, verifyAgainstDummy } = jest.requireActual<typeof import('../services/passwordHasher')>('../services/passwordHasher');
  const probe = async (id: string) => {
    const response = { status: jest.fn(), json: jest.fn(), clearCookie: jest.fn() }; response.status.mockReturnValue(response);
    const request = { headers: { cookie: `${SESSION_COOKIE}=${id}` } } as Request;
    const next = jest.fn();
    await requireAuthentication(request, response as unknown as Response, next);
    return { response, request, next };
  };
  beforeEach(() => {
    jest.clearAllMocks(); mockStrings.clear(); mockSets.clear();
    (getSession as jest.Mock).mockImplementation(sessions.getSession);
    (refreshSessionIfNeeded as jest.Mock).mockImplementation(sessions.refreshSessionIfNeeded);
    (deleteSession as jest.Mock).mockImplementation(sessions.deleteSession);
  });
  it('rejects sessions created after a concurrent reset with an old credential version', async () => {
    let account = { id: 'u', provider: 'local' as const, role: 'admin' as const, username: 'admin', passwordHash: await hashPassword('old password 123'), credentialVersion: 0, mustChangePassword: false, disabledAt: null, oidcSub: null, oidcIssuer: null, name: null, email: null, lastLoginAt: null };
    const users = { findByUsername: async () => ({ ...account }), recordLogin: async () => undefined };
    mockUsers.findById.mockImplementation(async () => ({ ...account }));
    const service = createLocalAuthService({ users, passwords: { verify: verifyPassword, verifyDummy: verifyAgainstDummy }, attempts: { isBlocked: async () => false, registerFailure: async () => undefined, clear: async () => undefined }, log: () => undefined });
    const authenticated = await service.authenticate({ username: 'admin', password: 'old password 123', ip: '127.0.0.1' });
    if (!authenticated.ok) throw new Error('fixture login failed');
    let release!: () => void;
    let entered!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    mockRedis.set.mockImplementationOnce(async (key, value) => { entered(); await barrier; mockStrings.set(key, value); return 'OK'; });
    const pending = sessions.createLocalSession({ sub: 'local:u' }, 'u', authenticated.credentialVersion);
    await started;
    account = { ...account, passwordHash: await hashPassword('new password 123'), credentialVersion: 1 };
    await expect(sessions.revokeLocalUserSessions('u')).resolves.toBe(0);
    release();
    const id = await pending;
    await expect(sessions.getSession(id)).resolves.toMatchObject({ credentialVersion: 0 });
    const { response, next } = await probe(id);
    expect(response.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(response.clearCookie).toHaveBeenCalled();
  });
  it('accepts legacy local sessions at version zero then invalidates them on reset', async () => {
    const account = { provider: 'local', credentialVersion: 0, disabledAt: null, role: 'admin', mustChangePassword: false };
    mockUsers.findById.mockImplementation(async () => ({ ...account }));
    mockStrings.set('oidc:session:legacy', JSON.stringify({ provider: 'local', localUserId: 'u', user: { sub: 'local:u' } }));
    expect((await probe('legacy')).next).toHaveBeenCalled();
    account.credentialVersion = 1;
    const { response, next } = await probe('legacy');
    expect(response.status).toHaveBeenCalledWith(401); expect(next).not.toHaveBeenCalled();
  });
  it('reads role and password status immediately on every request', async () => {
    const account = { provider: 'local', credentialVersion: 0, disabledAt: null, role: 'admin', mustChangePassword: false };
    mockUsers.findById.mockImplementation(async () => ({ ...account }));
    const id = await sessions.createLocalSession({ sub: 'local:u' }, 'u', 0);
    expect((await probe(id)).next).toHaveBeenCalled();
    account.role = 'operator'; account.mustChangePassword = true;
    const { request, response } = await probe(id);
    const next = jest.fn();
    requireAdmin(request, response as unknown as Response, next);
    requirePasswordCurrent(request, response as unknown as Response, next);
    expect(response.json).toHaveBeenCalledWith({ success: false, error: 'forbidden' });
    expect(response.json).toHaveBeenCalledWith({ success: false, error: 'password_change_required' });
    expect(next).not.toHaveBeenCalled();
  });
});


describe('verified legacy OIDC account lifecycle', () => {
  const sessions = jest.requireActual<typeof import('../services/authSessionService')>('../services/authSessionService');
  const oidc = jest.requireActual<typeof import('../services/oidcService')>('../services/oidcService');
  const settings = { enabled: true, issuer: 'https://original.example', clientId: 'client', clientSecret: 'secret', backchannelOrigin: '' };
  beforeEach(async () => {
    jest.clearAllMocks(); mockStrings.clear();
    process.env.APP_ORIGIN = 'https://app.example';
    process.env.OIDC_SESSION_ENCRYPTION_KEY = 'a'.repeat(64);
    oidc.setOidcSettingsSource(async () => settings);
    const original = await oidc.loadOidcOperationContext();
    mockLegacyOidcBinding.mockResolvedValue({ issuer: original.configuration.issuer, configurationFingerprint: original.configurationFingerprint });
    mockStrings.set('oidc:session:legacy-oidc', JSON.stringify({ user: { sub: 'legacy-sub', name: 'Ana' }, refreshToken: 'unused-encrypted', accessTokenExpiresAt: Date.now() + 60 * 60 * 1000 }));
    (getSession as jest.Mock).mockImplementation(sessions.getSession);
    (refreshSessionIfNeeded as jest.Mock).mockImplementation(sessions.refreshSessionIfNeeded);
    (deleteSession as jest.Mock).mockImplementation(sessions.deleteSession);
    mockUsers.findByOidcSub.mockResolvedValue(null);
    mockUsers.upsertOidcUser.mockResolvedValue({ id: 'oidc-account', provider: 'oidc', role: 'operator', disabledAt: null, mustChangePassword: false });
  });
  const probe = async () => {
    const response = { status: jest.fn(), json: jest.fn(), clearCookie: jest.fn() }; response.status.mockReturnValue(response);
    const request = { headers: { cookie: `${SESSION_COOKIE}=legacy-oidc` } } as Request;
    const next = jest.fn();
    await requireAuthentication(request, response as unknown as Response, next);
    return { request, response, next };
  };
  it('registers unexpired legacy sessions with verified original issuer', async () => {
    const { request, next } = await probe();
    expect(next).toHaveBeenCalledWith();
    expect(mockUsers.upsertOidcUser).toHaveBeenCalledWith({ issuer: 'https://original.example', sub: 'legacy-sub', name: 'Ana', email: undefined });
    expect((request as import('./authentication').AuthenticatedRequest).auth?.account.role).toBe('operator');
    await expect(sessions.getSession('legacy-oidc')).resolves.toMatchObject({ issuer: 'https://original.example', configurationFingerprint: expect.any(String) });
  });
  it('rejects changed issuer before any legacy account registration', async () => {
    oidc.setOidcSettingsSource(async () => ({ ...settings, issuer: 'https://replacement.example' }));
    const { response, next } = await probe();
    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith({ success: false, error: 'not_configured' });
    expect(next).not.toHaveBeenCalled();
    expect(mockUsers.upsertOidcUser).not.toHaveBeenCalled();
    expect(mockUsers.findByOidcSub).not.toHaveBeenCalled();
  });
  it('rejects partial unverified binding before registration', async () => {
    const legacy = JSON.parse(mockStrings.get('oidc:session:legacy-oidc')!);
    mockStrings.set('oidc:session:legacy-oidc', JSON.stringify({ ...legacy, issuer: 'https://original.example' }));
    const { response, next } = await probe();
    expect(response.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(mockUsers.upsertOidcUser).not.toHaveBeenCalled();
  });
});
