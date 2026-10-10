import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("local_users", (table) => {
    table.uuid("id").primary();
    table.string("username", 64).notNullable().unique();
    table.text("password_hash").notNullable();
    table.timestamp("disabled_at", { useTz: true }).nullable();
    table.timestamp("last_login_at", { useTz: true }).nullable();
    table.timestamps(true, true);
  });

  await knex.raw(
    "ALTER TABLE local_users ADD CONSTRAINT local_users_username_lowercase CHECK (username = lower(username))",
  );

  await knex.raw(`
    CREATE TRIGGER update_local_users_updated_at
    BEFORE UPDATE ON local_users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  `);

  await knex.raw("COMMENT ON TABLE local_users IS 'Local username/password accounts used alongside OIDC login'");
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("local_users");
}
