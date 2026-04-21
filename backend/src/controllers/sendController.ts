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
  getEmailQueue,
} from "../queue/emailQueue";
import {
  getJobRepository,
  getEmailLogRepository,
  isDatabaseReady,
} from "../services/databaseService";
import { generateUniqueHash } from "../services/idempotencyService";
import { CreateJobInput, Job } from "../models/Job";
import { CreateEmailLogInput } from "../models/EmailLog";

type BullJobData = {
  id?: string | number;
  data?: EmailJobData;
};

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
}

/**
 * Validation for email addresses
 * RFC 5322 simplified regex
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Default sender address
 */
const DEFAULT_FROM = process.env.SMTP_SENDER || "noreply@bulkmail.com";
const DEFAULT_FROM_NAME = process.env.SMTP_SENDER_NAME || "BulkMail Pro";

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

    // Check for database availability
    const dbReady = isDatabaseReady();

    // Check for duplicates (idempotency) only if DB is available
    const duplicates: string[] = [];
    const toSend: string[] = [];

    if (dbReady) {
      try {
        const emailLogRepo = getEmailLogRepository();
        for (const email of valid) {
          const uniqueHash = generateUniqueHash(
            campaign,
            email,
            subject,
            senderAddress,
          );
          const existing = await emailLogRepo.findByUniqueHash(uniqueHash);

          if (existing && existing.status === "sent") {
            duplicates.push(email);
          } else {
            toSend.push(email);
          }
        }
      } catch {
        console.warn("⚠️  Database check failed, skipping idempotency");
        toSend.push(...valid);
      }
    } else {
      toSend.push(...valid);
    }

    // Create or update job in database only if DB is available
    let job: Pick<Job, "id"> = { id: campaign };

    if (dbReady) {
      try {
        const jobRepo = getJobRepository();
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

        try {
          job = await jobRepo.create(jobInput);
        } catch (err) {
          const existing = await jobRepo.findByCampaignId(campaign);
          if (existing) {
            job = existing;
          } else {
            throw err;
          }
        }
      } catch {
        console.warn("⚠️  Database unavailable, running in queue-only mode");
      }
    }

    // Create email logs only if DB is available
    if (dbReady && toSend.length > 0) {
      try {
        const emailLogRepo = getEmailLogRepository();
        const emailLogInputs: CreateEmailLogInput[] = toSend.map((to) => ({
          job_id: job.id,
          recipient_email: to,
          subject,
          from_address: senderAddress,
          from_name: senderName,
          unique_hash: generateUniqueHash(campaign, to, subject, senderAddress),
        }));

        await emailLogRepo.createBatch(emailLogInputs);
      } catch (err) {
        console.warn("Could not create email logs:", err);
      }
    }

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
    }));

    // Add jobs to queue (fire-and-forget for immediate response)
    if (jobsData.length === 1) {
      addEmailJob(jobsData[0])
        .then((queueJob) =>
          console.log(`📬 Added 1 job to queue: ${queueJob.id}`),
        )
        .catch((err) => console.error("Failed to add job to queue:", err));
    } else {
      addBulkEmailJobs(jobsData)
        .then(() => console.log(`📬 Added ${jobsData.length} jobs to queue`))
        .catch((err) => console.error("Failed to add jobs to queue:", err));
    }

    // Update job status to processing only if DB is available (fire-and-forget)
    if (dbReady) {
      getJobRepository()
        .updateStatus(job.id, "processing")
        .catch((err) => console.warn("Could not update job status:", err));
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
