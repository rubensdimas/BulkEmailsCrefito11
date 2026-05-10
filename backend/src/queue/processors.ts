/**
 * Email Job Processors
 * Handles email sending, throttling, retry logic
 * Updated with persistence and idempotency
 */
import { createHash } from "crypto";
import {
  EmailJobData,
  EmailJobResult,
  RETRYABLE_ERROR_CODES,
  NON_RETRYABLE_ERROR_CODES,
} from "./emailQueue";
import { getTransporter, getSenderInfo } from "../config/smtp";
import {
  getJobRepository,
  getEmailLogRepository,
} from "../services/databaseService";
import { generateUniqueHash } from "../services/idempotencyService";

interface BullJobData {
  id?: string | number;
  data: EmailJobData;
  attemptsMade?: number;
}

/**
 * Error classification for retry strategy
 */
export type ErrorType = "temporary" | "permanent" | "unknown";

/**
 * Parse SMTP error code from error message
 */
export const parseSmtpErrorCode = (errorMessage: string): number | null => {
  // Match common SMTP error codes
  const match = errorMessage.match(/\b(4\d{2}|5\d{2})\b/);
  return match ? parseInt(match[1], 10) : null;
};

/**
 * Classify error type based on SMTP response
 */
export const classifyError = (errorMessage: string): ErrorType => {
  const code = parseSmtpErrorCode(errorMessage);

  if (code === null) {
    return "unknown";
  }

  if (RETRYABLE_ERROR_CODES.includes(code)) {
    return "temporary";
  }

  if (NON_RETRYABLE_ERROR_CODES.includes(code)) {
    return "permanent";
  }

  // Default: 4xx = temporary, 5xx = permanent
  return code < 500 ? "temporary" : "permanent";
};

// Throttling: emails per minute (used in worker limiter)
//const _RATE_LIMIT = parseInt(process.env.THROTTLE_RATE || '50', 10);

// Retry configuration
const MAX_RETRY_ATTEMPTS = 3;

// Default sender
const DEFAULT_FROM = process.env.SMTP_SENDER || "noreply@bulkmail.com";

/**
 * Generate unique hash for idempotency (legacy function)
 */
export const generateIdempotencyHash = (
  to: string,
  subject: string,
  campaignId?: string,
): string => {
  const data = `${to.toLowerCase()}|${subject}|${campaignId || ""}`;
  return createHash("sha256").update(data).digest("hex").substring(0, 16);
};

/**
 * Send email via SMTP
 */
export const sendEmail = async (
  jobData: EmailJobData,
): Promise<EmailJobResult> => {
  const {
    to,
    subject,
    html,
    text,
    from,
    replyTo,
    templateId,
    variables,
    campaignId,
  } = jobData;
  const transporter = getTransporter();
  const sender = getSenderInfo();

  // Validate required fields
  if (!to || !subject || (!html && !text)) {
    return {
      success: false,
      error: "Missing required fields: to, subject, and html/text",
      timestamp: new Date().toISOString(),
      attempts: 1,
    };
  }

  // Generate idempotency hash
  const idempotencyKey = generateIdempotencyHash(to, subject, campaignId);

  // Process template variables if present
  let processedHtml = html;
  let processedText = text;

  if (variables) {
    Object.entries(variables).forEach(([key, value]) => {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, "g");
      processedHtml = processedHtml?.replace(regex, String(value));
      processedText = processedText?.replace(regex, String(value));
    });
  }

  try {
    const info = await transporter.sendMail({
      from: from || `"${sender.name}" <${sender.email}>`,
      to,
      subject,
      html: processedHtml,
      text: processedText,
      replyTo,
      headers: {
        "X-Idempotency-Key": idempotencyKey,
        "X-Campaign-Id": campaignId || "unknown",
        "X-Template-Id": templateId || "custom",
      },
    });

    console.log(`📧 Email sent to ${to}: ${info.messageId}`);

    return {
      success: true,
      messageId: info.messageId,
      timestamp: new Date().toISOString(),
      attempts: 1,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error(`❌ Failed to send email to ${to}:`, errorMessage);

    // Classify error for retry strategy
    const errorType = classifyError(errorMessage);

    // For permanent errors, don't retry - return failure directly
    if (errorType === "permanent") {
      return {
        success: false,
        error: errorMessage,
        errorType: "permanent",
        timestamp: new Date().toISOString(),
        attempts: 1,
      };
    }

    // For temporary or unknown errors, throw to trigger Bull retry
    const errorWithType = new Error(errorMessage) as Error & {
      errorType: string;
    };
    errorWithType.errorType = errorType;
    throw errorWithType;
  }
};

