/**
 * Config Service Tests
 */
import { ConfigService } from './configService';
import { SystemConfigRepository } from '../repositories/systemConfigRepository';
import { Knex } from 'knex';

// Mock repository
jest.mock('../repositories/systemConfigRepository');

describe('ConfigService', () => {
  let configService: ConfigService;
  let mockRepository: jest.Mocked<SystemConfigRepository>;
  const mockDb = {} as Knex;

  beforeEach(() => {
    jest.clearAllMocks();
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

    it('should fall back to environment variables if database config does not exist', async () => {
      mockRepository.getByKey.mockResolvedValue(null);
      
      // We expect it to use process.env values (or defaults from getSMTPConfig)
      const result = await configService.getMailgridConfig();
      
      expect(result).toBeDefined();
      expect(mockRepository.getByKey).toHaveBeenCalledWith('smtp');
    });

    it('should fall back to environment variables if database query fails', async () => {
      mockRepository.getByKey.mockRejectedValue(new Error('DB Error'));
      
      const result = await configService.getMailgridConfig();
      
      expect(result).toBeDefined();
      expect(mockRepository.getByKey).toHaveBeenCalledWith('smtp');
    });
  });

  describe('updateMailgridConfig', () => {
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
