import type { Knex } from 'knex';

// Bounce rows carry the remote SMTP reply in the API field "erro"; existing rows keep it in raw.
export async function up(knex: Knex): Promise<void> {
  await knex.raw('ALTER TABLE mailgrid_report_entries ADD COLUMN erro TEXT');
  await knex.raw(`UPDATE mailgrid_report_entries SET erro = NULLIF(BTRIM(raw->>'erro'), '') WHERE raw \\? 'erro'`);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('ALTER TABLE mailgrid_report_entries DROP COLUMN IF EXISTS erro');
}
