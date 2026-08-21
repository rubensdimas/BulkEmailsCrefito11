import { readFileSync } from 'node:fs';

/**
 * Reads a secret from a direct environment variable or Docker's *_FILE form.
 * Direct values take precedence to preserve local development compatibility.
 */
export const readSecret = (
  environmentName: string,
  fileEnvironmentName: string,
  fallback?: string,
): string | undefined => {
  const directValue = process.env[environmentName];
  if (directValue) return directValue;

  const filePath = process.env[fileEnvironmentName];
  if (!filePath) return fallback;

  try {
    const fileValue = readFileSync(filePath, 'utf8').trim();
    return fileValue || fallback;
  } catch {
    return fallback;
  }
};
