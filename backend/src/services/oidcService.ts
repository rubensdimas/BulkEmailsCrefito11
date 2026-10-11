import {
  createHash,
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify,
} from 'crypto';
import { getSessionEncryptionKey, oidcConfigurationFingerprint, OidcError } from './oidcConfiguration';
export { getSessionEncryptionKey, OidcError } from './oidcConfiguration';
import type { OidcSettings } from '../models/SystemConfig';
import { getConfigService } from './databaseService';

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

export interface OidcConfiguration {
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

const base64Url = (value: Buffer): string => value.toString('base64url');

const decodeBase64UrlJson = <T>(value: string): T => {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
  } catch {
    throw new OidcError('Invalid token received from identity provider', 'invalid_token');
  }
};

export type OidcOperationContext = Readonly<{
  configuration: Readonly<OidcConfiguration>;
  configurationFingerprint: string;
}>;
export type OidcSettingsSource = () => Promise<OidcSettings | null>;
let settingsSource: OidcSettingsSource = () => getConfigService().getOidcSettings();
export const setOidcSettingsSource = (source: OidcSettingsSource): void => {
  settingsSource = source;
  metadataCache = null;
};
const configurationError = (message: string): never => { throw new OidcError(message, 'configuration_error'); };
const parseUrl = (value: string): URL => {
  try {
    return new URL(value);
  } catch {
    return configurationError('Issuer, backchannel origin e APP_ORIGIN precisam ser URLs válidas.');
  }
};
const localHttp = (url: URL): boolean => url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
export const validateStoredOidcSettings = (settings: OidcSettings): void => {
  if (settings.issuer) {
    const issuer = parseUrl(settings.issuer);
    if (issuer.protocol !== 'https:' && (process.env.NODE_ENV === 'production' || !localHttp(issuer))) configurationError('O issuer precisa usar HTTPS fora do ambiente local.');
  }
  if (settings.backchannelOrigin) {
    const backchannel = parseUrl(settings.backchannelOrigin);
    if (process.env.NODE_ENV === 'production') configurationError('Backchannel origin só é permitido fora de produção.');
    if (!['http:', 'https:'].includes(backchannel.protocol)) configurationError('Backchannel origin precisa usar HTTP ou HTTPS.');
  }
  if (settings.enabled && (!settings.issuer || !settings.clientId || !settings.clientSecret)) configurationError('Informe issuer, client ID e client secret.');
};
export const validateOidcSettings = (settings: OidcSettings, appOrigin = process.env.APP_ORIGIN || ''): OidcConfiguration => {
  validateStoredOidcSettings(settings);
  if (!settings.issuer || !settings.clientId || !settings.clientSecret) configurationError('Informe issuer, client ID e client secret.');
  const origin = parseUrl(appOrigin);
  if (process.env.NODE_ENV === 'production' && origin.protocol !== 'https:') configurationError('APP_ORIGIN precisa usar HTTPS em produção.');
  if (origin.protocol !== 'https:' && !localHttp(origin)) configurationError('APP_ORIGIN precisa usar HTTPS fora do ambiente local.');
  return {
    issuer: settings.issuer.replace(/\/$/, ''),
    clientId: settings.clientId,
    clientSecret: settings.clientSecret,
    ...(settings.backchannelOrigin ? { backchannelOrigin: settings.backchannelOrigin.replace(/\/$/, '') } : {}),
    appOrigin: origin.origin,
    redirectUri: `${origin.origin}/api/auth/oidc/callback`,
  };
};
export const loadOidcOperationContext = async (): Promise<OidcOperationContext> => {
  const settings = await settingsSource();
  if (!settings || !settings.enabled) throw new OidcError('Login da intranet não configurado.', 'not_configured');
  const configuration = Object.freeze(validateOidcSettings(settings));
  return Object.freeze({ configuration, configurationFingerprint: oidcConfigurationFingerprint(settings, getSessionEncryptionKey()) });
};
export const isOidcEnabled = async (): Promise<boolean> => {
  try {
    await loadOidcOperationContext();
    return true;
  } catch (error) {
    if (error instanceof OidcError && ['configuration_error', 'not_configured'].includes(error.code)) return false;
    throw error;
  }
};
export const assertOidcBinding = async (context: OidcOperationContext, binding: { issuer?: string; configurationFingerprint?: string }): Promise<void> => {
  // Only wholly unbound sessions/transactions can inherit the immutable bootstrap binding.
  const effective = binding.issuer === undefined && binding.configurationFingerprint === undefined
    ? await getConfigService().getLegacyOidcBinding()
    : binding;
  if (!effective || effective.issuer !== context.configuration.issuer || effective.configurationFingerprint !== context.configurationFingerprint) throw new OidcError('Configuração da intranet alterada. Entre novamente.', 'not_configured');
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

export const assertSessionEncryptionKey = (): void => { getSessionEncryptionKey(); };

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

const discoverOidcMetadata = async (config: Readonly<OidcConfiguration>): Promise<OidcMetadata> => {
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
    throw new OidcError('O discovery do issuer não é compatível (requer RS256 e PKCE S256).', 'configuration_error');
  }

  return metadata;
};