/**
 * Process email job with persistence tracking
 */
export const processEmailJob = async (
  job: BullJobData,
): Promise<EmailJobResult> => {
  const data = job.data as EmailJobData;
  console.log(`📧 Processing job ${job.id} for ${data.to}`);

  const attempts = job.attemptsMade || 0;
  const senderAddress = data.from || DEFAULT_FROM;
  const campaignId = data.campaignId || "unknown";

  // Try to get email log repository
  let emailLogRepo;
  let jobRepo;

  try {
    emailLogRepo = getEmailLogRepository();
    jobRepo = getJobRepository();
  } catch (err) {
    console.warn("Repositories not available, running without persistence");
  }

  // Check idempotency - skip if already sent
  if (emailLogRepo) {
    try {
      const uniqueHash = generateUniqueHash(
        campaignId,
        data.to,
        data.subject,
        senderAddress,
      );
      const existing = await emailLogRepo.findByUniqueHash(uniqueHash);

      if (existing && existing.status === "sent") {
        console.log(`⏭️  Skipping duplicate email to ${data.to}`);
        return {
          success: true,
          messageId: "duplicate",
          timestamp: new Date().toISOString(),
          attempts: attempts + 1,
          skipped: true,
        };
      }

      // Update status to processing
      if (existing) {
        await emailLogRepo.update(existing.id, { status: "processing" });
      }
    } catch (err) {
      console.warn("Could not check idempotency:", err);
    }
  }

  // Send email
  const result = await sendEmail(data);
  result.attempts = attempts + 1;

  // Update database with result
  if (emailLogRepo) {
    try {
      const uniqueHash = generateUniqueHash(
        campaignId,
        data.to,
        data.subject,
        senderAddress,
      );
      const existing = await emailLogRepo.findByUniqueHash(uniqueHash);

      if (existing) {
        if (result.success) {
          await emailLogRepo.markAsSent(existing.id);

          // Increment job completed count
          if (jobRepo) {
            const jobs = await jobRepo.findAll({ campaign_id: campaignId });
            if (jobs.length > 0) {
              await jobRepo.incrementCompletedCount(jobs[0].id);
            }
          }
        } else {
          await emailLogRepo.markAsFailed(
            existing.id,
            result.error || "Unknown error",
            undefined,
          );

          // Increment job failed count
          if (jobRepo) {
            const jobs = await jobRepo.findAll({ campaign_id: campaignId });
            if (jobs.length > 0) {
              await jobRepo.incrementFailedCount(jobs[0].id);
            }
          }
        }
      }
    } catch (err) {
      console.warn("Could not update email log:", err);
    }
  }

  if (!result.success) {
    console.error(
      `Job ${job.id} failed (attempt ${attempts + 1}/${MAX_RETRY_ATTEMPTS})`,
    );
  }

  return result;
};

/**
 * Email job processor for Bull Queue
 */
export const emailJobProcessor = async (
  job: BullJobData,
): Promise<EmailJobResult> => {
  return processEmailJob(job);
};

// Export processor name
export const PROCESSOR_NAME = "send-email";

export default emailJobProcessor;
