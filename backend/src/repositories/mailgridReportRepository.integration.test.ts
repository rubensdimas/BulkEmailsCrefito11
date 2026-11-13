import knex, { Knex } from 'knex';
import { MailgridReportRepository } from './mailgridReportRepository';
import { up as createMailgridReports } from '../migrations/20261112000000_create_mailgrid_reports';
import { up as addMailgridReportErro } from '../migrations/20261113000000_add_mailgrid_report_erro';
import type { MailgridReportEntryInput } from '../models/MailgridReport';

const describeDatabase = process.env.RUN_DATABASE_INTEGRATION === 'true' ? describe : describe.skip;

const entry = (overrides: Partial<MailgridReportEntryInput>): MailgridReportEntryInput => ({
  msgid: 'msg-1', email_de: 'from@example.com', email_para: 'to@example.com', status: 'Entregue com sucesso',
  tipo_status: 'Aceita', sender: 'from@example.com', sender_ip: '10.0.0.1', sender_host: 'prd-crefito-8',
  size: '7 KB', delivery_ip: '10.0.0.2', delivery_host: 'mx.example.com', message_id: 'mid@example.com',
  assunto: 'Assunto', event_at: new Date('2026-11-11T13:00:00Z'), sent_at: new Date('2026-11-11T12:59:59Z'),
  raw: { msgid: 'msg-1' }, erro: null, ...overrides,
});

