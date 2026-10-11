import { randomBytes } from 'crypto';
import { OidcError } from './oidcConfiguration';
import { getRedisClient } from '../config/redis';
import {
  assertOidcBinding,
  loadOidcOperationContext,
  OidcOperationContext,
  decryptRefreshToken,
  encryptRefreshToken,
  getUserInfo,
  refreshOidcTokens,
  shouldRefreshToken,
  validateIdToken,
} from './oidcService';

const LOGIN_PREFIX = 'oidc:login:';
const SESSION_PREFIX = 'oidc:session:';
const LOGIN_TTL_SECONDS = 5 * 60;
const SESSION_TTL_SECONDS = 8 * 60 * 60;

export interface OidcLoginTransaction {
  issuer?: string;
  configurationFingerprint?: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo?: string;
}

export interface AuthenticatedUser {
  sub: string;
  name?: string;
  email?: string;
}

export type AuthProvider = 'oidc' | 'local';

export interface OidcAuthSession {
  provider: 'oidc';
  issuer?: string;
  configurationFingerprint?: string;
  user: AuthenticatedUser;
  refreshToken: string;
  accessTokenExpiresAt: number;
}

export interface LocalAuthSession {
  provider: 'local';
  user: AuthenticatedUser;
  localUserId: string;
  credentialVersion: number;
}

export type AuthSession = OidcAuthSession | LocalAuthSession;

export const isLocalSession = (session: AuthSession): session is LocalAuthSession => session.provider === 'local';

export const createOpaqueId = (): string => randomBytes(32).toString('base64url');

const loginKey = (id: string): string => `${LOGIN_PREFIX}${id}`;
const sessionKey = (id: string): string => `${SESSION_PREFIX}${id}`;
const LOCAL_USER_SESSIONS_PREFIX = 'auth:local:user-sessions:';
const localUserSessionsKey = (localUserId: string): string => `${LOCAL_USER_SESSIONS_PREFIX}${localUserId}`;

export const saveLoginTransaction = async (transaction: OidcLoginTransaction): Promise<string> => {
  const id = createOpaqueId();
  await getRedisClient().set(loginKey(id), JSON.stringify(transaction), 'EX', LOGIN_TTL_SECONDS);
  return id;
};

export const consumeLoginTransaction = async (id: string | undefined): Promise<OidcLoginTransaction | null> => {
  if (!id) return null;
  const redis = getRedisClient();
  const value = await redis.get(loginKey(id));
  if (!value) return null;
  await redis.del(loginKey(id));

  try {
    const transaction = JSON.parse(value) as OidcLoginTransaction;
    if (!transaction.state || !transaction.nonce || !transaction.codeVerifier) return null;
    return transaction;
  } catch {
    return null;
  }
};

export const createSession = async (
  context: OidcOperationContext,
  user: AuthenticatedUser,
  refreshToken: string,
  expiresInSeconds: number,
): Promise<string> => {
  const id = createOpaqueId();
  const session: OidcAuthSession = {
    provider: 'oidc',
    issuer: context.configuration.issuer,
    configurationFingerprint: context.configurationFingerprint,
    user,
    refreshToken: encryptRefreshToken(refreshToken),
    accessTokenExpiresAt: Date.now() + expiresInSeconds * 1000,
  };
  await getRedisClient().set(sessionKey(id), JSON.stringify(session), 'EX', SESSION_TTL_SECONDS);
  return id;
};

export const createLocalSession = async (user: AuthenticatedUser, localUserId: string, credentialVersion: number): Promise<string> => {
  const id = createOpaqueId();
  const redis = getRedisClient();
  if (!Number.isSafeInteger(credentialVersion) || credentialVersion < 0) throw new Error('Invalid credential version');
  const session: LocalAuthSession = { provider: 'local', user, localUserId, credentialVersion };
  await redis.set(sessionKey(id), JSON.stringify(session), 'EX', SESSION_TTL_SECONDS);
  // Index lets password resets and deactivation end every open session at once.
  await redis.sadd(localUserSessionsKey(localUserId), id);
  await redis.expire(localUserSessionsKey(localUserId), SESSION_TTL_SECONDS);
  return id;
};

export const revokeLocalUserSessions = async (localUserId: string): Promise<number> => {
  const redis = getRedisClient();
  const ids = await redis.smembers(localUserSessionsKey(localUserId));
  if (ids.length > 0) {
    await redis.del(...ids.map(sessionKey));
    // Remove only what was read: a session indexed concurrently keeps its entry.
    await redis.srem(localUserSessionsKey(localUserId), ...ids);
  }
  return ids.length;
};

