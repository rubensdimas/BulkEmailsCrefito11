/**
 * Email Job Processors
 * Handles email sending, throttling, retry logic
 * Updated with persistence and idempotency
 */
import {
  EmailJobData,
  EmailJobResult,
  RETRYABLE_ERROR_CODES,
  NON_RETRYABLE_ERROR_CODES,
} from "./emailQueue";
import {
  getJobRepository,
  getEmailLogRepository,
  getConfigService,
  isDatabaseReady,
} from "../services/databaseService";
import { generateUniqueHash, wasEmailSent } from "../services/idempotencyService";
import { renderInstitutionalEmailTemplate } from "../services/emailTemplateService";
import { MailgridError, sendViaMailgrid } from "../services/mailgridService";

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
const DEFAULT_FROM = process.env.MAILGRID_SENDER || process.env.SMTP_SENDER || "noreply@bulkmail.com";

/**
 * Send email via Mailgrid API
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
    variables,
  } = jobData;

  // Validate required fields
  if (!to || !subject || (!html && !text)) {
    return {
      success: false,
      error: "Missing required fields: to, subject, and html/text",
      timestamp: new Date().toISOString(),
      attempts: 1,
    };
  }

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

  const templatedEmail = renderInstitutionalEmailTemplate({
    html: processedHtml || "",
    text: processedText,
  });

  try {
    const config = isDatabaseReady()
      ? await getConfigService().getMailgridConfig()
      : {
          host: process.env.MAILGRID_HOST || process.env.SMTP_HOST || "",
          user: process.env.MAILGRID_USER || process.env.SMTP_USER || "",
          pass: process.env.MAILGRID_PASS || process.env.SMTP_PASS || "",
          from_address: process.env.MAILGRID_SENDER || process.env.SMTP_SENDER || "",
          from_name: process.env.MAILGRID_SENDER_NAME || process.env.SMTP_SENDER_NAME || "BulkMail Pro",
        };
    const info = await sendViaMailgrid(config, {
      from: from || config.from_address,
      fromName: config.from_name,
      to,
      subject,
      html: templatedEmail.html,
      text: templatedEmail.text,
      replyTo,
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
    const errorType = error instanceof MailgridError
      ? (error.retryable ? "temporary" : "permanent")
      : classifyError(errorMessage);

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

      if (existing && wasEmailSent(existing.status)) {
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
          await emailLogRepo.markAsSent(existing.id, result.messageId);

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
