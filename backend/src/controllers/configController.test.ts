import { Request, Response } from 'express';
import configController from './configController';
import { getConfigService, isDatabaseReady } from '../services/databaseService';
import { sendViaMailgrid } from '../services/mailgridService';

jest.mock('../services/databaseService');
jest.mock('../services/mailgridService', () => ({ sendViaMailgrid: jest.fn() }));

describe('ConfigController', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequest = {};
    mockResponse = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    nextFunction = jest.fn();
  });

  it('returns 503 when Mailgrid configuration cannot be read', async () => {
    (isDatabaseReady as jest.Mock).mockReturnValue(false);
    await configController.getMailgridConfig(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(mockResponse.status).toHaveBeenCalledWith(503);
  });

  it('returns Mailgrid configuration without the password', async () => {
    (isDatabaseReady as jest.Mock).mockReturnValue(true);
    (getConfigService as jest.Mock).mockReturnValue({
      getMailgridConfig: jest.fn().mockResolvedValue({ host: 'smtp.mailgrid.net.br', user: 'user', pass: 'secret', from_address: 'from@test.com', webhook_token: 'webhook-secret' }),
    });
    await configController.getMailgridConfig(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        host: 'smtp.mailgrid.net.br',
        user: 'user',
        pass: '',
        webhook_token: '',
        webhook_token_configured: true,
      }),
    }));
  });

  it('sends a test email through Mailgrid', async () => {
    (isDatabaseReady as jest.Mock).mockReturnValue(false);
    (sendViaMailgrid as jest.Mock).mockResolvedValue({ messageId: 'mailgrid-1' });
    mockRequest.body = { config: { host: 'smtp.mailgrid.net.br', user: 'user', pass: 'pass', from_address: 'from@test.com' }, to: 'to@test.com' };
    await configController.testMailgridConfig(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(sendViaMailgrid).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ to: 'to@test.com' }));
    expect(mockResponse.status).toHaveBeenCalledWith(200);
  });

  it('keeps stored secrets when update fields are blank', async () => {
    const updateMailgridConfig = jest.fn();
    (isDatabaseReady as jest.Mock).mockReturnValue(true);
    (getConfigService as jest.Mock).mockReturnValue({
      getMailgridConfig: jest.fn().mockResolvedValue({
        pass: 'stored-password',
        webhook_token: 'stored-webhook-token',
      }),
      updateMailgridConfig,
    });
    mockRequest.body = {
      host: 'smtp.mailgrid.net.br',
      user: 'user',
      pass: '',
      from_address: 'from@test.com',
      webhook_token: '',
    };

    await configController.updateMailgridConfig(
      mockRequest as Request,
      mockResponse as Response,
      nextFunction
    );

    expect(updateMailgridConfig).toHaveBeenCalledWith(expect.objectContaining({
      pass: 'stored-password',
      webhook_token: 'stored-webhook-token',
    }));
  });
});