export const getOidcMetadata = async (context: OidcOperationContext): Promise<OidcMetadata> => {
  const config = context.configuration;
  const cacheKey = `${config.issuer}|${config.backchannelOrigin || ''}`;
  if (metadataCache && metadataCache.expiresAt > Date.now() && metadataCache.cacheKey === cacheKey) {
    return metadataCache.value;
  }

  const metadata = await discoverOidcMetadata(config);
  metadataCache = { value: metadata, expiresAt: Date.now() + DISCOVERY_TTL_MS, cacheKey };
  return metadata;
};

export const createAuthorizationRequest = async (context: OidcOperationContext, returnTo?: string): Promise<{
  issuer: string;
  configurationFingerprint: string;
  returnTo?: string;
  authorizationUrl: string;
  state: string;
  nonce: string;
  codeVerifier: string;
}> => {
  const config = context.configuration;
  const metadata = await getOidcMetadata(context);
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

  return { authorizationUrl: url.toString(), state, nonce, codeVerifier, issuer: config.issuer, configurationFingerprint: context.configurationFingerprint, returnTo };
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

const exchange = async (context: OidcOperationContext, parameters: URLSearchParams): Promise<OidcTokens> => {
  const config = context.configuration;
  const metadata = await getOidcMetadata(context);
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

export const exchangeAuthorizationCode = async (context: OidcOperationContext, code: string, codeVerifier: string): Promise<OidcTokens> => {
  const config = context.configuration;
  return exchange(context, new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    code_verifier: codeVerifier,
  }));
};

export const refreshOidcTokens = async (context: OidcOperationContext, refreshToken: string): Promise<OidcTokens> =>
  exchange(context, new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }));

export const validateIdToken = async (context: OidcOperationContext, token: string, expectedNonce?: string): Promise<OidcIdentity> => {
  const config = context.configuration;
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

  const metadata = await getOidcMetadata(context);
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

export const getUserInfo = async (context: OidcOperationContext, accessToken: string): Promise<OidcIdentity> => {
  const metadata = await getOidcMetadata(context);
  const identity = await fetchJson<OidcIdentity>(oidcUrl(metadata.userinfo_endpoint, context.configuration, true), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!identity.sub) throw new OidcError('Identity provider returned invalid user data', 'provider_error');
  return identity;
};

export const revokeRefreshToken = async (context: OidcOperationContext, refreshToken: string): Promise<void> => {
  const metadata = await getOidcMetadata(context);
  if (!metadata.revocation_endpoint) return;
  const config = context.configuration;
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

export const getLogoutUrl = async (context: OidcOperationContext): Promise<string | null> => (await getOidcMetadata(context)).end_session_endpoint || null;

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

export const probeOidcProvider = async (settings: OidcSettings): Promise<void> => {
  const context = { configuration: validateOidcSettings(settings), configurationFingerprint: '' };
  const metadata = await discoverOidcMetadata(context.configuration);
  const jwks = await fetchJson<JwksResponse>(oidcUrl(metadata.jwks_uri, context.configuration, true));
  if (!Array.isArray(jwks.keys) || !jwks.keys.some(key => key.kty === 'RSA' && key.use === 'sig' && key.alg === 'RS256')) configurationError('O issuer não possui chave de assinatura RS256.');
};
