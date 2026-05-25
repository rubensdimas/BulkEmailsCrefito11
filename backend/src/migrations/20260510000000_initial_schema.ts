import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // Schema consolidated into 20260428000000_initial_schema.ts.
  // Keep this migration as a no-op so existing migration history remains valid.
  await knex.raw("SELECT 1");
}

export async function down(knex: Knex): Promise<void> {
  // No-op rollback for the consolidated migration placeholder.
  await knex.raw("SELECT 1");
}
