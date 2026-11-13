/** Mailgrid report archive: one row per delivery event returned by the /report/ API. */
export interface MailgridReportEntryInput {
  msgid: string;
  email_de: string | null;
  email_para: string;
  status: string | null;
  tipo_status: string;
  sender: string | null;
  sender_ip: string | null;
  sender_host: string | null;
  size: string | null;
  delivery_ip: string | null;
  delivery_host: string | null;
  message_id: string | null;
  assunto: string | null;
  /** Remote SMTP reply for bounces; null for accepted rows. */
  erro: string | null;
  event_at: Date;
  sent_at: Date | null;
  raw: Record<string, unknown>;
}

export type MailgridReportEntry = Omit<MailgridReportEntryInput, 'raw'> & { id: string; collected_at: Date };

export type MailgridReportRunType = 'scheduled' | 'manual' | 'backfill';
export type MailgridReportRunStatus = 'running' | 'success' | 'failed';
export type MailgridReportErrorCode = 'auth_failed' | 'token_not_configured' | 'request_failed' | 'invalid_response';

export interface MailgridReportRun {
  id: string;
  type: MailgridReportRunType;
  window_start: Date;
  window_end: Date;
  status: MailgridReportRunStatus;
  fetched: number;
  inserted: number;
  skipped: number;
  error_code: MailgridReportErrorCode | null;
  error_message: string | null;
  started_at: Date;
  finished_at: Date | null;
  triggered_by: string | null;
}

export const MAILGRID_TIPO_STATUS = ['Aceita', 'Soft Bounce', 'Hard Bounce'] as const;

export interface ReportFilters {
  from: Date;
  to: Date;
  recipient?: string;
  sender?: string;
  subject?: string;
  deliveryHost?: string;
  msgid?: string;
  senderHost?: string;
  tipoStatus?: string[];
}

export interface ReportQuery extends ReportFilters {
  page: number;
  pageSize: number;
}
