import { readSecret } from '../config/secret';
import type { MailgridReportEntryInput, MailgridReportErrorCode } from '../models/MailgridReport';

export const MAILGRID_REPORT_URL = 'https://api.mailgrid.net.br/report/';
export const MAILGRID_REPORT_TOKEN_PLACEHOLDER = 'change-me-mailgrid-report-token';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
// Brazil has no daylight saving time since 2019, so São Paulo is a fixed UTC-03:00.
const SAO_PAULO_OFFSET_MS = -3 * 60 * 60 * 1000;

export class MailgridReportError extends Error {
  constructor(readonly code: MailgridReportErrorCode, message: string) {
    super(message);
    this.name = 'MailgridReportError';
  }
}

/** Returns the report token, or null when it is missing or still the .env.example placeholder. */
export const readMailgridReportToken = (): string | null => {
  const token = readSecret('TOKEN_AUTH_MAILGRID', 'TOKEN_AUTH_MAILGRID_FILE')?.trim();
  return token && token !== MAILGRID_REPORT_TOKEN_PLACEHOLDER ? token : null;
};

const pad = (value: number): string => String(value).padStart(2, '0');

export const toSaoPauloDateTime = (date: Date): { date: string; time: string } => {
  const local = new Date(date.getTime() + SAO_PAULO_OFFSET_MS);
  return {
    date: `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`,
    time: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`,
  };
};

/** Parses the API's 'dd/mm/aaaa' + 'HH:MM:SS' pair as São Paulo time; null when not a real date. */
export const parseSaoPauloDateTime = (date: string, time: string): Date | null => {
  const dateMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date?.trim() ?? '');
  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time?.trim() ?? '');
  if (!dateMatch || !timeMatch) return null;
  const [, day, month, year] = dateMatch.map(Number);
  const [, hours, minutes, seconds = 0] = timeMatch.map((part) => Number(part ?? 0));
  const utc = Date.UTC(year, month - 1, day, hours, minutes, seconds);
  const check = new Date(utc);
  // Date.UTC silently rolls over invalid values (31/02 → 03/03); reject them instead.
  if (check.getUTCDate() !== day || check.getUTCMonth() !== month - 1 || hours > 23 || minutes > 59 || seconds > 59) return null;
  return new Date(utc - SAO_PAULO_OFFSET_MS);
};

const text = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
};

export const parseReportRows = (body: unknown): { entries: MailgridReportEntryInput[]; skipped: number } => {
  if (!Array.isArray(body)) throw new MailgridReportError('invalid_response', 'Mailgrid report response is not a list');
  const first = body[0] as Record<string, unknown> | undefined;
  if (first && String(first.codigo ?? '') === '207') {
    throw new MailgridReportError('auth_failed', 'Mailgrid report authentication failed (codigo 207)');
  }
  // Any other {status, codigo} object is an API error, not a delivery row; failing keeps gaps visible.
  if (first && first.codigo !== undefined && !first.msgid) {
    throw new MailgridReportError('invalid_response', `Mailgrid report error (codigo ${String(first.codigo)}): ${String(first.status ?? '').slice(0, 200)}`);
  }
  const entries: MailgridReportEntryInput[] = [];
  let skipped = 0;
  for (const item of body) {
    if (!item || typeof item !== 'object') { skipped += 1; continue; }
    const row = item as Record<string, unknown>;
    const msgid = text(row.msgid);
    const emailPara = text(row.email_para);
    const eventAt = parseSaoPauloDateTime(String(row.data ?? ''), String(row.hora ?? ''));
    if (!msgid || !emailPara || !eventAt) { skipped += 1; continue; }
    entries.push({
      msgid, email_para: emailPara, email_de: text(row.email_de), status: text(row.status),
      tipo_status: text(row.tipo_status) ?? '', sender: text(row.sender), sender_ip: text(row.sender_ip),
      sender_host: text(row.sender_host), size: text(row.size), delivery_ip: text(row.delivery_ip),
      delivery_host: text(row.delivery_host), message_id: text(row.message_id), assunto: text(row.assunto),
      event_at: eventAt, sent_at: parseSaoPauloDateTime(String(row.data_envio ?? ''), String(row.hora_envio ?? '')),
      raw: row,
    });
  }
  return { entries, skipped };
};

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const fetchMailgridReport = async (
  window: { start: Date; end: Date },
  deps: { token?: string | null; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ entries: MailgridReportEntryInput[]; fetched: number; skipped: number }> => {
  const token = deps.token === undefined ? readMailgridReportToken() : deps.token;
  if (!token || token === MAILGRID_REPORT_TOKEN_PLACEHOLDER) {
    throw new MailgridReportError('token_not_configured', 'TOKEN_AUTH_MAILGRID is not configured');
  }
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const start = toSaoPauloDateTime(window.start);
  const end = toSaoPauloDateTime(window.end);
  const body = JSON.stringify({
    token_auth: token, dataini: start.date, horaini: start.time, datafim: end.date, horafim: end.time,
  });

  let lastError = 'unknown error';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await doFetch(MAILGRID_REPORT_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status >= 500) {
        lastError = `HTTP ${response.status}`;
      } else if (!response.ok) {
        throw new MailgridReportError('request_failed', `Mailgrid report request failed: HTTP ${response.status}`);
      } else {
        const parsed = parseReportRows(await response.json());
        return { ...parsed, fetched: parsed.entries.length + parsed.skipped };
      }
    } catch (error) {
      if (error instanceof MailgridReportError) throw error;
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < MAX_ATTEMPTS) await sleep(1000 * 2 ** (attempt - 1));
  }
  throw new MailgridReportError('request_failed', `Mailgrid report request failed after ${MAX_ATTEMPTS} attempts: ${lastError}`);
};
