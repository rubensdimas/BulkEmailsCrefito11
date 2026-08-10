import { Request, Response } from 'express';
import { requireAuthentication, requireTrustedOrigin, SESSION_COOKIE } from './authentication';
import { getSession, refreshSessionIfNeeded } from '../services/authSessionService';

jest.mock('../services/authSessionService', () => ({
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
    const session = {
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
