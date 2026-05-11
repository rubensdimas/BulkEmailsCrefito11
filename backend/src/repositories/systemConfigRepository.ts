/**
 * SystemConfig Repository
 * CRUD operations for SystemConfig entity
 */
import { Knex } from 'knex';
import {
  SystemConfig,
  ConfigRow,
  CreateConfigInput,
  configFromRow,
} from '../models/SystemConfig';

/**
 * SystemConfigRepository class
 */
export class SystemConfigRepository {
  private readonly db: Knex;
  private readonly tableName = 'configurations';

  constructor(db: Knex) {
    this.db = db;
  }

  /**
   * Get configuration by key
   */
  async getByKey(key: string): Promise<SystemConfig | null> {
    const row = await this.db(this.tableName)
      .where('key', key)
      .first();
    
    if (!row) return null;
    return configFromRow(row as unknown as ConfigRow);
  }

  /**
   * Set configuration (create or update)
   */
  async set(input: CreateConfigInput): Promise<SystemConfig> {
    const existing = await this.getByKey(input.key);

    if (existing) {
      const [row] = await this.db(this.tableName)
        .where('key', input.key)
        .update({
          value: JSON.stringify(input.value),
          updated_at: new Date()
        })
        .returning('*');
      
      return configFromRow(row as unknown as ConfigRow);
    }

    const [row] = await this.db(this.tableName)
      .insert({
        key: input.key,
        value: JSON.stringify(input.value),
        created_at: new Date(),
        updated_at: new Date()
      })
      .returning('*');

    return configFromRow(row as unknown as ConfigRow);
  }

  /**
   * Delete configuration by key
   */
  async delete(key: string): Promise<boolean> {
    const result = await this.db(this.tableName)
      .where('key', key)
      .del();
    
    return result > 0;
  }

  /**
   * List all configurations
   */
  async listAll(): Promise<SystemConfig[]> {
    const rows = await this.db(this.tableName).select('*');
    return rows.map(row => configFromRow(row as unknown as ConfigRow));
  }
}

/**
 * Create SystemConfigRepository instance
 */
export const createSystemConfigRepository = (db: Knex): SystemConfigRepository => {
  return new SystemConfigRepository(db);
};
