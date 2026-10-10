const MAX_RETURN_TO_LENGTH = 2048;
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f\\]/;

// Mirrors backend/src/utils/returnTo.ts: only same-origin paths are accepted.
export const sanitizeReturnTo = (value: string | null): string => {
  if (!value || value.length > MAX_RETURN_TO_LENGTH) return '/';
  if (!value.startsWith('/') || value.startsWith('//') || UNSAFE_CHARACTERS.test(value)) return '/';
  if (value === '/login' || value.startsWith('/login?') || value.startsWith('/login/')) return '/';
  return value;
};
