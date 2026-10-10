import { NextFunction, Request, Response } from 'express';
import { cookieOptions, getCookie, SESSION_COOKIE, SESSION_COOKIE_MAX_AGE } from '../middlewares/authentication';
import type { AuthenticatedUser } from '../services/authSessionService';
import type { LocalAuthInput, LocalAuthResult } from '../services/localAuthService';

export const MAX_USERNAME_INPUT_LENGTH = 64;
// Bounds scrypt input size; the 128 code point policy applies when passwords are set.
export const MAX_PASSWORD_INPUT_LENGTH = 1024;

export interface LocalAuthControllerDependencies {
  enabled: () => boolean;
  oidcEnabled: () => Promise<boolean>;
  authenticate: (input: LocalAuthInput) => Promise<LocalAuthResult>;
  createSession: (user: AuthenticatedUser, localUserId: string) => Promise<string>;
  deleteSession: (sessionId: string | undefined) => Promise<void>;
}

const isValidCredentialInput = (username: unknown, password: unknown): username is string =>
  typeof username === 'string'
  && typeof password === 'string'
  && username.trim().length > 0
  && username.length <= MAX_USERNAME_INPUT_LENGTH
  && password.length > 0
  && password.length <= MAX_PASSWORD_INPUT_LENGTH;

export const createLocalAuthController = (deps: LocalAuthControllerDependencies) => ({
  options: async (_request: Request, response: Response, next: NextFunction): Promise<void> => {
    try { response.status(200).json({ success: true, data: { localLoginEnabled: deps.enabled(), oidcEnabled: await deps.oidcEnabled() } }); } catch (error) { next(error); }
  },

  login: async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    if (!deps.enabled()) {
      response.status(404).json({ success: false, error: 'Not found' });
      return;
    }

    const { username, password } = (request.body ?? {}) as Record<string, unknown>;
    if (!isValidCredentialInput(username, password)) {
      response.status(400).json({ success: false, error: 'invalid_request' });
      return;
    }

    try {
      const result = await deps.authenticate({ username, password: password as string, ip: request.ip ?? 'unknown' });
      if (!result.ok) {
        const blocked = result.reason === 'blocked';
        response.status(blocked ? 429 : 401).json({
          success: false,
          error: blocked ? 'too_many_attempts' : 'invalid_credentials',
        });
        return;
      }

      const user: AuthenticatedUser = { sub: `local:${result.user.id}`, name: result.user.username };
      await deps.deleteSession(getCookie(request, SESSION_COOKIE));
      const sessionId = await deps.createSession(user, result.user.id);
      response.cookie(SESSION_COOKIE, sessionId, cookieOptions(SESSION_COOKIE_MAX_AGE));
      response.status(200).json({ success: true, data: { ...user, provider: 'local' } });
    } catch (error) {
      next(error);
    }
  },
});
