import {
  createHash,
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify,
} from 'crypto';
import { readFileSync } from 'fs';
import { isAbsolute, resolve } from 'path';

export interface OidcMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  revocation_endpoint?: string;
  end_session_endpoint?: string;
  id_token_signing_alg_values_supported?: string[];
  code_challenge_methods_supported?: string[];
}

export interface OidcTokens {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  expires_in: number;
}

export interface OidcIdentity {
  sub: string;
  name?: string;
  email?: string;
}

interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  nonce?: string;
}

interface Jwk {
  kty: string;
  kid?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

interface JwksResponse {
  keys: Jwk[];
}

interface OidcConfiguration {
  issuer: string;
  backchannelOrigin?: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  appOrigin: string;
}

const DISCOVERY_TTL_MS = 5 * 60 * 1000;
const TOKEN_REFRESH_SKEW_MS = 60 * 1000;
let metadataCache: { value: OidcMetadata; expiresAt: number; cacheKey: string } | null = null;

export class OidcError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'oidc_error',
    public readonly providerStatus?: number,
    public readonly providerError?: string,
  ) {
    super(message);
  }
}

const base64Url = (value: Buffer): string => value.toString('base64url');

const decodeBase64UrlJson = <T>(value: string): T => {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
  } catch {
    throw new OidcError('Invalid token received from identity provider', 'invalid_token');
  }
};

const getSecret = (name: string): string => {
  const value = process.env[name];
  if (value) return value.trim();

  const path = process.env[`${name}_FILE`];
  if (path) {
    try {
      let secret: string;
      try {
        secret = readFileSync(path, 'utf8').trim();
      } catch (error) {
        if (isAbsolute(path)) throw error;
        secret = readFileSync(resolve(__dirname, '../../../', path), 'utf8').trim();
      }
      if (secret) return secret;
    } catch {
      throw new OidcError(`${name}_FILE is not readable`, 'configuration_error');
    }
  }

  throw new OidcError(`${name} is required`, 'configuration_error');
};

const getConfiguration = (): OidcConfiguration => {
  const issuer = (process.env.OIDC_ISSUER || '').replace(/\/$/, '');
  const backchannelOrigin = (process.env.OIDC_BACKCHANNEL_ORIGIN || '').replace(/\/$/, '');
  const clientId = process.env.OIDC_CLIENT_ID || '';
  const appOrigin = (process.env.APP_ORIGIN || '').replace(/\/$/, '');

  if (!issuer || !clientId || !appOrigin) {
    throw new OidcError('OIDC_ISSUER, OIDC_CLIENT_ID and APP_ORIGIN are required', 'configuration_error');
  }

  let issuerUrl: URL;
  let originUrl: URL;
  let backchannelUrl: URL | undefined;
  try {
    issuerUrl = new URL(issuer);
    originUrl = new URL(appOrigin);
    backchannelUrl = backchannelOrigin ? new URL(backchannelOrigin) : undefined;
  } catch {
    throw new OidcError('OIDC_ISSUER and APP_ORIGIN must be valid URLs', 'configuration_error');
  }

  const localIssuer = issuerUrl.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(issuerUrl.hostname);
  if (process.env.NODE_ENV === 'production' && issuerUrl.protocol !== 'https:') {
    throw new OidcError('OIDC_ISSUER must use HTTPS in production', 'configuration_error');
  }
  if (process.env.NODE_ENV === 'production' && originUrl.protocol !== 'https:') {
    throw new OidcError('APP_ORIGIN must use HTTPS in production', 'configuration_error');
  }
  if (issuerUrl.protocol !== 'https:' && !localIssuer) {
    throw new OidcError('OIDC_ISSUER must use HTTPS outside local development', 'configuration_error');
  }
  if (backchannelUrl && process.env.NODE_ENV === 'production') {
    throw new OidcError('OIDC_BACKCHANNEL_ORIGIN is only supported outside production', 'configuration_error');
  }
  if (backchannelUrl && !['http:', 'https:'].includes(backchannelUrl.protocol)) {
    throw new OidcError('OIDC_BACKCHANNEL_ORIGIN must use HTTP or HTTPS', 'configuration_error');
  }

  return {
    issuer,
    ...(backchannelOrigin ? { backchannelOrigin } : {}),
    clientId,
    clientSecret: getSecret('OIDC_CLIENT_SECRET'),
    redirectUri: `${originUrl.origin}/api/auth/oidc/callback`,
    appOrigin: originUrl.origin,
  };
};

