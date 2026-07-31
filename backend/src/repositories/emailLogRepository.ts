/**
 * EmailLog Repository
 * CRUD operations for EmailLog entity
 */
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import {
  EmailLog,
  EmailLogRow,
  CreateEmailLogInput,
  UpdateEmailLogInput,
  EmailLogFilter,
  EmailStats,
  MailgridWebhookUpdate,
  shouldApplyMailgridWebhookEvent,
  emailLogFromRow,
} from '../models/EmailLog';

/**
 * EmailLogRepository class
 */
export class EmailLogRepository {
  private readonly db: Knex;

  constructor(db: Knex) {
    this.db = db;
  }

  /**
   * Create a new email log
   */
  async create(input: CreateEmailLogInput): Promise<EmailLog> {
    const now = new Date();
    const id = uuidv4();

    // Check if already exists
    const existing = await this.db('email_logs')
      .where('unique_hash', input.unique_hash)
      .first();

    if (existing) {
      return emailLogFromRow(existing as unknown as EmailLogRow);
    }

    // Insert new record
    const [row] = await this.db('email_logs')
      .insert({
        id,
        job_id: input.job_id,
        recipient_email: input.recipient_email,
        subject: input.subject,
        from_address: input.from_address,
        from_name: input.from_name ?? null,
        status: 'pending',
        error_message: null,
        error_code: null,
        unique_hash: input.unique_hash,
        mailgrid_message_id: null,
        delivered_at: null,
        mailgrid_sent_at: null,
        mailgrid_event_at: null,
        webhook_received_at: null,
        mailgrid_status_code: null,
        mailgrid_status_message: null,
        mailgrid_payload: null,
        sent_at: null,
        opened_at: null,
        clicked_at: null,
        bounces_at: null,
        retry_count: 0,
        created_at: now,
        updated_at: now,
      })
      .returning('*');

    return emailLogFromRow(row as unknown as EmailLogRow);
  }

  /**
   * Create multiple email logs in batch
   */
  async createBatch(inputs: CreateEmailLogInput[]): Promise<EmailLog[]> {
    if (inputs.length === 0) return [];

    const now = new Date();
    const jobId = inputs[0].job_id;

    // Get existing hashes for this job
    const existingLogs = await this.db('email_logs')
      .where('job_id', jobId)
      .select('unique_hash')
      .then(rows => new Set(rows.map((r: { unique_hash: string }) => r.unique_hash)));

    // Filter out duplicates
    const newInputs = inputs.filter(input => !existingLogs.has(input.unique_hash));

    if (newInputs.length > 0) {
      const values = newInputs.map((input) => ({
        id: uuidv4(),
        job_id: input.job_id,
        recipient_email: input.recipient_email,
        subject: input.subject,
        from_address: input.from_address,
        from_name: input.from_name ?? null,
        status: 'pending' as const,
        error_message: null,
        error_code: null,
        unique_hash: input.unique_hash,
        mailgrid_message_id: null,
        delivered_at: null,
        mailgrid_sent_at: null,
        mailgrid_event_at: null,
        webhook_received_at: null,
        mailgrid_status_code: null,
        mailgrid_status_message: null,
        mailgrid_payload: null,
        sent_at: null,
        opened_at: null,
        clicked_at: null,
        bounces_at: null,
        retry_count: 0,
        created_at: now,
        updated_at: now,
      }));

      await this.db('email_logs').insert(values);
    }

    // Get all records for this job
    const rows = await this.db('email_logs').where('job_id', jobId).select('*');
    return rows.map((row) => emailLogFromRow(row as unknown as EmailLogRow));
  }

  /**
   * Find email log by ID
   */
  async findById(id: string): Promise<EmailLog | null> {
    const row = await this.db('email_logs').where('id', id).first();
    if (!row) return null;
    return emailLogFromRow(row as unknown as EmailLogRow);
  }

  /**
   * Find email log by unique hash (for idempotency check)
   */
  async findByUniqueHash(uniqueHash: string): Promise<EmailLog | null> {
    const row = await this.db('email_logs')
      .where('unique_hash', uniqueHash)
      .first();
    if (!row) return null;
    return emailLogFromRow(row as unknown as EmailLogRow);
  }

  async findByMailgridMessageId(messageId: string): Promise<EmailLog | null> {
    const row = await this.db('email_logs')
      .where('mailgrid_message_id', messageId)
      .first();
    if (!row) return null;
    return emailLogFromRow(row as unknown as EmailLogRow);
  }

  /**
   * Find all email logs by job ID
   */
  async findByJobId(jobId: string, filter?: EmailLogFilter): Promise<EmailLog[]> {
    let query = this.db('email_logs')
      .where('job_id', jobId)
      .select('*')
      .orderBy('created_at', 'desc');

    if (filter) {
      if (filter.status) {
        query = query.where('status', filter.status);
      }
      if (filter.limit) {
        query = query.limit(filter.limit);
      }
      if (filter.offset) {
        query = query.offset(filter.offset);
      }
    }

    const rows = await query;
    return rows.map((row) => emailLogFromRow(row as unknown as EmailLogRow));
  }

