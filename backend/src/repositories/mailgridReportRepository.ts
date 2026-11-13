import type { Knex } from 'knex';
import type {
  MailgridReportEntry, MailgridReportEntryInput, MailgridReportErrorCode, MailgridReportRun,
  MailgridReportRunType, ReportFilters, ReportQuery,
} from '../models/MailgridReport';

const ENTRIES = 'mailgrid_report_entries';
const RUNS = 'mailgrid_report_runs';
const INSERT_CHUNK_SIZE = 500;
const ENTRY_COLUMNS = [
  'id', 'msgid', 'email_de', 'email_para', 'status', 'tipo_status', 'sender', 'sender_ip', 'sender_host', 'size',
  'delivery_ip', 'delivery_host', 'message_id', 'assunto', 'event_at', 'sent_at', 'collected_at',
];

/** Escapes LIKE wildcards so user input always matches literally. */
export const escapeLike = (value: string): string => value.replace(/[\\%_]/g, '\\$&');

const normalizeRun = (row: Record<string, unknown>): MailgridReportRun => ({
  ...(row as unknown as MailgridReportRun),
  fetched: Number(row.fetched), inserted: Number(row.inserted), skipped: Number(row.skipped),
});

export class MailgridReportRepository {
  constructor(private readonly db: Knex) {}

  async createRun(input: {
    type: MailgridReportRunType; window_start: Date; window_end: Date; triggered_by: string | null;
  }): Promise<MailgridReportRun> {
    const [row] = await this.db(RUNS).insert({ ...input, status: 'running' }).returning('*');
    return normalizeRun(row);
  }

  async finishRun(id: string, result: {
    status: 'success' | 'failed'; fetched: number; inserted: number; skipped: number;
    error_code?: MailgridReportErrorCode | null; error_message?: string | null;
  }): Promise<void> {
    await this.db(RUNS).where({ id }).update({
      status: result.status, fetched: result.fetched, inserted: result.inserted, skipped: result.skipped,
      error_code: result.error_code ?? null, error_message: result.error_message ?? null, finished_at: this.db.fn.now(),
    });
  }

  /** Inserts entries idempotently and returns how many rows were actually new. */
  async insertEntries(runId: string, entries: MailgridReportEntryInput[]): Promise<number> {
    let inserted = 0;
    for (let offset = 0; offset < entries.length; offset += INSERT_CHUNK_SIZE) {
      const rows = entries.slice(offset, offset + INSERT_CHUNK_SIZE)
        .map((entry) => ({ ...entry, raw: JSON.stringify(entry.raw), run_id: runId }));
      const result = await this.db(ENTRIES).insert(rows)
        .onConflict(['msgid', 'email_para', 'event_at', 'tipo_status']).ignore().returning('id');
      inserted += result.length;
    }
    return inserted;
  }

  async listRuns(limit: number): Promise<MailgridReportRun[]> {
    const rows = await this.db(RUNS).orderBy('started_at', 'desc').limit(limit);
    return rows.map(normalizeRun);
  }

  async latestRun(): Promise<MailgridReportRun | null> {
    const row = await this.db(RUNS).orderBy('started_at', 'desc').first();
    return row ? normalizeRun(row) : null;
  }

  async hasRunningBackfill(): Promise<boolean> {
    return Boolean(await this.db(RUNS).where({ type: 'backfill', status: 'running' }).first('id'));
  }

  private filtered(filters: ReportFilters): Knex.QueryBuilder {
    const query = this.db(ENTRIES).where('event_at', '>=', filters.from).andWhere('event_at', '<=', filters.to);
    const partial: Array<[string, string | undefined]> = [
      ['email_para', filters.recipient], ['email_de', filters.sender],
      ['assunto', filters.subject], ['delivery_host', filters.deliveryHost],
    ];
    for (const [column, value] of partial) {
      if (value) query.whereRaw('?? ILIKE ? ESCAPE ?', [column, `%${escapeLike(value)}%`, '\\']);
    }
    if (filters.msgid) query.where('msgid', filters.msgid);
    if (filters.senderHost) query.where('sender_host', filters.senderHost);
    if (filters.tipoStatus?.length) query.whereIn('tipo_status', filters.tipoStatus);
    return query;
  }

  async count(filters: ReportFilters): Promise<number> {
    const row = await this.filtered(filters).count<{ count: string }[]>({ count: '*' }).first();
    return Number(row?.count ?? 0);
  }

  async query(q: ReportQuery): Promise<{ rows: MailgridReportEntry[]; total: number }> {
    const rows = await this.filtered(q).select(ENTRY_COLUMNS)
      .orderBy([{ column: 'event_at', order: 'desc' }, { column: 'id', order: 'desc' }])
      .limit(q.pageSize).offset((q.page - 1) * q.pageSize);
    return { rows: rows as MailgridReportEntry[], total: await this.count(q) };
  }

  stream(filters: ReportFilters, limit: number): AsyncIterable<MailgridReportEntry> {
    return this.filtered(filters).select(ENTRY_COLUMNS)
      .orderBy([{ column: 'event_at', order: 'desc' }, { column: 'id', order: 'desc' }])
      .limit(limit).stream() as unknown as AsyncIterable<MailgridReportEntry>;
  }

  async listSenderHosts(): Promise<string[]> {
    const rows = await this.db(ENTRIES).distinct('sender_host').whereNotNull('sender_host').orderBy('sender_host');
    return rows.map((row: { sender_host: string }) => row.sender_host);
  }
}

export const createMailgridReportRepository = (db: Knex): MailgridReportRepository => new MailgridReportRepository(db);
