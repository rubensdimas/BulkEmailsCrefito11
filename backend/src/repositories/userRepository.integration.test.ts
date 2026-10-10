import knex, { Knex } from 'knex';
import { spawnSync } from 'child_process';
import { UserRepository, LastActiveAdminError, UserNotFoundError } from './userRepository';
import { up as createLocalUsers } from '../migrations/20261010000000_create_local_users';
import { up as migrateUsers, down as rollbackUsers } from '../migrations/20261010120000_users_roles';

const describeDatabase = process.env.RUN_DATABASE_INTEGRATION === 'true' ? describe : describe.skip;

describeDatabase('UserRepository PostgreSQL integration', () => {
  let database: Knex;
  let repository: UserRepository;
  const suffix = Date.now();
  const username = `it-${suffix}`;
  const sub = `oidc-it-${suffix}`;

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
      pool: { min: 0, max: 4 },
    });
    repository = new UserRepository(database);
  });

  afterAll(async () => {
    await database('users').where({ username }).orWhere({ oidc_sub: sub }).delete();
    await database.destroy();
  });

  it('preserves existing local admin identities and credentials during migration', async () => {
    await database.transaction(async (transaction) => {
      const schema = `users_migration_it_${suffix}`;
      await transaction.raw('CREATE SCHEMA ??', [schema]);
      await transaction.raw('SET LOCAL search_path TO ??, public', [schema]);
      await createLocalUsers(transaction);
      const original = {
        id: '00000000-0000-0000-0000-000000004201',
        username: 'existing-admin', password_hash: 'existing-hash',
        disabled_at: new Date('2026-01-01T00:00:00Z'),
        last_login_at: new Date('2026-02-01T00:00:00Z'),
      };
      await transaction('local_users').insert(original);
      await migrateUsers(transaction);
      expect(await transaction('users').where({ id: original.id }).first()).toMatchObject({
        ...original, provider: 'local', role: 'admin', credential_version: 0, must_change_password: false,
      });
      await rollbackUsers(transaction);
      expect(await transaction('local_users').where({ id: original.id }).first()).toMatchObject(original);
      await migrateUsers(transaction);
      expect(await transaction('users').where({ id: original.id }).first()).toMatchObject({
        ...original, provider: 'local', role: 'admin',
      });
      await transaction.raw('DROP SCHEMA ?? CASCADE', [schema]);
    });
  });

  it('creates local admins by default and finds them by username and id', async () => {
    const created = await repository.create({ username, passwordHash: 'hash-1' });
    expect(created).toMatchObject({
      provider: 'local', role: 'admin', username, passwordHash: 'hash-1',
      mustChangePassword: false, oidcSub: null, oidcIssuer: null, credentialVersion: 0,
    });
    await expect(repository.findByUsername(username)).resolves.toMatchObject({ id: created.id });
    await expect(repository.findById(created.id)).resolves.toMatchObject({ username });
  });

  it('resets passwords atomically and defaults to no required change', async () => {
    const user = (await repository.findByUsername(username))!;
    await repository.updatePassword(user.id, 'hash-2', true);
    await expect(repository.findById(user.id)).resolves.toMatchObject({
      passwordHash: 'hash-2', mustChangePassword: true, credentialVersion: 1,
    });
    await Promise.all([repository.updatePassword(user.id, 'hash-3'), repository.updatePassword(user.id, 'hash-3')]);
    await expect(repository.findById(user.id)).resolves.toMatchObject({
      passwordHash: 'hash-3', mustChangePassword: false, credentialVersion: 3,
    });
  });

  it('changes passwords only with the current hash and credential version', async () => {
    const user = (await repository.findByUsername(username))!;
    await repository.updatePassword(user.id, 'current', true);
    const version = user.credentialVersion + 1;
    await expect(repository.changePasswordIfCurrent(user.id, 'stale', version, 'next')).resolves.toBe(false);
    await expect(repository.changePasswordIfCurrent(user.id, 'current', version - 1, 'next')).resolves.toBe(false);
    const results = await Promise.all([
      repository.changePasswordIfCurrent(user.id, 'current', version, 'next'),
      repository.changePasswordIfCurrent(user.id, 'current', version, 'other'),
    ]);
    expect(results.sort()).toEqual([false, true]);
    await expect(repository.findById(user.id)).resolves.toMatchObject({
      credentialVersion: version, mustChangePassword: false,
    });
  });

  it('registers operators and refreshes only their name and email', async () => {
    const first = await repository.upsertOidcUser({ issuer: 'https://a.example', sub, email: 'old@example.com', name: 'Old' });
    expect(first).toMatchObject({ provider: 'oidc', role: 'operator', oidcSub: sub, oidcIssuer: 'https://a.example', username: null, passwordHash: null });
    await database('users').where({ id: first.id }).update({ role: 'admin', disabled_at: new Date(), credential_version: 7 });
    const second = await repository.upsertOidcUser({ issuer: 'https://a.example', sub, email: 'new@example.com', name: 'New' });
    expect(second).toMatchObject({ id: first.id, role: 'admin', email: 'new@example.com', name: 'New', credentialVersion: 7 });
    expect(second.disabledAt).toBeInstanceOf(Date);
  });

  it('isolates the same subject across issuers', async () => {
    const a = await repository.findByOidcSub('https://a.example', sub);
    const b = await repository.upsertOidcUser({ issuer: 'https://b.example', sub });
    expect(b.id).not.toBe(a!.id);
    expect(b.role).toBe('operator');
    expect((await repository.findByOidcSub('https://a.example', sub))?.role).toBe('admin');
    await expect(repository.findByUsername(sub)).resolves.toBeNull();
  });

  it('lists users and supports local account disabling and login recording', async () => {
    expect((await repository.list()).map((user) => user.username ?? user.oidcSub)).toEqual(expect.arrayContaining([username, sub]));
    const user = (await repository.findByUsername(username))!;
    const other = await repository.create({ username: `other-${suffix}`, passwordHash: 'hash' });
    await repository.setDisabled(user.id, true);
    await repository.recordLogin(user.id);
    expect(await repository.findById(user.id)).toMatchObject({ disabledAt: expect.any(Date), lastLoginAt: expect.any(Date) });
    await repository.setDisabled(user.id, false);
    expect((await repository.findById(user.id))?.disabledAt).toBeNull();
    await database('users').where({ id: other.id }).delete();
    await expect(repository.findById('00000000-0000-0000-0000-000000000000')).resolves.toBeNull();
    await expect(repository.findByUsername('unknown')).resolves.toBeNull();
  });

  it.each([
    { provider: 'oidc', role: 'operator', oidc_sub: sub },
    { provider: 'oidc', role: 'operator', oidc_issuer: 'https://missing.example' },
    { provider: 'local', role: 'admin', username: `invalid-${suffix}` },
  ])('rejects incomplete identities at the database level: %p', async (identity) => {
    await expect(database('users').insert({ id: '00000000-0000-0000-0000-000000000001', ...identity })).rejects.toThrow(/users_identity_check/);
  });

  it('preserves the lowercase username constraint', async () => {
    await expect(repository.create({ username: `UP-${suffix}`, passwordHash: 'hash' })).rejects.toThrow();
  });
});

