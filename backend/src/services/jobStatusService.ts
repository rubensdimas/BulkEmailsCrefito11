/**
 * JobStatusService
 * Centralized logic for computing the real-time status of a Job
 * based on email_logs terminal states (sent, failed, bounced).
 *
 * This resolves the divergence between GET /api/jobs (static DB column)
 * and GET /api/status/:id (dynamic calculation).
 */
import { Job, JobStatus } from '../models/Job';
import { EmailStats } from '../models/EmailLog';

/**
 * Result of a computed job status
 */
export interface ComputedJobStatus {
  status: JobStatus;
  completedCount: number;
  failedCount: number;
  bouncedCount: number;
  processingCount: number;
  waitingCount: number;
  terminalCount: number;
  progress: number;
}

/**
 * Compute the real-time status of a job using email log statistics.
 *
 * Rules:
 * 1. If all emails reached a terminal state (sent + failed + bounced >= valid_recipients)
 *    → status = 'completed'
 * 2. If the DB status is explicitly 'failed' (e.g. SMTP hard error) → keep 'failed'
 * 3. If there are emails actively being processed → 'processing'
 * 4. Otherwise → 'pending'
 *
 * @param job - The Job entity from the database
 * @param stats - Email log statistics for the job
 */
export function computeJobStatus(job: Job, stats: EmailStats): ComputedJobStatus {
  const total = job.valid_recipients;

  const completedCount = stats.sent;
  const failedCount = stats.failed;
  const bouncedCount = stats.bounced;
  const terminalCount = completedCount + failedCount + bouncedCount;
  const processingCount = stats.processing;
  const waitingCount = stats.pending;

  const progress = total > 0 ? Math.min(Math.round((terminalCount / total) * 100), 100) : 0;

  let status: JobStatus;

  if (job.status === 'completed' || (terminalCount >= total && total > 0)) {
    status = 'completed';
  } else if (job.status === 'failed') {
    status = 'failed';
  } else if (job.status === 'cancelled') {
    status = 'cancelled';
  } else if (processingCount > 0 || job.status === 'processing') {
    status = 'processing';
  } else {
    status = 'pending';
  }

  return {
    status,
    completedCount,
    failedCount,
    bouncedCount,
    processingCount,
    waitingCount,
    terminalCount,
    progress,
  };
}

/**
 * Check if a job's DB status needs to be synced (i.e. the column is stale).
 * Returns the new status if an update is needed, or null if it's already correct.
 */
export function shouldSyncStatus(job: Job, computed: ComputedJobStatus): ('pending' | 'processing' | 'completed' | 'failed') | null {
  if (job.status !== computed.status && computed.status === 'completed') {
    return 'completed';
  }
  return null;
}
