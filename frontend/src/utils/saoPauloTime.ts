// Mailgrid works in São Paulo time, a fixed UTC-03:00 since Brazil dropped daylight saving in 2019.
const OFFSET_MS = -3 * 60 * 60 * 1000;
const pad = (value: number): string => String(value).padStart(2, '0');

const shifted = (date: Date): Date => new Date(date.getTime() + OFFSET_MS);

/** Value for <input type="datetime-local">, shown in São Paulo time. */
export const toSaoPauloInput = (date: Date): string => {
  const local = shifted(date);
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
};

/** Turns a datetime-local value into ISO 8601 with the São Paulo offset; seconds fill the whole minute at the end of a range. */
export const fromSaoPauloInput = (value: string, endOfMinute = false): string =>
  value ? `${value}:${endOfMinute ? '59' : '00'}-03:00` : '';

export const formatSaoPaulo = (iso: string | null): string => {
  if (!iso) return '—';
  const local = shifted(new Date(iso));
  return `${pad(local.getUTCDate())}/${pad(local.getUTCMonth() + 1)}/${local.getUTCFullYear()} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`;
};
