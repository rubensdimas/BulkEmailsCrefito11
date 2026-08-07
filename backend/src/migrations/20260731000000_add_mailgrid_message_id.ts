import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("email_logs", (table) => {
    table.string("mailgrid_message_id", 255).nullable();
  });
  await knex.raw(`
    CREATE UNIQUE INDEX email_logs_mailgrid_message_id_unique
    ON email_logs (mailgrid_message_id)
    WHERE mailgrid_message_id IS NOT NULL
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw("DROP INDEX IF EXISTS email_logs_mailgrid_message_id_unique");
  await knex.schema.alterTable("email_logs", (table) => {
    table.dropColumn("mailgrid_message_id");
  });
}
