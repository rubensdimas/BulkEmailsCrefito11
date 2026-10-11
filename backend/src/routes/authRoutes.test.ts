const mockChangeOwnPassword = jest.fn();
jest.mock('../services/userAdminService', () => ({ ...jest.requireActual('../services/userAdminService'), createUserAdminService: () => ({ changeOwnPassword: mockChangeOwnPassword }) }));
const mockUsers = { upsertOidcUser: jest.fn(), recordLogin: jest.fn() };
jest.mock('../services/databaseService', () => ({ getUserRepository: () => mockUsers }));
const mockRedisDelete = jest.fn().mockResolvedValue(1);
jest.mock('../config/redis', () => ({ getRedisClient: () => ({ del: mockRedisDelete }) }));
import type { NextFunction, Request, Response } from 'express';
jest.mock('../services/loginAttemptLimiter', () => ({
  isLoginBlocked: jest.fn().mockResolvedValue(false),
  registerFailedLogin: jest.fn().mockResolvedValue(undefined),
  clearFailedLogins: jest.fn().mockResolvedValue(undefined),
}));
import { clearFailedLogins, isLoginBlocked, registerFailedLogin } from '../services/loginAttemptLimiter';

jest.mock('../services/oidcService', () => ({
  loadOidcOperationContext: jest.fn().mockResolvedValue({ configuration: { issuer: 'https://idp.example' }, configurationFingerprint: 'fingerprint' }),
  assertOidcBinding: jest.fn().mockResolvedValue(undefined),
  isOidcEnabled: jest.fn().mockResolvedValue(true),
  createAuthorizationRequest: jest.fn(),
  exchangeAuthorizationCode: jest.fn(),
  getLogoutUrl: jest.fn(),
  getUserInfo: jest.fn(),
  revokeRefreshToken: jest.fn(),
  refreshOidcTokens: jest.fn(),
  validateIdToken: jest.fn(),
  OidcError: jest.requireActual('../services/oidcConfiguration').OidcError,
}));
jest.mock('../services/authSessionService', () => ({
  ...jest.requireActual('../services/authSessionService'),
  saveLoginTransaction: jest.fn(),
  consumeLoginTransaction: jest.fn(),
  createSession: jest.fn(),
  deleteSession: jest.fn(),
  getSession: jest.fn(),
  getRefreshTokenForSession: jest.fn(),
}));

import authRoutes from './authRoutes';
import { requireTrustedOrigin, SESSION_COOKIE } from '../middlewares/authentication';
import {
  consumeLoginTransaction,
  createSession,
  getSession,
  saveLoginTransaction,
} from '../services/authSessionService';
import {
  assertOidcBinding,
  loadOidcOperationContext,
  OidcError,
  createAuthorizationRequest,
  exchangeAuthorizationCode,
  getLogoutUrl,
  getUserInfo,
  revokeRefreshToken,
  refreshOidcTokens,
  validateIdToken,
} from '../services/oidcService';

type Handler = (request: Request, response: Response, next: NextFunction) => unknown;
interface Layer { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Handler }> } }

const routeStack = (method: string, path: string): Handler[] => {
  const layer = (authRoutes as unknown as { stack: Layer[] }).stack
    .find((item) => item.route?.path === path && item.route.methods[method]);
  if (!layer?.route) throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  return layer.route.stack.map((item) => item.handle);
};
const finalHandler = (method: string, path: string): Handler => routeStack(method, path).slice(-1)[0];

const mockResponse = () => {
  const response = { redirect: jest.fn(), cookie: jest.fn(), clearCookie: jest.fn(), status: jest.fn(), json: jest.fn() };
  response.status.mockReturnValue(response);
  return response;
};
const next = jest.fn() as unknown as NextFunction;
const localSession = { provider: 'local', user: { sub: 'local:user-1', name: 'admin' }, localUserId: 'user-1' };

