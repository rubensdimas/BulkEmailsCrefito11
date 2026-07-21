const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9]){1,})+$/;

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export const isValidEmail = (email: string): boolean => {
  const normalized = normalizeEmail(email);
  return normalized.length > 0 && normalized.length <= 254 && EMAIL_REGEX.test(normalized);
};

export const mergeUniqueEmails = (...lists: string[][]): string[] => {
  return [...new Set(lists.flat().map(normalizeEmail).filter(Boolean))];
};

export const splitEmailInput = (value: string): string[] => {
  return value.split(',').map(normalizeEmail).filter(Boolean);
};
