/**
 * Job Repository
 * CRUD operations for Job entity
 */
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import {
  Job,
  JobRow,
  CreateJobInput,
  UpdateJobInput,
  JobFilter,
  JobStats,
  jobFromRow,
} from '../models/Job';

/**
 * JobRepository class
 */
export class JobRepository {
  private readonly db: Knex;

  constructor(db: Knex) {
    this.db = db;
  }

  /**
   * Create a new job
   */
  async create(input: CreateJobInput): Promise<Job> {
    const now = new Date();
    const id = uuidv4();

    // Check if already exists
    const existing = await this.db('jobs')
      .where('campaign_id', input.campaign_id)
      .first();

    if (existing) {
      return jobFromRow(existing as unknown as JobRow);
    }

    // Insert new record
    const [row] = await this.db('jobs')
      .insert({
        id,
        campaign_id: input.campaign_id,
        subject: input.subject,
        html: input.html ?? null,
        text: input.text ?? null,
        from_address: input.from_address,
        from_name: input.from_name ?? null,
        reply_to: input.reply_to ?? null,
        template_id: input.template_id ?? null,
        variables: input.variables ? JSON.stringify(input.variables) : null,
        status: 'pending',
        priority: input.priority ?? 'normal',
        total_recipients: input.total_recipients,
        valid_recipients: input.valid_recipients,
        invalid_recipients: input.invalid_recipients,
        completed_count: 0,
        failed_count: 0,
        throttle_rate: input.throttle_rate ?? 50,
        started_at: null,
        completed_at: null,
        created_at: now,
        updated_at: now,
      })
      .returning('*');

    return jobFromRow(row as unknown as JobRow);
  }

  /**
   * Find job by ID
   */
  async findById(id: string): Promise<Job | null> {
    const row = await this.db('jobs').where('id', id).first();
    if (!row) return null;
    return jobFromRow(row as unknown as JobRow);
  }

  /**
   * Find job by campaign ID
   */
  async findByCampaignId(campaignId: string): Promise<Job | null> {
    const row = await this.db('jobs')
      .where('campaign_id', campaignId)
      .first();
    if (!row) return null;
    return jobFromRow(row as unknown as JobRow);
  }

  /**
   * Find all jobs with optional filters
   */
  async findAll(filter?: JobFilter): Promise<Job[]> {
    let query = this.db('jobs').select('*').orderBy('created_at', 'desc');

    if (filter) {
      if (filter.status) {
        query = query.where('status', filter.status);
      }
      if (filter.campaign_id) {
        query = query.where('campaign_id', filter.campaign_id);
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
    return rows.map((row) => jobFromRow(row as unknown as JobRow));
  }

  /**
   * Count jobs with optional filters
   */
  async count(filter?: JobFilter): Promise<number> {
    let query = this.db('jobs');

    if (filter) {
      if (filter.status) {
        query = query.where('status', filter.status);
      }
      if (filter.campaign_id) {
        query = query.where('campaign_id', filter.campaign_id);
      }
      if (filter.from_date) {
        query = query.where('created_at', '>=', filter.from_date);
      }
      if (filter.to_date) {
        query = query.where('created_at', '<=', filter.to_date);
      }
    }

    const row = await query.count('* as total').first();
    return Number(row?.total) || 0;
  }

  /**
   * Update job
   */
  async update(id: string, input: UpdateJobInput): Promise<Job | null> {
    const updateData: Partial<JobRow> = {};

    if (input.status !== undefined) {
      updateData.status = input.status;
    }
    if (input.priority !== undefined) {
      updateData.priority = input.priority;
    }
    if (input.completed_count !== undefined) {
      updateData.completed_count = input.completed_count;
    }
    if (input.failed_count !== undefined) {
      updateData.failed_count = input.failed_count;
    }
    if (input.started_at !== undefined) {
      updateData.started_at = input.started_at;
    }
    if (input.completed_at !== undefined) {
      updateData.completed_at = input.completed_at;
    }

    if (Object.keys(updateData).length === 0) {
      return this.findById(id);
    }

    updateData.updated_at = new Date();

    const [row] = await this.db('jobs')
      .where('id', id)
      .update(updateData)
      .returning('*');

    if (!row) return null;
    return jobFromRow(row as unknown as JobRow);
  }

  /**
   * Delete job (soft delete by setting status to cancelled)
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.db('jobs')
      .where('id', id)
      .update({ status: 'cancelled', updated_at: new Date() });
    return result > 0;
  }

  /**
   * Hard delete job
   */
  async hardDelete(id: string): Promise<boolean> {
    const result = await this.db('jobs').where('id', id).del();
    return result > 0;
  }

  /**
   * Increment completed count
   */
  async incrementCompletedCount(id: string): Promise<void> {
    await this.db('jobs')
      .where('id', id)
      .increment('completed_count', 1)
      .update({ updated_at: new Date() });
  }

  /**
   * Increment failed count
   */
  async incrementFailedCount(id: string): Promise<void> {
    await this.db('jobs')
      .where('id', id)
      .increment('failed_count', 1)
      .update({ updated_at: new Date() });
  }

  /**
   * Update job status
   */
  async updateStatus(
    id: string,
    status: 'pending' | 'processing' | 'completed' | 'failed'
  ): Promise<void> {
    const updateData: Partial<JobRow> = {
      status,
      updated_at: new Date(),
    };

    if (status === 'processing' && !updateData.started_at) {
      updateData.started_at = new Date();
    }

    if (status === 'completed') {
      updateData.completed_at = new Date();
    }

    await this.db('jobs').where('id', id).update(updateData);
  }

  /**
   * Get job statistics
   */
  async getStats(): Promise<JobStats> {
    const stats = await this.db('jobs')
      .select(
        this.db.raw('COUNT(*) as total_jobs'),
        this.db.raw("SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending"),
        this.db.raw("SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing"),
        this.db.raw("SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed"),
        this.db.raw("SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed"),
        this.db.raw("SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled"),
        this.db.raw('SUM(completed_count) as total_emails_sent'),
        this.db.raw('SUM(failed_count) as total_emails_failed')
      )
      .first();

    return {
      total_jobs: Number(stats?.total_jobs) || 0,
      pending: Number(stats?.pending) || 0,
      processing: Number(stats?.processing) || 0,
      completed: Number(stats?.completed) || 0,
      failed: Number(stats?.failed) || 0,
      cancelled: Number(stats?.cancelled) || 0,
      total_emails_sent: Number(stats?.total_emails_sent) || 0,
      total_emails_failed: Number(stats?.total_emails_failed) || 0,
    };
  }
}

/**
 * Create JobRepository instance
 */
export const createJobRepository = (db: Knex): JobRepository => {
  return new JobRepository(db);
};