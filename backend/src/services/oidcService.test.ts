const mockLegacyBinding = jest.fn();
jest.mock('./databaseService', () => ({ getConfigService: () => ({ getLegacyOidcBinding: mockLegacyBinding }) }));
import { createSign, generateKeyPairSync } from 'crypto';
import {
  clearOidcMetadataCache,
  loadOidcOperationContext,
  setOidcSettingsSource,
  refreshOidcTokens,
  validateStoredOidcSettings,
  isOidcEnabled,
  assertOidcBinding,
  probeOidcProvider,
  validateOidcSettings,
  createAuthorizationRequest,
  encryptRefreshToken,
  decryptRefreshToken,
  exchangeAuthorizationCode,
  OidcError,
  validateIdToken,
} from './oidcService';

const issuer = 'http://127.0.0.1:8080';
const clientId = 'oidc_test_client';
const baseSettings = { enabled: true, issuer, clientId, clientSecret: 'test-client-secret', backchannelOrigin: '' };
const useSettings = (overrides = {}) => setOidcSettingsSource(async () => ({ ...baseSettings, ...overrides }));
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
    delete process.env.OIDC_ISSUER;
    delete process.env.OIDC_CLIENT_ID;
    delete process.env.OIDC_CLIENT_SECRET;
    useSettings();
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

    const request = await createAuthorizationRequest(await loadOidcOperationContext());
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
    useSettings({ backchannelOrigin: 'http://host.docker.internal:8080' });
    global.fetch = jest.fn().mockResolvedValue(response(metadata));

    const request = await createAuthorizationRequest(await loadOidcOperationContext());

    expect(global.fetch).toHaveBeenCalledWith('http://host.docker.internal:8080/.well-known/openid-configuration', undefined);
    expect(new URL(request.authorizationUrl).origin).toBe(issuer);
  });

  it('uses the Docker backchannel for the authorization-code token exchange', async () => {
    useSettings({ backchannelOrigin: 'http://host.docker.internal:8080' });
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response(metadata))
      .mockResolvedValueOnce(response({
        access_token: 'access-token',
        id_token: 'id-token',
        refresh_token: 'refresh-token',
        expires_in: 300,
      }));

    await expect(exchangeAuthorizationCode(await loadOidcOperationContext(), 'authorization-code', 'code-verifier')).resolves.toMatchObject({
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
      await exchangeAuthorizationCode(await loadOidcOperationContext(), 'authorization-code', 'code-verifier');
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

    await expect(exchangeAuthorizationCode(await loadOidcOperationContext(), 'authorization-code', 'code-verifier')).rejects.toMatchObject({
      code: 'token_exchange_failed',
      providerStatus: 502,
      providerError: undefined,
    });
  });

  it('validates a signed ID token with issuer, audience and nonce', async () => {
    useSettings({ backchannelOrigin: 'http://host.docker.internal:8080' });
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

    await expect(validateIdToken(await loadOidcOperationContext(), token, 'nonce-1')).resolves.toEqual({ sub: 'user-1' });
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

    await expect(validateIdToken(await loadOidcOperationContext(), token, 'different-nonce')).rejects.toThrow('Invalid ID token');
  });

  it('encrypts refresh tokens before they are stored in sessions', () => {
    const encrypted = encryptRefreshToken('refresh-token-value');
    expect(encrypted).not.toContain('refresh-token-value');
    expect(decryptRefreshToken(encrypted)).toBe('refresh-token-value');
  });
});

 describe('operation settings', () => {
 beforeEach(() => { process.env.NODE_ENV = 'test'; process.env.APP_ORIGIN = 'http://localhost:5173'; process.env.OIDC_SESSION_ENCRYPTION_KEY = 'a'.repeat(64); });
 it.each(['code', 'refresh'])('keeps the snapshot during %s discovery', async (operation) => {
   let settings = baseSettings;
   const source = jest.fn(async () => settings);
   setOidcSettingsSource(source);
   let complete!: (value: Response) => void;
   const discovery = new Promise<Response>((resolve) => { complete = resolve; });
   const transport = jest.spyOn(global, 'fetch').mockReturnValueOnce(discovery).mockResolvedValueOnce(response({ access_token: 'a', id_token: 'i', refresh_token: 'r', expires_in: 300 }));
   const context = await loadOidcOperationContext();
   const pending = operation === 'code' ? exchangeAuthorizationCode(context, 'code', 'verifier') : refreshOidcTokens(context, 'refresh');
   settings = { ...baseSettings, issuer: 'https://new.example', clientSecret: 'new-secret' };
   complete(response(metadata));
   await pending;
   expect(source).toHaveBeenCalledTimes(1);
   expect(transport).toHaveBeenNthCalledWith(2, metadata.token_endpoint, expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Basic ${Buffer.from(`${clientId}:test-client-secret`).toString('base64')}` }) }));
   expect(transport.mock.calls.some(([url]) => String(url).includes('new.example'))).toBe(false);
   transport.mockRestore();
 });
 it('validates filled fields while disabled', () => {
   expect(() => validateStoredOidcSettings({ ...baseSettings, enabled: false, issuer: 'invalid' })).toThrow();
   expect(() => validateStoredOidcSettings({ enabled: false, issuer: '', clientId: '', clientSecret: '', backchannelOrigin: '' })).not.toThrow();
 });
 it('propagates database outages', async () => {
   setOidcSettingsSource(async () => { throw new Error('database down'); });
   await expect(isOidcEnabled()).rejects.toThrow('database down');
 });
 });

describe('configuration bindings', () => {
 beforeEach(() => { process.env.NODE_ENV = 'test'; process.env.APP_ORIGIN = 'http://localhost:5173'; process.env.OIDC_SESSION_ENCRYPTION_KEY = 'a'.repeat(64); useSettings(); });
 it('accepts unchanged legacy binding and rejects changed or missing binding before transport', async () => {
   const original = await loadOidcOperationContext();
   const binding = { issuer: original.configuration.issuer, configurationFingerprint: original.configurationFingerprint };
   mockLegacyBinding.mockResolvedValue(binding);
   await expect(assertOidcBinding(original, {})).resolves.toBeUndefined();
   useSettings({ issuer: 'https://new.example' });
   const changed = await loadOidcOperationContext();
   const transport = jest.spyOn(global, 'fetch');
   await expect(assertOidcBinding(changed, {})).rejects.toMatchObject({ code: 'not_configured' });
   await expect(assertOidcBinding(changed, binding)).rejects.toMatchObject({ code: 'not_configured' });
   mockLegacyBinding.mockResolvedValue(null);
   await expect(assertOidcBinding(original, {})).rejects.toMatchObject({ code: 'not_configured' });
   expect(transport).not.toHaveBeenCalled(); transport.mockRestore();
 });
 it('reports absent/disabled config and derives callback origin', async () => {
   setOidcSettingsSource(async () => null); await expect(isOidcEnabled()).resolves.toBe(false);
   useSettings({ enabled: false }); await expect(loadOidcOperationContext()).rejects.toMatchObject({ code: 'not_configured' });
   expect(validateOidcSettings(baseSettings, 'http://localhost:5173/').redirectUri).toBe('http://localhost:5173/api/auth/oidc/callback');
 });
 it('probes disabled connection settings without discovery cache', async () => {
   const transport = jest.spyOn(global, 'fetch').mockResolvedValueOnce(response(metadata)).mockResolvedValueOnce(response({ keys: [{ kty: 'RSA', use: 'sig', alg: 'RS256' }] })).mockResolvedValueOnce(response(metadata)).mockResolvedValueOnce(response({ keys: [{ kty: 'RSA', use: 'sig', alg: 'RS256' }] }));
   await probeOidcProvider({ ...baseSettings, enabled: false }); await probeOidcProvider(baseSettings);
   expect(transport).toHaveBeenCalledTimes(4); transport.mockRestore();
 });
 it('rejects production HTTP and backchannel even while disabled', () => {
   process.env.NODE_ENV = 'production';
   try {
     expect(() => validateStoredOidcSettings({ ...baseSettings, enabled: false })).toThrow('HTTPS');
     expect(() => validateStoredOidcSettings({ ...baseSettings, enabled: false, issuer: 'https://idp.example', backchannelOrigin: 'http://internal' })).toThrow('Backchannel');
     expect(() => validateOidcSettings({ ...baseSettings, issuer: 'https://idp.example' }, 'http://app.example')).toThrow('APP_ORIGIN');
   } finally { process.env.NODE_ENV = 'test'; }
 });
});
