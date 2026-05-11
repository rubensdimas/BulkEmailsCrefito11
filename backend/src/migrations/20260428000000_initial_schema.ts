import { Knex } from "knex";
import * as fs from "fs";
import * as path from "path";

export async function up(knex: Knex): Promise<void> {
  const sqlPath = path.join(__dirname, "001_initial_schema.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  
  // Split the SQL file by semicolons to execute statements individually if needed, 
  // but knex.raw can usually handle multiple statements in Postgres
  await knex.raw(sql);
}

export async function down(knex: Knex): Promise<void> {
  // Drop tables in reverse order
  await knex.raw(`
    DROP TABLE IF EXISTS email_logs CASCADE;
    DROP TABLE IF EXISTS jobs CASCADE;
    DROP FUNCTION IF EXISTS update_updated_at_column CASCADE;
  `);
}
