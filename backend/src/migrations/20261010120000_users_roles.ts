import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Rename in place to preserve existing account IDs, credentials and timestamps.
  await knex.schema.renameTable('local_users', 'users');
  await knex.schema.alterTable('users', (table) => {
    table.string('username', 64).nullable().alter();
    table.text('password_hash').nullable().alter();
    table.string('provider', 16).notNullable().defaultTo('local');
    table.string('role', 16).notNullable().defaultTo('admin');
    table.text('oidc_sub').nullable();
    table.text('oidc_issuer').nullable();
    table.text('email').nullable();
    table.text('name').nullable();
    table.boolean('must_change_password').notNullable().defaultTo(false);
    table.integer('credential_version').notNullable().defaultTo(0);
    table.unique(['oidc_issuer', 'oidc_sub'], { indexName: 'users_oidc_identity_unique' });
  });
  await knex.raw(`
    ALTER TABLE users
    ADD CONSTRAINT users_provider_check CHECK (provider IN ('local', 'oidc')),
    ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'operator')),
    ADD CONSTRAINT users_identity_check CHECK (
      (provider = 'local' AND username IS NOT NULL AND password_hash IS NOT NULL
        AND oidc_issuer IS NULL AND oidc_sub IS NULL)
      OR (provider = 'oidc' AND oidc_issuer IS NOT NULL AND oidc_sub IS NOT NULL
        AND username IS NULL AND password_hash IS NULL)
    )
  `);
  await knex.raw("COMMENT ON TABLE users IS 'Local and OIDC accounts with application roles'");
}

export async function down(knex: Knex): Promise<void> {
  // The previous schema supports only local accounts.
  await knex('users').where({ provider: 'oidc' }).delete();
  await knex.raw(`
    ALTER TABLE users DROP CONSTRAINT users_identity_check,
    DROP CONSTRAINT users_provider_check, DROP CONSTRAINT users_role_check
  `);
  await knex.schema.alterTable('users', (table) => {
    table.dropUnique(['oidc_issuer', 'oidc_sub'], 'users_oidc_identity_unique');
    table.dropColumns('provider', 'role', 'oidc_sub', 'oidc_issuer', 'email', 'name', 'must_change_password', 'credential_version');
    table.string('username', 64).notNullable().alter();
    table.text('password_hash').notNullable().alter();
  });
  await knex.schema.renameTable('users', 'local_users');
  await knex.raw("COMMENT ON TABLE local_users IS 'Local username/password accounts used alongside OIDC login'");
}
