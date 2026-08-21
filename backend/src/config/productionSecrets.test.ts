import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('production Docker secret wiring', () => {
  const originalEnvironment = process.env;
  let temporaryDirectory: string;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnvironment, NODE_ENV: 'production' };
    delete process.env.POSTGRES_PASSWORD;
    delete process.env.REDIS_PASSWORD;
    temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'bulkmail-production-secrets-'));
  });

  afterEach(() => {
    process.env = originalEnvironment;
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('loads the PostgreSQL password from POSTGRES_PASSWORD_FILE', async () => {
    const filePath = path.join(temporaryDirectory, 'postgres_password');
    writeFileSync(filePath, 'postgres-from-docker-secret\n');
    process.env.POSTGRES_PASSWORD_FILE = filePath;
    process.env.POSTGRES_HOST = 'postgres';
    process.env.POSTGRES_USER = 'bulkmail';
    process.env.POSTGRES_DB = 'bulkmail';

    const config = (await import('./database')).default;

    expect(config.connection.password).toBe('postgres-from-docker-secret');
  });

  it('loads the Redis password from REDIS_PASSWORD_FILE', async () => {
    const filePath = path.join(temporaryDirectory, 'redis_password');
    writeFileSync(filePath, 'redis-from-docker-secret\n');
    process.env.REDIS_PASSWORD_FILE = filePath;

    const { redisOptions } = await import('./redis');

    expect(redisOptions.password).toBe('redis-from-docker-secret');
  });
});
