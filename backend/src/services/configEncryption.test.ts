import { decryptSecret, encryptSecret } from './configEncryption';

describe('configEncryption', () => {
  const originalKey = process.env.CONFIG_ENCRYPTION_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.CONFIG_ENCRYPTION_KEY;
    else process.env.CONFIG_ENCRYPTION_KEY = originalKey;
  });

  it('encrypts and decrypts a secret with AES-GCM', () => {
    process.env.CONFIG_ENCRYPTION_KEY = 'a'.repeat(64);
    const encrypted = encryptSecret('mailgrid-password');

    expect(encrypted).toMatch(/^enc:v1:/);
    expect(encrypted).not.toContain('mailgrid-password');
    expect(decryptSecret(encrypted)).toBe('mailgrid-password');
  });

  it('keeps legacy plaintext readable', () => {
    process.env.CONFIG_ENCRYPTION_KEY = 'b'.repeat(64);
    expect(decryptSecret('legacy-password')).toBe('legacy-password');
  });

  it('rejects invalid key lengths', () => {
    process.env.CONFIG_ENCRYPTION_KEY = 'too-short';
    expect(() => encryptSecret('value')).toThrow('exactly 32 bytes');
  });
});
