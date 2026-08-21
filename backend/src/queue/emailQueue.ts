/**
 * Bull Queue - Simple wrapper for email jobs
 */
import Bull, { Queue } from 'bull';
import { generateUniqueHash } from '../services/idempotencyService';
import { readSecret } from '../config/secret';

// Queue name
export const EMAIL_QUEUE_NAME = 'email-queue';

// Throttling configuration (emails per minute)
export const DEFAULT_THROTTLE_RATE = parseInt(process.env.THROTTLE_RATE || '50', 10);

// Retry configuration
export const MAX_RETRY_ATTEMPTS = 3;
export const RETRY_BACKOFF = {
  type: 'exponential' as const,
  delay: 1000, // Initial delay: 1000ms
};
export const BULL_BULK_CHUNK_SIZE = 500;
const BULL_STATE_LOOKUP_CHUNK_SIZE = 100;

// Error types for retry strategy
export const RETRYABLE_ERROR_CODES = [421, 450, 452]; // Temporary failures
export const NON_RETRYABLE_ERROR_CODES = [550, 551, 553]; // Permanent failures

// Job data interface
export interface EmailJobData {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  templateId?: string;
  variables?: Record<string, unknown>;
  campaignId?: string;
  idempotencyKey?: string;
}

// Job result interface
export interface EmailJobResult {
  success: boolean;
  messageId?: string;
  error?: string;
  errorType?: 'temporary' | 'permanent' | 'unknown';
  timestamp: string;
  attempts: number;
  skipped?: boolean;
}

export type EmailQueueJobState =
  | 'created'
  | 'waiting'
  | 'paused'
  | 'delayed'
  | 'active'
  | 'completed'
  | 'failed'
  | 'uncertain';

export interface EmailQueueJobStateEntry {
  id?: string;
  data: EmailJobData;
  state: EmailQueueJobState;
}

export interface EmailQueueEnqueueSummary {
  requested: number;
  created: number;
  waiting: number;
  paused: number;
  delayed: number;
  active: number;
  completed: number;
  failed: number;
  uncertain: number;
  entries: EmailQueueJobStateEntry[];
}

export interface EmailQueueEnqueueOptions {
  verifiedMissingJobIds?: ReadonlySet<string>;
}

// Create queue instance using factory function
const createQueue = () => {
  return Bull(EMAIL_QUEUE_NAME, {
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: readSecret('REDIS_PASSWORD', 'REDIS_PASSWORD_FILE'),
    },
  });
};

// Queue instance
let emailQueue: ReturnType<typeof createQueue> | null = null;

/**
 * Get or create email queue
 */
export const getEmailQueue = (): ReturnType<typeof createQueue> => {
  if (!emailQueue) {
    emailQueue = createQueue();
    console.log('✅ Email queue initialized');
  }
  return emailQueue;
};

/**
 * Add email job to queue
 */
export const addEmailJob = async (jobData: EmailJobData): Promise<EmailQueueEnqueueSummary> => (
  enqueueEmailJobs([jobData])
);

export const getEmailJobId = (jobData: EmailJobData): string | undefined => {
  if (jobData.idempotencyKey) return jobData.idempotencyKey;
  if (!jobData.campaignId) return undefined;
  const sender = jobData.from || process.env.MAILGRID_SENDER || process.env.SMTP_SENDER || 'noreply@bulkmail.com';
  return generateUniqueHash(jobData.campaignId, jobData.to, jobData.subject, sender);
};

export const buildBullJobs = (jobsData: EmailJobData[]) => jobsData.map((data) => {
  const jobId = getEmailJobId(data);
  return {
    data,
    opts: {
      attempts: MAX_RETRY_ATTEMPTS,
      backoff: RETRY_BACKOFF,
      ...(jobId ? { jobId } : {}),
    },
  };
});

const emptySummary = (requested: number): EmailQueueEnqueueSummary => ({
  requested,
  created: 0,
  waiting: 0,
  paused: 0,
  delayed: 0,
  active: 0,
  completed: 0,
  failed: 0,
  uncertain: 0,
  entries: [],
});

