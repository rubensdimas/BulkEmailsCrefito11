/**
 * Config Service
 * Handles system configurations with database persistence and environment fallback
 */
import { Knex } from 'knex';
import { SystemConfigRepository } from '../repositories/systemConfigRepository';
import { SmtpConfig } from '../models/SystemConfig';
import { getSMTPConfig, SMTPConfig } from '../config/smtp';

export class ConfigService {
  private repository: SystemConfigRepository;

  constructor(db: Knex) {
    this.repository = new SystemConfigRepository(db);
  }

  /**
   * Get SMTP configuration from database or environment
   */
  async getSmtpConfig(): Promise<SMTPConfig> {
    try {
      const dbConfig = await this.repository.getByKey('smtp');
      
      if (dbConfig && dbConfig.value) {
        const smtp = dbConfig.value as SmtpConfig;
        return {
          host: smtp.host,
          port: smtp.port,
          secure: smtp.secure,
          auth: {
            user: smtp.user,
            pass: smtp.pass
          },
          sender: smtp.from_address,
          senderName: smtp.from_name || 'BulkMail Pro'
        };
      }
    } catch (error) {
      console.error('Error fetching SMTP config from DB, falling back to ENV:', error);
    }

    // Fallback to environment variables
    return getSMTPConfig();
  }

  /**
   * Update SMTP configuration in database
   */
  async updateSmtpConfig(config: SmtpConfig): Promise<void> {
    await this.repository.set({
      key: 'smtp',
      value: config
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
