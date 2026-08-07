import type { Knex } from 'knex';
import path from 'node:path';

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
      // Knex changes the working directory to the directory of this compiled
      // file. Resolve from __dirname so production always targets dist/migrations.
      directory: path.resolve(__dirname, '..', 'migrations'),
      extension: 'js',
      // TypeScript declarations (*.d.ts) are emitted alongside the compiled
      // migrations. Knex must never attempt to execute those declaration files.
      loadExtensions: ['.js'],
    },
  },
};

export default config;