describeDatabase('MailgridReportRepository PostgreSQL integration', () => {
  let database: Knex;
  const suffix = Date.now();

  beforeAll(() => {
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
  });

  afterAll(async () => { await database.destroy(); });

  // Each test runs against fresh tables in an isolated schema that is dropped afterwards.
  const inSchema = async (name: string, run: (repository: MailgridReportRepository) => Promise<void>) => {
    const schema = `mailgrid_it_${name}_${suffix}`;
    await database.transaction(async (transaction) => {
      await transaction.raw('CREATE SCHEMA ??', [schema]);
      await transaction.raw('SET LOCAL search_path TO ??, public', [schema]);
      await createMailgridReports(transaction);
      await addMailgridReportErro(transaction);
      try { await run(new MailgridReportRepository(transaction)); }
      finally { await transaction.raw('DROP SCHEMA ?? CASCADE', [schema]); }
    });
  };

  it('insertEntries ignores identical events and keeps distinct events of the same msgid', async () => {
    await inSchema('dedupe', async (repository) => {
      const run = await repository.createRun({
        type: 'manual', window_start: new Date('2026-11-11T00:00:00Z'), window_end: new Date('2026-11-12T00:00:00Z'), triggered_by: 'it',
      });
      const softBounce = entry({ tipo_status: 'Soft Bounce', event_at: new Date('2026-11-11T13:00:00Z') });
      const accepted = entry({ tipo_status: 'Aceita', event_at: new Date('2026-11-11T13:05:00Z') });
      await expect(repository.insertEntries(run.id, [softBounce, accepted])).resolves.toBe(2);
      await expect(repository.insertEntries(run.id, [softBounce, accepted])).resolves.toBe(0);
      const result = await repository.query({
        from: new Date('2026-11-11T00:00:00Z'), to: new Date('2026-11-12T00:00:00Z'), page: 1, pageSize: 50,
      });
      expect(result.total).toBe(2);
      expect(result.rows.map((row) => row.tipo_status)).toEqual(['Aceita', 'Soft Bounce']);
    });
  });

  it('query filters by period, tipoStatus and escapes LIKE wildcards', async () => {
    await inSchema('filters', async (repository) => {
      const run = await repository.createRun({
        type: 'manual', window_start: new Date('2026-11-01T00:00:00Z'), window_end: new Date('2026-11-12T00:00:00Z'), triggered_by: 'it',
      });
      await repository.insertEntries(run.id, [
        entry({ msgid: 'a', email_para: '1000@x.com', tipo_status: 'Aceita' }),
        entry({ msgid: 'b', email_para: '100%@x.com', tipo_status: 'Hard Bounce' }),
        entry({ msgid: 'c', email_para: 'old@x.com', event_at: new Date('2026-10-01T00:00:00Z') }),
      ]);
      const base = { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-12T00:00:00Z'), page: 1, pageSize: 50 };
      expect((await repository.query({ ...base, recipient: '100%' })).rows.map((row) => row.msgid)).toEqual(['b']);
      expect((await repository.query({ ...base, tipoStatus: ['Aceita'] })).rows.map((row) => row.msgid)).toEqual(['a']);
      expect((await repository.query(base)).total).toBe(2);
      await expect(repository.count(base)).resolves.toBe(2);
      await expect(repository.listSenderHosts()).resolves.toEqual(['prd-crefito-8']);
    });
  });

  it('hasRunningBackfill ignores backfill runs stuck in running for more than 6 hours', async () => {
    await inSchema('stale', async (repository) => {
      const run = await repository.createRun({
        type: 'backfill', window_start: new Date('2026-08-14T00:00:00Z'), window_end: new Date('2026-08-21T00:00:00Z'), triggered_by: 'it',
      });
      await repository.db('mailgrid_report_runs').where({ id: run.id })
        .update({ started_at: new Date(Date.now() - 7 * 60 * 60 * 1000) });
      await expect(repository.hasRunningBackfill()).resolves.toBe(false);
    });
  });

  it('latestConclusiveRun skips running and request_failed runs', async () => {
    await inSchema('conclusive', async (repository) => {
      const window = { window_start: new Date('2026-11-10T00:00:00Z'), window_end: new Date('2026-11-11T00:00:00Z'), triggered_by: 'it' };
      const authFailed = await repository.createRun({ type: 'scheduled', ...window });
      await repository.finishRun(authFailed.id, { status: 'failed', fetched: 0, inserted: 0, skipped: 0, error_code: 'auth_failed' });
      const network = await repository.createRun({ type: 'manual', ...window });
      await repository.finishRun(network.id, { status: 'failed', fetched: 0, inserted: 0, skipped: 0, error_code: 'request_failed' });
      await repository.createRun({ type: 'manual', ...window });
      await expect(repository.latestConclusiveRun()).resolves.toMatchObject({ id: authFailed.id, error_code: 'auth_failed' });
    });
  });

  it('erro migration fills existing bounces from raw and query returns erro', async () => {
    const schema = `mailgrid_it_erro_${suffix}`;
    await database.transaction(async (transaction) => {
      await transaction.raw('CREATE SCHEMA ??', [schema]);
      await transaction.raw('SET LOCAL search_path TO ??, public', [schema]);
      try {
        await createMailgridReports(transaction);
        await transaction('mailgrid_report_entries').insert([
          { msgid: 'b', email_para: 'x@y.com', tipo_status: 'Hard Bounce', event_at: new Date('2026-11-11T13:00:00Z'), raw: JSON.stringify({ erro: '550 5.1.1 user unknown' }) },
          { msgid: 'a', email_para: 'x@y.com', tipo_status: 'Aceita', event_at: new Date('2026-11-11T13:00:00Z'), raw: JSON.stringify({ erro: '' }) },
        ]);
        await addMailgridReportErro(transaction);
        const repository = new MailgridReportRepository(transaction);
        const { rows } = await repository.query({ from: new Date('2026-11-11T00:00:00Z'), to: new Date('2026-11-12T00:00:00Z'), page: 1, pageSize: 50 });
        expect(Object.fromEntries(rows.map((row) => [row.msgid, row.erro]))).toEqual({ b: '550 5.1.1 user unknown', a: null });
      } finally { await transaction.raw('DROP SCHEMA ?? CASCADE', [schema]); }
    });
  });

  it('hasRunningBackfill is true only while a backfill run is running', async () => {
    await inSchema('backfill', async (repository) => {
      await expect(repository.hasRunningBackfill()).resolves.toBe(false);
      const run = await repository.createRun({
        type: 'backfill', window_start: new Date('2026-08-14T00:00:00Z'), window_end: new Date('2026-08-21T00:00:00Z'), triggered_by: 'it',
      });
      await expect(repository.hasRunningBackfill()).resolves.toBe(true);
      await repository.finishRun(run.id, { status: 'success', fetched: 1, inserted: 1, skipped: 0 });
      await expect(repository.hasRunningBackfill()).resolves.toBe(false);
      await expect(repository.latestRun()).resolves.toMatchObject({ id: run.id, status: 'success', inserted: 1 });
      await expect(repository.listRuns(50)).resolves.toHaveLength(1);
    });
  });
});
