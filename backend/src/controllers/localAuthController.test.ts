import type { NextFunction, Request, Response } from 'express';
import { SESSION_COOKIE } from '../middlewares/authentication';
import { createLocalAuthController } from './localAuthController';

const admin = {
  id: 'user-1', username: 'admin', passwordHash: 'h',
  provider: 'local' as const, role: 'admin' as const,
  oidcSub: null, oidcIssuer: null, credentialVersion: 0,
  email: null, name: null, mustChangePassword: false,
  disabledAt: null, lastLoginAt: null,
};

const setup = (enabled = true) => {
  const deps = {
    enabled: jest.fn(() => enabled),
    oidcEnabled: jest.fn().mockResolvedValue(true),
    authenticate: jest.fn(),
    createSession: jest.fn().mockResolvedValue('new-session'),
    deleteSession: jest.fn().mockResolvedValue(undefined),
  };
  const response = { status: jest.fn(), json: jest.fn(), cookie: jest.fn() };
  response.status.mockReturnValue(response);
  const next = jest.fn() as unknown as NextFunction;
  return { deps, response, next, controller: createLocalAuthController(deps) };
};

const request = (body: unknown, cookie?: string): Request =>
  ({ body, ip: '203.0.113.7', headers: cookie ? { cookie } : {} }) as unknown as Request;

describe('localAuthController', () => {
  it('reports which login methods are available', async () => {
    const { controller, response, next } = setup(false);
    await controller.options({} as Request, response as unknown as Response, next);
    expect(response.json).toHaveBeenCalledWith({ success: true, data: { localLoginEnabled: false, oidcEnabled: true } });
  });

  it('responds 404 when local login is disabled', async () => {
    const { controller, deps, response, next } = setup(false);
    await controller.login(request({ username: 'admin', password: 'x'.repeat(12) }), response as unknown as Response, next);
    expect(response.status).toHaveBeenCalledWith(404);
    expect(deps.authenticate).not.toHaveBeenCalled();
  });

  it.each([
    [{}],
    [{ username: 'admin' }],
    [{ username: '   ', password: 'x'.repeat(12) }],
    [{ username: 'a'.repeat(65), password: 'x'.repeat(12) }],
    [{ username: 'admin', password: 'x'.repeat(1025) }],
    [{ username: ['admin'], password: 'x'.repeat(12) }],
  ])('rejects malformed body %p with 400', async (body) => {
    const { controller, deps, response, next } = setup();
    await controller.login(request(body), response as unknown as Response, next);
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({ success: false, error: 'invalid_request' });
    expect(deps.authenticate).not.toHaveBeenCalled();
  });

  it('answers invalid credentials with 401 and no cookie', async () => {
    const { controller, deps, response, next } = setup();
    deps.authenticate.mockResolvedValue({ ok: false, reason: 'invalid_credentials' });
    await controller.login(request({ username: 'admin', password: 'wrong password' }), response as unknown as Response, next);
    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith({ success: false, error: 'invalid_credentials' });
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it('answers blocked attempts with 429', async () => {
    const { controller, deps, response, next } = setup();
    deps.authenticate.mockResolvedValue({ ok: false, reason: 'blocked' });
    await controller.login(request({ username: 'admin', password: 'whatever pass' }), response as unknown as Response, next);
    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.json).toHaveBeenCalledWith({ success: false, error: 'too_many_attempts' });
  });

  it('replaces any previous session and sets the session cookie on success', async () => {
    const { controller, deps, response, next } = setup();
    deps.authenticate.mockResolvedValue({ ok: true, user: admin, credentialVersion: 0 });
    await controller.login(
      request({ username: 'Admin', password: 'correct password' }, `${SESSION_COOKIE}=old-session`),
      response as unknown as Response,
      next,
    );
    expect(deps.authenticate).toHaveBeenCalledWith({ username: 'Admin', password: 'correct password', ip: '203.0.113.7' });
    expect(deps.deleteSession).toHaveBeenCalledWith('old-session');
    expect(deps.createSession).toHaveBeenCalledWith({ sub: 'local:user-1', name: 'admin' }, 'user-1', 0);
    expect(response.cookie).toHaveBeenCalledWith(SESSION_COOKIE, 'new-session', expect.objectContaining({ httpOnly: true }));
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      data: { userId: 'user-1', sub: 'local:user-1', name: 'admin', provider: 'local', role: 'admin', mustChangePassword: false },
    });
  });

  it('forwards infrastructure failures to the error handler', async () => {
    const { controller, deps, response, next } = setup();
    const failure = new Error('Redis down');
    deps.authenticate.mockRejectedValue(failure);
    await controller.login(request({ username: 'admin', password: 'correct password' }), response as unknown as Response, next);
    expect(next).toHaveBeenCalledWith(failure);
    expect(response.cookie).not.toHaveBeenCalled();
    expect(deps.createSession).not.toHaveBeenCalled();
  });
});
