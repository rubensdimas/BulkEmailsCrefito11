import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  return knex.raw(`
    -- Initial schema for BulkMail Pro
    -- Updated to match Job and EmailLog models

    -- ======================
    -- Jobs table: stores email sending jobs/campaigns
    -- ======================
    CREATE TABLE IF NOT EXISTS jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        campaign_id VARCHAR(255) NOT NULL UNIQUE,
        subject VARCHAR(500) NOT NULL,
        html TEXT,
        text TEXT,
        from_address VARCHAR(255) NOT NULL,
        from_name VARCHAR(255),
        reply_to VARCHAR(255),
        template_id VARCHAR(255),
        variables JSONB,
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        priority VARCHAR(50) NOT NULL DEFAULT 'normal',
        total_recipients INTEGER NOT NULL DEFAULT 0,
        valid_recipients INTEGER NOT NULL DEFAULT 0,
        invalid_recipients INTEGER NOT NULL DEFAULT 0,
        completed_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        throttle_rate INTEGER NOT NULL DEFAULT 50,
        started_at TIMESTAMP WITH TIME ZONE,
        completed_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    -- Indexes for jobs table
    CREATE INDEX IF NOT EXISTS idx_jobs_campaign_id ON jobs(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_priority ON jobs(priority);
    CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);

    -- ======================
    -- Email logs table: tracks individual email sends
    -- ======================
    CREATE TABLE IF NOT EXISTS email_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        recipient_email VARCHAR(255) NOT NULL,
        subject VARCHAR(500) NOT NULL,
        from_address VARCHAR(255) NOT NULL,
        from_name VARCHAR(255),
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        error_message TEXT,
        error_code VARCHAR(50),
        unique_hash VARCHAR(64) NOT NULL UNIQUE,
        sent_at TIMESTAMP WITH TIME ZONE,
        opened_at TIMESTAMP WITH TIME ZONE,
        clicked_at TIMESTAMP WITH TIME ZONE,
        bounces_at TIMESTAMP WITH TIME ZONE,
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    -- Indexes for email_logs table
    CREATE INDEX IF NOT EXISTS idx_email_logs_job_id ON email_logs(job_id);
    CREATE INDEX IF NOT EXISTS idx_email_logs_recipient_email ON email_logs(recipient_email);
    CREATE INDEX IF NOT EXISTS idx_email_logs_unique_hash ON email_logs(unique_hash);
    CREATE INDEX IF NOT EXISTS idx_email_logs_status ON email_logs(status);
    CREATE INDEX IF NOT EXISTS idx_email_logs_created_at ON email_logs(created_at DESC);

    -- Composite index for idempotency check
    CREATE INDEX IF NOT EXISTS idx_email_logs_idempotency ON email_logs(job_id, recipient_email, subject, from_address);

    -- ======================
    -- Functions and Triggers
    -- ======================

    -- Function to auto-update updated_at timestamp
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
    END;
    $$ language 'plpgsql';

    -- Trigger for jobs
    DROP TRIGGER IF EXISTS update_jobs_updated_at ON jobs;
    CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON jobs
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    -- Trigger for email_logs
    DROP TRIGGER IF EXISTS update_email_logs_updated_at ON email_logs;
    CREATE TRIGGER update_email_logs_updated_at BEFORE UPDATE ON email_logs
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

    -- ======================
    -- Comments for documentation
    -- ======================
    COMMENT ON TABLE jobs IS 'Stores email sending jobs/campaigns';
    COMMENT ON TABLE email_logs IS 'Tracks individual email send attempts';
    COMMENT ON COLUMN jobs.campaign_id IS 'Unique campaign identifier for grouping emails';
    COMMENT ON COLUMN jobs.throttle_rate IS 'Maximum emails per minute';
    COMMENT ON COLUMN email_logs.unique_hash IS 'SHA256 hash for idempotency check: SHA256(job_id + recipient_email + subject + from_address)';
    COMMENT ON COLUMN email_logs.retry_count IS 'Number of retry attempts';
  `);
}

export async function down(knex: Knex): Promise<void> {
  return knex.raw(`
    DROP TABLE IF EXISTS email_logs;
    DROP TABLE IF EXISTS jobs;
    DROP FUNCTION IF EXISTS update_updated_at_column CASCADE;
  `);
}
