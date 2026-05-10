/**
 * BulkMail Pro - Backend API
 * Express server with file upload and email processing
 * Updated with database initialization
 */
import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import path from 'path';

// Import routes
import uploadRoutes from './routes/uploadRoutes';
import sendRoutes from './routes/sendRoutes';
import statusRoutes from './routes/statusRoutes';
import jobRoutes from './routes/jobRoutes';
import { httpErrorHandler, notFoundHandler } from './middlewares/errorHandler';

// Load environment variables
import dotenv from 'dotenv';
dotenv.config();

// Create Express app
const app: Express = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Set static folder for uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// API Routes
app.use('/api/upload', uploadRoutes);
app.use('/api/send', sendRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/jobs', jobRoutes);

/**
 * Health check endpoint
 * GET /api/health
 */
app.get('/api/health', (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'BulkMail Pro API is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

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
const startServer = async () => {
  // Initialize database (if available)
  try {
    const { initializeDatabase } = await import('./services/databaseService');
    await initializeDatabase();
  } catch (error) {
    console.warn('⚠️  Database not available, running in queue-only mode');
    console.warn('   Install and start PostgreSQL to enable persistence');
  }

  // Start Express server
  app.listen(PORT, () => {
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
};

// Start if called directly
if (require.main === module) {
  startServer().catch((error) => {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  });
}

export default app;