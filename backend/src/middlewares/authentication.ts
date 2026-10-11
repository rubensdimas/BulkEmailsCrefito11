import { NextFunction, Request, Response } from 'express';
import type { User } from '../repositories/userRepository';
import { resolveAccount } from '../services/accountService';
import { getUserRepository } from '../services/databaseService';
import { OidcError } from '../services/oidcConfiguration';
import { AuthSession, BeforeTokenRefresh, deleteSession, getSession, refreshSessionIfNeeded, SessionAccountDisabledError } from '../services/authSessionService';

export const SESSION_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-bulkmail_session' : 'bulkmail_session';
export const LOGIN_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-bulkmail_oidc_login' : 'bulkmail_oidc_login';
export const SESSION_COOKIE_MAX_AGE = 8 * 60 * 60 * 1000;

export interface AuthenticatedRequest extends Request {
  auth?: { sessionId: string; session: AuthSession; account: User };
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

// Lookup only: unknown accounts are registered after a successful refresh, as before.
const rejectDisabledBeforeRefresh: BeforeTokenRefresh = async (bound) => {
  const existing = await getUserRepository().findByOidcSub(bound.issuer, bound.user.sub);
  if (existing?.disabledAt) throw new SessionAccountDisabledError();
};

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

    const currentSession = await refreshSessionIfNeeded(sessionId, session, rejectDisabledBeforeRefresh);
    if (!currentSession) {
      response.clearCookie(SESSION_COOKIE, cookieOptions());
      response.status(401).json({ success: false, error: 'Session expired' });
      return;
    }
    const account = await resolveAccount(currentSession, getUserRepository());
    if (!account || account.disabledAt) {
      // Revocation is an optimization; account/version checks remain authoritative.
      try { await deleteSession(sessionId); } catch { /* Redis cleanup is best effort. */ }
      response.clearCookie(SESSION_COOKIE, cookieOptions());
      response.status(401).json({ success: false, error: 'Account disabled' });
      return;
    }
    request.auth = { sessionId, session: currentSession, account };
    next();
  } catch (error) {
    if (error instanceof SessionAccountDisabledError) {
      // The refresh operation already ended the session.
      response.clearCookie(SESSION_COOKIE, cookieOptions());
      response.status(401).json({ success: false, error: 'Account disabled' });
      return;
    }
    if (error instanceof OidcError && error.code === 'not_configured') {
      response.clearCookie(SESSION_COOKIE, cookieOptions());
      response.status(401).json({ success: false, error: 'not_configured' });
      return;
    }
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


export const requireAdmin = (request: AuthenticatedRequest, response: Response, next: NextFunction): void => {
  if (request.auth?.account.role !== 'admin') {
    response.status(403).json({ success: false, error: 'forbidden' });
    return;
  }
  next();
};

export const requirePasswordCurrent = (request: AuthenticatedRequest, response: Response, next: NextFunction): void => {
  if (request.auth?.account.mustChangePassword) {
    response.status(403).json({ success: false, error: 'password_change_required' });
    return;
  }
  next();
};
