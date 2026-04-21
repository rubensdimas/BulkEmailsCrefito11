/**
 * Email Validator Service
 * Validates emails using regex RFC 5322 basic pattern
 */

// RFC 5322 basic pattern - validates basic email format
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9]){1,})+$/;

/**
 * Validate a single email address
 * @param email - Email address to validate
 * @returns true if valid, false otherwise
 */
export const isValidEmail = (email: string | null | undefined): boolean => {
  if (!email || typeof email !== 'string') {
    return false;
  }

  const trimmed = email.trim();

  if (trimmed.length === 0 || trimmed.length > 254) {
    return false;
  }

  return EMAIL_REGEX.test(trimmed);
};

/**
 * Validate result interface
 */
export interface ValidationResult {
  email: string;
  isValid: boolean;
  error?: string;
}

/**
 * Validate a batch of emails
 * @param emails - Array of email addresses to validate
 * @returns Object with valid and invalid arrays
 */
export const validateEmails = (emails: string[]): { valid: string[]; invalid: ValidationResult[] } => {
  const valid: string[] = [];
  const invalid: ValidationResult[] = [];

  for (const email of emails) {
    const trimmed = email.trim();
    const isValid = isValidEmail(trimmed);

    if (isValid) {
      valid.push(trimmed.toLowerCase());
    } else {
      invalid.push({
        email: trimmed,
        isValid: false,
        error: 'Invalid email format',
      });
    }
  }

  return { valid, invalid };
};

/**
 * Validate and deduplicate emails
 * @param emails - Array of email addresses
 * @returns Object with deduplicated valid and invalid arrays
 */
export const validateAndDeduplicate = (emails: string[]): { valid: string[]; invalid: ValidationResult[] } => {
  const { valid, invalid } = validateEmails(emails);

  // Deduplicate valid emails
  const uniqueValid = [...new Set(valid)];

  return { valid: uniqueValid, invalid };
};

export default {
  isValidEmail,
  validateEmails,
  validateAndDeduplicate,
};