  async findPageByJobId(
    jobId: string,
    page: number,
    pageSize: number
  ): Promise<{ data: EmailLog[]; total: number }> {
    const offset = (page - 1) * pageSize;
    const [rows, countRow] = await Promise.all([
      this.db('email_logs')
        .where('job_id', jobId)
        .select('*')
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(pageSize)
        .offset(offset),
      this.db('email_logs')
        .where('job_id', jobId)
        .count<{ count: string }[]>({ count: '*' })
        .first(),
    ]);

    return {
      data: rows.map((row) => emailLogFromRow(row as unknown as EmailLogRow)),
      total: Number(countRow?.count) || 0,
    };
  }

  async applyMailgridWebhook(
    messageId: string,
    input: MailgridWebhookUpdate
  ): Promise<'updated' | 'ignored' | 'not_found'> {
    const existing = await this.findByMailgridMessageId(messageId);
    if (!existing) return 'not_found';

    if (!shouldApplyMailgridWebhookEvent(existing.mailgrid_event_at, input.eventAt)) {
      return 'ignored';
    }

    const isBounce = input.status === 'soft_bounce' || input.status === 'hard_bounce';
    await this.db('email_logs')
      .where('id', existing.id)
      .update({
        status: input.status,
        delivered_at: input.status === 'delivered'
          ? input.eventAt || input.receivedAt
          : existing.delivered_at,
        bounces_at: isBounce ? input.eventAt || input.receivedAt : existing.bounces_at,
        mailgrid_sent_at: input.sentAt || existing.mailgrid_sent_at,
        mailgrid_event_at: input.eventAt || existing.mailgrid_event_at,
        webhook_received_at: input.receivedAt,
        mailgrid_status_code: input.statusCode,
        mailgrid_status_message: input.statusMessage,
        mailgrid_payload: input.payload,
        updated_at: input.receivedAt,
      });

    return 'updated';
  }

  /**
   * Find email log by recipient email and job
   */
  async findByEmail(jobId: string, email: string): Promise<EmailLog | null> {
    const row = await this.db('email_logs')
      .where('job_id', jobId)
      .where('recipient_email', email.toLowerCase())
      .first();
    if (!row) return null;
    return emailLogFromRow(row as unknown as EmailLogRow);
  }

  /**
   * Find all email logs with optional filters
   */
  async findAll(filter?: EmailLogFilter): Promise<EmailLog[]> {
    let query = this.db('email_logs').select('*').orderBy('created_at', 'desc');

    if (filter) {
      if (filter.job_id) {
        query = query.where('job_id', filter.job_id);
      }
      if (filter.recipient_email) {
        query = query.where('recipient_email', filter.recipient_email);
      }
      if (filter.status) {
        query = query.where('status', filter.status);
      }
      if (filter.unique_hash) {
        query = query.where('unique_hash', filter.unique_hash);
      }
      if (filter.from_date) {
        query = query.where('created_at', '>=', filter.from_date);
      }
      if (filter.to_date) {
        query = query.where('created_at', '<=', filter.to_date);
      }
      if (filter.limit) {
        query = query.limit(filter.limit);
      }
      if (filter.offset) {
        query = query.offset(filter.offset);
      }
    }

    const rows = await query;
    return rows.map((row) => emailLogFromRow(row as unknown as EmailLogRow));
  }

  /**
   * Update email log
   */
  async update(id: string, input: UpdateEmailLogInput): Promise<EmailLog | null> {
    const updateData: Partial<EmailLogRow> = {};

    if (input.status !== undefined) {
      updateData.status = input.status;
    }
    if (input.error_message !== undefined) {
      updateData.error_message = input.error_message;
    }
    if (input.error_code !== undefined) {
      updateData.error_code = input.error_code;
    }
    if (input.sent_at !== undefined) {
      updateData.sent_at = input.sent_at;
    }
    if (input.opened_at !== undefined) {
      updateData.opened_at = input.opened_at;
    }
    if (input.clicked_at !== undefined) {
      updateData.clicked_at = input.clicked_at;
    }
    if (input.bounces_at !== undefined) {
      updateData.bounces_at = input.bounces_at;
    }
    if (input.retry_count !== undefined) {
      updateData.retry_count = input.retry_count;
    }
    if (input.mailgrid_message_id !== undefined) {
      updateData.mailgrid_message_id = input.mailgrid_message_id;
    }
    if (input.delivered_at !== undefined) {
      updateData.delivered_at = input.delivered_at;
    }
    if (input.mailgrid_sent_at !== undefined) {
      updateData.mailgrid_sent_at = input.mailgrid_sent_at;
    }
    if (input.mailgrid_event_at !== undefined) {
      updateData.mailgrid_event_at = input.mailgrid_event_at;
    }
    if (input.webhook_received_at !== undefined) {
      updateData.webhook_received_at = input.webhook_received_at;
    }
    if (input.mailgrid_status_code !== undefined) {
      updateData.mailgrid_status_code = input.mailgrid_status_code;
    }
    if (input.mailgrid_status_message !== undefined) {
      updateData.mailgrid_status_message = input.mailgrid_status_message;
    }
    if (input.mailgrid_payload !== undefined) {
      updateData.mailgrid_payload = input.mailgrid_payload;
    }

    if (Object.keys(updateData).length === 0) {
      return this.findById(id);
    }

    updateData.updated_at = new Date();

    const [row] = await this.db('email_logs')
      .where('id', id)
      .update(updateData)
      .returning('*');

    if (!row) return null;
    return emailLogFromRow(row as unknown as EmailLogRow);
  }

