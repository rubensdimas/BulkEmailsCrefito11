import { Request, Response } from 'express';
import { getJobRepository } from '../services/databaseService';
import { JobFilter, JobStatus } from '../models/Job';

/**
 * Controller for managing Jobs
 */
export class JobController {
  /**
   * Get paginated list of jobs
   */
  static async getJobs(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const offset = parseInt(req.query.offset as string) || 0;
      const status = req.query.status as string;

      const filter: JobFilter = { limit, offset };
      if (status) {
        filter.status = status as JobStatus;
      }

      const jobRepo = getJobRepository();
      
      const [data, total] = await Promise.all([
        jobRepo.findAll(filter),
        jobRepo.count(filter),
      ]);

      res.status(200).json({
        success: true,
        data,
        pagination: {
          total,
          limit,
          offset,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      console.error('[JobController] Error getting jobs:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve jobs',
      });
    }
  }

  /**
   * Delete a job
   */
  static async deleteJob(req: Request, res: Response): Promise<void> {
    try {
      const { jobId } = req.params;
      
      if (!jobId) {
        res.status(400).json({ success: false, message: 'Job ID is required' });
        return;
      }

      const jobRepo = getJobRepository();
      const job = await jobRepo.findById(jobId);

      if (!job) {
        res.status(404).json({ success: false, message: 'Job not found' });
        return;
      }

      if (job.status === 'processing' || job.status === 'pending') {
        res.status(400).json({ 
          success: false, 
          message: 'Cannot delete a job that is pending or processing' 
        });
        return;
      }

      await jobRepo.hardDelete(jobId);

      res.status(200).json({
        success: true,
        message: 'Job deleted successfully',
      });
    } catch (error) {
      console.error('[JobController] Error deleting job:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete job',
      });
    }
  }
}
