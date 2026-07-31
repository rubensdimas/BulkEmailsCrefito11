import { Request, Response, NextFunction } from 'express';
import { getConfigService, isDatabaseReady } from '../services/databaseService';
import { MailgridConfig } from '../models/SystemConfig';
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
    const config: MailgridConfig = req.body;

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
    res.status(500).json({
      success: false,
      error: 'Mailgrid test failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

export default {
  getMailgridConfig,
  updateMailgridConfig,
  testMailgridConfig
};
