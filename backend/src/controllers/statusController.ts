import { Request, Response, NextFunction } from 'express';
import Bull from 'bull';
import { getEmailQueue, getQueueStats, EmailJobData } from '../queue/emailQueue';
import { getJobRepository, getEmailLogRepository, isDatabaseReady } from '../services/databaseService';
import { computeJobStatus, shouldSyncStatus } from '../services/jobStatusService';

interface BullJobLike {
  id: string | number;
  data: EmailJobData;
}

const getJobData = (job: Bull.Job | BullJobLike): EmailJobData => {
  return job.data as EmailJobData;
};

// Response interface
export interface JobStatusResponse {
  success: boolean;
  jobId: string;
  campaignId?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'not-found';
  total: number;
  completed: number;
  failed: number;
  processing: number;
  waiting: number;
  progress?: number;
  timestamp: string;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

/**
 * GET /api/status/:jobId
 * Get status for a job campaign (from database)
 */
export const getJobStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      res.status(400).json({
        success: false,
        error: 'Job ID is required',
      } as JobStatusResponse);
      return;
    }

    // Check database availability
    const dbReady = isDatabaseReady();

    if (dbReady) {
      try {
        const jobRepo = getJobRepository();
        const emailLogRepo = getEmailLogRepository();

        let job = await jobRepo.findById(jobId);
        
        if (!job) {
          job = await jobRepo.findByCampaignId(jobId);
        }

        if (job) {
          const stats = await emailLogRepo.getStatsByJobId(job.id);
          const computed = computeJobStatus(job, stats);

          // Auto-sync DB column if stale
          const newStatus = shouldSyncStatus(job, computed);
          if (newStatus) {
            await jobRepo.updateStatus(job.id, newStatus);
          }

          res.status(200).json({
            success: true,
            jobId: job.id,
            campaignId: job.campaign_id,
            status: computed.status,
            total: job.valid_recipients,
            completed: computed.completedCount,
            failed: computed.failedCount,
            processing: computed.processingCount,
            waiting: computed.waitingCount,
            progress: computed.progress,
            timestamp: new Date().toISOString(),
            createdAt: job.created_at ? new Date(job.created_at).toISOString() : undefined,
            updatedAt: job.updated_at ? new Date(job.updated_at).toISOString() : undefined,
            startedAt: job.started_at ? new Date(job.started_at).toISOString() : undefined,
            completedAt: job.completed_at ? new Date(job.completed_at).toISOString() : undefined,
          } as JobStatusResponse);
          return;
        }
      } catch (err) {
        console.warn('⚠️  Database query failed, using queue status:', err);
      }
    }

    // Fallback to queue-only status (for jobs not in DB)
    const queue = getEmailQueue();

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaiting(),
      queue.getActive(),
      queue.getCompleted(),
      queue.getFailed(),
      queue.getDelayed(),
    ]);

    // Combine all jobs
    const allJobs = [...waiting, ...active, ...completed, ...failed, ...delayed];

    // Find jobs with matching campaignId
    const campaignJobs = allJobs.filter((job) => getJobData(job).campaignId === jobId);

    if (campaignJobs.length === 0) {
      // Try to find by individual job ID
      let foundJob = null;
      for (const job of allJobs) {
        if (String(job.id) === jobId || String(job.id) === jobId) {
          foundJob = job;
          break;
        }
      }

      if (!foundJob) {
        res.status(404).json({
          success: false,
          jobId,
          status: 'not-found',
          total: 0,
          completed: 0,
          failed: 0,
          processing: 0,
          waiting: 0,
          timestamp: new Date().toISOString(),
          error: 'Job not found',
        } as JobStatusResponse);
        return;
      }

      // Single job - determine state by position
      const inCompleted = completed.some((j) => String(j.id) === String(foundJob.id));
      const inFailed = failed.some((j) => String(j.id) === String(foundJob.id));
      const inActive = active.some((j) => String(j.id) === String(foundJob.id));
      const inWaiting = waiting.some((j) => String(j.id) === String(foundJob.id));
      const inDelayed = delayed.some((j) => String(j.id) === String(foundJob.id));

      let state: string = 'unknown';
      if (inCompleted) state = 'completed';
      else if (inFailed) state = 'failed';
      else if (inActive) state = 'processing';
      else if (inWaiting) state = 'pending';
      else if (inDelayed) state = 'pending';

      res.status(200).json({
        success: true,
        jobId,
        status: state as JobStatusResponse['status'],
        total: 1,
        completed: inCompleted ? 1 : 0,
        failed: inFailed ? 1 : 0,
        processing: inActive ? 1 : 0,
        waiting: inWaiting || inDelayed ? 1 : 0,
        progress: inCompleted ? 100 : 0,
        timestamp: new Date().toISOString(),
      } as JobStatusResponse);
      return;
    }

    // Calculate counts for campaign
    let completedCount = 0;
    let failedCount = 0;
    const bouncedCount = 0;
    let processing = 0;
    let waitingCount = 0;

    for (const job of campaignJobs) {
      const jobIdStr = String(job.id);
      if (completed.some((j) => String(j.id) === jobIdStr)) completedCount++;
      else if (failed.some((j) => String(j.id) === jobIdStr)) failedCount++;
      else if (active.some((j) => String(j.id) === jobIdStr)) processing++;
      else if (waiting.some((j) => String(j.id) === jobIdStr) || delayed.some((j) => String(j.id) === jobIdStr)) waitingCount++;
    }

    const total = campaignJobs.length;
    const progress = total > 0 ? Math.round(((completedCount + failedCount + bouncedCount) / total) * 100) : 0;

    // Determine overall status
    let status: JobStatusResponse['status'];
    if (waitingCount > 0 || processing > 0) {
      status = processing > 0 ? 'processing' : 'pending';
    } else if (total > 0 && (completedCount + failedCount + bouncedCount) >= total) {
      status = 'completed';
    } else if (failedCount > 0 && completedCount === 0 && bouncedCount === 0) {
      status = 'failed';
    } else {
      status = 'processing'; // Default if some are still in other states
    }

    res.status(200).json({
      success: true,
      jobId,
      status,
      total,
      completed: completedCount,
      failed: failedCount,
      processing,
      waiting: waitingCount,
      progress: Math.min(progress, 100),
      timestamp: new Date().toISOString(),
    } as JobStatusResponse);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/status
 * Get overall queue status
 */
export const getQueueStatus = async (
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Try database first
    const jobRepo = getJobRepository();
    const emailLogRepo = getEmailLogRepository();

    const [jobStats, emailStats] = await Promise.all([
      jobRepo.getStats(),
      emailLogRepo.getStats(),
    ]);

    res.status(200).json({
      success: true,
      jobs: jobStats,
      emails: emailStats,
      queue: 'email-queue',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    // Fallback to queue stats only
    try {
      const stats = await getQueueStats();
      res.status(200).json({
        success: true,
        queue: 'email-queue',
        stats,
        timestamp: new Date().toISOString(),
      });
    } catch (queueError) {
      next(queueError);
    }
  }
};

export default {
  getJobStatus,
  getQueueStatus,
};