const oidcUrl = (url: string, config: OidcConfiguration, useBackchannel: boolean): string => {
  if (!useBackchannel || !config.backchannelOrigin) return url;
  const publicUrl = new URL(url);
  if (publicUrl.origin !== new URL(config.issuer).origin) return url;
  const backchannelUrl = new URL(config.backchannelOrigin);
  backchannelUrl.pathname = publicUrl.pathname;
  backchannelUrl.search = publicUrl.search;
  return backchannelUrl.toString();
};

export const assertOidcConfiguration = (): void => {
  getConfiguration();
  getSessionEncryptionKey();
};

const fetchJson = async <T>(url: string, options?: RequestInit): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new OidcError('Identity provider is unavailable', 'provider_unavailable');
  }
  if (!response.ok) {
    throw new OidcError('Identity provider returned an invalid response', 'provider_error');
  }
  try {
    return await response.json() as T;
  } catch {
    throw new OidcError('Identity provider returned invalid JSON', 'provider_error');
  }
};

const equals = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

export const getOidcMetadata = async (): Promise<OidcMetadata> => {
  const config = getConfiguration();
  const cacheKey = `${config.issuer}|${config.backchannelOrigin || ''}`;
  if (metadataCache && metadataCache.expiresAt > Date.now() && metadataCache.cacheKey === cacheKey) {
    return metadataCache.value;
  }

  const metadata = await fetchJson<OidcMetadata>(oidcUrl(`${config.issuer}/.well-known/openid-configuration`, config, true));
  if (
    metadata.issuer !== config.issuer ||
    !metadata.authorization_endpoint ||
    !metadata.token_endpoint ||
    !metadata.userinfo_endpoint ||
    !metadata.jwks_uri ||
    !metadata.id_token_signing_alg_values_supported?.includes('RS256') ||
    !metadata.code_challenge_methods_supported?.includes('S256')
  ) {
    throw new OidcError('Identity provider metadata is incompatible', 'configuration_error');
  }

  metadataCache = { value: metadata, expiresAt: Date.now() + DISCOVERY_TTL_MS, cacheKey };
  return metadata;
};

export const createAuthorizationRequest = async (): Promise<{
  authorizationUrl: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}> => {
  const config = getConfiguration();
  const metadata = await getOidcMetadata();
  const state = base64Url(randomBytes(32));
  const nonce = base64Url(randomBytes(32));
  const codeVerifier = base64Url(randomBytes(64));
  const codeChallenge = base64Url(createHash('sha256').update(codeVerifier).digest());
  const url = new URL(metadata.authorization_endpoint);

  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: 'openid profile email offline_access',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  }).toString();

  return { authorizationUrl: url.toString(), state, nonce, codeVerifier };
};

