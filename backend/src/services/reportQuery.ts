import { MAILGRID_TIPO_STATUS, ReportQuery } from '../models/MailgridReport';

export const REPORT_PAGE_SIZE = 50;
export const REPORT_CSV_MAX_ROWS = 100_000;
const DEFAULT_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TEXT_LENGTH = 254;
const SAO_PAULO_OFFSET_MS = -3 * 60 * 60 * 1000;

export class ReportQueryError extends Error {
  readonly code = 'invalid_filter';
  constructor(readonly field: string, message: string) {
    super(message);
    this.name = 'ReportQueryError';
  }
}

const textFilter = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().slice(0, MAX_TEXT_LENGTH);
  return trimmed || undefined;
};

const dateFilter = (value: unknown, field: string): Date | undefined => {
  if (value === undefined || value === '') return undefined;
  const date = typeof value === 'string' ? new Date(value) : new Date(NaN);
  if (Number.isNaN(date.getTime())) throw new ReportQueryError(field, 'Data inválida.');
  return date;
};

/** Validates query-string filters; the period defaults to the last 7 days so queries stay on the event_at index. */
export const parseReportQuery = (query: Record<string, unknown>, now: Date): ReportQuery => {
  const to = dateFilter(query.to, 'to') ?? now;
  const from = dateFilter(query.from, 'from') ?? new Date(to.getTime() - DEFAULT_PERIOD_MS);
  if (from > to) throw new ReportQueryError('from', 'A data inicial deve ser anterior à final.');

  const tipoStatusText = textFilter(query.tipoStatus);
  const tipoStatus = tipoStatusText?.split(',').map((value) => value.trim()).filter(Boolean);
  if (tipoStatus?.some((value) => !(MAILGRID_TIPO_STATUS as readonly string[]).includes(value))) {
    throw new ReportQueryError('tipoStatus', 'Resultado desconhecido.');
  }
  const page = Math.max(1, Number.parseInt(String(query.page ?? '1'), 10) || 1);

  const parsed: ReportQuery = { from, to, page, pageSize: REPORT_PAGE_SIZE };
  const texts = {
    recipient: textFilter(query.recipient), sender: textFilter(query.sender), subject: textFilter(query.subject),
    deliveryHost: textFilter(query.deliveryHost), msgid: textFilter(query.msgid), senderHost: textFilter(query.senderHost),
  };
  for (const [key, value] of Object.entries(texts)) if (value) (parsed as unknown as Record<string, unknown>)[key] = value;
  if (tipoStatus?.length) parsed.tipoStatus = tipoStatus;
  return parsed;
};

/** Prefixes values a spreadsheet would execute as a formula. */
export const csvSafe = (value: string | null): string => {
  if (value === null || value === undefined) return '';
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
};

const pad = (value: number): string => String(value).padStart(2, '0');

export const formatSaoPaulo = (date: Date | null): string => {
  if (!date) return '';
  const local = new Date(new Date(date).getTime() + SAO_PAULO_OFFSET_MS);
  return `${pad(local.getUTCDate())}/${pad(local.getUTCMonth() + 1)}/${local.getUTCFullYear()} `
    + `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`;
};
