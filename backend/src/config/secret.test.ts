import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readSecret } from './secret';

describe('readSecret', () => {
  const originalEnvironment = process.env;
  let temporaryDirectory: string;

  beforeEach(() => {
    process.env = { ...originalEnvironment };
    temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'bulkmail-secret-'));
  });

  afterEach(() => {
    process.env = originalEnvironment;
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('prefers a direct environment value', () => {
    const filePath = path.join(temporaryDirectory, 'password');
    writeFileSync(filePath, 'file-password\n');
    process.env.DIRECT_SECRET = 'environment-password';
    process.env.DIRECT_SECRET_FILE = filePath;

    expect(readSecret('DIRECT_SECRET', 'DIRECT_SECRET_FILE', 'fallback')).toBe('environment-password');
  });

  it('reads and trims a Docker secret file', () => {
    const filePath = path.join(temporaryDirectory, 'password');
    writeFileSync(filePath, 'file-password\n');
    process.env.FILE_SECRET_FILE = filePath;

    expect(readSecret('FILE_SECRET', 'FILE_SECRET_FILE')).toBe('file-password');
  });

  it('uses the fallback when the secret file is unavailable', () => {
    process.env.MISSING_SECRET_FILE = path.join(temporaryDirectory, 'missing');

    expect(readSecret('MISSING_SECRET', 'MISSING_SECRET_FILE', 'fallback')).toBe('fallback');
  });
});
