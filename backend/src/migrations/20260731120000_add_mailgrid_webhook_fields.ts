import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('email_logs', (table) => {
    table.timestamp('delivered_at', { useTz: true }).nullable();
    table.timestamp('mailgrid_sent_at', { useTz: true }).nullable();
    table.timestamp('mailgrid_event_at', { useTz: true }).nullable();
    table.timestamp('webhook_received_at', { useTz: true }).nullable();
    table.smallint('mailgrid_status_code').nullable();
    table.text('mailgrid_status_message').nullable();
    table.jsonb('mailgrid_payload').nullable();
  });

  await knex.raw(`
    ALTER TABLE email_logs
    ADD CONSTRAINT email_logs_mailgrid_status_code_check
    CHECK (mailgrid_status_code IS NULL OR mailgrid_status_code IN (0, 1, 2))
  `);

  await knex.raw(`
    CREATE INDEX email_logs_job_created_id_idx
    ON email_logs (job_id, created_at DESC, id DESC)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS email_logs_job_created_id_idx');
  await knex.raw('ALTER TABLE email_logs DROP CONSTRAINT IF EXISTS email_logs_mailgrid_status_code_check');

  await knex.schema.alterTable('email_logs', (table) => {
    table.dropColumns(
      'delivered_at',
      'mailgrid_sent_at',
      'mailgrid_event_at',
      'webhook_received_at',
      'mailgrid_status_code',
      'mailgrid_status_message',
      'mailgrid_payload'
    );
  });
}
