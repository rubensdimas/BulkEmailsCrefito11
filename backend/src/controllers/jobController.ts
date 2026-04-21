import { Request, Response } from 'express';
import { getJobRepository, getEmailLogRepository } from '../services/databaseService';
import { JobFilter, JobStatus } from '../models/Job';
import { computeJobStatus, shouldSyncStatus } from '../services/jobStatusService';

/**
 * Controller for managing Jobs
 */
export class JobController {
  /**
   * Get paginated list of jobs with dynamically computed status
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
      const emailLogRepo = getEmailLogRepository();
      
      const [jobs, total] = await Promise.all([
        jobRepo.findAll(filter),
        jobRepo.count(filter),
      ]);

      // Compute real-time status for each job and auto-sync stale DB values
      const enrichedJobs = await Promise.all(
        jobs.map(async (job) => {
          const stats = await emailLogRepo.getStatsByJobId(job.id);
          const computed = computeJobStatus(job, stats);

          // Auto-sync stale DB status
          const newStatus = shouldSyncStatus(job, computed);
          if (newStatus) {
            await jobRepo.updateStatus(job.id, newStatus);
          }

          return {
            ...job,
            status: computed.status,
            completed_count: computed.completedCount,
            failed_count: computed.failedCount,
          };
        })
      );

      res.status(200).json({
        success: true,
        data: enrichedJobs,
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
