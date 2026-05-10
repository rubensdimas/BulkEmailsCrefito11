/**
 * Bull Queue - Simple wrapper for email jobs
 */
import Bull, { Job } from 'bull';

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

// Create queue instance using factory function
const createQueue = () => {
  return Bull(EMAIL_QUEUE_NAME, {
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
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
export const addEmailJob = async (jobData: EmailJobData): Promise<Job> => {
  const queue = getEmailQueue();
  return queue.add(jobData, {
    attempts: MAX_RETRY_ATTEMPTS,
    backoff: RETRY_BACKOFF,
  });
};

/**
 * Add multiple email jobs
 */
export const addBulkEmailJobs = async (jobsData: EmailJobData[]) => {
  const queue = getEmailQueue();
  // Add jobs one by one since Bull 4.x addBulk has different signature
  for (const data of jobsData) {
    await queue.add(data, {
      attempts: MAX_RETRY_ATTEMPTS,
      backoff: RETRY_BACKOFF,
    });
  }
  return jobsData.map(d => ({ id: d.campaignId, data: d }));
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