describe('auth routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.APP_ORIGIN = 'https://app.example';
    mockUsers.upsertOidcUser.mockResolvedValue({ id: 'acc', disabledAt: null });
  });

  it('protects local login with the trusted origin check', () => {
    expect(routeStack('post', '/local/login')).toContain(requireTrustedOrigin);
    expect(() => routeStack('get', '/options')).not.toThrow();
  });

  it.each([
    ['//evil.example', '/'],
    ['/status/abc?page=2', '/status/abc?page=2'],
  ])('stores the sanitized return path %p when starting OIDC login', async (nextParam, expected) => {
    (createAuthorizationRequest as jest.Mock).mockResolvedValue({
      authorizationUrl: 'https://idp.example/authorize', state: 's', nonce: 'n', codeVerifier: 'v',
    });
    (saveLoginTransaction as jest.Mock).mockResolvedValue('tx');
    const response = mockResponse();
    await finalHandler('get', '/oidc/login')({ query: { next: nextParam } } as unknown as Request, response as unknown as Response, next);
    expect(saveLoginTransaction).toHaveBeenCalledWith({ issuer: undefined, configurationFingerprint: undefined, state: 's', nonce: 'n', codeVerifier: 'v', returnTo: expected });
    expect(response.redirect).toHaveBeenCalledWith(302, 'https://idp.example/authorize');
  });

  it('sends OIDC callback failures to the login page', async () => {
    (consumeLoginTransaction as jest.Mock).mockResolvedValue(null);
    const response = mockResponse();
    await finalHandler('get', '/oidc/callback')({ query: {}, headers: {} } as unknown as Request, response as unknown as Response, next);
    expect(response.redirect).toHaveBeenCalledWith(302, 'https://app.example/login?auth_error=invalid_callback');
  });

  it('returns to the stored path after a successful OIDC callback', async () => {
    (consumeLoginTransaction as jest.Mock).mockResolvedValue({ state: 's', nonce: 'n', codeVerifier: 'v', returnTo: '/dashboard' });
    (exchangeAuthorizationCode as jest.Mock).mockResolvedValue({ refresh_token: 'r', id_token: 'i', access_token: 'a', expires_in: 300 });
    (validateIdToken as jest.Mock).mockResolvedValue({ sub: 'u' });
    (getUserInfo as jest.Mock).mockResolvedValue({ sub: 'u', name: 'Usuária' });
    (createSession as jest.Mock).mockResolvedValue('sid');
    const response = mockResponse();
    await finalHandler('get', '/oidc/callback')(
      { query: { code: 'c', state: 's' }, headers: {} } as unknown as Request,
      response as unknown as Response,
      next,
    );
    expect(response.redirect).toHaveBeenCalledWith(302, 'https://app.example/dashboard');
    expect(mockUsers.upsertOidcUser).toHaveBeenCalledWith({ issuer: 'https://idp.example', sub: 'u', name: 'Usuária', email: undefined });
    expect(mockUsers.recordLogin).toHaveBeenCalledWith('acc');
    expect(loadOidcOperationContext).toHaveBeenCalledTimes(1);
    const context = await (loadOidcOperationContext as jest.Mock).mock.results[0].value;
    expect(exchangeAuthorizationCode).toHaveBeenCalledWith(context, 'c', 'v');
    expect(validateIdToken).toHaveBeenCalledWith(context, 'i', 'n');
    expect(getUserInfo).toHaveBeenCalledWith(context, 'a');
    expect(createSession).toHaveBeenCalledWith(context, { sub: 'u', name: 'Usuária' }, 'r', 300);
  });

  it('ends a local session without contacting the OIDC provider', async () => {
    (getSession as jest.Mock).mockResolvedValue(localSession);
    const response = mockResponse();
    await finalHandler('post', '/logout')(
      { auth: { sessionId: 'sid', session: localSession } } as unknown as Request,
      response as unknown as Response,
      next,
    );
    expect(revokeRefreshToken).not.toHaveBeenCalled();
    expect(getLogoutUrl).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith({ success: true, logoutUrl: null });
  });

  it.each([
    [localSession, 'local'],
    [{ provider: 'oidc', user: { sub: 'u' }, refreshToken: 'r', accessTokenExpiresAt: 1 }, 'oidc'],
  ])('reports the session provider on /me', async (session, provider) => {
    const response = mockResponse();
    await finalHandler('get', '/me')({ auth: { sessionId: 'sid', session, account: { id: 'acc', provider, role: 'operator', name: 'name' in session.user ? session.user.name : undefined, mustChangePassword: false } } } as unknown as Request, response as unknown as Response, next);
    expect(response.json).toHaveBeenCalledWith({ success: true, data: { userId: 'acc', ...session.user, provider, role: 'operator', mustChangePassword: false } });
  });
});

