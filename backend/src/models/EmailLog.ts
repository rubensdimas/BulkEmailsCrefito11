/**
 * EmailLog Model
 * TypeScript interfaces for EmailLog entity
 */

/**
 * Email log status enum
 */
export type EmailLogStatus = 
  | 'pending' 
  | 'processing' 
  | 'sent' 
  | 'delivered'
  | 'soft_bounce'
  | 'hard_bounce'
  | 'failed' 
  | 'bounced';

/**
 * EmailLog entity interface
 */
export interface EmailLog {
  id: string;
  job_id: string;
  recipient_email: string;
  subject: string;
  from_address: string;
  from_name: string | null;
  status: EmailLogStatus;
  error_message: string | null;
  error_code: string | null;
  unique_hash: string;
  mailgrid_message_id: string | null;
  delivered_at: Date | null;
  mailgrid_sent_at: Date | null;
  mailgrid_event_at: Date | null;
  webhook_received_at: Date | null;
  mailgrid_status_code: number | null;
  mailgrid_status_message: string | null;
  mailgrid_payload: Record<string, unknown> | null;
  sent_at: Date | null;
  opened_at: Date | null;
  clicked_at: Date | null;
  bounces_at: Date | null;
  retry_count: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * EmailLog creation input
 */
export interface CreateEmailLogInput {
  job_id: string;
  recipient_email: string;
  subject: string;
  from_address: string;
  from_name?: string | null;
  unique_hash: string;
}

/**
 * EmailLog update input
 */
export interface UpdateEmailLogInput {
  status?: EmailLogStatus;
  error_message?: string | null;
  error_code?: string | null;
  sent_at?: Date | null;
  opened_at?: Date | null;
  clicked_at?: Date | null;
  bounces_at?: Date | null;
  retry_count?: number;
  mailgrid_message_id?: string | null;
  delivered_at?: Date | null;
  mailgrid_sent_at?: Date | null;
  mailgrid_event_at?: Date | null;
  webhook_received_at?: Date | null;
  mailgrid_status_code?: number | null;
  mailgrid_status_message?: string | null;
  mailgrid_payload?: Record<string, unknown> | null;
}

export interface MailgridWebhookUpdate {
  status: Extract<EmailLogStatus, 'delivered' | 'soft_bounce' | 'hard_bounce'>;
  statusCode: 0 | 1 | 2;
  statusMessage: string | null;
  sentAt: Date | null;
  eventAt: Date | null;
  receivedAt: Date;
  payload: Record<string, unknown>;
}

/**
 * Delivery status recovered from an exported Mailgrid CSV report.
 * It intentionally contains only fields that already exist on email_logs.
 */
export interface ImportedEmailStatusUpdate {
  messageId: string;
  recipient: string;
  status: Extract<EmailLogStatus, 'delivered' | 'soft_bounce' | 'hard_bounce'>;
  statusCode: 0 | 1 | 2;
  statusMessage: string;
  sentAt: Date | null;
  eventAt: Date | null;
  sourceRow: number;
}

export const shouldApplyMailgridWebhookEvent = (
  currentEventAt: Date | null,
  incomingEventAt: Date | null
): boolean => {
  if (!currentEventAt) return true;
  if (!incomingEventAt) return false;
  return incomingEventAt.getTime() >= currentEventAt.getTime();
};

/**
 * EmailLog filter options
 */
export interface EmailLogFilter {
  job_id?: string;
  recipient_email?: string;
  status?: EmailLogStatus;
  unique_hash?: string;
  from_date?: Date;
  to_date?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Email statistics by status
 */
export interface EmailStats {
  total_logs: number;
  pending: number;
  processing: number;
  sent: number;
  failed: number;
  bounced: number;
  delivered: number;
  soft_bounce: number;
  hard_bounce: number;
}

/**
 * Database row type (snake_case from PostgreSQL)
 */
export interface EmailLogRow {
  id: string;
  job_id: string;
  recipient_email: string;
  subject: string;
  from_address: string;
  from_name: string | null;
  status: string;
  error_message: string | null;
  error_code: string | null;
  unique_hash: string;
  mailgrid_message_id: string | null;
  delivered_at: Date | null;
  mailgrid_sent_at: Date | null;
  mailgrid_event_at: Date | null;
  webhook_received_at: Date | null;
  mailgrid_status_code: number | null;
  mailgrid_status_message: string | null;
  mailgrid_payload: Record<string, unknown> | null;
  sent_at: Date | null;
  opened_at: Date | null;
  clicked_at: Date | null;
  bounces_at: Date | null;
  retry_count: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * Convert database row to EmailLog entity
 */
export const emailLogFromRow = (row: EmailLogRow): EmailLog => ({
  id: row.id,
  job_id: row.job_id,
  recipient_email: row.recipient_email,
  subject: row.subject,
  from_address: row.from_address,
  from_name: row.from_name,
  status: row.status as EmailLogStatus,
  error_message: row.error_message,
  error_code: row.error_code,
  unique_hash: row.unique_hash,
  mailgrid_message_id: row.mailgrid_message_id,
  delivered_at: row.delivered_at,
  mailgrid_sent_at: row.mailgrid_sent_at,
  mailgrid_event_at: row.mailgrid_event_at,
  webhook_received_at: row.webhook_received_at,
  mailgrid_status_code: row.mailgrid_status_code,
  mailgrid_status_message: row.mailgrid_status_message,
  mailgrid_payload: row.mailgrid_payload,
  sent_at: row.sent_at,
  opened_at: row.opened_at,
  clicked_at: row.clicked_at,
  bounces_at: row.bounces_at,
  retry_count: row.retry_count,
  created_at: row.created_at,
  updated_at: row.updated_at,
});
