import knex, { Knex } from 'knex';
import { SystemConfigRepository } from './systemConfigRepository';
import { ConfigService } from '../services/configService';
import { oidcConfigurationFingerprint } from '../services/oidcConfiguration';

const describeDatabase = process.env.RUN_DATABASE_INTEGRATION === 'true' ? describe : describe.skip;

describeDatabase('SystemConfigRepository PostgreSQL integration', () => {
  let database: Knex;
  const schema = `it_config_${Date.now()}`;
  const originalKey = process.env.OIDC_SESSION_ENCRYPTION_KEY;
  const encryptionKey = Buffer.alloc(32, 7);
  beforeAll(async () => {
    database = knex({ client: 'pg', connection: {
      host: process.env.POSTGRES_HOST || '127.0.0.1', port: Number(process.env.POSTGRES_PORT || 55432),
      user: process.env.POSTGRES_USER || 'bulkmail', password: process.env.POSTGRES_PASSWORD || 'bulkmail123', database: process.env.POSTGRES_DB || 'bulkmail',
    }, searchPath: [schema], pool: { min: 0, max: 4 } });
    await database.schema.createSchema(schema);
    await database.schema.withSchema(schema).createTable('configurations', (table) => {
      table.increments('id'); table.string('key').notNullable().unique(); table.jsonb('value').notNullable(); table.timestamps(true, true);
    });
    process.env.OIDC_SESSION_ENCRYPTION_KEY = encryptionKey.toString('hex');
  });
  beforeEach(async () => { await database('configurations').delete(); });
  afterAll(async () => {
    if (originalKey === undefined) delete process.env.OIDC_SESSION_ENCRYPTION_KEY;
    else process.env.OIDC_SESSION_ENCRYPTION_KEY = originalKey;
    if (database) { await database.schema.dropSchemaIfExists(schema, true); await database.destroy(); }
  });
  it('inserts a configuration only once under concurrency', async () => {
    const repository = new SystemConfigRepository(database);
    const results = await Promise.all([repository.insertIfAbsent('test', { source: 'first' }), repository.insertIfAbsent('test', { source: 'second' })]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const stored = await repository.getByKey('test');
    expect(['first', 'second']).toContain((stored?.value as { source: string }).source);
    await expect(repository.insertIfAbsent('test', { source: 'third' })).resolves.toBe(false);
  });
  it('concurrent imports bind to the configuration that wins the insert', async () => {
    const service = new ConfigService(database);
    const connections = new Set<string>();
    const observeQuery = (query: { __knexUid: string; __knexTxId?: string }) => {
      if (query.__knexTxId) connections.add(query.__knexUid);
    };
    database.on('query', observeQuery);
    let arrivals = 0;
    let release!: () => void;
    const bothTransactionsReady = new Promise<void>((resolve) => { release = resolve; });
    const originalInsert = SystemConfigRepository.prototype.insertIfAbsent;
    const insert = jest.spyOn(SystemConfigRepository.prototype, 'insertIfAbsent').mockImplementation(async function (this: SystemConfigRepository, key, value) {
      if (key === 'smtp') {
        arrivals += 1;
        if (arrivals === 2) release();
        await bothTransactionsReady;
      }
      return originalInsert.call(this, key, value);
    });
    let results: { mailgrid: boolean; oidc: boolean }[];
    try { results = await Promise.all([
      service.importFromEnvironment({ MAILGRID_HOST: 'first', OIDC_ISSUER: 'https://first.example', OIDC_CLIENT_ID: 'first', OIDC_CLIENT_SECRET: 'first-secret' }),
      service.importFromEnvironment({ MAILGRID_HOST: 'second', OIDC_ISSUER: 'https://second.example', OIDC_CLIENT_ID: 'second', OIDC_CLIENT_SECRET: 'second-secret' }),
    ]); } finally { insert.mockRestore(); database.removeListener('query', observeQuery); }
    expect(arrivals).toBe(2);
    expect(connections.size).toBe(2);
    expect(results.filter((result) => result.oidc)).toHaveLength(1);
    expect(results.filter((result) => result.mailgrid)).toHaveLength(1);
    const original = await service.getOidcSettings();
    expect(original).not.toBeNull();
    const binding = await service.getLegacyOidcBinding();
    expect(binding).toEqual({ issuer: original!.issuer, configurationFingerprint: oidcConfigurationFingerprint(original!, encryptionKey) });
    await service.updateOidcSettings({ ...original!, issuer: 'https://changed.example' });
    await service.importFromEnvironment({ OIDC_CLIENT_SECRET_FILE: '/unreadable' });
    expect(await service.getLegacyOidcBinding()).toEqual(binding);
  });
  it('rolls back all imports when binding persistence fails, then retries', async () => {
    await database.raw(`ALTER TABLE ?? ADD CONSTRAINT reject_binding CHECK (key <> 'oidc_legacy_binding')`, [`${schema}.configurations`]);
    const service = new ConfigService(database);
    const env = { MAILGRID_HOST: 'smtp.example', OIDC_ISSUER: 'https://id.example', OIDC_CLIENT_ID: 'client', OIDC_CLIENT_SECRET: 'secret' };
    await expect(service.importFromEnvironment(env)).rejects.toThrow();
    expect(await database('configurations').count('* as total').first()).toEqual({ total: '0' });
    await database.raw(`ALTER TABLE ?? DROP CONSTRAINT reject_binding`, [`${schema}.configurations`]);
    await expect(service.importFromEnvironment(env)).resolves.toEqual({ mailgrid: true, oidc: true });
  });
});
