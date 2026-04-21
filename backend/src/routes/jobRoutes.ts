import { Router } from 'express';
import { JobController } from '../controllers/jobController';

const router = Router();

/**
 * @route   GET /api/jobs
 * @desc    Get paginated list of jobs
 * @access  Public
 */
router.get('/', JobController.getJobs);

/**
 * @route   DELETE /api/jobs/:jobId
 * @desc    Delete a job
 * @access  Public
 */
router.delete('/:jobId', JobController.deleteJob);

export default router;
