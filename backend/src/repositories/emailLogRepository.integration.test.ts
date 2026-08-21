import knex, { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { EmailLogRepository } from './emailLogRepository';
import { JobRepository } from './jobRepository';
import { generateUniqueHash } from '../services/idempotencyService';

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
});
