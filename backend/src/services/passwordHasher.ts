import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'crypto';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

const ALGORITHM = 'scrypt';
const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const MAX_ACCEPTED_COST = 1_048_576;
const SALT_BYTES = 16;
const KEY_LENGTH = 64;

const scrypt = (password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, key) => (error ? reject(error) : resolve(key)));
  });

export const validatePasswordPolicy = (password: string): string | null => {
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) return `A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  if (length > PASSWORD_MAX_LENGTH) return `A senha deve ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`;
  return null;
};

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password, salt, KEY_LENGTH, { N: COST, r: BLOCK_SIZE, p: PARALLELIZATION });
  return [ALGORITHM, COST, BLOCK_SIZE, PARALLELIZATION, salt.toString('base64'), key.toString('base64')].join('$');
};

export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== ALGORITHM) return false;
  const [cost, blockSize, parallelization] = parts.slice(1, 4).map(Number);
  if (![cost, blockSize, parallelization].every(Number.isSafeInteger) || cost > MAX_ACCEPTED_COST) return false;

  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (salt.length === 0 || expected.length !== KEY_LENGTH) return false;

  try {
    const actual = await scrypt(password, salt, KEY_LENGTH, { N: cost, r: blockSize, p: parallelization });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
};

let dummyHash: Promise<string> | null = null;

// Equalizes response time for unknown usernames so they cannot be enumerated.
export const verifyAgainstDummy = async (password: string): Promise<void> => {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(password, await dummyHash);
};