// Separate schema and pool: committed fixtures permit genuine overlapping transactions.
describeDatabase('UserRepository access protection', () => {
  let database: Knex;
  let repository: UserRepository;
  const schema = `access_it_${Date.now()}`;
  beforeAll(async () => {
    database = knex({ client: 'pg', connection: {
      host: '127.0.0.1', port: Number(process.env.POSTGRES_PORT),
      user: 'bulkmail', password: 'bulkmail123', database: 'bulkmail',
    }, pool: { min: 0, max: 4 }, searchPath: [schema] });
    await database.raw('CREATE SCHEMA ??', [schema]);
    await database.raw('CREATE TABLE ??.users (LIKE public.users INCLUDING ALL)', [schema]);
    repository = new UserRepository(database);
  });
  beforeEach(async () => { await database('users').delete(); });
  afterAll(async () => {
    await database.raw('DROP SCHEMA ?? CASCADE', [schema]);
    await database.destroy();
  });
  it.each([{ role: 'operator' as const }, { disabled: true }])('rejects removing the last active admin: %p', async (change) => {
    const admin = await repository.create({ username: 'only-admin', passwordHash: 'h' });
    await repository.create({ username: 'disabled-admin', passwordHash: 'h' });
    await database('users').where({ username: 'disabled-admin' }).update({ disabled_at: new Date() });
    await expect(repository.updateAccess(admin.id, change)).rejects.toBeInstanceOf(LastActiveAdminError);
    await expect(repository.findById(admin.id)).resolves.toMatchObject({ role: 'admin', disabledAt: null });
    const protectedUpdate = jest.spyOn(repository, 'updateAccess');
    await expect(repository.setDisabled(admin.id, true)).rejects.toBeInstanceOf(LastActiveAdminError);
    expect(protectedUpdate).toHaveBeenCalledWith(admin.id, { disabled: true });
    protectedUpdate.mockRestore();
  });
  it('allows self-demotion with another admin and returns unchanged users for empty changes', async () => {
    const first = await repository.create({ username: 'first-admin', passwordHash: 'h' });
    await repository.create({ username: 'second-admin', passwordHash: 'h' });
    await expect(repository.updateAccess(first.id, {})).resolves.toEqual(first);
    await expect(repository.updateAccess(first.id, { role: 'operator' })).resolves.toMatchObject({ role: 'operator' });
  });
  it('permits operator changes and bootstrapping an admin without any current admin', async () => {
    const user = await repository.create({ username: 'operator', passwordHash: 'h', role: 'operator' });
    expect((await repository.updateAccess(user.id, { disabled: true })).disabledAt).toBeInstanceOf(Date);
    await expect(repository.updateAccess(user.id, { disabled: false })).resolves.toMatchObject({ disabledAt: null });
    await expect(repository.updateAccess(user.id, { role: 'admin' })).resolves.toMatchObject({ role: 'admin' });
    await database('users').where({ id: user.id }).update({ disabled_at: new Date() });
    await expect(repository.updateAccess(user.id, { disabled: false })).resolves.toMatchObject({ role: 'admin', disabledAt: null });
  });
  it('reports missing users including empty changes', async () => {
    const id = '00000000-0000-0000-0000-000000000000';
    await expect(repository.updateAccess(id, {})).rejects.toBeInstanceOf(UserNotFoundError);
  });
  it('serializes concurrent demotion and disabling of exactly two active admins', async () => {
    const first = await repository.create({ username: 'first-admin', passwordHash: 'h' });
    const second = await repository.create({ username: 'second-admin', passwordHash: 'h' });
    // Dedicated single-connection pools keep the warmed backend PIDs bound to each call.
    const clients = [knex({ ...database.client.config, pool: { min: 1, max: 1 } }),
      knex({ ...database.client.config, pool: { min: 1, max: 1 } })];
    const blocker = await database.transaction();
    let pending: Promise<PromiseSettledResult<unknown>[]> | undefined;
    try {
      const pids = await Promise.all(clients.map(async (client) => {
        const result = await client.raw('SELECT pg_backend_pid() AS pid');
        return Number(result.rows[0].pid);
      }));
      expect(new Set(pids).size).toBe(2);
      await blocker.raw('SELECT pg_advisory_xact_lock(420002)');
      const blockerPid = Number((await blocker.raw('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      expect(pids).not.toContain(blockerPid);
      pending = Promise.allSettled([
        new UserRepository(clients[0]).updateAccess(first.id, { role: 'operator' }),
        new UserRepository(clients[1]).setDisabled(second.id, true),
      ]);
      // Do not release until PostgreSQL proves both production transactions overlap
      // and are waiting for the real advisory lock on their distinct connections.
      const deadline = Date.now() + 3000;
      let waiting: number[] = [];
      do {
        const locks = await database('pg_locks').select('pid').where({
          locktype: 'advisory', classid: 0, objid: 420002, granted: false,
        }).whereIn('pid', pids);
        waiting = locks.map((lock) => Number(lock.pid));
        if (waiting.length === 2) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      } while (Date.now() < deadline);
      expect(waiting.sort()).toEqual([...pids].sort());
      await blocker.commit();
      const results = await pending;
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      expect(rejected?.reason).toBeInstanceOf(LastActiveAdminError);
      expect(await database('users').where({ role: 'admin' }).whereNull('disabled_at')).toHaveLength(1);
    } finally {
      if (!blocker.isCompleted()) await blocker.rollback();
      if (pending) await pending;
      await Promise.all(clients.map((client) => client.destroy()));
    }
  });
  it('CLI refuses disabling the last admin with a Portuguese error and nonzero exit', async () => {
    const admin = await repository.create({ username: 'only-admin', passwordHash: 'h' });
    const result = spawnSync(process.execPath, ['-r', 'ts-node/register', 'src/scripts/manageLocalAdmin.ts', 'disable', '--username=only-admin'], {
      env: { ...process.env, POSTGRES_HOST: '127.0.0.1', PGOPTIONS: `-c search_path=${schema}`, POSTGRES_PORT: String(process.env.POSTGRES_PORT) },
      encoding: 'utf8', timeout: 15000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('último administrador ativo');
    await expect(repository.findById(admin.id)).resolves.toMatchObject({ disabledAt: null });
  }, 20000);
});
