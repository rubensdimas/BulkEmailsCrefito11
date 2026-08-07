/**
 * BulkMail Pro - Backend API
 * Express server with file upload and email processing
 * Updated with database initialization
 */
import express, { Express, Request, Response } from 'express';
import path from 'path';
import { Server } from 'http';

// Import routes
import uploadRoutes from './routes/uploadRoutes';
import sendRoutes from './routes/sendRoutes';
import statusRoutes from './routes/statusRoutes';
import jobRoutes from './routes/jobRoutes';
import configRoutes from './routes/configRoutes';
import webhookRoutes from './routes/webhookRoutes';
import { httpErrorHandler, notFoundHandler } from './middlewares/errorHandler';
import {
  configureSecurity,
  configLimiter,
  sendLimiter,
  uploadLimiter,
  webhookLimiter,
} from './middlewares/security';
import { getDatabase } from './config/database';
import { getRedisClient, closeRedisConnection } from './config/redis';
import { shutdownDatabase } from './services/databaseService';

// Load environment variables
import dotenv from 'dotenv';
dotenv.config();

// Create Express app
const app: Express = express();
const PORT = process.env.PORT || 3000;
const CREFITO11_LOGO_PATH = process.env.CREFITO11_LOGO_PATH ||
  '/assets/logos/CREFITO 11 - Marca - Neg 2 Completa.png';

// Middleware
configureSecurity(app);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.get('/api/assets/crefito11-email-logo.png', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.resolve(CREFITO11_LOGO_PATH));
});

// API Routes
app.use('/api/upload', uploadLimiter, uploadRoutes);
app.use('/api/send', sendLimiter, sendRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/config', configLimiter, configRoutes);
app.use('/api/webhooks', webhookLimiter, webhookRoutes);

/**
 * Health check endpoint
 * GET /api/health
 */
app.get('/api/health/live', (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    status: 'live',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

const readinessHandler = async (_req: Request, res: Response): Promise<void> => {
  try {
    await getDatabase().raw('SELECT 1');
    await getRedisClient().ping();
    res.status(200).json({ success: true, status: 'ready', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ success: false, status: 'not_ready', timestamp: new Date().toISOString() });
  }
};

app.get('/api/health/ready', readinessHandler);
app.get('/api/health', readinessHandler);

/**
 * Root endpoint
 * GET /
 */
app.get('/', (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'BulkMail Pro API',
    docs: '/api/health',
  });
});

// Error handling
app.use(httpErrorHandler);
app.use(notFoundHandler);

/**
 * Initialize and start server
 */
const startServer = async (): Promise<Server> => {
  // Initialize database (if available)
  try {
    const { initializeDatabase } = await import('./services/databaseService');
    await initializeDatabase();
  } catch (error) {
    if (process.env.NODE_ENV === 'production') throw error;
    console.warn('⚠️  Database not available in development');
  }

  try {
    await getRedisClient().ping();
  } catch (error) {
    if (process.env.NODE_ENV === 'production') throw error;
    console.warn('⚠️  Redis not available in development');
  }

  // Start Express server
  const server = app.listen(PORT, () => {
    console.log(`
 ╔═══════════════════════════════════════════════════════════╗
 ║          BulkMail Pro - Backend API               ║
 ╠═══════════════════════════════════════════════════════════╣
 ║  Server running on port ${PORT}                         ║
 ║  Health check: http://localhost:${PORT}/api/health      ║
 ║  Upload endpoint: http://localhost:${PORT}/api/upload    ║
 ║  Send endpoint: http://localhost:${PORT}/api/send       ║
 ║  Status endpoint: http://localhost:${PORT}/api/status    ║
 ╚═══════════════════════════════════════════════════════════╝
    `);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`Received ${signal}, shutting down...`);
    server.close(async () => {
      await Promise.allSettled([shutdownDatabase(), closeRedisConnection()]);
      process.exit(0);
    });
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
  return server;
};

// Start if called directly
if (require.main === module) {
  startServer().catch((error) => {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  });
}

export default app;
