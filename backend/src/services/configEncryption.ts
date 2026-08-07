import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const PREFIX = 'enc:v1';

const getKey = (): Buffer | null => {
  const raw = process.env.CONFIG_ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CONFIG_ENCRYPTION_KEY is required in production');
    }
    return null;
  }

  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('CONFIG_ENCRYPTION_KEY must contain exactly 32 bytes');
  return key;
};

export const encryptSecret = (value: string): string => {
  if (!value || value.startsWith(`${PREFIX}:`)) return value;
  const key = getKey();
  if (!key) return value;

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
};

export const decryptSecret = (value: string): string => {
  if (!value || !value.startsWith(`${PREFIX}:`)) return value;
  const key = getKey();
  if (!key) return value;

  const parts = value.split(':');
  if (parts.length !== 5) throw new Error('Encrypted configuration has an invalid format');
  const [, , ivValue, tagValue, encryptedValue] = parts;
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivValue, 'base64'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64')),
    decipher.final(),
  ]).toString('utf8');
};
