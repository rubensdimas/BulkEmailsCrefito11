import knex, { Knex } from 'knex';
import { LocalUserRepository } from './localUserRepository';

const describeDatabase = process.env.RUN_DATABASE_INTEGRATION === 'true' ? describe : describe.skip;

describeDatabase('LocalUserRepository PostgreSQL integration', () => {
  let database: Knex;
  let repository: LocalUserRepository;
  const username = `it-${Date.now()}`;

  beforeAll(async () => {
    database = knex({
      client: 'pg',
      connection: {
        host: process.env.POSTGRES_HOST || '127.0.0.1',
        port: Number(process.env.POSTGRES_PORT || 5432),
        user: process.env.POSTGRES_USER || 'bulkmail',
        password: process.env.POSTGRES_PASSWORD || 'bulkmail123',
        database: process.env.POSTGRES_DB || 'bulkmail',
      },
      pool: { min: 0, max: 2 },
    });
    repository = new LocalUserRepository(database);
  });

  afterAll(async () => {
    await database('local_users').where({ username }).delete();
    await database.destroy();
  });

  it('creates, finds, updates, disables and records logins', async () => {
    const created = await repository.create({ username, passwordHash: 'hash-1' });
    await expect(repository.findByUsername(username)).resolves.toEqual({
      id: created.id,
      username,
      passwordHash: 'hash-1',
      disabledAt: null,
      lastLoginAt: null,
    });

    await repository.updatePassword(created.id, 'hash-2');
    await repository.setDisabled(created.id, true);
    await repository.recordLogin(created.id);
    const updated = await repository.findByUsername(username);
    expect(updated?.passwordHash).toBe('hash-2');
    expect(updated?.disabledAt).toBeInstanceOf(Date);
    expect(updated?.lastLoginAt).toBeInstanceOf(Date);

    await repository.setDisabled(created.id, false);
    expect((await repository.findByUsername(username))?.disabledAt).toBeNull();
  });

  it('returns null for an unknown username', async () => {
    await expect(repository.findByUsername('nobody-here')).resolves.toBeNull();
  });

  it('rejects usernames that are not lowercase', async () => {
    await expect(repository.create({ username: `UP-${Date.now()}`, passwordHash: 'hash' })).rejects.toThrow();
  });
});