  /**
   * Mark email as sent
   */
  async markAsSent(id: string, mailgridMessageId?: string): Promise<void> {
    const update: Partial<EmailLogRow> = {
      status: 'sent',
      sent_at: new Date(),
      updated_at: new Date(),
    };
    if (mailgridMessageId) {
      update.mailgrid_message_id = mailgridMessageId;
    }
    await this.db('email_logs')
      .where('id', id)
      .update(update);
  }

  /**
   * Mark email as failed
   */
  async markAsFailed(
    id: string,
    errorMessage: string,
    errorCode?: string
  ): Promise<void> {
    await this.db('email_logs')
      .where('id', id)
      .update({
        status: 'failed',
        error_message: errorMessage,
        error_code: errorCode ?? null,
        updated_at: new Date(),
      });
  }

  /**
   * Increment retry count
   */
  async incrementRetryCount(id: string): Promise<void> {
    await this.db('email_logs')
      .where('id', id)
      .increment('retry_count', 1)
      .update({ updated_at: new Date() });
  }

  /**
   * Check if email was already sent (for idempotency)
   */
  async isDuplicate(uniqueHash: string): Promise<boolean> {
    const row = await this.db('email_logs')
      .where('unique_hash', uniqueHash)
      .whereIn('status', ['sent', 'delivered', 'soft_bounce', 'hard_bounce'])
      .first();
    return !!row;
  }

  /**
   * Get email statistics by job
   */
  async getStatsByJobId(jobId: string): Promise<EmailStats> {
    const stats = await this.db('email_logs')
      .where('job_id', jobId)
      .select(
        this.db.raw('COUNT(*) as total_logs'),
        this.db.raw("SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending"),
        this.db.raw("SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing"),
        this.db.raw("SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent"),
        this.db.raw("SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed"),
        this.db.raw("SUM(CASE WHEN status IN ('bounced', 'soft_bounce', 'hard_bounce') THEN 1 ELSE 0 END) as bounced"),
        this.db.raw("SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered"),
        this.db.raw("SUM(CASE WHEN status = 'soft_bounce' THEN 1 ELSE 0 END) as soft_bounce"),
        this.db.raw("SUM(CASE WHEN status = 'hard_bounce' THEN 1 ELSE 0 END) as hard_bounce")
      )
      .first();

    return {
      total_logs: Number(stats?.total_logs) || 0,
      pending: Number(stats?.pending) || 0,
      processing: Number(stats?.processing) || 0,
      sent: Number(stats?.sent) || 0,
      failed: Number(stats?.failed) || 0,
      bounced: Number(stats?.bounced) || 0,
      delivered: Number(stats?.delivered) || 0,
      soft_bounce: Number(stats?.soft_bounce) || 0,
      hard_bounce: Number(stats?.hard_bounce) || 0,
    };
  }

  /**
   * Get overall email statistics
   */
  async getStats(): Promise<EmailStats> {
    const stats = await this.db('email_logs')
      .select(
        this.db.raw('COUNT(*) as total_logs'),
        this.db.raw("SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending"),
        this.db.raw("SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing"),
        this.db.raw("SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent"),
        this.db.raw("SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed"),
        this.db.raw("SUM(CASE WHEN status IN ('bounced', 'soft_bounce', 'hard_bounce') THEN 1 ELSE 0 END) as bounced"),
        this.db.raw("SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered"),
        this.db.raw("SUM(CASE WHEN status = 'soft_bounce' THEN 1 ELSE 0 END) as soft_bounce"),
        this.db.raw("SUM(CASE WHEN status = 'hard_bounce' THEN 1 ELSE 0 END) as hard_bounce")
      )
      .first();

    return {
      total_logs: Number(stats?.total_logs) || 0,
      pending: Number(stats?.pending) || 0,
      processing: Number(stats?.processing) || 0,
      sent: Number(stats?.sent) || 0,
      failed: Number(stats?.failed) || 0,
      bounced: Number(stats?.bounced) || 0,
      delivered: Number(stats?.delivered) || 0,
      soft_bounce: Number(stats?.soft_bounce) || 0,
      hard_bounce: Number(stats?.hard_bounce) || 0,
    };
  }

  /**
   * Delete logs by job ID
   */
  async deleteByJobId(jobId: string): Promise<number> {
    const result = await this.db('email_logs').where('job_id', jobId).del();
    return result;
  }
}

/**
 * Create EmailLogRepository instance
 */
export const createEmailLogRepository = (db: Knex): EmailLogRepository => {
  return new EmailLogRepository(db);
};
