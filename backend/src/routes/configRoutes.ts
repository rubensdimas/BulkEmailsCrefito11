import { Router } from 'express';
import configController from '../controllers/configController';

const router = Router();

/**
 * GET /api/config/smtp
 * Get SMTP configuration
 */
router.get('/smtp', configController.getSmtpConfig);

/**
 * POST /api/config/smtp
 * Update SMTP configuration
 */
router.post('/smtp', configController.updateSmtpConfig);

/**
 * POST /api/config/smtp/test
 * Test SMTP configuration
 */
router.post('/smtp/test', configController.testSmtpConfig);

export default router;
