import { createHmac } from 'crypto';
import { readFileSync } from 'fs';
import { isAbsolute, resolve } from 'path';
import type { OidcSettings } from '../models/SystemConfig';

export class OidcError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'oidc_error',
    public readonly providerStatus?: number,
    public readonly providerError?: string,
  ) { super(message); }
}

/** Read exported entrypoint values first; never expose secret paths or contents in errors. */
export const environmentSecret = (env: NodeJS.ProcessEnv, name: string): string => {
  if (env[name]) return env[name]!.trim();
  const path = env[`${name}_FILE`];
  if (!path) return '';
  try {
    try { return readFileSync(path, 'utf8').trim(); }
    catch (error) {
      if (isAbsolute(path)) throw error;
      return readFileSync(resolve(__dirname, '../../../', path), 'utf8').trim();
    }
  } catch {
    throw new OidcError(`${name}_FILE is not readable`, 'configuration_error');
  }
};

export const getSessionEncryptionKey = (env: NodeJS.ProcessEnv = process.env): Buffer => {
  const raw = environmentSecret(env, 'OIDC_SESSION_ENCRYPTION_KEY');
  if (!raw) throw new OidcError('OIDC_SESSION_ENCRYPTION_KEY is required', 'configuration_error');
  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new OidcError('OIDC_SESSION_ENCRYPTION_KEY must contain exactly 32 bytes', 'configuration_error');
  return key;
};

/** Pure session binding; deliberately excludes the environment-specific APP_ORIGIN. */
export const oidcConfigurationFingerprint = (settings: OidcSettings, sessionEncryptionKey: Buffer): string =>
  createHmac('sha256', sessionEncryptionKey).update(JSON.stringify([
    settings.enabled, settings.issuer, settings.clientId, settings.clientSecret, settings.backchannelOrigin,
  ])).digest('hex');
