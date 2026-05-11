import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("configurations", (table) => {
    table.increments("id").primary();
    table.string("key").notNullable().unique();
    table.jsonb("value").notNullable();
    table.timestamps(true, true);
  });

  // Add trigger for updated_at using existing function
  await knex.raw(`
    CREATE TRIGGER update_configurations_updated_at 
    BEFORE UPDATE ON configurations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  `);

  // Add comment
  await knex.raw("COMMENT ON TABLE configurations IS 'Stores system configurations like SMTP settings'");
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("configurations");
}
