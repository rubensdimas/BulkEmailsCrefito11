import type { Request, Response, NextFunction } from 'express';
import type { Knex } from 'knex';
import { addBulkEmailJobs, addEmailJob } from '../queue/emailQueue';
import { getEmailLogRepository, isDatabaseReady } from '../services/databaseService';
import { getDatabase } from '../config/database';
import { JobRepository } from '../repositories/jobRepository';
import { EmailLogRepository } from '../repositories/emailLogRepository';
import { sendEmails } from './sendController';
import { Job } from '../models/Job';
import { generateUniqueHash } from '../services/idempotencyService';

jest.mock('../queue/emailQueue', () => ({
  addEmailJob: jest.fn(),
  addBulkEmailJobs: jest.fn(),
}));
jest.mock('../services/databaseService', () => ({
  getEmailLogRepository: jest.fn(),
  isDatabaseReady: jest.fn(),
}));
jest.mock('../config/database', () => ({ getDatabase: jest.fn() }));

const persistedJob: Job = {
  id: '11111111-1111-1111-1111-111111111111',
  campaign_id: 'campaign-1',
  subject: 'Subject',
  html: '<p>Body</p>',
  text: null,
  from_address: 'sender@example.com',
  from_name: 'BulkMail Pro',
  reply_to: null,
  template_id: null,
  variables: null,
  status: 'pending',
  priority: 'normal',
  total_recipients: 2,
  valid_recipients: 2,
  invalid_recipients: 0,
  completed_count: 0,
  failed_count: 0,
  throttle_rate: 50,
  started_at: null,
  completed_at: null,
  created_at: new Date(),
  updated_at: new Date(),
};

const response = () => {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  return { status, json };
};

const request = (emails = ['one@example.com', 'two@example.com']): Request => ({
  body: {
    emails,
    subject: 'Subject',
    html: '<p>Body</p>',
    from: 'sender@example.com',
    campaignId: 'campaign-1',
  },
} as Request);

const queueSummary = (overrides: Record<string, number> = {}) => ({
  requested: 2,
  created: 2,
  waiting: 0,
  paused: 0,
  delayed: 0,
  active: 0,
  completed: 0,
  failed: 0,
  uncertain: 0,
  entries: [],
  ...overrides,
});

describe('sendEmails persistence ordering', () => {
  const next = jest.fn() as NextFunction;
  const transaction = jest.fn() as unknown as Knex.Transaction;
  const database = {
    transaction: jest.fn(async (callback) => callback(transaction)),
  } as unknown as Knex;

  beforeEach(() => {
    jest.clearAllMocks();
    (isDatabaseReady as jest.Mock).mockReturnValue(true);
    (getDatabase as jest.Mock).mockReturnValue(database);
    (getEmailLogRepository as jest.Mock).mockReturnValue({
      findStatesByUniqueHashes: jest.fn().mockResolvedValue(new Map()),
    });
    jest.spyOn(JobRepository.prototype, 'create').mockResolvedValue(persistedJob);
    jest.spyOn(JobRepository.prototype, 'updateStatus').mockResolvedValue();
    jest.spyOn(EmailLogRepository.prototype, 'createBatch').mockResolvedValue({
      requested: 2,
      inserted: 2,
      existing: 0,
    });
    (addBulkEmailJobs as jest.Mock).mockResolvedValue(queueSummary());
    (addEmailJob as jest.Mock).mockResolvedValue(queueSummary({ requested: 1, created: 1 }));
  });

  afterEach(() => jest.restoreAllMocks());

  it('does not touch Redis when the database is unavailable', async () => {
    (isDatabaseReady as jest.Mock).mockReturnValue(false);
    const res = response();

    await sendEmails(request(), res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(addBulkEmailJobs).not.toHaveBeenCalled();
    expect(addEmailJob).not.toHaveBeenCalled();
  });

  it('does not touch Redis when recipient persistence fails', async () => {
    jest.spyOn(EmailLogRepository.prototype, 'createBatch').mockRejectedValue(new Error('bind failed'));
    const res = response();

    await sendEmails(request(), res as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'bind failed' }));
    expect(addBulkEmailJobs).not.toHaveBeenCalled();
  });

  it('rejects reuse of a campaign id with a different payload', async () => {
    jest.spyOn(JobRepository.prototype, 'create').mockResolvedValue({
      ...persistedJob,
      subject: 'Different subject',
    });
    const res = response();

    await sendEmails(request(), res as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 409,
      message: 'Campaign ID already exists with a different payload',
    }));
    expect(addBulkEmailJobs).not.toHaveBeenCalled();
  });

  it('rejects reuse of a campaign id with different template variables', async () => {
    jest.spyOn(JobRepository.prototype, 'create').mockResolvedValue({
      ...persistedJob,
      variables: { name: 'Persisted' },
    });
    const req = request();
    req.body.variables = { name: 'Changed' };
    const res = response();

    await sendEmails(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 409,
      message: 'Campaign ID already exists with a different payload',
    }));
    expect(addBulkEmailJobs).not.toHaveBeenCalled();
  });

  it('returns a recoverable campaign id when queueing fails after commit', async () => {
    (addBulkEmailJobs as jest.Mock).mockRejectedValue(new Error('redis unavailable'));
    const res = response();

    await sendEmails(request(), res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      campaignId: 'campaign-1',
      jobId: persistedJob.id,
      retryable: true,
    }));
  });

  it('requires manual confirmation for failed database logs before touching Redis', async () => {
    const hash = generateUniqueHash('campaign-1', 'one@example.com', 'Subject', 'sender@example.com');
    (getEmailLogRepository as jest.Mock).mockReturnValue({
      findStatesByUniqueHashes: jest.fn().mockResolvedValue(new Map([[hash, 'failed']])),
    });
    jest.spyOn(JobRepository.prototype, 'findByCampaignId').mockResolvedValue(persistedJob);
    const res = response();

    await sendEmails(request(['one@example.com']), res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'CAMPAIGN_MANUAL_RETRY_REQUIRED',
      retryable: false,
    }));
    expect(addEmailJob).not.toHaveBeenCalled();
  });

  it('requires reconciliation when the deterministic Bull job is already completed', async () => {
    (addBulkEmailJobs as jest.Mock).mockResolvedValue(queueSummary({ created: 0, completed: 2 }));
    const res = response();

    await sendEmails(request(), res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'CAMPAIGN_RECONCILIATION_REQUIRED',
    }));
    expect(JobRepository.prototype.updateStatus).not.toHaveBeenCalled();
  });

  it('persists recipients before bulk queueing and returns 202', async () => {
    const res = response();

    await sendEmails(request(), res as unknown as Response, next);

    const persistOrder = (EmailLogRepository.prototype.createBatch as jest.Mock).mock.invocationCallOrder[0];
    const queueOrder = (addBulkEmailJobs as jest.Mock).mock.invocationCallOrder[0];
    expect(persistOrder).toBeLessThan(queueOrder);
    expect(addBulkEmailJobs).toHaveBeenCalledWith(expect.any(Array));
    expect(res.status).toHaveBeenCalledWith(202);
  });
});
