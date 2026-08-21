/**
 * Status Routes
 * GET /api/status/:jobId - Get job status and counters
 */
import { Router } from 'express';
import { getJobStatus, getQueueStatus, importJobStatuses } from '../controllers/statusController';
import { uploadCsv, handleCsvUploadError } from '../middlewares/uploadMiddleware';
import { uploadLimiter } from '../middlewares/security';

const router = Router();

router.post('/:jobId/import', uploadLimiter, (req, res, next) => {
  uploadCsv(req, res, (err) => {
    if (err) {
      handleCsvUploadError(err, req, res, next);
      return;
    }
    next();
  });
}, importJobStatuses);

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
