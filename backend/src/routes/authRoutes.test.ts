import type { NextFunction, Request, Response } from 'express';

jest.mock('../services/oidcService', () => ({
  createAuthorizationRequest: jest.fn(),
  exchangeAuthorizationCode: jest.fn(),
  getLogoutUrl: jest.fn(),
  getUserInfo: jest.fn(),
  revokeRefreshToken: jest.fn(),
  validateIdToken: jest.fn(),
  OidcError: class OidcError extends Error {},
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
import { requireTrustedOrigin } from '../middlewares/authentication';
import {
  consumeLoginTransaction,
  createSession,
  getSession,
  saveLoginTransaction,
} from '../services/authSessionService';
import {
  createAuthorizationRequest,
  exchangeAuthorizationCode,
  getLogoutUrl,
  getUserInfo,
  revokeRefreshToken,
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
    expect(saveLoginTransaction).toHaveBeenCalledWith({ state: 's', nonce: 'n', codeVerifier: 'v', returnTo: expected });
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
    await finalHandler('get', '/me')({ auth: { sessionId: 'sid', session } } as unknown as Request, response as unknown as Response, next);
    expect(response.json).toHaveBeenCalledWith({ success: true, data: { ...session.user, provider } });
  });
});
