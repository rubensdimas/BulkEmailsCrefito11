/**
 * Config Service
 * Handles system configurations with database persistence and one-time environment import
 */
import type { Knex } from 'knex';
import { SystemConfigRepository } from '../repositories/systemConfigRepository';
import { MailgridConfig, OidcSettings, LegacyOidcBinding } from '../models/SystemConfig';
import { decryptSecret, encryptSecret } from './configEncryption';
import { environmentSecret, getSessionEncryptionKey, oidcConfigurationFingerprint } from './oidcConfiguration';

export class ConfigService {
  private repository: SystemConfigRepository;

  constructor(private readonly db: Knex) {
    this.repository = new SystemConfigRepository(db);
  }

  /** Read Mailgrid only from persisted configuration. */
  async getMailgridConfig(): Promise<MailgridConfig> {
    const config = await this.repository.getByKey('smtp');
    if (!config) return { host: '', user: '', pass: '', from_address: '', from_name: 'BulkMail Pro', webhook_token: '' };
    const smtp = config.value as MailgridConfig;
    return { host: smtp.host, user: smtp.user, pass: decryptSecret(smtp.pass || ''),
      from_address: smtp.from_address, from_name: smtp.from_name || 'BulkMail Pro',
      webhook_token: decryptSecret(smtp.webhook_token || '') };
  }

  async getOidcSettings(): Promise<OidcSettings | null> {
    const config = await this.repository.getByKey('oidc');
    return config ? this.decryptOidcSettings(config.value as OidcSettings) : null;
  }

  private decryptOidcSettings(settings: OidcSettings): OidcSettings {
    return { ...settings, clientSecret: decryptSecret(settings.clientSecret || '') };
  }

  async updateOidcSettings(settings: OidcSettings): Promise<void> {
    await this.repository.set({ key: 'oidc', value: { ...settings, clientSecret: encryptSecret(settings.clientSecret) } });
  }

  async getLegacyOidcBinding(): Promise<LegacyOidcBinding | null> {
    return this.getConfig<LegacyOidcBinding>('oidc_legacy_binding');
  }

  /** Import missing sections atomically; concurrent starts bind to the stored winner. */
  async importFromEnvironment(env: NodeJS.ProcessEnv = process.env): Promise<{ mailgrid: boolean; oidc: boolean }> {
    return this.db.transaction(async (transaction) => {
      const repository = new SystemConfigRepository(transaction);
      const smtp = await repository.getByKey('smtp');
      const oidc = await repository.getByKey('oidc');
      const binding = await repository.getByKey('oidc_legacy_binding');
      // Prepare every value before writing: unreadable files and encryption failures write nothing.
      const host = !smtp ? (env.MAILGRID_HOST || env.SMTP_HOST || '').trim() : '';
      let mailgrid: MailgridConfig | null = null;
      if (host) {
        const user = env.MAILGRID_USER || env.SMTP_USER || '';
        const pass = environmentSecret(env, 'MAILGRID_PASS') || environmentSecret(env, 'SMTP_PASS');
        mailgrid = { host, user, pass: encryptSecret(pass),
          from_address: env.MAILGRID_SENDER || env.SMTP_SENDER || user,
          from_name: env.MAILGRID_SENDER_NAME || env.SMTP_SENDER_NAME || 'BulkMail Pro',
          webhook_token: encryptSecret(environmentSecret(env, 'MAILGRID_WEBHOOK_TOKEN')) };
      }
      let importedOidc: OidcSettings | null = null;
      if (!oidc && env.OIDC_ISSUER) {
        const issuer = env.OIDC_ISSUER.trim().replace(/\/+$/, '');
        const clientId = (env.OIDC_CLIENT_ID || '').trim();
        const clientSecret = environmentSecret(env, 'OIDC_CLIENT_SECRET');
        const backchannelOrigin = (env.OIDC_BACKCHANNEL_ORIGIN || '').trim().replace(/\/+$/, '');
        if (!clientId || !clientSecret) throw new Error('OIDC_CLIENT_ID and OIDC_CLIENT_SECRET are required');
        let issuerUrl: URL;
        let backchannelUrl: URL | null;
        try { issuerUrl = new URL(issuer); backchannelUrl = backchannelOrigin ? new URL(backchannelOrigin) : null; }
        catch { throw new Error('OIDC issuer and backchannel must be valid URLs'); }
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(issuerUrl.hostname);
        if (issuerUrl.protocol !== 'https:' && !(issuerUrl.protocol === 'http:' && local && process.env.NODE_ENV !== 'production')) {
          throw new Error('OIDC issuer must use HTTPS outside local development');
        }
        if (backchannelUrl && (process.env.NODE_ENV === 'production' || !['http:', 'https:'].includes(backchannelUrl.protocol))) {
          throw new Error('OIDC backchannel must use HTTP or HTTPS outside production');
        }
        importedOidc = { enabled: true, issuer, clientId, clientSecret: encryptSecret(clientSecret), backchannelOrigin };
      }
      const key = !binding && (oidc || importedOidc) ? getSessionEncryptionKey() : null;
      const mailgridInserted = mailgrid ? await repository.insertIfAbsent('smtp', mailgrid) : false;
      const oidcInserted = importedOidc ? await repository.insertIfAbsent('oidc', importedOidc) : false;
      if (!binding && key) {
        // A competing import may have won: derive only from persisted settings after insert.
        const stored = await repository.getByKey('oidc');
        if (!stored) throw new Error('OIDC configuration was not persisted');
        const settings = this.decryptOidcSettings(stored.value as OidcSettings);
        await repository.insertIfAbsent('oidc_legacy_binding', {
          issuer: settings.issuer, configurationFingerprint: oidcConfigurationFingerprint(settings, key),
        });
      }
      return { mailgrid: mailgridInserted, oidc: oidcInserted };
    });
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
        pass: encryptSecret(config.pass),
        from_address: config.from_address,
        from_name: config.from_name || 'BulkMail Pro',
        webhook_token: encryptSecret(config.webhook_token || ''),
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
