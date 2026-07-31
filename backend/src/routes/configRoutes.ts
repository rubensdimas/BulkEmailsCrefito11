import { Router } from 'express';
import configController from '../controllers/configController';

const router = Router();

/**
 * GET /api/config/mailgrid
 * Get Mailgrid configuration
 */
router.get('/mailgrid', configController.getMailgridConfig);

// Keep the previous SMTP path available while already-open/stale frontend
// bundles are replaced. Both paths resolve to the current Mailgrid config.
router.get('/smtp', configController.getMailgridConfig);

/**
 * POST /api/config/mailgrid
 * Update Mailgrid configuration
 */
router.post('/mailgrid', configController.updateMailgridConfig);

// Legacy alias for clients that have not loaded the Mailgrid bundle yet.
router.post('/smtp', configController.updateMailgridConfig);

/**
 * POST /api/config/mailgrid/test
 * Test Mailgrid configuration
 */
router.post('/mailgrid/test', configController.testMailgridConfig);

// Legacy alias for the test endpoint.
router.post('/smtp/test', configController.testMailgridConfig);

export default router;
