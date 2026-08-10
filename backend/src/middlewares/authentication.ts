import { NextFunction, Request, Response } from 'express';
import { AuthSession, getSession, refreshSessionIfNeeded } from '../services/authSessionService';

export const SESSION_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-bulkmail_session' : 'bulkmail_session';
export const LOGIN_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-bulkmail_oidc_login' : 'bulkmail_oidc_login';

export interface AuthenticatedRequest extends Request {
  auth?: { sessionId: string; session: AuthSession };
}

const cookies = (request: Request): Record<string, string> => {
  const header = request.headers.cookie;
  if (!header) return {};
  return header.split(';').reduce<Record<string, string>>((result, item) => {
    const separator = item.indexOf('=');
    if (separator <= 0) return result;
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    try {
      result[key] = decodeURIComponent(value);
    } catch {
      // Malformed cookies are ignored and treated as unauthenticated.
    }
    return result;
  }, {});
};

export const getCookie = (request: Request, name: string): string | undefined => cookies(request)[name];

export const cookieOptions = (maxAge?: number) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  ...(maxAge ? { maxAge } : {}),
});

export const requireAuthentication = async (
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const sessionId = getCookie(request, SESSION_COOKIE);
    const session = await getSession(sessionId);
    if (!session || !sessionId) {
      response.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    const currentSession = await refreshSessionIfNeeded(sessionId, session);
    if (!currentSession) {
      response.clearCookie(SESSION_COOKIE, cookieOptions());
      response.status(401).json({ success: false, error: 'Session expired' });
      return;
    }
    request.auth = { sessionId, session: currentSession };
    next();
  } catch (error) {
    next(error);
  }
};

export const requireTrustedOrigin = (request: Request, response: Response, next: NextFunction): void => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    next();
    return;
  }

  const expectedOrigin = process.env.APP_ORIGIN?.replace(/\/$/, '');
  const origin = request.get('Origin');
  if (!expectedOrigin || origin !== expectedOrigin) {
    response.status(403).json({ success: false, error: 'Untrusted request origin' });
    return;
  }
  next();
};
