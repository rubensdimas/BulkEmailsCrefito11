import { Request, Response, NextFunction } from 'express';
import nodemailer from 'nodemailer';
import { getConfigService, isDatabaseReady } from '../services/databaseService';
import { SmtpConfig } from '../models/SystemConfig';
import { resetTransporter } from '../config/smtp';

/**
 * GET /api/config/smtp
 * Get current SMTP configuration
 */
export const getSmtpConfig = async (
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
    const smtpConfig = await configService.getSmtpConfig();

    // Map to SmtpConfig interface for the frontend
    const response: SmtpConfig = {
      host: smtpConfig.host,
      port: smtpConfig.port,
      user: smtpConfig.auth.user,
      pass: '', // Don't return password for security
      secure: smtpConfig.secure,
      from_address: smtpConfig.sender || '',
      from_name: smtpConfig.senderName || ''
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
 * POST /api/config/smtp
 * Update SMTP configuration
 */
export const updateSmtpConfig = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const config: SmtpConfig = req.body;

    // Basic validation
    if (!config.host || !config.port || !config.user || !config.from_address) {
      res.status(400).json({
        success: false,
        error: 'Missing required SMTP fields'
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
    
    // If password is empty, keep the existing one if we're updating
    if (!config.pass) {
      const existing = await configService.getSmtpConfig();
      config.pass = existing.auth.pass;
    }

    await configService.updateSmtpConfig(config);
    
    // Reset transporter cache so it reloads with new config
    resetTransporter();

    res.status(200).json({
      success: true,
      message: 'SMTP configuration updated successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/config/smtp/test
 * Test SMTP configuration by sending a test email
 */
export const testSmtpConfig = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { config, to } = req.body as { config: SmtpConfig; to: string };

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
      const existing = await configService.getSmtpConfig();
      config.pass = existing.auth.pass;
    }

    // Create a temporary transporter for testing
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass,
      },
      connectionTimeout: 10000,
    });

    // Verify transporter
    await transporter.verify();

    // Send test email
    await transporter.sendMail({
      from: `"${config.from_name || 'BulkMail Test'}" <${config.from_address}>`,
      to,
      subject: 'BulkMail Pro - SMTP Test Connection',
      text: 'Congratulations! Your SMTP configuration is working correctly.',
      html: '<h1>BulkMail Pro</h1><p>Congratulations! Your SMTP configuration is working correctly.</p>'
    });

    res.status(200).json({
      success: true,
      message: 'Test email sent successfully'
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: 'SMTP test failed',
      details: error.message
    });
  }
};

export default {
  getSmtpConfig,
  updateSmtpConfig,
  testSmtpConfig
};
