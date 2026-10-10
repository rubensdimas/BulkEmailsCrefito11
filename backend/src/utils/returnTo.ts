const MAX_RETURN_TO_LENGTH = 2048;
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f\\]/;

/**
 * Accepts only same-origin paths so `next` cannot become an open redirect.
 */
export const sanitizeReturnTo = (value: unknown): string => {
  if (typeof value !== 'string' || value.length > MAX_RETURN_TO_LENGTH) return '/';
  if (!value.startsWith('/') || value.startsWith('//') || UNSAFE_CHARACTERS.test(value)) return '/';
  if (value === '/login' || value.startsWith('/login?') || value.startsWith('/login/')) return '/';
  return value;
};
