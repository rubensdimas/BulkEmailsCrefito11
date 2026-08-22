import knex, { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { EmailLogRepository } from './emailLogRepository';
import { JobRepository } from './jobRepository';
import { generateUniqueHash } from '../services/idempotencyService';
import type { ImportedEmailStatusUpdate } from '../models/EmailLog';
import type { Job } from '../models/Job';

const describeDatabase = process.env.RUN_DATABASE_INTEGRATION === 'true' ? describe : describe.skip;

describeDatabase('EmailLogRepository PostgreSQL integration', () => {
  let database: Knex;
  const jobIds: string[] = [];

  beforeAll(async () => {
    database = knex({
      client: 'pg',
      connection: {
        host: process.env.POSTGRES_HOST || '127.0.0.1',
        port: Number(process.env.POSTGRES_PORT || 5432),
        user: process.env.POSTGRES_USER || 'bulkmail',
        password: process.env.POSTGRES_PASSWORD || 'bulkmail123',
        database: process.env.POSTGRES_DB || 'bulkmail',
      },
      pool: { min: 0, max: 4 },
    });
    await database.raw('select 1');
  });

  afterAll(async () => {
    if (jobIds.length > 0) await database('jobs').whereIn('id', jobIds).delete();
    await database.destroy();
  });

  const createJob = async (recipients: number) => {
    const campaignId = `integration-${uuidv4()}`;
    const job = await new JobRepository(database).create({
      campaign_id: campaignId,
      subject: 'Integration subject',
      html: '<p>Integration</p>',
      from_address: 'integration@example.com',
      total_recipients: recipients,
      valid_recipients: recipients,
      invalid_recipients: 0,
    });
    jobIds.push(job.id);
    return job;
  };

  const seedSentLogs = async (job: Job, prefix: string, count: number): Promise<void> => {
    const repository = new EmailLogRepository(database);
    const inputs = Array.from({ length: count }, (_, index) => {
      const recipient = `${prefix}-${index}@example.com`;
      return {
        job_id: job.id,
        recipient_email: recipient,
        subject: job.subject,
        from_address: job.from_address,
        unique_hash: generateUniqueHash(job.campaign_id, recipient, job.subject, job.from_address),
      };
    });
    await repository.createBatch(inputs);
    await database('email_logs').where('job_id', job.id).update({
      status: 'sent',
      sent_at: new Date('2026-08-21T15:00:00Z'),
      mailgrid_message_id: database.raw(`'msg-' || split_part(recipient_email, '@', 1)`),
    });
  };

  const importedUpdate = (
    messageId: string,
    recipient: string,
    overrides: Partial<ImportedEmailStatusUpdate> = {},
  ): ImportedEmailStatusUpdate => ({
    messageId,
    recipient,
    status: 'delivered',
    statusCode: 1,
    statusMessage: 'Entregue',
    sentAt: new Date('2026-08-21T16:00:00Z'),
    eventAt: new Date('2026-08-21T18:00:00Z'),
    sourceRow: 2,
    ...overrides,
  });

  it('persists 3,908 recipients in bounded chunks and remains idempotent', async () => {
    const job = await createJob(3908);
    const inputs = Array.from({ length: 3908 }, (_, index) => ({
      job_id: job.id,
      recipient_email: `integration-${index}@example.com`,
      subject: job.subject,
      from_address: job.from_address,
      unique_hash: generateUniqueHash(job.campaign_id, `integration-${index}@example.com`, job.subject, job.from_address),
    }));
    const repository = new EmailLogRepository(database);

    await expect(repository.createBatch(inputs)).resolves.toEqual({
      requested: 3908,
      inserted: 3908,
      existing: 0,
    });
    await expect(repository.createBatch(inputs)).resolves.toEqual({
      requested: 3908,
      inserted: 0,
      existing: 3908,
    });
    await expect(database('email_logs').where('job_id', job.id).count<{ count: string }[]>({ count: '*' }).first())
      .resolves.toMatchObject({ count: '3908' });
  }, 30000);

  it('rolls back earlier chunks when a later chunk fails', async () => {
    const job = await createJob(1500);
    const inputs = Array.from({ length: 1500 }, (_, index) => ({
      job_id: job.id,
      recipient_email: `rollback-${index}@example.com`,
      subject: index === 1200 ? 'x'.repeat(501) : job.subject,
      from_address: job.from_address,
      unique_hash: generateUniqueHash(job.campaign_id, `rollback-${index}@example.com`, job.subject, job.from_address),
    }));

    await expect(new EmailLogRepository(database).createBatch(inputs)).rejects.toThrow();
    const count = await database('email_logs').where('job_id', job.id).count<{ count: string }[]>({ count: '*' }).first();
    expect(Number(count?.count)).toBe(0);
  }, 30000);

  it('applies a 3,907-row status import with set-based updates and remains idempotent', async () => {
    const count = 3907;
    const job = await createJob(count);
    await seedSentLogs(job, 'bulk-status', count);
    const updates = Array.from({ length: count }, (_, index) => importedUpdate(
      `msg-bulk-status-${index}`,
      `bulk-status-${index}@example.com`,
      { sourceRow: index + 2 },
    ));
    const repository = new EmailLogRepository(database);

    await expect(repository.applyImportedStatuses(job.id, updates)).resolves.toEqual({
      updated: count,
      unchanged: 0,
      ignoredStale: 0,
      notFound: 0,
      otherCampaign: 0,
      recipientMismatch: 0,
    });
    await expect(repository.applyImportedStatuses(job.id, updates)).resolves.toEqual({
      updated: 0,
      unchanged: count,
      ignoredStale: 0,
      notFound: 0,
      otherCampaign: 0,
      recipientMismatch: 0,
    });
    const persisted = await database('email_logs')
      .where({ job_id: job.id, status: 'delivered' })
      .count<{ count: string }[]>({ count: '*' })
      .first();
    expect(Number(persisted?.count)).toBe(count);
  }, 30000);

  it('classifies unknown, cross-campaign, mismatched and stale rows without creating data', async () => {
    const job = await createJob(3);
    const otherJob = await createJob(1);
    await seedSentLogs(job, 'class-target', 3);
    await seedSentLogs(otherJob, 'class-other', 1);
    await database('email_logs').where('mailgrid_message_id', 'msg-class-target-2').update({
      status: 'delivered',
      mailgrid_event_at: new Date('2026-08-21T20:00:00Z'),
      mailgrid_status_code: 1,
      mailgrid_status_message: 'Entregue mais tarde',
    });
    const repository = new EmailLogRepository(database);
    const beforeCount = await database('email_logs').count<{ count: string }[]>({ count: '*' }).first();

    await expect(repository.applyImportedStatuses(job.id, [
      importedUpdate('msg-class-target-0', 'class-target-0@example.com'),
      importedUpdate('msg-class-target-1', 'wrong@example.com'),
      importedUpdate('msg-class-target-2', 'class-target-2@example.com'),
      importedUpdate('msg-missing', 'missing@example.com'),
      importedUpdate('msg-class-other-0', 'class-other-0@example.com'),
    ])).resolves.toEqual({
      updated: 1,
      unchanged: 0,
      ignoredStale: 1,
      notFound: 1,
      otherCampaign: 1,
      recipientMismatch: 1,
    });

    const afterCount = await database('email_logs').count<{ count: string }[]>({ count: '*' }).first();
    expect(afterCount?.count).toBe(beforeCount?.count);
  });

  it('rolls back the complete status import when the set-based update fails', async () => {
    const job = await createJob(2);
    await seedSentLogs(job, 'status-rollback', 2);
    const updates = [
      importedUpdate('msg-status-rollback-0', 'status-rollback-0@example.com'),
      importedUpdate('msg-status-rollback-1', 'status-rollback-1@example.com', { statusCode: 9 as 1 }),
    ];

    await expect(new EmailLogRepository(database).applyImportedStatuses(job.id, updates)).rejects.toThrow();
    const rows = await database('email_logs')
      .where('job_id', job.id)
      .select('status', 'mailgrid_event_at');
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === 'sent' && row.mailgrid_event_at === null)).toBe(true);
  });

  it('prevents a delayed webhook from overwriting a newer locked event', async () => {
    const job = await createJob(1);
    await seedSentLogs(job, 'webhook-race', 1);
    const repository = new EmailLogRepository(database);
    const lock = await database.transaction();
    const lockedRow = await lock('email_logs')
      .where('mailgrid_message_id', 'msg-webhook-race-0')
      .forUpdate()
      .first();
    expect(lockedRow).toBeDefined();

    const delayedWebhook = repository.applyMailgridWebhook('msg-webhook-race-0', {
      status: 'hard_bounce',
      statusCode: 0,
      statusMessage: '550 recipient rejected',
      sentAt: new Date('2026-08-21T16:00:00Z'),
      eventAt: new Date('2026-08-21T18:00:00Z'),
      receivedAt: new Date('2026-08-21T18:01:00Z'),
      payload: { source: 'integration-test' },
    });
    await lock('email_logs').where('id', lockedRow.id).update({
      status: 'delivered',
      mailgrid_event_at: new Date('2026-08-21T20:00:00Z'),
      mailgrid_status_code: 1,
      mailgrid_status_message: 'Entregue',
    });
    await lock.commit();

    await expect(delayedWebhook).resolves.toBe('ignored');
    const persisted = await database('email_logs').where('id', lockedRow.id).first();
    expect(persisted).toMatchObject({ status: 'delivered', mailgrid_status_code: 1 });
    expect(new Date(persisted.mailgrid_event_at).toISOString()).toBe('2026-08-21T20:00:00.000Z');
  });

  it('filters recipients and status before counting and paginating', async () => {
    const job = await createJob(4);
    const repository = new EmailLogRepository(database);
    const recipients = [
      'filter-one@example.com',
      'filter-two@example.com',
      'filter-three@example.com',
      'filter-four@example.com',
    ];
    await repository.createBatch(recipients.map((recipient) => ({
      job_id: job.id,
      recipient_email: recipient,
      subject: job.subject,
      from_address: job.from_address,
      unique_hash: generateUniqueHash(job.campaign_id, recipient, job.subject, job.from_address),
    })));
    await database('email_logs')
      .where({ job_id: job.id, recipient_email: recipients[0] })
      .update({ status: 'delivered' });
    await database('email_logs')
      .where({ job_id: job.id, recipient_email: recipients[1] })
      .update({ status: 'delivered' });
    await database('email_logs')
      .where({ job_id: job.id, recipient_email: recipients[2] })
      .update({ status: 'hard_bounce' });

    const deliveredPage = await repository.findPageByJobId(job.id, 1, 1, {
      status: 'delivered',
    });
    expect(deliveredPage.total).toBe(2);
    expect(deliveredPage.data).toHaveLength(1);
    expect(deliveredPage.data[0].status).toBe('delivered');

    const combined = await repository.findPageByJobId(job.id, 1, 100, {
      recipient: recipients[2],
      status: 'hard_bounce',
    });
    expect(combined.total).toBe(1);
    expect(combined.data[0].recipient_email).toBe(recipients[2]);

    await expect(repository.findPageByJobId(job.id, 1, 100, {
      recipient: recipients[2],
      status: 'delivered',
    })).resolves.toMatchObject({ total: 0, data: [] });
  });
});
