/**
 * Job Model
 * TypeScript interfaces for Job entity
 */

/**
 * Job status enum
 */
export type JobStatus = 
  | 'pending' 
  | 'processing' 
  | 'completed' 
  | 'failed' 
  | 'cancelled';

/**
 * Job priority enum
 */
export type JobPriority = 'low' | 'normal' | 'high' | 'critical';

/**
 * Job entity interface
 */
export interface Job {
  id: string;
  campaign_id: string;
  subject: string;
  html: string | null;
  text: string | null;
  from_address: string;
  from_name: string | null;
  reply_to: string | null;
  template_id: string | null;
  variables: Record<string, unknown> | null;
  status: JobStatus;
  priority: JobPriority;
  total_recipients: number;
  valid_recipients: number;
  invalid_recipients: number;
  completed_count: number;
  failed_count: number;
  throttle_rate: number;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Job creation input (without auto-generated fields)
 */
export interface CreateJobInput {
  campaign_id: string;
  subject: string;
  html?: string | null;
  text?: string | null;
  from_address: string;
  from_name?: string | null;
  reply_to?: string | null;
  template_id?: string | null;
  variables?: Record<string, unknown> | null;
  priority?: JobPriority;
  throttle_rate?: number;
  total_recipients: number;
  valid_recipients: number;
  invalid_recipients: number;
}

/**
 * Job update input
 */
export interface UpdateJobInput {
  status?: JobStatus;
  priority?: JobPriority;
  completed_count?: number;
  failed_count?: number;
  started_at?: Date | null;
  completed_at?: Date | null;
}

/**
 * Job filter options for queries
 */
export interface JobFilter {
  status?: JobStatus;
  campaign_id?: string;
  from_date?: Date;
  to_date?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Job statistics summary
 */
export interface JobStats {
  total_jobs: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  cancelled: number;
  total_emails_sent: number;
  total_emails_failed: number;
}

/**
 * Database row type (snake_case from PostgreSQL)
 */
export interface JobRow {
  id: string;
  campaign_id: string;
  subject: string;
  html: string | null;
  text: string | null;
  from_address: string;
  from_name: string | null;
  reply_to: string | null;
  template_id: string | null;
  variables: Record<string, unknown> | null;
  status: string;
  priority: string;
  total_recipients: number;
  valid_recipients: number;
  invalid_recipients: number;
  completed_count: number;
  failed_count: number;
  throttle_rate: number;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Convert database row to Job entity
 */
export const jobFromRow = (row: JobRow): Job => ({
  id: row.id,
  campaign_id: row.campaign_id,
  subject: row.subject,
  html: row.html,
  text: row.text,
  from_address: row.from_address,
  from_name: row.from_name,
  reply_to: row.reply_to,
  template_id: row.template_id,
  variables: row.variables,
  status: row.status as JobStatus,
  priority: row.priority as JobPriority,
  total_recipients: row.total_recipients,
  valid_recipients: row.valid_recipients,
  invalid_recipients: row.invalid_recipients,
  completed_count: row.completed_count,
  failed_count: row.failed_count,
  throttle_rate: row.throttle_rate,
  started_at: row.started_at,
  completed_at: row.completed_at,
  created_at: row.created_at,
  updated_at: row.updated_at,
});