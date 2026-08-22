import type { Knex } from 'knex';

const INDEX_NAME = 'email_logs_job_status_created_id_idx';

export async function up(knex: Knex): Promise<void> {
  await knex.raw(`
    CREATE INDEX ${INDEX_NAME}
    ON email_logs (job_id, status, created_at DESC, id DESC)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS ${INDEX_NAME}`);
}
