import { Router, Request, Response } from 'express';
import { timingSafeEqual } from 'crypto';
import {
  createSession,
  consumeLoginTransaction,
  deleteSession,
  getRefreshTokenForSession,
  getSession,
  saveLoginTransaction,
} from '../services/authSessionService';
import {
  createAuthorizationRequest,
  exchangeAuthorizationCode,
  getLogoutUrl,
  getUserInfo,
  OidcError,
  revokeRefreshToken,
  validateIdToken,
} from '../services/oidcService';
import {
  AuthenticatedRequest,
  cookieOptions,
  getCookie,
  LOGIN_COOKIE,
  requireAuthentication,
  requireTrustedOrigin,
  SESSION_COOKIE,
} from '../middlewares/authentication';

const router = Router();
const LOGIN_COOKIE_MAX_AGE = 5 * 60 * 1000;
const SESSION_COOKIE_MAX_AGE = 8 * 60 * 60 * 1000;

const matches = (left: string, right: string): boolean => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

const appOrigin = (): string => (process.env.APP_ORIGIN || '').replace(/\/$/, '');

router.get('/oidc/login', async (_request: Request, response: Response, next) => {
  try {
    const authorization = await createAuthorizationRequest();
    const transactionId = await saveLoginTransaction({
      state: authorization.state,
      nonce: authorization.nonce,
      codeVerifier: authorization.codeVerifier,
    });
    response.cookie(LOGIN_COOKIE, transactionId, cookieOptions(LOGIN_COOKIE_MAX_AGE));
    response.redirect(302, authorization.authorizationUrl);
  } catch (error) {
    next(error);
  }
});

router.get('/oidc/callback', async (request: Request, response: Response) => {
  const fail = (reason: string): void => {
    response.clearCookie(LOGIN_COOKIE, cookieOptions());
    response.redirect(302, `${appOrigin()}/?auth_error=${encodeURIComponent(reason)}`);
  };

  try {
    if (typeof request.query.error === 'string') {
      fail('access_denied');
      return;
    }

    const code = typeof request.query.code === 'string' ? request.query.code : '';
    const state = typeof request.query.state === 'string' ? request.query.state : '';
    const transaction = await consumeLoginTransaction(getCookie(request, LOGIN_COOKIE));
    response.clearCookie(LOGIN_COOKIE, cookieOptions());
    if (!code || !state || !transaction || !matches(state, transaction.state)) {
      fail('invalid_callback');
      return;
    }

    const tokens = await exchangeAuthorizationCode(code, transaction.codeVerifier);
    if (!tokens.refresh_token) {
      fail('missing_refresh_token');
      return;
    }
    const claims = await validateIdToken(tokens.id_token, transaction.nonce);
    const user = await getUserInfo(tokens.access_token);
    if (claims.sub !== user.sub) {
      fail('invalid_identity');
      return;
    }
    const sessionId = await createSession(user, tokens.refresh_token, tokens.expires_in);
    response.cookie(SESSION_COOKIE, sessionId, cookieOptions(SESSION_COOKIE_MAX_AGE));
    response.redirect(302, `${appOrigin()}/`);
  } catch (error) {
    if (error instanceof OidcError) {
      console.error('[OIDC] Callback failed:', {
        code: error.code,
        providerStatus: error.providerStatus,
        providerError: error.providerError,
      });
    } else {
      console.error('[OIDC] Callback failed:', error instanceof Error ? error.message : error);
    }
    fail('authentication_failed');
  }
});

router.get('/me', requireAuthentication, (request: AuthenticatedRequest, response: Response) => {
  response.status(200).json({ success: true, data: request.auth?.session.user });
});

router.post('/logout', requireAuthentication, requireTrustedOrigin, async (request: AuthenticatedRequest, response: Response, next) => {
  try {
    const session = await getSession(request.auth?.sessionId);
    await deleteSession(request.auth?.sessionId);
    response.clearCookie(SESSION_COOKIE, cookieOptions());
    if (session) await revokeRefreshToken(getRefreshTokenForSession(session));
    response.status(200).json({ success: true, logoutUrl: await getLogoutUrl() });
  } catch (error) {
    next(error);
  }
});

export default router;
