import { Request, Response, NextFunction } from 'express';
import { getConfigService, isDatabaseReady } from '../services/databaseService';
import type { AuthenticatedRequest } from '../middlewares/authentication';
import { accountLabel } from '../services/userAdminService';
import { logSettingsChange } from '../services/settingsAudit';
import { OidcError, probeOidcProvider, validateStoredOidcSettings } from '../services/oidcService';
import { MailgridConfig, OidcSettings } from '../models/SystemConfig';
import { sendViaMailgrid } from '../services/mailgridService';

/**
 * GET /api/config/mailgrid
 * Get current Mailgrid configuration
 */
export const getMailgridConfig = async (
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!isDatabaseReady()) {
      res.status(503).json({
        success: false,
        error: 'Database not available'
      });
      return;
    }

    const configService = getConfigService();
    const config = await configService.getMailgridConfig();

    // Never expose the stored password to the frontend.
    const response: MailgridConfig = {
      host: config.host,
      user: config.user,
      pass: '', // Don't return password for security
      from_address: config.from_address,
      from_name: config.from_name || '',
      webhook_token: '',
      webhook_token_configured: Boolean(config.webhook_token),
    };

    res.status(200).json({
      success: true,
      data: response
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/config/mailgrid
 * Update Mailgrid configuration
 */
export const updateMailgridConfig = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const suppliedSecrets = ['pass', 'webhook_token'].filter(field => Boolean(req.body?.[field]));
    const config: MailgridConfig = { ...req.body };

    // Basic validation
    if (!config.host || !config.user || !config.from_address) {
      res.status(400).json({
        success: false,
        error: 'Missing required Mailgrid fields'
      });
      return;
    }

    if (!isDatabaseReady()) {
      res.status(503).json({
        success: false,
        error: 'Database not available'
      });
      return;
    }

    const configService = getConfigService();
    
    // Empty secrets mean "keep the current value".
    if (!config.pass || !config.webhook_token) {
      const existing = await configService.getMailgridConfig();
      if (!config.pass) config.pass = existing.pass;
      if (!config.webhook_token) config.webhook_token = existing.webhook_token;
    }

    await configService.updateMailgridConfig(config);
    logSettingsChange({ actor: actorOf(req), action: 'settings.update_mailgrid', fields: ['host', 'user', 'from_address', 'from_name', ...suppliedSecrets] });

    res.status(200).json({
      success: true,
      message: 'Mailgrid configuration updated successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/config/mailgrid/test
 * Test Mailgrid configuration by sending a test email
 */
export const testMailgridConfig = async (
  req: Request,
  res: Response,
  _next: NextFunction
): Promise<void> => {
  try {
    const { config, to } = req.body as { config: MailgridConfig; to: string };

    if (!config || !to) {
      res.status(400).json({
        success: false,
        error: 'Config and recipient email (to) are required'
      });
      return;
    }

    // Use current password from DB if not provided in the test request
    if (!config.pass && isDatabaseReady()) {
      const configService = getConfigService();
      const existing = await configService.getMailgridConfig();
      config.pass = existing.pass;
    }

    await sendViaMailgrid(config, {
      from: config.from_address,
      fromName: config.from_name || 'BulkMail Test',
      to,
      subject: 'BulkMail Pro - Mailgrid Test Connection',
      text: 'Congratulations! Your Mailgrid configuration is working correctly.',
      html: '<h1>BulkMail Pro</h1><p>Congratulations! Your Mailgrid configuration is working correctly.</p>'
    });

    res.status(200).json({
      success: true,
      message: 'Mailgrid test email sent successfully'
    });
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') console.error('Mailgrid test failed:', error);
    res.status(500).json({
      success: false,
      error: 'Mailgrid test failed'
    });
  }
};

const actorOf = (request: Request): string => {
  const account = (request as AuthenticatedRequest).auth?.account;
  return account ? accountLabel(account) : 'unknown';
};
const databaseAvailable = (response: Response): boolean => {
  if (isDatabaseReady()) return true;
  response.status(503).json({ success: false, error: 'Database not available' });
  return false;
};
const oidcInput = async (body: unknown): Promise<OidcSettings> => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new OidcError('Informe uma configuração válida.', 'configuration_error');
  const input = body as Record<string, unknown>;
  if (typeof input.enabled !== 'boolean' || ['issuer', 'clientId', 'backchannelOrigin'].some(key => typeof input[key] !== 'string') ||
    (input.clientSecret !== undefined && typeof input.clientSecret !== 'string')) {
    throw new OidcError('Informe uma configuração válida.', 'configuration_error');
  }
  const current = await getConfigService().getOidcSettings();
  return {
    enabled: input.enabled,
    issuer: input.issuer as string,
    clientId: input.clientId as string,
    clientSecret: (input.clientSecret as string | undefined) || current?.clientSecret || '',
    backchannelOrigin: input.backchannelOrigin as string,
  };
};
const configurationFailure = (error: unknown, response: Response, next: NextFunction): void => {
  if (error instanceof OidcError && error.code === 'configuration_error') {
    response.status(400).json({ success: false, error: 'invalid_oidc_settings', message: error.message });
    return;
  }
  next(error);
};
export const getOidcConfig = async (_request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    if (!databaseAvailable(response)) return;
    const settings = await getConfigService().getOidcSettings() ?? { enabled: false, issuer: '', clientId: '', clientSecret: '', backchannelOrigin: '' };
    response.json({ success: true, data: {
      enabled: settings.enabled, issuer: settings.issuer, clientId: settings.clientId,
      clientSecret: '', clientSecretConfigured: Boolean(settings.clientSecret),
      backchannelAllowed: process.env.NODE_ENV !== 'production', backchannelOrigin: settings.backchannelOrigin,
      callbackUrl: `${(process.env.APP_ORIGIN || '').replace(/\/$/, '')}/api/auth/oidc/callback`,
    } });
  } catch (error) { next(error); }
};
export const updateOidcConfig = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  try {
    if (!databaseAvailable(response)) return;
    const settings = await oidcInput(request.body);
    // Validate populated fields even when OIDC login is disabled.
    validateStoredOidcSettings(settings);
    await getConfigService().updateOidcSettings(settings);
    logSettingsChange({ actor: actorOf(request), action: 'settings.update_oidc', fields: [
      'enabled', 'issuer', 'clientId', 'backchannelOrigin', ...(request.body?.clientSecret ? ['clientSecret'] : []),
    ] });
    response.json({ success: true, message: 'Configuração da intranet atualizada.' });
  } catch (error) { configurationFailure(error, response, next); }
};
export const testOidcConfig = async (request: Request, response: Response, next: NextFunction): Promise<void> => {
  let settings: OidcSettings;
  try {
    if (!databaseAvailable(response)) return;
    settings = await oidcInput(request.body);
    validateStoredOidcSettings(settings);
  } catch (error) { configurationFailure(error, response, next); return; }
  try {
    await probeOidcProvider(settings);
    response.json({ success: true, message: 'Conexão validada: discovery e chaves de assinatura encontrados.' });
  } catch {
    // Provider errors can include remote bodies or credentials; expose a fixed message.
    response.status(400).json({ success: false, error: 'oidc_test_failed', message: 'Não foi possível conectar ao issuer.' });
  }
};

export default {
  getMailgridConfig,
  updateMailgridConfig,
  testMailgridConfig,
  getOidcConfig,
  updateOidcConfig,
  testOidcConfig
};