const clientAuthorization = (clientId: string, clientSecret: string): string =>
  `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;

const readProviderError = async (response: Response): Promise<string | undefined> => {
  try {
    const payload = await response.json() as { error?: unknown };
    return typeof payload.error === 'string' && /^[a-z0-9_]{1,64}$/i.test(payload.error)
      ? payload.error
      : undefined;
  } catch {
    return undefined;
  }
};

const exchange = async (parameters: URLSearchParams): Promise<OidcTokens> => {
  const config = getConfiguration();
  const metadata = await getOidcMetadata();
  let response: Response;
  try {
    response = await fetch(oidcUrl(metadata.token_endpoint, config, true), {
      method: 'POST',
      headers: {
        Authorization: clientAuthorization(config.clientId, config.clientSecret),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: parameters,
    });
  } catch {
    throw new OidcError('Identity provider is unavailable', 'provider_unavailable');
  }

  if (!response.ok) {
    throw new OidcError(
      'Authentication could not be completed',
      'token_exchange_failed',
      response.status,
      await readProviderError(response),
    );
  }

  const tokens = await response.json() as Partial<OidcTokens>;
  if (!tokens.access_token || !tokens.id_token || !Number.isFinite(tokens.expires_in)) {
    throw new OidcError('Identity provider returned incomplete tokens', 'provider_error');
  }
  return tokens as OidcTokens;
};

export const exchangeAuthorizationCode = async (code: string, codeVerifier: string): Promise<OidcTokens> => {
  const config = getConfiguration();
  return exchange(new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    code_verifier: codeVerifier,
  }));
};

export const refreshOidcTokens = async (refreshToken: string): Promise<OidcTokens> =>
  exchange(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }));

export const validateIdToken = async (token: string, expectedNonce?: string): Promise<OidcIdentity> => {
  const config = getConfiguration();
  const [encodedHeader, encodedPayload, encodedSignature, ...extraParts] = token.split('.');
  if (!encodedHeader || !encodedPayload || !encodedSignature || extraParts.length > 0) {
    throw new OidcError('Invalid ID token', 'invalid_token');
  }

  const header = decodeBase64UrlJson<{ alg?: string; kid?: string }>(encodedHeader);
  const claims = decodeBase64UrlJson<IdTokenClaims>(encodedPayload);
  if (header.alg !== 'RS256' || !header.kid || !claims.sub || !claims.exp || claims.iss !== config.issuer) {
    throw new OidcError('Invalid ID token', 'invalid_token');
  }

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(config.clientId) || claims.exp * 1000 <= Date.now()) {
    throw new OidcError('Invalid ID token', 'invalid_token');
  }
  if (expectedNonce !== undefined && (!claims.nonce || !equals(claims.nonce, expectedNonce))) {
    throw new OidcError('Invalid ID token', 'invalid_token');
  }

  const metadata = await getOidcMetadata();
  const jwks = await fetchJson<JwksResponse>(oidcUrl(metadata.jwks_uri, config, true));
  const key = jwks.keys.find((candidate) => candidate.kid === header.kid && candidate.kty === 'RSA' && candidate.use === 'sig' && candidate.alg === 'RS256');
  if (!key) throw new OidcError('Signing key was not found', 'invalid_token');

  let publicKey;
  try {
    publicKey = createPublicKey({ key: key as never, format: 'jwk' });
  } catch {
    throw new OidcError('Invalid signing key', 'invalid_token');
  }
  const isValid = verify('RSA-SHA256', Buffer.from(`${encodedHeader}.${encodedPayload}`), publicKey, Buffer.from(encodedSignature, 'base64url'));
  if (!isValid) throw new OidcError('Invalid ID token signature', 'invalid_token');

  return { sub: claims.sub };
};

export const getUserInfo = async (accessToken: string): Promise<OidcIdentity> => {
  const metadata = await getOidcMetadata();
  const identity = await fetchJson<OidcIdentity>(oidcUrl(metadata.userinfo_endpoint, getConfiguration(), true), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!identity.sub) throw new OidcError('Identity provider returned invalid user data', 'provider_error');
  return identity;
};

export const revokeRefreshToken = async (refreshToken: string): Promise<void> => {
  const metadata = await getOidcMetadata();
  if (!metadata.revocation_endpoint) return;
  const config = getConfiguration();
  try {
    await fetch(oidcUrl(metadata.revocation_endpoint, config, true), {
      method: 'POST',
      headers: {
        Authorization: clientAuthorization(config.clientId, config.clientSecret),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ token: refreshToken, token_type_hint: 'refresh_token' }),
    });
  } catch {
    // The local session is still removed even when the provider is unavailable.
  }
};

export const getLogoutUrl = async (): Promise<string | null> => (await getOidcMetadata()).end_session_endpoint || null;

const getSessionEncryptionKey = (): Buffer => {
  const raw = getSecret('OIDC_SESSION_ENCRYPTION_KEY');
  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new OidcError('OIDC_SESSION_ENCRYPTION_KEY must contain exactly 32 bytes', 'configuration_error');
  return key;
};

export const encryptRefreshToken = (value: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getSessionEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
};

export const decryptRefreshToken = (value: string): string => {
  const [iv, tag, encrypted, ...extraParts] = value.split('.');
  if (!iv || !tag || !encrypted || extraParts.length > 0) throw new OidcError('Invalid encrypted session', 'invalid_session');
  try {
    const decipher = createDecipheriv('aes-256-gcm', getSessionEncryptionKey(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new OidcError('Invalid encrypted session', 'invalid_session');
  }
};

export const shouldRefreshToken = (expiresAt: number): boolean => expiresAt - Date.now() <= TOKEN_REFRESH_SKEW_MS;

export const clearOidcMetadataCache = (): void => {
  metadataCache = null;
};