describe('OIDC operation failures', () => {
 beforeEach(() => { jest.clearAllMocks(); process.env.APP_ORIGIN = 'https://app.example'; });
 it('redirects disabled login to not_configured', async () => {
   (loadOidcOperationContext as jest.Mock).mockRejectedValueOnce(new OidcError('off', 'not_configured'));
   const response = mockResponse();
   await finalHandler('get', '/oidc/login')({ query: {} } as unknown as Request, response as unknown as Response, next);
   expect(response.redirect).toHaveBeenCalledWith(302, 'https://app.example/login?auth_error=not_configured');
 });
 it('rejects changed callback binding before exchange', async () => {
   (consumeLoginTransaction as jest.Mock).mockResolvedValueOnce({ state: 's', nonce: 'n', codeVerifier: 'v', issuer: 'https://old.example', configurationFingerprint: 'old' });
   (assertOidcBinding as jest.Mock).mockRejectedValueOnce(new OidcError('changed', 'not_configured'));
   const response = mockResponse();
   const log = jest.spyOn(console, 'error').mockImplementation(() => {});
   await finalHandler('get', '/oidc/callback')({ query: { code: 'c', state: 's' }, headers: {} } as unknown as Request, response as unknown as Response, next);
   expect(exchangeAuthorizationCode).not.toHaveBeenCalled(); expect(getUserInfo).not.toHaveBeenCalled();
   expect(response.redirect).toHaveBeenCalledWith(302, 'https://app.example/login?auth_error=not_configured'); log.mockRestore();
 });
 it('rejects changed logout binding before revocation', async () => {
   (getSession as jest.Mock).mockResolvedValueOnce({ provider: 'oidc', user: { sub: 'u' }, refreshToken: 'r', accessTokenExpiresAt: 1 });
   (assertOidcBinding as jest.Mock).mockRejectedValueOnce(new OidcError('changed', 'not_configured'));
   const response = mockResponse();
   await finalHandler('post', '/logout')({ auth: { sessionId: 'sid' } } as unknown as Request, response as unknown as Response, next);
   expect(revokeRefreshToken).not.toHaveBeenCalled(); expect(getLogoutUrl).not.toHaveBeenCalled();
   expect(response.clearCookie).toHaveBeenCalled();
 });
});

describe('real authentication route chain', () => {
  it.each([['get', '/me'], ['post', '/logout']])('preserves changed-configuration reason on %s %s', async (method, path) => {
    jest.clearAllMocks();
    (getSession as jest.Mock).mockResolvedValueOnce({ provider: 'oidc', user: { sub: 'u' }, refreshToken: 'encrypted-token', accessTokenExpiresAt: 1, issuer: 'https://old.example', configurationFingerprint: 'old' });
    (assertOidcBinding as jest.Mock).mockRejectedValueOnce(new OidcError('changed', 'not_configured'));
    const response = mockResponse();
    const request = { method: method.toUpperCase(), headers: { cookie: `${SESSION_COOKIE}=sid` }, get: jest.fn().mockReturnValue('https://app.example') } as unknown as Request;
    let reachedHandler = false;
    const handlers = routeStack(method, path);
    for (const handler of handlers) {
      let advanced = false;
      const stepNext = jest.fn((error?: unknown) => { if (error) throw error; advanced = true; });
      if (handler === handlers[handlers.length - 1]) reachedHandler = true;
      await handler(request, response as unknown as Response, stepNext);
      if (!advanced) break;
    }
    expect(reachedHandler).toBe(false);
    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith({ success: false, error: 'not_configured' });
    expect(response.clearCookie).toHaveBeenCalledWith(SESSION_COOKIE, expect.any(Object));
    expect(mockRedisDelete).toHaveBeenCalledWith('oidc:session:sid');
    expect(refreshOidcTokens).not.toHaveBeenCalled();
    expect(revokeRefreshToken).not.toHaveBeenCalled();
    expect(exchangeAuthorizationCode).not.toHaveBeenCalled();
    expect(getUserInfo).not.toHaveBeenCalled();
  });
});

