import type { Knex } from 'knex';

const config: Record<string, Knex.Config> = {
  production: {
    client: 'pg',
    connection: {
      host: process.env.POSTGRES_HOST,
      port: Number(process.env.POSTGRES_PORT || 5432),
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DB,
    },
    pool: { min: 1, max: 5 },
    migrations: {
      tableName: 'knex_migrations',
      directory: './dist/migrations',
      extension: 'js',
    },
  },
};

export default config;
