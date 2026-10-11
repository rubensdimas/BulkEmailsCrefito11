import { createHmac } from 'crypto';
import { environmentSecret, getSessionEncryptionKey, oidcConfigurationFingerprint } from './oidcConfiguration';

describe('OIDC configuration helpers', () => {
  const settings = { enabled: true, issuer: 'https://id.example', clientId: 'client', clientSecret: 'secret', backchannelOrigin: '' };
  const key = Buffer.alloc(32, 1);
  it('fingerprints exactly the stable configuration tuple with HMAC SHA256', () => {
    const expected = createHmac('sha256', key).update(JSON.stringify([true, settings.issuer, 'client', 'secret', ''])).digest('hex');
    expect(oidcConfigurationFingerprint(settings, key)).toBe(expected);
    for (const changed of [{ enabled: false }, { issuer: 'https://other.example' }, { clientId: 'other' }, { clientSecret: 'other' }, { backchannelOrigin: 'http://localhost' }]) {
      expect(oidcConfigurationFingerprint({ ...settings, ...changed }, key)).not.toBe(expected);
    }
    expect(oidcConfigurationFingerprint(settings, Buffer.alloc(32, 2))).not.toBe(expected);
  });
  it('prefers exported secrets over unreadable files', () => {
    expect(environmentSecret({ SECRET: 'exported', SECRET_FILE: '/missing' }, 'SECRET')).toBe('exported');
  });
  it('reports only the variable name for unreadable files', () => {
    expect(() => environmentSecret({ SECRET_FILE: '/missing/private-path' }, 'SECRET')).toThrow('SECRET_FILE is not readable');
  });
  it('loads the same hex and base64 encryption key', () => {
    expect(getSessionEncryptionKey({ OIDC_SESSION_ENCRYPTION_KEY: key.toString('hex') })).toEqual(key);
    expect(getSessionEncryptionKey({ OIDC_SESSION_ENCRYPTION_KEY: key.toString('base64') })).toEqual(key);
    expect(() => getSessionEncryptionKey({ OIDC_SESSION_ENCRYPTION_KEY: 'short' })).toThrow('exactly 32 bytes');
  });
});
