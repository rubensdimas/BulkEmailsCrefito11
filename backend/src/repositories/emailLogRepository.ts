/**
 * EmailLog Repository
 * CRUD operations for EmailLog entity
 */
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import {
  EmailLog,
  EmailLogStatus,
  EmailLogRow,
  CreateEmailLogInput,
  UpdateEmailLogInput,
  EmailLogFilter,
  EmailStats,
  MailgridWebhookUpdate,
  ImportedEmailStatusUpdate,
  shouldApplyMailgridWebhookEvent,
  emailLogFromRow,
} from '../models/EmailLog';

export const EMAIL_LOG_INSERT_CHUNK_SIZE = 1000;
const EMAIL_LOG_LOOKUP_CHUNK_SIZE = 1000;
export const EMAIL_STATUS_STAGE_CHUNK_SIZE = 1000;
const EMAIL_STATUS_STAGE_TABLE = 'email_status_import_stage';
const EMAIL_STATUS_APPLY_TABLE = 'email_status_import_apply';

export interface EmailLogBatchResult {
  requested: number;
  inserted: number;
  existing: number;
}

export interface EmailStatusImportApplyResult {
  updated: number;
  unchanged: number;
  ignoredStale: number;
  notFound: number;
  otherCampaign: number;
  recipientMismatch: number;
}

export interface EmailLogPageFilter {
  recipient?: string;
  status?: Extract<EmailLogStatus, 'pending' | 'delivered' | 'soft_bounce' | 'hard_bounce'>;
}

const timestampValue = (value: Date | string | null): number | null => (
  value ? new Date(value).getTime() : null
);

