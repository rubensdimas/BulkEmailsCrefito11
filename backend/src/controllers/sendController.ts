/**
 * Send Controller
 * POST /api/send - Create email jobs in queue
 * Updated to use repositories for persistence
 */
import { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";
import {
  addEmailJob,
  addBulkEmailJobs,
  EmailJobData,
  EmailQueueEnqueueSummary,
} from "../queue/emailQueue";
import {
  getEmailLogRepository,
  isDatabaseReady,
} from "../services/databaseService";
import { getDatabase } from "../config/database";
import { JobRepository } from "../repositories/jobRepository";
import { EmailLogRepository } from "../repositories/emailLogRepository";
import { generateUniqueHash, wasEmailSent } from "../services/idempotencyService";
import { CreateJobInput, Job } from "../models/Job";
import { CreateEmailLogInput } from "../models/EmailLog";
import { HttpException } from "../middlewares/errorHandler";

// Request interface for sending emails
export interface SendEmailRequest {
  emails: string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  templateId?: string;
  variables?: Record<string, unknown>;
  campaignId?: string;
  priority?: number;
}

// Response interface
export interface SendJobResponse {
  success: boolean;
  jobId: string;
  campaignId: string;
  totalEmails: number;
  validEmails: number;
  duplicateEmails: number;
  invalidEmails: number;
  message: string;
  timestamp: string;
  queue?: Omit<EmailQueueEnqueueSummary, 'entries'>;
}

/**
 * Validation for email addresses
 * RFC 5322 simplified regex
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Default sender address
 */
const DEFAULT_FROM = process.env.MAILGRID_SENDER || process.env.SMTP_SENDER || "noreply@bulkmail.com";
const DEFAULT_FROM_NAME = process.env.MAILGRID_SENDER_NAME || process.env.SMTP_SENDER_NAME || "BulkMail Pro";

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value ?? null);
};

const campaignPayloadMatches = (job: Job, input: CreateJobInput): boolean => (
  job.campaign_id === input.campaign_id
  && job.subject === input.subject
  && job.html === (input.html ?? null)
  && job.text === (input.text ?? null)
  && job.from_address.toLowerCase() === input.from_address.toLowerCase()
  && job.from_name === (input.from_name ?? null)
  && job.reply_to === (input.reply_to ?? null)
  && job.template_id === (input.template_id ?? null)
  && canonicalJson(job.variables) === canonicalJson(input.variables)
);

const queueCounts = (
  summary: EmailQueueEnqueueSummary,
): Omit<EmailQueueEnqueueSummary, 'entries'> => ({
  requested: summary.requested,
  created: summary.created,
  waiting: summary.waiting,
  paused: summary.paused,
  delayed: summary.delayed,
  active: summary.active,
  completed: summary.completed,
  failed: summary.failed,
  uncertain: summary.uncertain,
});

/**
 * Validate and clean email list
 */
const validateEmails = (
  emails: string[],
): { valid: string[]; invalid: string[] } => {
  const valid: string[] = [];
  const invalid: string[] = [];

  const uniqueEmails = [...new Set(emails.map((e) => e.toLowerCase().trim()))];

  for (const email of uniqueEmails) {
    if (email && EMAIL_REGEX.test(email)) {
      valid.push(email);
    } else {
      invalid.push(email);
    }
  }

  return { valid, invalid };
};

/**
 * POST /api/send
 * Create email jobs in queue with persistence
 */
