import { randomBytes } from 'crypto';
import { getRedisClient } from '../config/redis';
import {
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
  user: AuthenticatedUser;
  refreshToken: string;
  accessTokenExpiresAt: number;
}

export interface LocalAuthSession {
  provider: 'local';
  user: AuthenticatedUser;
  localUserId: string;
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
  user: AuthenticatedUser,
  refreshToken: string,
  expiresInSeconds: number,
): Promise<string> => {
  const id = createOpaqueId();
  const session: OidcAuthSession = {
    provider: 'oidc',
    user,
    refreshToken: encryptRefreshToken(refreshToken),
    accessTokenExpiresAt: Date.now() + expiresInSeconds * 1000,
  };
  await getRedisClient().set(sessionKey(id), JSON.stringify(session), 'EX', SESSION_TTL_SECONDS);
  return id;
};

export const createLocalSession = async (user: AuthenticatedUser, localUserId: string): Promise<string> => {
  const id = createOpaqueId();
  const redis = getRedisClient();
  const session: LocalAuthSession = { provider: 'local', user, localUserId };
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
      return stored.localUserId ? { provider: 'local', user: stored.user, localUserId: stored.localUserId } : null;
    }
    // Sessions created before Story 4.1 have no provider and are OIDC sessions.
    if (stored.provider !== undefined && stored.provider !== 'oidc') return null;
    if (!stored.refreshToken || !Number.isFinite(stored.accessTokenExpiresAt)) return null;
    return {
      provider: 'oidc',
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

export const refreshSessionIfNeeded = async (id: string, session: AuthSession): Promise<AuthSession | null> => {
  if (isLocalSession(session)) return session;
  if (!shouldRefreshToken(session.accessTokenExpiresAt)) return session;

  try {
    const tokens = await refreshOidcTokens(decryptRefreshToken(session.refreshToken));
    const identity = await validateIdToken(tokens.id_token);
    const user = await getUserInfo(tokens.access_token);
    if (identity.sub !== session.user.sub || user.sub !== session.user.sub || !tokens.refresh_token) {
      await deleteSession(id);
      return null;
    }

    const next: OidcAuthSession = {
      provider: 'oidc',
      user: { sub: user.sub, name: user.name, email: user.email },
      refreshToken: encryptRefreshToken(tokens.refresh_token),
      accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
    };
    await getRedisClient().set(sessionKey(id), JSON.stringify(next), 'EX', SESSION_TTL_SECONDS);
    return next;
  } catch {
    await deleteSession(id);
    return null;
  }
};

export const getRefreshTokenForSession = (session: OidcAuthSession): string => decryptRefreshToken(session.refreshToken);
