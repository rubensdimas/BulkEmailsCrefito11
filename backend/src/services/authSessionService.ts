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
}

export interface AuthenticatedUser {
  sub: string;
  name?: string;
  email?: string;
}

export interface AuthSession {
  user: AuthenticatedUser;
  refreshToken: string;
  accessTokenExpiresAt: number;
}

export const createOpaqueId = (): string => randomBytes(32).toString('base64url');

const loginKey = (id: string): string => `${LOGIN_PREFIX}${id}`;
const sessionKey = (id: string): string => `${SESSION_PREFIX}${id}`;

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
  const session: AuthSession = {
    user,
    refreshToken: encryptRefreshToken(refreshToken),
    accessTokenExpiresAt: Date.now() + expiresInSeconds * 1000,
  };
  await getRedisClient().set(sessionKey(id), JSON.stringify(session), 'EX', SESSION_TTL_SECONDS);
  return id;
};

const parseSession = (value: string | null): AuthSession | null => {
  if (!value) return null;
  try {
    const session = JSON.parse(value) as AuthSession;
    if (!session.user?.sub || !session.refreshToken || !Number.isFinite(session.accessTokenExpiresAt)) return null;
    return session;
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
  if (!shouldRefreshToken(session.accessTokenExpiresAt)) return session;

  try {
    const tokens = await refreshOidcTokens(decryptRefreshToken(session.refreshToken));
    const identity = await validateIdToken(tokens.id_token);
    const user = await getUserInfo(tokens.access_token);
    if (identity.sub !== session.user.sub || user.sub !== session.user.sub || !tokens.refresh_token) {
      await deleteSession(id);
      return null;
    }

    const next: AuthSession = {
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

export const getRefreshTokenForSession = (session: AuthSession): string => decryptRefreshToken(session.refreshToken);