export const sendEmails = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const {
      emails,
      subject,
      html,
      text,
      from,
      replyTo,
      templateId,
      variables,
      campaignId,
    } = req.body as SendEmailRequest;

    // Validate required fields
    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      res.status(400).json({
        success: false,
        message: 'Field "emails" is required and must be a non-empty array',
      } as SendJobResponse);
      return;
    }

    if (!subject) {
      res.status(400).json({
        success: false,
        message: 'Field "subject" is required',
      } as SendJobResponse);
      return;
    }

    if (subject.length > 150) {
      res.status(400).json({
        success: false,
        message: 'Field "subject" exceeds maximum length of 150 characters',
      } as SendJobResponse);
      return;
    }

    if (!html && !text) {
      res.status(400).json({
        success: false,
        message: 'At least one of "html" or "text" fields is required',
      } as SendJobResponse);
      return;
    }

    // Validate emails
    const { valid, invalid } = validateEmails(emails);

    if (valid.length === 0) {
      res.status(400).json({
        success: false,
        message: "No valid email addresses found. " + invalid.slice(0, 10),
        validEmails: 0,
        invalidEmails: invalid.length,
      } as SendJobResponse);
      return;
    }

    // Generate campaign ID
    const campaign = campaignId || uuidv4();
    const senderAddress = from || DEFAULT_FROM;
    const senderName = DEFAULT_FROM_NAME;

    if (!isDatabaseReady()) {
      res.status(503).json({
        success: false,
        campaignId: campaign,
        retryable: true,
        error: "Database is not ready; no email jobs were queued",
      });
      return;
    }

    // Resolve idempotency states in bounded queries instead of one query per recipient.
    const duplicates: string[] = [];
    const manualRetry: string[] = [];
    const toSend: string[] = [];
    const hashes = new Map(valid.map((email) => [
      email,
      generateUniqueHash(campaign, email, subject, senderAddress),
    ]));
    const existingStates = await getEmailLogRepository()
      .findStatesByUniqueHashes([...hashes.values()]);

    for (const email of valid) {
      const state = existingStates.get(hashes.get(email)!);
      if (wasEmailSent(state)) duplicates.push(email);
      else if (state === 'failed' || state === 'bounced') manualRetry.push(email);
      else toSend.push(email);
    }

    if (manualRetry.length > 0) {
      const existingJob = await new JobRepository(getDatabase()).findByCampaignId(campaign);
      res.status(409).json({
        success: false,
        code: 'CAMPAIGN_MANUAL_RETRY_REQUIRED',
        campaignId: campaign,
        jobId: existingJob?.id,
        retryable: false,
        recipients: manualRetry,
        error: 'Failed recipients require explicit confirmation before retry',
      });
      return;
    }

    // Persist the campaign and every recipient before touching Redis.
    const jobInput: CreateJobInput = {
      campaign_id: campaign,
      subject,
      html: html || null,
      text: text || null,
      from_address: senderAddress,
      from_name: senderName,
      reply_to: replyTo || null,
      template_id: templateId || null,
      variables: variables || null,
      priority: "normal",
      throttle_rate: parseInt(process.env.THROTTLE_RATE || "50", 10),
      total_recipients: emails.length,
      valid_recipients: toSend.length,
      invalid_recipients: invalid.length,
    };

    const database = getDatabase();
    const persistence = await database.transaction(async (transaction) => {
      const jobRepo = new JobRepository(transaction);
      const emailLogRepo = new EmailLogRepository(transaction);
      const persistedJob = await jobRepo.create(jobInput);
      if (!campaignPayloadMatches(persistedJob, jobInput)) {
        throw new HttpException('Campaign ID already exists with a different payload', 409);
      }
      const emailLogInputs: CreateEmailLogInput[] = toSend.map((to) => ({
        job_id: persistedJob.id,
        recipient_email: to,
        subject,
        from_address: senderAddress,
        from_name: senderName,
        unique_hash: hashes.get(to)!,
      }));
      const batch = await emailLogRepo.createBatch(emailLogInputs, transaction);
      return { job: persistedJob, batch };
    });
    const job: Pick<Job, "id"> = persistence.job;
    console.info("Email logs persisted", {
      campaignId: campaign,
      requested: persistence.batch.requested,
      inserted: persistence.batch.inserted,
      existing: persistence.batch.existing,
    });

    // Create job data for queue
    const jobsData: EmailJobData[] = toSend.map((to) => ({
      to,
      subject,
      html: html || "",
      text,
      from: senderAddress,
      replyTo,
      templateId,
      variables,
      campaignId: campaign,
      idempotencyKey: hashes.get(to),
    }));

    try {
      let queueSummary: EmailQueueEnqueueSummary | null = null;
      if (jobsData.length === 1) queueSummary = await addEmailJob(jobsData[0]);
      else if (jobsData.length > 1) queueSummary = await addBulkEmailJobs(jobsData);

      if (queueSummary && (queueSummary.failed > 0 || queueSummary.completed > 0 || queueSummary.uncertain > 0)) {
        const code = queueSummary.failed > 0
          ? 'CAMPAIGN_MANUAL_RETRY_REQUIRED'
          : 'CAMPAIGN_RECONCILIATION_REQUIRED';
        res.status(409).json({
          success: false,
          code,
          campaignId: campaign,
          jobId: job.id,
          retryable: false,
          queue: queueCounts(queueSummary),
          error: 'Existing terminal or uncertain Bull jobs require reconciliation',
        });
        return;
      }

      if (jobsData.length > 0) {
        await new JobRepository(database).updateStatus(job.id, "processing");
      }
    } catch (error) {
      console.error("Campaign persisted but queueing is incomplete", {
        campaignId: campaign,
        recipientCount: jobsData.length,
        error: error instanceof Error ? error.message : "unknown_error",
      });
      res.status(503).json({
        success: false,
        campaignId: campaign,
        jobId: job.id,
        retryable: true,
        error: "Campaign was persisted but queueing is incomplete",
      });
      return;
    }

    // Return response
    const response: SendJobResponse = {
      success: true,
      jobId: job.id,
      campaignId: campaign,
      totalEmails: emails.length,
      validEmails: toSend.length,
      duplicateEmails: duplicates.length,
      invalidEmails: invalid.length,
      message:
        duplicates.length > 0
          ? `Created ${toSend.length} email jobs (${duplicates.length} duplicates skipped)`
          : `Created ${toSend.length} email jobs in queue`,
      timestamp: new Date().toISOString(),
    };

    res.status(202).json(response);
  } catch (error) {
    next(error);
  }
};

export default {
  sendEmails,
};
