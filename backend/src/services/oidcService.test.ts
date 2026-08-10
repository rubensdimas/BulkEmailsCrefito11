import { createSign, generateKeyPairSync } from 'crypto';
import {
  clearOidcMetadataCache,
  createAuthorizationRequest,
  encryptRefreshToken,
  decryptRefreshToken,
  exchangeAuthorizationCode,
  OidcError,
  validateIdToken,
} from './oidcService';

const issuer = 'http://127.0.0.1:8080';
const clientId = 'oidc_test_client';
const metadata = {
  issuer,
  authorization_endpoint: `${issuer}/oauth/authorize`,
  token_endpoint: `${issuer}/oauth/token`,
  userinfo_endpoint: `${issuer}/oauth/userinfo`,
  jwks_uri: `${issuer}/.well-known/jwks.json`,
  id_token_signing_alg_values_supported: ['RS256'],
  code_challenge_methods_supported: ['S256'],
};

const response = (payload: unknown): Response => ({
  ok: true,
  status: 200,
  json: jest.fn().mockResolvedValue(payload),
} as unknown as Response);

const errorResponse = (status: number, payload: unknown): Response => ({
  ok: false,
  status,
  json: jest.fn().mockResolvedValue(payload),
} as unknown as Response);

const createIdToken = (privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'], payload: object): string => {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${body}`);
  signer.end();
  return `${header}.${body}.${signer.sign(privateKey).toString('base64url')}`;
};

describe('OIDC service', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.OIDC_ISSUER = issuer;
    process.env.OIDC_CLIENT_ID = clientId;
    process.env.OIDC_CLIENT_SECRET = 'test-client-secret';
    process.env.OIDC_SESSION_ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.APP_ORIGIN = 'http://localhost:5173';
    delete process.env.OIDC_BACKCHANNEL_ORIGIN;
    clearOidcMetadataCache();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('uses discovery metadata and creates an S256 authorization request', async () => {
    global.fetch = jest.fn().mockResolvedValue(response(metadata));

    const request = await createAuthorizationRequest();
    const url = new URL(request.authorizationUrl);

    expect(url.origin).toBe(issuer);
    expect(url.pathname).toBe('/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe(clientId);
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:5173/api/auth/oidc/callback');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(request.codeVerifier).toHaveLength(86);
    expect(request.nonce).toHaveLength(43);
  });

  it('uses the Docker backchannel for discovery while keeping the browser authorization URL public', async () => {
    process.env.OIDC_BACKCHANNEL_ORIGIN = 'http://host.docker.internal:8080';
    global.fetch = jest.fn().mockResolvedValue(response(metadata));

    const request = await createAuthorizationRequest();

    expect(global.fetch).toHaveBeenCalledWith('http://host.docker.internal:8080/.well-known/openid-configuration', undefined);
    expect(new URL(request.authorizationUrl).origin).toBe(issuer);
  });

  it('uses the Docker backchannel for the authorization-code token exchange', async () => {
    process.env.OIDC_BACKCHANNEL_ORIGIN = 'http://host.docker.internal:8080';
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response(metadata))
      .mockResolvedValueOnce(response({
        access_token: 'access-token',
        id_token: 'id-token',
        refresh_token: 'refresh-token',
        expires_in: 300,
      }));

    await expect(exchangeAuthorizationCode('authorization-code', 'code-verifier')).resolves.toMatchObject({
      access_token: 'access-token',
      id_token: 'id-token',
    });
    expect(global.fetch).toHaveBeenNthCalledWith(2, 'http://host.docker.internal:8080/oauth/token', expect.objectContaining({ method: 'POST' }));
  });

  it('captures a sanitized OAuth error from a failed token exchange', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response(metadata))
      .mockResolvedValueOnce(errorResponse(400, { error: 'invalid_grant', error_description: 'sensitive provider detail' }));

    try {
      await exchangeAuthorizationCode('authorization-code', 'code-verifier');
      throw new Error('Expected token exchange to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(OidcError);
      expect(error).toMatchObject({
        message: 'Authentication could not be completed',
        code: 'token_exchange_failed',
        providerStatus: 400,
        providerError: 'invalid_grant',
      });
      expect(JSON.stringify(error)).not.toContain('sensitive provider detail');
    }
  });

  it('ignores malformed provider error bodies', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response(metadata))
      .mockResolvedValueOnce(errorResponse(502, { error: 'invalid grant: secret=leaked' }));

    await expect(exchangeAuthorizationCode('authorization-code', 'code-verifier')).rejects.toMatchObject({
      code: 'token_exchange_failed',
      providerStatus: 502,
      providerError: undefined,
    });
  });

  it('validates a signed ID token with issuer, audience and nonce', async () => {
    process.env.OIDC_BACKCHANNEL_ORIGIN = 'http://host.docker.internal:8080';
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' });
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response(metadata))
      .mockResolvedValueOnce(response({ keys: [{ ...jwk, kid: 'test-key', use: 'sig', alg: 'RS256' }] }));
    const token = createIdToken(privateKey, {
      iss: issuer,
      sub: 'user-1',
      aud: clientId,
      exp: Math.floor(Date.now() / 1000) + 300,
      nonce: 'nonce-1',
    });

    await expect(validateIdToken(token, 'nonce-1')).resolves.toEqual({ sub: 'user-1' });
    expect(global.fetch).toHaveBeenNthCalledWith(2, 'http://host.docker.internal:8080/.well-known/jwks.json', undefined);
  });

  it('rejects a token whose nonce does not match the login transaction', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' });
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response(metadata))
      .mockResolvedValueOnce(response({ keys: [{ ...jwk, kid: 'test-key', use: 'sig', alg: 'RS256' }] }));
    const token = createIdToken(privateKey, {
      iss: issuer,
      sub: 'user-1',
      aud: clientId,
      exp: Math.floor(Date.now() / 1000) + 300,
      nonce: 'nonce-1',
    });

    await expect(validateIdToken(token, 'different-nonce')).rejects.toThrow('Invalid ID token');
  });

  it('encrypts refresh tokens before they are stored in sessions', () => {
    const encrypted = encryptRefreshToken('refresh-token-value');
    expect(encrypted).not.toContain('refresh-token-value');
    expect(decryptRefreshToken(encrypted)).toBe('refresh-token-value');
  });
});
