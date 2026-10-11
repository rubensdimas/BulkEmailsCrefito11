/**
 * SystemConfig Model
 * TypeScript interfaces for configurations entity
 */

/**
 * Mailgrid configuration interface
 */
export interface MailgridConfig {
  host: string;
  user: string;
  pass: string;
  from_address: string;
  from_name?: string;
  webhook_token?: string;
  webhook_token_configured?: boolean;
}

/**
 * Configuration value type
 */
export interface OidcSettings {
  enabled: boolean;
  issuer: string;
  clientId: string;
  clientSecret: string;
  backchannelOrigin: string;
}

export interface LegacyOidcBinding {
  issuer: string;
  configurationFingerprint: string;
}

export type ConfigValue = MailgridConfig | OidcSettings | LegacyOidcBinding | Record<string, unknown>;

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
