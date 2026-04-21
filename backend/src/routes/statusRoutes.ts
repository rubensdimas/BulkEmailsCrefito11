/**
 * Status Routes
 * GET /api/status/:jobId - Get job status and counters
 */
import { Router } from 'express';
import { getJobStatus, getQueueStatus } from '../controllers/statusController';

const router = Router();

/**
 * GET /api/status/:jobId
 * Get status for a specific job/campaign
 * 
 * Parameters:
 *   - jobId: string (required) - Job or campaign ID
 * 
 * Response:
 *   - jobId: string
 *   - status: pending | processing | completed | failed | not-found
 *   - total: number - Total jobs
 *   - completed: number - Completed jobs
 *   - failed: number - Failed jobs
 *   - processing: number - Currently processing
 *   - waiting: number - Jobs waiting
 *   - progress: number - Progress percentage
 */
router.get('/:jobId', getJobStatus);

/**
 * GET /api/status
 * Get overall queue status
 * 
 * Response:
 *   - queue: string - Queue name
 *   - stats: object - Queue statistics
 */
router.get('/', getQueueStatus);

export default router;