const importedStatusIsUnchanged = (
  row: EmailLogRow,
  input: ImportedEmailStatusUpdate,
): boolean => (
  row.status === input.status
  && row.mailgrid_status_code === input.statusCode
  && row.mailgrid_status_message === input.statusMessage
  && timestampValue(row.mailgrid_sent_at) === timestampValue(input.sentAt)
  && timestampValue(row.mailgrid_event_at) === timestampValue(input.eventAt)
);

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
  async createBatch(
    inputs: CreateEmailLogInput[],
    transaction?: Knex.Transaction,
  ): Promise<EmailLogBatchResult> {
    if (inputs.length === 0) {
      return { requested: 0, inserted: 0, existing: 0 };
    }

    const insert = async (executor: Knex | Knex.Transaction): Promise<EmailLogBatchResult> => {
      const now = new Date();
      let inserted = 0;

      for (let offset = 0; offset < inputs.length; offset += EMAIL_LOG_INSERT_CHUNK_SIZE) {
        const chunk = inputs.slice(offset, offset + EMAIL_LOG_INSERT_CHUNK_SIZE);
        const values = chunk.map((input) => ({
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

        const rows = await executor('email_logs')
          .insert(values)
          .onConflict('unique_hash')
          .ignore()
          .returning('unique_hash');
        inserted += rows.length;
      }

      return {
        requested: inputs.length,
        inserted,
        existing: inputs.length - inserted,
      };
    };

    if (transaction) return insert(transaction);
    return this.db.transaction((trx) => insert(trx));
  }

  /**
   * Load existing log states without creating a query with an unsafe number of
   * PostgreSQL bind parameters.
   */
  async findStatesByUniqueHashes(uniqueHashes: string[]): Promise<Map<string, EmailLogStatus>> {
    const states = new Map<string, EmailLogStatus>();
    const hashes = [...new Set(uniqueHashes)];

    for (let offset = 0; offset < hashes.length; offset += EMAIL_LOG_LOOKUP_CHUNK_SIZE) {
      const chunk = hashes.slice(offset, offset + EMAIL_LOG_LOOKUP_CHUNK_SIZE);
      const rows = await this.db('email_logs')
        .whereIn('unique_hash', chunk)
        .select('unique_hash', 'status') as Array<{ unique_hash: string; status: EmailLogStatus }>;
      for (const row of rows) states.set(row.unique_hash, row.status);
    }

    return states;
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
    pageSize: number,
    filter: EmailLogPageFilter = {},
  ): Promise<{ data: EmailLog[]; total: number }> {
    const offset = (page - 1) * pageSize;
    const rowsQuery = this.db('email_logs')
      .where('job_id', jobId);
    const countQuery = this.db('email_logs')
      .where('job_id', jobId);

    if (filter.recipient) {
      rowsQuery.where('recipient_email', filter.recipient);
      countQuery.where('recipient_email', filter.recipient);
    }
    if (filter.status) {
      rowsQuery.where('status', filter.status);
      countQuery.where('status', filter.status);
    }

    const [rows, countRow] = await Promise.all([
      rowsQuery
        .select('*')
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(pageSize)
        .offset(offset),
      countQuery
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
    return this.db.transaction(async (trx) => {
      const row = await trx('email_logs')
        .where('mailgrid_message_id', messageId)
        .forUpdate()
        .first();
      if (!row) return 'not_found';

      const existing = emailLogFromRow(row as unknown as EmailLogRow);
      if (!shouldApplyMailgridWebhookEvent(existing.mailgrid_event_at, input.eventAt)) {
        return 'ignored';
      }

      const isBounce = input.status === 'soft_bounce' || input.status === 'hard_bounce';
      await trx('email_logs')
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
    });
  }

  /**
   * Apply statuses from a provider export without creating email logs.
   * The transaction and row locks prevent a concurrent webhook from being
   * overwritten by an older CSV event.
   */
  async applyImportedStatuses(
    jobId: string,
    updates: ImportedEmailStatusUpdate[],
  ): Promise<EmailStatusImportApplyResult> {
    if (updates.length === 0) {
      return {
        updated: 0,
        unchanged: 0,
        ignoredStale: 0,
        notFound: 0,
        otherCampaign: 0,
        recipientMismatch: 0,
      };
    }

    return this.db.transaction(async (trx) => {
      await trx.raw(`
        CREATE TEMP TABLE ${EMAIL_STATUS_STAGE_TABLE} (
          message_id VARCHAR(255) PRIMARY KEY,
          recipient VARCHAR(255) NOT NULL,
          status VARCHAR(50) NOT NULL,
          status_code SMALLINT NOT NULL,
          status_message TEXT NOT NULL,
          sent_at TIMESTAMPTZ NOT NULL,
          event_at TIMESTAMPTZ NOT NULL,
          source_row INTEGER NOT NULL
        ) ON COMMIT DROP
      `);

      for (let offset = 0; offset < updates.length; offset += EMAIL_STATUS_STAGE_CHUNK_SIZE) {
        const chunk = updates.slice(offset, offset + EMAIL_STATUS_STAGE_CHUNK_SIZE);
        await trx(EMAIL_STATUS_STAGE_TABLE).insert(chunk.map((item) => ({
          message_id: item.messageId,
          recipient: item.recipient,
          status: item.status,
          status_code: item.statusCode,
          status_message: item.statusMessage,
          sent_at: item.sentAt,
          event_at: item.eventAt,
          source_row: item.sourceRow,
        })));
      }

      const rows = await trx({ email: 'email_logs' })
        .join({ stage: EMAIL_STATUS_STAGE_TABLE }, 'email.mailgrid_message_id', 'stage.message_id')
        .select('email.*')
        .orderBy('email.id')
        .forUpdate('email');
      const byMessageId = new Map(
        rows.map((row) => [String(row.mailgrid_message_id), row as unknown as EmailLogRow]),
      );
      const applicable: ImportedEmailStatusUpdate[] = [];
      let unchanged = 0;
      let ignoredStale = 0;
      let notFound = 0;
      let otherCampaign = 0;
      let recipientMismatch = 0;

      for (const item of updates) {
        const row = byMessageId.get(item.messageId);
        if (!row) {
          notFound++;
          continue;
        }
        if (row.job_id !== jobId) {
          otherCampaign++;
          continue;
        }
        if (row.recipient_email.toLowerCase() !== item.recipient.toLowerCase()) {
          recipientMismatch++;
          continue;
        }

        const currentEventAt = row.mailgrid_event_at ? new Date(row.mailgrid_event_at) : null;
        if (!shouldApplyMailgridWebhookEvent(currentEventAt, item.eventAt)) {
          ignoredStale++;
          continue;
        }
        if (importedStatusIsUnchanged(row, item)) {
          unchanged++;
          continue;
        }
        applicable.push(item);
      }

      if (applicable.length > 0) {
        await trx.raw(`
          CREATE TEMP TABLE ${EMAIL_STATUS_APPLY_TABLE} (
            message_id VARCHAR(255) PRIMARY KEY
          ) ON COMMIT DROP
        `);
        for (let offset = 0; offset < applicable.length; offset += EMAIL_STATUS_STAGE_CHUNK_SIZE) {
          await trx(EMAIL_STATUS_APPLY_TABLE).insert(
            applicable.slice(offset, offset + EMAIL_STATUS_STAGE_CHUNK_SIZE)
              .map((item) => ({ message_id: item.messageId })),
          );
        }

        const result = await trx.raw(`
          UPDATE email_logs AS email
          SET
            status = stage.status,
            delivered_at = CASE
              WHEN stage.status = 'delivered' THEN stage.event_at
              ELSE email.delivered_at
            END,
            bounces_at = CASE
              WHEN stage.status IN ('soft_bounce', 'hard_bounce') THEN stage.event_at
              ELSE email.bounces_at
            END,
            mailgrid_sent_at = stage.sent_at,
            mailgrid_event_at = stage.event_at,
            mailgrid_status_code = stage.status_code,
            mailgrid_status_message = stage.status_message,
            updated_at = CURRENT_TIMESTAMP
          FROM ${EMAIL_STATUS_STAGE_TABLE} AS stage
          INNER JOIN ${EMAIL_STATUS_APPLY_TABLE} AS applicable
            ON applicable.message_id = stage.message_id
          WHERE email.job_id = ?
            AND email.mailgrid_message_id = stage.message_id
            AND LOWER(email.recipient_email) = LOWER(stage.recipient)
        `, [jobId]);
        if (result.rowCount !== applicable.length) {
          throw new Error('Imported status update count mismatch');
        }
      }

      return {
        updated: applicable.length,
        unchanged,
        ignoredStale,
        notFound,
        otherCampaign,
        recipientMismatch,
      };
    });
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