type StoredSession = Partial<Omit<OidcAuthSession, 'provider'> & Omit<LocalAuthSession, 'provider'>> & {
  provider?: string;
};

const parseSession = (value: string | null): AuthSession | null => {
  if (!value) return null;
  try {
    const stored = JSON.parse(value) as StoredSession;
    if (!stored.user?.sub) return null;
    if (stored.provider === 'local') {
      const credentialVersion = stored.credentialVersion === undefined ? 0 : stored.credentialVersion;
      if (!Number.isSafeInteger(credentialVersion) || credentialVersion < 0) return null;
      return stored.localUserId ? { provider: 'local', user: stored.user, localUserId: stored.localUserId, credentialVersion } : null;
    }
    // Sessions created before Story 4.1 have no provider and are OIDC sessions.
    if (stored.provider !== undefined && stored.provider !== 'oidc') return null;
    if (!stored.refreshToken || !Number.isFinite(stored.accessTokenExpiresAt)) return null;
    return {
      provider: 'oidc',
      issuer: stored.issuer,
      configurationFingerprint: stored.configurationFingerprint,
      user: stored.user,
      refreshToken: stored.refreshToken,
      accessTokenExpiresAt: stored.accessTokenExpiresAt as number,
    };
  } catch {
    return null;
  }
};

export const deleteSession = async (id: string | undefined): Promise<void> => {
  if (id) await getRedisClient().del(sessionKey(id));
};

export const getSession = async (id: string | undefined): Promise<AuthSession | null> => {
  if (!id) return null;
  return parseSession(await getRedisClient().get(sessionKey(id)));
};

/** Raised by a refresh guard to end the session before any token reaches the provider. */
export class SessionAccountDisabledError extends Error {
  constructor() { super('Account disabled'); }
}

/** Receives the session bound to the verified issuer; may throw SessionAccountDisabledError. */
export type BeforeTokenRefresh = (bound: OidcAuthSession & { issuer: string }) => Promise<void>;

export const refreshSessionIfNeeded = async (id: string, session: AuthSession, beforeTokenRefresh?: BeforeTokenRefresh): Promise<AuthSession | null> => {
  if (isLocalSession(session)) return session;
  try {
    const context = await loadOidcOperationContext();
    await assertOidcBinding(context, session);
    if (!shouldRefreshToken(session.accessTokenExpiresAt)) {
      if (session.issuer === undefined && session.configurationFingerprint === undefined) {
        // assertOidcBinding verified the immutable bootstrap binding against this context.
        const bound: OidcAuthSession = { ...session, issuer: context.configuration.issuer, configurationFingerprint: context.configurationFingerprint };
        await getRedisClient().set(sessionKey(id), JSON.stringify(bound), 'EX', SESSION_TTL_SECONDS);
        return bound;
      }
      return session;
    }
    // Account checks run after binding verification and before any provider call.
    await beforeTokenRefresh?.({ ...session, issuer: context.configuration.issuer, configurationFingerprint: context.configurationFingerprint });
    const tokens = await refreshOidcTokens(context, decryptRefreshToken(session.refreshToken));
    const identity = await validateIdToken(context, tokens.id_token);
    const user = await getUserInfo(context, tokens.access_token);
    if (identity.sub !== session.user.sub || user.sub !== session.user.sub || !tokens.refresh_token) {
      await deleteSession(id);
      return null;
    }

    const next: OidcAuthSession = {
      provider: 'oidc',
      issuer: context.configuration.issuer,
      configurationFingerprint: context.configurationFingerprint,
      user: { sub: user.sub, name: user.name, email: user.email },
      refreshToken: encryptRefreshToken(tokens.refresh_token),
      accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
    };
    await getRedisClient().set(sessionKey(id), JSON.stringify(next), 'EX', SESSION_TTL_SECONDS);
    return next;
  } catch (error) {
    await deleteSession(id);
    if (error instanceof SessionAccountDisabledError) throw error;
    // Authentication must preserve the login-required configuration signal.
    if (error instanceof OidcError && ['not_configured', 'configuration_error'].includes(error.code)) {
      throw new OidcError('Configuração da intranet indisponível. Entre novamente.', 'not_configured');
    }
    return null;
  }
};

export const getRefreshTokenForSession = (session: OidcAuthSession): string => decryptRefreshToken(session.refreshToken);
