import { NextFunction, Request, Response } from 'express';
import { receiveMailgridWebhook } from './webhookController';
import {
  getConfigService,
  getEmailLogRepository,
  isDatabaseReady,
} from '../services/databaseService';

jest.mock('../services/databaseService');

describe('receiveMailgridWebhook', () => {
  const status = jest.fn();
  const json = jest.fn();
  const next = jest.fn() as NextFunction;
  const applyMailgridWebhook = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    status.mockReturnValue({ json });
    (isDatabaseReady as jest.Mock).mockReturnValue(true);
    (getConfigService as jest.Mock).mockReturnValue({
      getMailgridConfig: jest.fn().mockResolvedValue({ webhook_token: 'secret-token' }),
    });
    (getEmailLogRepository as jest.Mock).mockReturnValue({ applyMailgridWebhook });
  });

  const request = (authorization?: string, body: unknown = { msgid: 'msg-1', status: 1 }) => ({
    body,
    get: jest.fn().mockReturnValue(authorization),
  } as unknown as Request);

  const response = { status, json } as unknown as Response;

  it('rejects requests without a bearer token', async () => {
    await receiveMailgridWebhook(request(), response, next);
    expect(status).toHaveBeenCalledWith(401);
  });

  it('rejects invalid tokens', async () => {
    await receiveMailgridWebhook(request('Bearer wrong-token'), response, next);
    expect(status).toHaveBeenCalledWith(401);
  });

  it('validates the payload', async () => {
    await receiveMailgridWebhook(request('Bearer secret-token', { msgid: 'msg-1', status: 9 }), response, next);
    expect(status).toHaveBeenCalledWith(400);
  });

  it('updates a known message and acknowledges duplicate-safe processing', async () => {
    applyMailgridWebhook.mockResolvedValue('updated');
    await receiveMailgridWebhook(request('Bearer secret-token'), response, next);

    expect(applyMailgridWebhook).toHaveBeenCalledWith(
      'msg-1',
      expect.objectContaining({ status: 'delivered', statusCode: 1 })
    );
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ status: 'ok', msgid: 'msg-1' });
  });

  it('returns 404 so Mailgrid retries an unknown message', async () => {
    applyMailgridWebhook.mockResolvedValue('not_found');
    await receiveMailgridWebhook(request('Bearer secret-token'), response, next);
    expect(status).toHaveBeenCalledWith(404);
  });

  it('acknowledges an older duplicate without applying it again', async () => {
    applyMailgridWebhook.mockResolvedValue('ignored');
    await receiveMailgridWebhook(request('Bearer secret-token'), response, next);
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ status: 'ok', msgid: 'msg-1', ignored: true });
  });
});
