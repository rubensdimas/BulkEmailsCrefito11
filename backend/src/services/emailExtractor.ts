/**
 * Email Extractor Service
 * Auto-detects email column and extracts values from XLSX data
 */

// Email column name patterns
const EMAIL_COLUMN_PATTERNS = [
  'email',
  'e-mail',
  'mail',
  'endereco_email',
  'endereco de email',
  'enderecoemail',
  'email_address',
  'emailaddress',
  'correo',
  'correo_electronico',
];

/**
 * Extract email column from headers
 * @param headers - Array of column headers
 * @returns Index of email column or -1 if not found
 */
export const findEmailColumn = (headers: string[]): number => {
  for (let i = 0; i < headers.length; i++) {
    const normalizedHeader = normalizeHeader(headers[i]);
    if (EMAIL_COLUMN_PATTERNS.some(pattern => normalizedHeader.includes(pattern))) {
      return i;
    }
  }
  return -1;
};

/**
 * Normalize header for comparison
 */
const normalizeHeader = (header: string): string => {
  return header
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9]/g, '') // Remove special characters
    .trim();
};

/**
 * Extract emails from parsed XLSX data
 * @param data - Array of objects from XLSX
 * @param headers - Array of column headers
 * @returns Array of email values
 */
export const extractEmails = (data: Record<string, unknown>[], headers: string[]): string[] => {
  // Try to find email column
  const emailColIndex = findEmailColumn(headers);

  if (emailColIndex !== -1) {
    // Extract from specific column
    const emailColumnName = headers[emailColIndex];
    return data
      .map(row => row[emailColumnName])
      .filter((email): email is string => {
        return email !== null && email !== undefined && typeof email === 'string' && email.trim().length > 0;
      });
  }

  // Fallback: use first column if no email column found
  if (headers.length > 0) {
    const firstColumn = headers[0];
    return data
      .map(row => row[firstColumn])
      .filter((email): email is string => {
        return email !== null && email !== undefined && typeof email === 'string' && email.trim().length > 0;
      });
  }

  return [];
};

/**
 * Get all columns from data
 */
export const getColumns = (data: Record<string, unknown>[]): string[] => {
  if (data.length === 0) {
    return [];
  }
  return Object.keys(data[0]);
};

export default {
  findEmailColumn,
  extractEmails,
  getColumns,
};