const recordState = (
  summary: EmailQueueEnqueueSummary,
  entry: EmailQueueJobStateEntry,
): void => {
  summary[entry.state] += 1;
  summary.entries.push(entry);
};

const inspectExistingJob = async (
  queue: Queue<EmailJobData>,
  data: EmailJobData,
): Promise<EmailQueueJobStateEntry | null> => {
  const id = getEmailJobId(data);
  if (!id) return null;
  const existing = await queue.getJob(id);
  if (!existing) return null;
  const state = await existing.getState();
  const normalized: EmailQueueJobState = [
    'waiting',
    'paused',
    'delayed',
    'active',
    'completed',
    'failed',
  ].includes(state) ? state as EmailQueueJobState : 'uncertain';
  return { id, data, state: normalized };
};

export const enqueueEmailJobs = async (
  jobsData: EmailJobData[],
  queue: Queue<EmailJobData> = getEmailQueue(),
  options: EmailQueueEnqueueOptions = {},
): Promise<EmailQueueEnqueueSummary> => {
  const summary = emptySummary(jobsData.length);

  for (let offset = 0; offset < jobsData.length; offset += BULL_BULK_CHUNK_SIZE) {
    const chunk = jobsData.slice(offset, offset + BULL_BULK_CHUNK_SIZE);
    const existingByData = new Map<EmailJobData, EmailQueueJobStateEntry>();

    for (let lookupOffset = 0; lookupOffset < chunk.length; lookupOffset += BULL_STATE_LOOKUP_CHUNK_SIZE) {
      const lookupChunk = chunk.slice(lookupOffset, lookupOffset + BULL_STATE_LOOKUP_CHUNK_SIZE);
      const existing = await Promise.all(lookupChunk.map((data) => {
        const id = getEmailJobId(data);
        return id && options.verifiedMissingJobIds?.has(id)
          ? Promise.resolve(null)
          : inspectExistingJob(queue, data);
      }));
      for (let index = 0; index < lookupChunk.length; index += 1) {
        const entry = existing[index];
        if (entry) existingByData.set(lookupChunk[index], entry);
      }
    }

    for (const entry of existingByData.values()) recordState(summary, entry);
    const missing = chunk.filter((data) => !existingByData.has(data));
    if (missing.length === 0) continue;

    const added = await queue.addBulk(buildBullJobs(missing));
    for (let index = 0; index < missing.length; index += 1) {
      recordState(summary, {
        id: added[index]?.id === undefined ? getEmailJobId(missing[index]) : String(added[index].id),
        data: missing[index],
        state: 'created',
      });
    }
  }

  return summary;
};

/**
 * Add multiple email jobs
 */
export const addBulkEmailJobs = async (
  jobsData: EmailJobData[],
  options: EmailQueueEnqueueOptions = {},
): Promise<EmailQueueEnqueueSummary> => enqueueEmailJobs(jobsData, getEmailQueue(), options);

export const retryFailedEmailJobs = async (
  jobIds: string[],
  queue: Queue<EmailJobData> = getEmailQueue(),
): Promise<number> => {
  const jobs = [];
  for (const jobId of jobIds) {
    const job = await queue.getJob(jobId);
    if (!job) throw new Error(`Bull job not found: ${jobId}`);
    const state = await job.getState();
    if (state !== 'failed') throw new Error(`Bull job ${jobId} is ${state}, not failed`);
    jobs.push(job);
  }

  let retried = 0;
  for (const job of jobs) {
    await job.retry();
    retried += 1;
  }
  return retried;
};

/**
 * Close queue
 */
export const closeEmailQueue = async () => {
  if (emailQueue) {
    await emailQueue.close();
    emailQueue = null;
  }
};

/**
 * Get queue stats
 */
export const getQueueStats = async () => {
  const queue = getEmailQueue();
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);
  return { waiting, active, completed, failed, delayed };
};

export default getEmailQueue;
