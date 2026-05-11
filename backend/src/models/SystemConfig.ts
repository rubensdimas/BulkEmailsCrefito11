/**
 * SystemConfig Model
 * TypeScript interfaces for configurations entity
 */

/**
 * SMTP Configuration interface
 */
export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  secure: boolean;
  from_address: string;
  from_name?: string;
}

/**
 * Configuration value type
 */
export type ConfigValue = SmtpConfig | Record<string, unknown>;

/**
 * SystemConfig entity interface
 */
export interface SystemConfig {
  id: number;
  key: string;
  value: ConfigValue;
  created_at: Date;
  updated_at: Date;
}

/**
 * Configuration creation input
 */
export interface CreateConfigInput {
  key: string;
  value: ConfigValue;
}

/**
 * Database row type (snake_case from PostgreSQL)
 */
export interface ConfigRow {
  id: number;
  key: string;
  value: ConfigValue;
  created_at: Date;
  updated_at: Date;
}

/**
 * Convert database row to SystemConfig entity
 */
export const configFromRow = (row: ConfigRow): SystemConfig => ({
  id: row.id,
  key: row.key,
  value: row.value,
  created_at: row.created_at,
  updated_at: row.updated_at,
});
