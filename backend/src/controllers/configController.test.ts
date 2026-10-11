import { Request, Response } from 'express';
import configController from './configController';
import { getConfigService, isDatabaseReady } from '../services/databaseService';
import { sendViaMailgrid } from '../services/mailgridService';

jest.mock('../services/databaseService');
jest.mock('../services/settingsAudit', () => ({ logSettingsChange: jest.fn() }));
jest.mock('../services/oidcService', () => ({ ...jest.requireActual('../services/oidcService'), probeOidcProvider: jest.fn() }));
import { probeOidcProvider } from '../services/oidcService';
import { logSettingsChange } from '../services/settingsAudit';
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
        host: 'smtp.mailgrid.net.br', user: 'user', from_address: 'old@test.com', from_name: 'BulkMail Pro',
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
    expect(logSettingsChange).toHaveBeenCalledWith({ actor: 'unknown', action: 'settings.update_mailgrid', fields: ['from_address'] });
    expect(JSON.stringify((logSettingsChange as jest.Mock).mock.calls)).not.toMatch(/stored-password|stored-webhook-token/);
    expect(mockRequest.body.pass).toBe('');
  });

  describe('Mailgrid stored password scope', () => {
    const storedMailgrid = { host: 'smtp.mailgrid.net.br', user: 'user', pass: 'stored-password', from_address: 'from@test.com', from_name: 'CREFITO', webhook_token: 'stored-webhook-token' };
    const updateMailgridConfig = jest.fn();
    beforeEach(() => {
      (isDatabaseReady as jest.Mock).mockReturnValue(true);
      (getConfigService as jest.Mock).mockReturnValue({ getMailgridConfig: jest.fn().mockResolvedValue(storedMailgrid), updateMailgridConfig });
    });

    it.each([
      [{ host: 'smtp.attacker.example' }],
      [{ user: 'other-user' }],
    ])('requires the password when saving with a changed host or user: %p', async (change) => {
      mockRequest.body = { ...storedMailgrid, pass: '', webhook_token: '', ...change };
      await configController.updateMailgridConfig(mockRequest as Request, mockResponse as Response, nextFunction);
      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({ success: false, error: 'invalid_mailgrid_settings', message: 'Informe a senha ao alterar o host ou o usuário do Mailgrid.' });
      expect(updateMailgridConfig).not.toHaveBeenCalled();
    });

    it('keeps the stored password for the same host and user despite case and spaces', async () => {
      mockRequest.body = { ...storedMailgrid, host: ' SMTP.mailgrid.net.br ', pass: '', webhook_token: '' };
      await configController.updateMailgridConfig(mockRequest as Request, mockResponse as Response, nextFunction);
      expect(updateMailgridConfig).toHaveBeenCalledWith(expect.objectContaining({ pass: 'stored-password', webhook_token: 'stored-webhook-token' }));
      expect(logSettingsChange).toHaveBeenCalledWith({ actor: 'unknown', action: 'settings.update_mailgrid', fields: [] });
    });

    it('audits only changed field names and supplied secrets', async () => {
      mockRequest.body = { ...storedMailgrid, host: 'smtp.novo.example', pass: 'new-password', webhook_token: '' };
      await configController.updateMailgridConfig(mockRequest as Request, mockResponse as Response, nextFunction);
      expect(logSettingsChange).toHaveBeenCalledWith({ actor: 'unknown', action: 'settings.update_mailgrid', fields: ['host', 'pass'] });
      expect(JSON.stringify((logSettingsChange as jest.Mock).mock.calls)).not.toMatch(/new-password|stored-password|smtp\.novo/);
    });

    it('never sends the stored password to a test host that differs from the saved one', async () => {
      mockRequest.body = { config: { ...storedMailgrid, host: 'smtp.attacker.example', pass: '' }, to: 'to@test.com' };
      await configController.testMailgridConfig(mockRequest as Request, mockResponse as Response, nextFunction);
      expect(sendViaMailgrid).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({ success: false, error: 'invalid_mailgrid_settings', message: 'Informe a senha ao alterar o host ou o usuário do Mailgrid.' });
    });

    it('tests with the stored password when host and user are unchanged', async () => {
      (sendViaMailgrid as jest.Mock).mockResolvedValue({ messageId: 'm' });
      mockRequest.body = { config: { ...storedMailgrid, pass: '' }, to: 'to@test.com' };
      await configController.testMailgridConfig(mockRequest as Request, mockResponse as Response, nextFunction);
      expect(sendViaMailgrid).toHaveBeenCalledWith(expect.objectContaining({ host: 'smtp.mailgrid.net.br', pass: 'stored-password' }), expect.any(Object));
      expect(mockResponse.status).toHaveBeenCalledWith(200);
    });
  });

  describe('OIDC configuration', () => {
    const stored = { enabled: true, issuer: 'https://intranet.example', clientId: 'client', clientSecret: 'stored-secret', backchannelOrigin: '' };
    const service = {
      getOidcSettings: jest.fn().mockResolvedValue(stored),
      updateOidcSettings: jest.fn(),
    };
    const request = (body: object = {}) => ({ body, auth: { account: { username: 'admin', email: null, oidcSub: null, oidcIssuer: null, credentialVersion: 0, id: 'a' } } }) as unknown as Request;

    beforeEach(() => {
      process.env.APP_ORIGIN = 'http://localhost:5173';
      (isDatabaseReady as jest.Mock).mockReturnValue(true);
      (getConfigService as jest.Mock).mockReturnValue(service);
      service.updateOidcSettings.mockClear();
    });

    it('returns settings without the client secret and with the callback URL', async () => {
      await configController.getOidcConfig(request(), mockResponse as Response, nextFunction);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: {
          enabled: true, issuer: 'https://intranet.example', clientId: 'client', clientSecret: '', clientSecretConfigured: true, backchannelAllowed: true,
          backchannelOrigin: '', callbackUrl: 'http://localhost:5173/api/auth/oidc/callback',
        },
      });
    });

    it('returns disabled empty editable settings when no OIDC configuration exists', async () => {
      service.getOidcSettings.mockResolvedValueOnce(null as never);
      await configController.getOidcConfig(request(), mockResponse as Response, nextFunction);
      expect(mockResponse.json).toHaveBeenCalledWith({ success: true, data: {
        enabled: false, issuer: '', clientId: '', clientSecret: '', clientSecretConfigured: false,
        backchannelAllowed: true, backchannelOrigin: '', callbackUrl: 'http://localhost:5173/api/auth/oidc/callback',
      } });
    });

    it('keeps the stored client secret when the field is empty and the provider is unchanged', async () => {
      await configController.updateOidcConfig(
        request({ enabled: true, issuer: ' https://intranet.example/ ', clientId: ' client ', clientSecret: '', backchannelOrigin: '' }),
        mockResponse as Response,
        nextFunction,
      );
      expect(service.updateOidcSettings).toHaveBeenCalledWith({ ...stored, issuer: 'https://intranet.example/' });
    });

    it('trims issuer and client ID before validation and storage', async () => {
      await configController.updateOidcConfig(
        request({ enabled: true, issuer: '  https://novo.example  ', clientId: '  novo  ', clientSecret: 'new-secret', backchannelOrigin: '' }),
        mockResponse as Response,
        nextFunction,
      );
      expect(service.updateOidcSettings).toHaveBeenCalledWith({ ...stored, issuer: 'https://novo.example', clientId: 'novo', clientSecret: 'new-secret' });
    });

    it.each([
      [{ enabled: true, clientId: 'novo' }],
      [{ enabled: true, issuer: 'https://novo.example' }],
      [{ enabled: false, issuer: 'https://novo.example' }],
    ])('requires the client secret when the provider changes: %p', async (change) => {
      await configController.updateOidcConfig(request({ ...stored, clientSecret: '', ...change }), mockResponse as Response, nextFunction);
      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false, error: 'invalid_oidc_settings', message: 'Informe o client secret ao alterar o issuer ou o client ID.',
      });
      expect(service.updateOidcSettings).not.toHaveBeenCalled();
    });

    it('accepts a new provider with a new client secret', async () => {
      await configController.updateOidcConfig(request({ ...stored, issuer: 'https://novo.example', clientId: 'novo', clientSecret: 'new-secret' }), mockResponse as Response, nextFunction);
      expect(service.updateOidcSettings).toHaveBeenCalledWith({ ...stored, issuer: 'https://novo.example', clientId: 'novo', clientSecret: 'new-secret' });
    });

    it('audits only changed OIDC field names and a supplied secret', async () => {
      await configController.updateOidcConfig(request({ ...stored, enabled: false, clientSecret: '' }), mockResponse as Response, nextFunction);
      expect(logSettingsChange).toHaveBeenLastCalledWith({ actor: 'admin', action: 'settings.update_oidc', fields: ['enabled'] });
      await configController.updateOidcConfig(request({ ...stored, clientSecret: 'rotated-secret' }), mockResponse as Response, nextFunction);
      expect(logSettingsChange).toHaveBeenLastCalledWith({ actor: 'admin', action: 'settings.update_oidc', fields: ['clientSecret'] });
      expect(JSON.stringify((logSettingsChange as jest.Mock).mock.calls)).not.toMatch(/rotated-secret|stored-secret/);
    });

    it('does not probe a changed issuer with the stored secret', async () => {
      await configController.testOidcConfig(request({ ...stored, issuer: 'https://novo.example', clientSecret: '' }), mockResponse as Response, nextFunction);
      expect(probeOidcProvider).not.toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'invalid_oidc_settings' }));
    });

    it('rejects invalid settings with a Portuguese message', async () => {
      await configController.updateOidcConfig(
        request({ enabled: true, issuer: 'http://intranet.example', clientId: 'c', clientSecret: 's', backchannelOrigin: '' }),
        mockResponse as Response,
        nextFunction,
      );
      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false, error: 'invalid_oidc_settings', message: 'O issuer precisa usar HTTPS fora do ambiente local.',
      });
      expect(service.updateOidcSettings).not.toHaveBeenCalled();
    });

    it('saves disabled empty settings', async () => {
      await configController.updateOidcConfig(
        request({ enabled: false, issuer: '', clientId: '', clientSecret: '', backchannelOrigin: '' }),
        mockResponse as Response,
        nextFunction,
      );
      // Clearing the provider drops the stored secret: it belongs to the old client.
      expect(service.updateOidcSettings).toHaveBeenCalledWith({ ...stored, enabled: false, issuer: '', clientId: '', clientSecret: '' });
    });

    it.each([
      [{ enabled: false, issuer: 'http://intranet.example' }, 'test'],
      [{ enabled: false, issuer: '', backchannelOrigin: 'http://localhost:9000' }, 'production'],
    ])('validates populated fields even when disabled: %p', async (body, mode) => {
      const previous = process.env.NODE_ENV;
      process.env.NODE_ENV = mode;
      try {
        await configController.updateOidcConfig(request({ ...stored, ...body }), mockResponse as Response, nextFunction);
        expect(mockResponse.status).toHaveBeenCalledWith(400);
        expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'invalid_oidc_settings' }));
        expect(service.updateOidcSettings).not.toHaveBeenCalled();
      } finally { process.env.NODE_ENV = previous; }
    });

    it('keeps omitted secret and excludes binding or response flags from persistence', async () => {
      await configController.updateOidcConfig(request({ ...stored, clientSecret: undefined, legacyIssuer: 'untrusted', clientSecretConfigured: false }), mockResponse as Response, nextFunction);
      expect(service.updateOidcSettings).toHaveBeenCalledWith(stored);
      expect(JSON.stringify((logSettingsChange as jest.Mock).mock.calls)).not.toContain('stored-secret');
    });

    it('returns backchannelAllowed=false in production', async () => {
      const previous = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        await configController.getOidcConfig(request(), mockResponse as Response, nextFunction);
        expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ backchannelAllowed: false }) }));
      } finally { process.env.NODE_ENV = previous; }
    });

    it('tests the provider with the stored secret and reports failures', async () => {
      (probeOidcProvider as jest.Mock).mockResolvedValueOnce(undefined);
      await configController.testOidcConfig(request({ ...stored, clientSecret: '' }), mockResponse as Response, nextFunction);
      expect(probeOidcProvider).toHaveBeenCalledWith(stored);
      expect(mockResponse.json).toHaveBeenCalledWith({ success: true, message: 'Conexão validada: discovery e chaves de assinatura encontrados.' });

      expect(service.updateOidcSettings).not.toHaveBeenCalled();
      const { OidcError } = jest.requireActual('../services/oidcService');
      (probeOidcProvider as jest.Mock).mockRejectedValueOnce(new OidcError('Identity provider is unavailable: stored-secret', 'provider_unavailable'));
      await configController.testOidcConfig(request(stored), mockResponse as Response, nextFunction);
      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenLastCalledWith({
        success: false, error: 'oidc_test_failed', message: 'Não foi possível conectar ao issuer.',
      });
      expect(JSON.stringify((mockResponse.json as jest.Mock).mock.calls)).not.toContain('stored-secret');
    });
  });
});
