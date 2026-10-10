/**
 * Config Service Tests
 */
import { ConfigService } from './configService';
import { SystemConfigRepository } from '../repositories/systemConfigRepository';
import type { Knex } from 'knex';

// Mock repository
jest.mock('../repositories/systemConfigRepository');

describe('ConfigService', () => {
  let configService: ConfigService;
  let mockRepository: jest.Mocked<SystemConfigRepository>;
  const mockDb = { transaction: jest.fn(async (callback) => callback(mockDb)) } as unknown as Knex;

  beforeEach(() => {
    jest.resetAllMocks();
    (mockDb.transaction as jest.Mock).mockImplementation(async (callback) => callback(mockDb));
    mockRepository = new SystemConfigRepository(mockDb) as jest.Mocked<SystemConfigRepository>;
    (SystemConfigRepository as jest.Mock).mockImplementation(() => mockRepository);
    configService = new ConfigService(mockDb);
  });

  describe('getMailgridConfig', () => {
    it('should return SMTP config from database if exists', async () => {
      const mockDbConfig = {
        id: 1,
        key: 'smtp',
        value: {
          host: 'smtp.db.com',
          user: 'dbuser',
          pass: 'dbpass',
          from_address: 'db@test.com',
          from_name: 'DB Sender',
          webhook_token: 'webhook-secret'
        },
        created_at: new Date(),
        updated_at: new Date()
      };

      mockRepository.getByKey.mockResolvedValue(mockDbConfig);

      const result = await configService.getMailgridConfig();

      expect(result.host).toBe('smtp.db.com');
      expect(result.user).toBe('dbuser');
      expect(result.from_address).toBe('db@test.com');
      expect(result.webhook_token).toBe('webhook-secret');
      expect(mockRepository.getByKey).toHaveBeenCalledWith('smtp');
    });

    it('ignores environment settings when no configuration is stored', async () => {
      process.env.MAILGRID_HOST = 'environment.host';
      mockRepository.getByKey.mockResolvedValue(null);
      await expect(configService.getMailgridConfig()).resolves.toEqual({
        host: '', user: '', pass: '', from_address: '', from_name: 'BulkMail Pro', webhook_token: '',
      });
      delete process.env.MAILGRID_HOST;
    });

    it('propagates database failures', async () => {
      mockRepository.getByKey.mockRejectedValue(new Error('DB Error'));
      await expect(configService.getMailgridConfig()).rejects.toThrow('DB Error');
    });
  });

  describe('environment import', () => {
    const settings = { enabled: true, issuer: 'https://intranet.example', clientId: 'client', clientSecret: 'secret', backchannelOrigin: '' };
    const env = { OIDC_ISSUER: settings.issuer, OIDC_CLIENT_ID: settings.clientId, OIDC_CLIENT_SECRET: settings.clientSecret, MAILGRID_HOST: 'smtp.example', MAILGRID_PASS: 'mailpass' };
    beforeEach(() => {
      process.env.OIDC_SESSION_ENCRYPTION_KEY = 'ab'.repeat(32);
      mockRepository.getByKey.mockResolvedValue(null);
      mockRepository.insertIfAbsent.mockResolvedValue(true);
    });
    afterEach(() => { delete process.env.OIDC_SESSION_ENCRYPTION_KEY; });

    it('imports both sections and the original binding', async () => {
      mockRepository.getByKey.mockImplementation(async (key) => key === 'oidc' && mockRepository.insertIfAbsent.mock.calls.some(([insertKey]) => insertKey === 'oidc') ? { id: 1, key, value: settings, created_at: new Date(), updated_at: new Date() } : null);
      await expect(configService.importFromEnvironment(env)).resolves.toEqual({ mailgrid: true, oidc: true });
      expect(mockRepository.insertIfAbsent).toHaveBeenCalledWith('oidc_legacy_binding', expect.objectContaining({ issuer: settings.issuer, configurationFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    });

    it('fails without writing when a legacy secret file is unreadable and retries successfully', async () => {
      await expect(configService.importFromEnvironment({ ...env, OIDC_CLIENT_SECRET: undefined, OIDC_CLIENT_SECRET_FILE: '/missing/secret' })).rejects.toThrow('OIDC_CLIENT_SECRET_FILE');
      expect(mockRepository.insertIfAbsent).not.toHaveBeenCalled();
      mockRepository.getByKey.mockImplementation(async (key) => key === 'oidc' && mockRepository.insertIfAbsent.mock.calls.some(([insertKey]) => insertKey === 'oidc') ? { id: 1, key, value: settings, created_at: new Date(), updated_at: new Date() } : null);
      await expect(configService.importFromEnvironment(env)).resolves.toEqual({ mailgrid: true, oidc: true });
    });

    it('ignores unreadable files and derives missing binding from stored OIDC', async () => {
      mockRepository.getByKey.mockImplementation(async (key) => key === 'oidc_legacy_binding' ? null : { id: 1, key, value: key === 'oidc' ? settings : {}, created_at: new Date(), updated_at: new Date() });
      await expect(configService.importFromEnvironment({ MAILGRID_PASS_FILE: '/missing/mail', OIDC_CLIENT_SECRET_FILE: '/missing/oidc', OIDC_ISSUER: 'https://stale.example' })).resolves.toEqual({ mailgrid: false, oidc: false });
      expect(mockRepository.insertIfAbsent).toHaveBeenCalledTimes(1);
      expect(mockRepository.insertIfAbsent).toHaveBeenCalledWith('oidc_legacy_binding', expect.objectContaining({ issuer: settings.issuer }));
    });

    it('does not create binding without OIDC configuration', async () => {
      await expect(configService.importFromEnvironment({})).resolves.toEqual({ mailgrid: false, oidc: false });
      expect(mockRepository.insertIfAbsent).not.toHaveBeenCalled();
    });

    it('preserves the original binding when OIDC issuer changes', async () => {
      const binding = { issuer: settings.issuer, configurationFingerprint: 'original' };
      mockRepository.getByKey.mockResolvedValue({ id: 1, key: 'oidc_legacy_binding', value: binding, created_at: new Date(), updated_at: new Date() });
      const before = await configService.getLegacyOidcBinding();
      await configService.updateOidcSettings({ ...settings, issuer: 'https://new.example' });
      await expect(configService.getLegacyOidcBinding()).resolves.toEqual(before);
      expect(mockRepository.set).toHaveBeenCalledWith({ key: 'oidc', value: expect.objectContaining({ issuer: 'https://new.example' }) });
    });

    it('stores and decrypts the OIDC client secret', async () => {
      process.env.CONFIG_ENCRYPTION_KEY = 'cd'.repeat(32);
      try {
        await configService.updateOidcSettings(settings);
        const stored = mockRepository.set.mock.calls[0][0];
        expect((stored.value as typeof settings).clientSecret).not.toContain('secret');
        mockRepository.getByKey.mockResolvedValue({ id: 1, key: 'oidc', value: stored.value, created_at: new Date(), updated_at: new Date() });
        await expect(configService.getOidcSettings()).resolves.toEqual(settings);
      } finally { delete process.env.CONFIG_ENCRYPTION_KEY; }
    });

    it('returns null for absent OIDC settings and binding', async () => {
      await expect(configService.getOidcSettings()).resolves.toBeNull();
      await expect(configService.getLegacyOidcBinding()).resolves.toBeNull();
    });
  });

  describe('updateMailgridConfig' , () => {
    it('should save SMTP config to repository', async () => {
      const newConfig = {
        host: 'new.smtp.com',
        user: 'newuser',
        pass: 'newpass',
        from_address: 'new@test.com',
        webhook_token: 'new-webhook-token'
      };

      await configService.updateMailgridConfig(newConfig);

      expect(mockRepository.set).toHaveBeenCalledWith({
        key: 'smtp',
        value: {
          ...newConfig,
          from_name: 'BulkMail Pro',
        }
      });
    });
  });
});
