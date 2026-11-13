import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE TABLE mailgrid_report_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type TEXT NOT NULL CHECK (type IN ('scheduled', 'manual', 'backfill')),
      window_start TIMESTAMPTZ NOT NULL,
      window_end TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed')),
      fetched INTEGER NOT NULL DEFAULT 0,
      inserted INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      error_code TEXT CHECK (error_code IN ('auth_failed', 'token_not_configured', 'request_failed', 'invalid_response')),
      error_message TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      triggered_by TEXT
    )
  `);
  await knex.raw('CREATE INDEX mailgrid_report_runs_started_idx ON mailgrid_report_runs (started_at DESC)');

  // tipo_status is NOT NULL so the unique key also deduplicates rows without a result type.
  await knex.raw(`
    CREATE TABLE mailgrid_report_entries (
      id BIGSERIAL PRIMARY KEY,
      msgid TEXT NOT NULL,
      email_de TEXT,
      email_para TEXT NOT NULL,
      status TEXT,
      tipo_status TEXT NOT NULL DEFAULT '',
      sender TEXT,
      sender_ip TEXT,
      sender_host TEXT,
      size TEXT,
      delivery_ip TEXT,
      delivery_host TEXT,
      message_id TEXT,
      assunto TEXT,
      event_at TIMESTAMPTZ NOT NULL,
      sent_at TIMESTAMPTZ,
      raw JSONB NOT NULL,
      collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      run_id UUID REFERENCES mailgrid_report_runs (id) ON DELETE SET NULL,
      CONSTRAINT mailgrid_report_entries_event_uq UNIQUE (msgid, email_para, event_at, tipo_status)
    )
  `);
  await knex.raw('CREATE INDEX mailgrid_report_entries_event_idx ON mailgrid_report_entries (event_at DESC, id DESC)');
  await knex.raw('CREATE INDEX mailgrid_report_entries_msgid_idx ON mailgrid_report_entries (msgid)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS mailgrid_report_entries');
  await knex.raw('DROP TABLE IF EXISTS mailgrid_report_runs');
}
