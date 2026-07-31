/**
 * Config Service
 * Handles system configurations with database persistence and environment fallback
 */
import { Knex } from 'knex';
import { SystemConfigRepository } from '../repositories/systemConfigRepository';
import { MailgridConfig } from '../models/SystemConfig';

export class ConfigService {
  private repository: SystemConfigRepository;

  constructor(db: Knex) {
    this.repository = new SystemConfigRepository(db);
  }

  /**
 * Get Mailgrid configuration from database or environment
   */
  async getMailgridConfig(): Promise<MailgridConfig> {
    try {
      const dbConfig = await this.repository.getByKey('smtp');
      
      if (dbConfig && dbConfig.value) {
        const smtp = dbConfig.value as MailgridConfig & { port?: number; secure?: boolean };
        return {
          host: smtp.host,
          user: smtp.user,
          pass: smtp.pass,
          from_address: smtp.from_address,
          from_name: smtp.from_name || 'BulkMail Pro',
          webhook_token: smtp.webhook_token || process.env.MAILGRID_WEBHOOK_TOKEN || '',
        };
      }
    } catch (error) {
      console.error('Error fetching Mailgrid config from DB, falling back to ENV:', error);
    }

    // Fallback to environment variables
    return {
      host: process.env.MAILGRID_HOST || process.env.SMTP_HOST || '',
      user: process.env.MAILGRID_USER || process.env.SMTP_USER || '',
      pass: process.env.MAILGRID_PASS || process.env.SMTP_PASS || '',
      from_address: process.env.MAILGRID_SENDER || process.env.SMTP_SENDER || process.env.MAILGRID_USER || process.env.SMTP_USER || '',
      from_name: process.env.MAILGRID_SENDER_NAME || process.env.SMTP_SENDER_NAME || 'BulkMail Pro',
      webhook_token: process.env.MAILGRID_WEBHOOK_TOKEN || '',
    };
  }

  /**
 * Update Mailgrid configuration in database
   */
  async updateMailgridConfig(config: MailgridConfig): Promise<void> {
    await this.repository.set({
      key: 'smtp',
      value: {
        host: config.host,
        user: config.user,
        pass: config.pass,
        from_address: config.from_address,
        from_name: config.from_name || 'BulkMail Pro',
        webhook_token: config.webhook_token || '',
      }
    });
  }
  /**
   * Get generic configuration by key
   */
  async getConfig<T>(key: string): Promise<T | null> {
    const config = await this.repository.getByKey(key);
    return config ? (config.value as T) : null;
  }
}

/**
 * Create ConfigService instance
 */
export const createConfigService = (db: Knex): ConfigService => {
  return new ConfigService(db);
};