it('refuses disabled OIDC account before creating session', async () => {
  jest.clearAllMocks();
  mockUsers.upsertOidcUser.mockResolvedValueOnce({ id: 'acc', disabledAt: new Date() });
  (consumeLoginTransaction as jest.Mock).mockResolvedValue({ state: 's', nonce: 'n', codeVerifier: 'v' });
  (exchangeAuthorizationCode as jest.Mock).mockResolvedValue({ refresh_token: 'r', id_token: 'i', access_token: 'a', expires_in: 300 });
  (validateIdToken as jest.Mock).mockResolvedValue({ sub: 'u' });
  (getUserInfo as jest.Mock).mockResolvedValue({ sub: 'u' });
  const response = mockResponse();
  await finalHandler('get', '/oidc/callback')({ query: { code: 'c', state: 's' }, headers: {} } as unknown as Request, response as unknown as Response, next);
  expect(response.redirect).toHaveBeenCalledWith(302, 'https://app.example/login?auth_error=unauthorized');
  expect(createSession).not.toHaveBeenCalled();
  expect(mockUsers.recordLogin).not.toHaveBeenCalled();
});

it('changes own password and reports domain errors', async () => {
  const { UserAdminError } = jest.requireActual('../services/userAdminService');
  const account = { id: 'l', provider: 'local' };
  const request = { auth: { account }, body: { currentPassword: 'a', newPassword: 'b' } } as unknown as Request;
  let response = mockResponse();
  await finalHandler('post', '/password')(request, response as unknown as Response, next);
  expect(mockChangeOwnPassword).toHaveBeenCalledWith(account, 'a', 'b');
  expect(response.json).toHaveBeenCalledWith({ success: true });
  mockChangeOwnPassword.mockRejectedValueOnce(new UserAdminError('credentials_changed', 409, 'Sua senha foi alterada. Entre novamente para continuar.'));
  response = mockResponse();
  await finalHandler('post', '/password')(request, response as unknown as Response, next);
  expect(response.status).toHaveBeenCalledWith(409);
  expect(response.json).toHaveBeenCalledWith({ success: false, error: 'credentials_changed', message: 'Sua senha foi alterada. Entre novamente para continuar.' });
  expect(routeStack('post', '/password')).toContain(requireTrustedOrigin);
});

it('limits current-password guesses per user like the login limiter', async () => {
  const { UserAdminError } = jest.requireActual('../services/userAdminService');
  const account = { id: 'user-7', provider: 'local' };
  const request = { auth: { account }, ip: '10.0.0.1', body: { currentPassword: 'wrong', newPassword: 'b' } } as unknown as Request;
  mockChangeOwnPassword.mockRejectedValueOnce(new UserAdminError('invalid_current_password', 400, 'A senha atual está incorreta.'));
  let response = mockResponse();
  await finalHandler('post', '/password')(request, response as unknown as Response, next);
  expect(response.status).toHaveBeenCalledWith(400);
  expect(registerFailedLogin).toHaveBeenCalledWith('password-change:user-7', '10.0.0.1');

  (isLoginBlocked as jest.Mock).mockResolvedValueOnce(true);
  mockChangeOwnPassword.mockClear();
  response = mockResponse();
  await finalHandler('post', '/password')(request, response as unknown as Response, next);
  expect(isLoginBlocked).toHaveBeenLastCalledWith('password-change:user-7', '10.0.0.1');
  expect(mockChangeOwnPassword).not.toHaveBeenCalled();
  expect(response.status).toHaveBeenCalledWith(429);
  expect(response.json).toHaveBeenCalledWith({ success: false, error: 'too_many_attempts', message: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' });

  (registerFailedLogin as jest.Mock).mockClear();
  mockChangeOwnPassword.mockRejectedValueOnce(new UserAdminError('same_password', 400, 'A nova senha deve ser diferente da senha atual.'));
  await finalHandler('post', '/password')(request, mockResponse() as unknown as Response, next);
  expect(registerFailedLogin).not.toHaveBeenCalled();

  response = mockResponse();
  await finalHandler('post', '/password')(request, response as unknown as Response, next);
  expect(response.json).toHaveBeenCalledWith({ success: true });
  expect(clearFailedLogins).toHaveBeenCalledWith('password-change:user-7', '10.0.0.1');
});
