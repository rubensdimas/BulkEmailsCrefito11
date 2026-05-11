/**
 * Config Controller Tests
 */
import { Request, Response } from 'express';
import configController from './configController';
import { getConfigService, isDatabaseReady } from '../services/databaseService';
import nodemailer from 'nodemailer';

// Mocks
jest.mock('../services/databaseService');
jest.mock('../config/smtp');
jest.mock('nodemailer');

describe('ConfigController', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequest = {};
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    nextFunction = jest.fn();
  });

  describe('getSmtpConfig', () => {
    it('should return 503 if database is not ready', async () => {
      (isDatabaseReady as jest.Mock).mockReturnValue(false);

      await configController.getSmtpConfig(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(503);
      expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    });

    it('should return SMTP config if database is ready', async () => {
      (isDatabaseReady as jest.Mock).mockReturnValue(true);
      const mockConfigService = {
        getSmtpConfig: jest.fn().mockResolvedValue({
          host: 'smtp.test.com',
          port: 587,
          secure: false,
          auth: { user: 'testuser', pass: 'secret' },
          sender: 'test@test.com'
        })
      };
      (getConfigService as jest.Mock).mockReturnValue(mockConfigService);

      await configController.getSmtpConfig(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          host: 'smtp.test.com',
          user: 'testuser',
          pass: '' // Security check: password should be empty
        })
      }));
    });
  });

  describe('testSmtpConfig', () => {
    it('should successfully test SMTP connection', async () => {
      const mockTransporter = {
        verify: jest.fn().mockResolvedValue(true),
        sendMail: jest.fn().mockResolvedValue({ messageId: 'test-id' })
      };
      (nodemailer.createTransport as jest.Mock).mockReturnValue(mockTransporter);

      mockRequest.body = {
        config: {
          host: 'smtp.test.com',
          port: 587,
          user: 'user',
          pass: 'pass',
          from_address: 'from@test.com'
        },
        to: 'to@test.com'
      };

      await configController.testSmtpConfig(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockTransporter.verify).toHaveBeenCalled();
      expect(mockTransporter.sendMail).toHaveBeenCalledWith(expect.objectContaining({
        to: 'to@test.com',
        from: expect.stringContaining('from@test.com')
      }));
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('should return 500 if SMTP test fails', async () => {
      const mockTransporter = {
        verify: jest.fn().mockRejectedValue(new Error('Auth failed'))
      };
      (nodemailer.createTransport as jest.Mock).mockReturnValue(mockTransporter);

      mockRequest.body = {
        config: { host: 'smtp.fail.com' },
        to: 'to@test.com'
      };

      await configController.testSmtpConfig(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        error: 'SMTP test failed'
      }));
    });
  });
});
