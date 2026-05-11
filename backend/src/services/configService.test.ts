/**
 * Config Service Tests
 */
import { ConfigService } from './configService';
import { SystemConfigRepository } from '../repositories/systemConfigRepository';

// Mock repository
jest.mock('../repositories/systemConfigRepository');

describe('ConfigService', () => {
  let configService: ConfigService;
  let mockRepository: jest.Mocked<SystemConfigRepository>;
  const mockDb = {} as any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRepository = new SystemConfigRepository(mockDb) as jest.Mocked<SystemConfigRepository>;
    (SystemConfigRepository as jest.Mock).mockImplementation(() => mockRepository);
    configService = new ConfigService(mockDb);
  });

  describe('getSmtpConfig', () => {
    it('should return SMTP config from database if exists', async () => {
      const mockDbConfig = {
        id: 1,
        key: 'smtp',
        value: {
          host: 'smtp.db.com',
          port: 587,
          secure: false,
          user: 'dbuser',
          pass: 'dbpass',
          from_address: 'db@test.com',
          from_name: 'DB Sender'
        },
        created_at: new Date(),
        updated_at: new Date()
      };

      mockRepository.getByKey.mockResolvedValue(mockDbConfig);

      const result = await configService.getSmtpConfig();

      expect(result.host).toBe('smtp.db.com');
      expect(result.auth.user).toBe('dbuser');
      expect(result.sender).toBe('db@test.com');
      expect(mockRepository.getByKey).toHaveBeenCalledWith('smtp');
    });

    it('should fall back to environment variables if database config does not exist', async () => {
      mockRepository.getByKey.mockResolvedValue(null);
      
      // We expect it to use process.env values (or defaults from getSMTPConfig)
      const result = await configService.getSmtpConfig();
      
      expect(result).toBeDefined();
      expect(mockRepository.getByKey).toHaveBeenCalledWith('smtp');
    });

    it('should fall back to environment variables if database query fails', async () => {
      mockRepository.getByKey.mockRejectedValue(new Error('DB Error'));
      
      const result = await configService.getSmtpConfig();
      
      expect(result).toBeDefined();
      expect(mockRepository.getByKey).toHaveBeenCalledWith('smtp');
    });
  });

  describe('updateSmtpConfig', () => {
    it('should save SMTP config to repository', async () => {
      const newConfig = {
        host: 'new.smtp.com',
        port: 465,
        secure: true,
        user: 'newuser',
        pass: 'newpass',
        from_address: 'new@test.com'
      };

      await configService.updateSmtpConfig(newConfig);

      expect(mockRepository.set).toHaveBeenCalledWith({
        key: 'smtp',
        value: newConfig
      });
    });
  });
});
