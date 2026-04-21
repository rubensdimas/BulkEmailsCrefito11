/**
 * SMTP Configuration for Nodemailer
 * Transporter setup with credentials from environment
 */
import nodemailer, { Transporter, TransportOptions } from 'nodemailer';

// SMTP Configuration interface
export interface SMTPConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
  sender?: string;
  senderName?: string;
}

/**
 * Get SMTP configuration from environment variables
 * @returns SMTP configuration object
 */
export const getSMTPConfig = (): SMTPConfig => {
  const host = process.env.SMTP_HOST || 'smtp.mailtrap.io';
  const port = parseInt(process.env.SMTP_PORT || '2525', 10);
  const secure = port === 465; // Use secure for port 465
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';
  const sender = process.env.SMTP_SENDER || process.env.SMTP_USER || '';
  const senderName = process.env.SMTP_SENDER_NAME || 'BulkMail Pro';

  return {
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
    sender,
    senderName,
  };
};

// Create transporter cache
let transporter: Transporter | null = null;

/**
 * Get or create Nodemailer transporter
 * @returns Configured transporter instance
 */
export const getTransporter = (): Transporter => {
  if (!transporter) {
    const config = getSMTPConfig();

    // Validate configuration
    if (!config.auth.user || !config.auth.pass) {
      console.warn('⚠️ SMTP credentials not configured. Using test mode.');
    }

    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.auth.user,
        pass: config.auth.pass,
      },
      // Connection settings for reliability
      connectionTimeout: 10000,
      socketTimeout: 10000,
      // Pool settings for bulk sending
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
    } as TransportOptions);

    // Verify connection on startup (optional)
    transporter.verify((err, _success) => {
      if (err) {
        console.error('❌ SMTP verification failed:', err.message);
      } else {
        console.log('✅ SMTP transporter ready');
      }
    });
  }

  return transporter;
};

/**
 * Get sender information
 * @returns Sender email and name
 */
export const getSenderInfo = (): { email: string; name: string } => {
  const config = getSMTPConfig();
  return {
    email: config.sender || config.auth.user,
    name: config.senderName || 'BulkMail Pro',
  };
};

/**
 * Reset transporter (for testing or reconfiguration)
 */
export const resetTransporter = (): void => {
  if (transporter) {
    transporter.close();
    transporter = null;
  }
};

export default getTransporter;