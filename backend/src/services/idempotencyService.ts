/**
 * Idempotency Service
 * Generate and verify unique_hash for email sending
 */
import { createHash, randomBytes } from 'crypto';

/**
 * Generate unique hash for an email
 * Hash formula: SHA256(job_id + recipient_email + subject + from_address)
 * 
 * @param jobId - Job/Campaign ID
 * @param recipientEmail - Recipient email address
 * @param subject - Email subject
 * @param fromAddress - Sender email address
 * @returns 64-character hex hash
 */
export const generateUniqueHash = (
  jobId: string,
  recipientEmail: string,
  subject: string,
  fromAddress: string
): string => {
  // Combine fields and create hash
  const data = `${jobId}|${recipientEmail.toLowerCase()}|${subject}|${fromAddress.toLowerCase()}`;
  const hash = createHash('sha256').update(data).digest('hex');
  return hash;
};

/**
 * Verify if an email should be sent based on unique_hash
 * Returns true if the email should be sent (not a duplicate)
 * 
 * @param existingStatus - Current status in database
 * @returns true if email can be sent
 */
export const shouldSendEmail = (
  existingStatus: string | undefined
): boolean => {
  // If no existing record, or if previous attempt failed, send again
  if (!existingStatus) return true;
  if (existingStatus === 'failed') return true;
  if (existingStatus === 'bounced') return true;
  
  // If already sent, don't send again (idempotency)
  return false;
};

/**
 * Check if email was already sent successfully
 * 
 * @param existingStatus - Current status in database
 * @returns true if email was already sent
 */
export const wasEmailSent = (existingStatus: string | undefined): boolean => {
  return existingStatus === 'sent';
};

/**
 * Generate a unique tracking ID for email
 */
export const generateTrackingId = (): string => {
  return randomBytes(16).toString('hex');
};

/**
 * Parse template variables from subject/body
 * Supports {{variable}} syntax
 * 
 * @param template - Template string with {{variables}}
 * @param variables - Key-value pairs for replacement
 * @returns Parsed string
 */
export const parseTemplate = (
  template: string,
  variables: Record<string, unknown>
): string => {
  let result = template;
  
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'gi');
    result = result.replace(regex, String(value));
  }
  
  return result;
};

/**
 * Validate template variables
 * Checks if all required variables are provided
 * 
 * @param template - Template string with {{variables}}
 * @param provided - Key-value pairs provided
 * @returns Array of missing variable names
 */
export const validateTemplateVariables = (
  template: string,
  provided: Record<string, unknown>
): string[] => {
  const regex = /{{\s*(\w+)\s*}}/g;
  const missing: string[] = [];
  let match: RegExpExecArray | null;
  
  // Find all variables in template
  const requiredVars = new Set<string>();
  while ((match = regex.exec(template)) !== null) {
    requiredVars.add(match[1]);
  }
  
  // Check which are missing
  for (const variable of requiredVars) {
    if (!(variable in provided)) {
      missing.push(variable);
    }
  }
  
  return missing;
};

/**
 * Sanitize email content for safe display
 * Removes potentially dangerous HTML
 * 
 * @param content - Raw content
 * @returns Sanitized content
 */
export const sanitizeHtmlContent = (content: string): string => {
  // Basic sanitization - remove script tags and event handlers
  let sanitized = content;
  
  // Remove script tags
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  
  // Remove on* event handlers
  sanitized = sanitized.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
  
  return sanitized;
};

export default {
  generateUniqueHash,
  shouldSendEmail,
  wasEmailSent,
  generateTrackingId,
  parseTemplate,
  validateTemplateVariables,
  sanitizeHtmlContent,
};