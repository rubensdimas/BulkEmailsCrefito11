/**
 * Database Configuration
 * Knex.js configuration for PostgreSQL
 */
import knex, { Knex } from 'knex';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Database configuration interface
export interface DatabaseConfig {
  client: 'pg';
  connection: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
  pool: {
    min: number;
    max: number;
  };
  migrations: {
    tableName: string;
    directory: string;
  };
}

// Get environment variables with defaults
const dbConfig: DatabaseConfig = {
  client: 'pg',
  connection: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    user: process.env.POSTGRES_USER || 'bulkmail',
    password: process.env.POSTGRES_PASSWORD || 'bulkmail123',
    database: process.env.POSTGRES_DB || 'bulkmail',
  },
  pool: {
    min: 2,
    max: 10,
  },
  migrations: {
    tableName: 'knex_migrations',
    directory: './migrations',
  },
};

// Database instance singleton
let db: Knex | null = null;

/**
 * Initialize database connection
 */
export const initDatabase = async (): Promise<Knex> => {
  if (db) {
    return db;
  }

  try {
    db = knex(dbConfig);
    
    // Test connection
    await db.raw('SELECT 1');
    console.log('✅ Database connected successfully');
    
    return db;
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    throw error;
  }
};

/**
 * Get database instance
 */
export const getDatabase = (): Knex => {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
};

/**
 * Close database connection
 */
export const closeDatabase = async (): Promise<void> => {
  if (db) {
    await db.destroy();
    db = null;
    console.log('🔌 Database connection closed');
  }
};

// Export knex configuration for Knex CLI
export default {
  client: dbConfig.client,
  connection: dbConfig.connection,
  pool: dbConfig.pool,
  migrations: dbConfig.migrations,
};