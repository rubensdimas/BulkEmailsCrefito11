import type { Knex } from 'knex';
import { EmailLogRepository } from '../repositories/emailLogRepository';
import { JobRepository } from '../repositories/jobRepository';
import { Job } from '../models/Job';
import { EmailLog } from '../models/EmailLog';
import { addBulkEmailJobs } from '../queue/emailQueue';
import { generateUniqueHash } from './idempotencyService';
import {
  enqueueMissingPendingCampaign,
  QueueJobSnapshot,
  reconcileEmailJobs,
  retryFailedCampaign,
} from './emailJobReconciliationService';

jest.mock('../queue/emailQueue', () => ({
  ...jest.requireActual('../queue/emailQueue'),
  addBulkEmailJobs: jest.fn(),
}));

const campaign: Job = {
  id: '11111111-1111-1111-1111-111111111111',
  campaign_id: 'campaign-1',
  subject: 'Subject',
  html: '<p>Body</p>',
  text: null,
  from_address: 'sender@example.com',
  from_name: 'Sender',
  reply_to: null,
  template_id: null,
  variables: null,
  status: 'processing',
  priority: 'normal',
  total_recipients: 1,
  valid_recipients: 1,
  invalid_recipients: 0,
  completed_count: 0,
  failed_count: 0,
  throttle_rate: 50,
  started_at: new Date(),
  completed_at: null,
  created_at: new Date(),
  updated_at: new Date(),
};

const completedSnapshot = (): QueueJobSnapshot => ({
  id: '1',
  state: 'completed',
  data: {
    to: 'recipient@example.com',
    subject: 'Subject',
    html: '<p>Body</p>',
    from: 'sender@example.com',
    campaignId: 'campaign-1',
  },
  attemptsMade: 1,
  finishedOn: Date.now(),
  returnvalue: {
    success: true,
    messageId: 'mailgrid-1',
    timestamp: new Date().toISOString(),
    attempts: 1,
  },
});

const log = (status: EmailLog['status'], uniqueHash: string): EmailLog => ({
  id: '22222222-2222-2222-2222-222222222222',
  job_id: campaign.id,
  recipient_email: 'recipient@example.com',
  subject: campaign.subject,
  from_address: campaign.from_address,
  from_name: campaign.from_name,
  status,
  error_message: status === 'failed' ? 'failed' : null,
  error_code: null,
  unique_hash: uniqueHash,
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
  retry_count: 1,
  created_at: new Date(),
  updated_at: new Date(),
});

const dependencies = (overrides: {
  findJob?: jest.Mock;
  findAllJobs?: jest.Mock;
  findLogs?: jest.Mock;
  transaction?: jest.Mock;
} = {}) => ({
  database: {
    transaction: overrides.transaction || jest.fn(),
  } as unknown as Knex,
  jobRepository: {
    findByCampaignId: overrides.findJob || jest.fn().mockResolvedValue(campaign),
    findAll: overrides.findAllJobs || jest.fn().mockResolvedValue([campaign]),
    updateStatus: jest.fn().mockResolvedValue(undefined),
  } as unknown as JobRepository,
  emailLogRepository: {
    findByJobId: overrides.findLogs || jest.fn().mockResolvedValue([]),
  } as unknown as EmailLogRepository,
});

describe('reconcileEmailJobs', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it('reports recoverable completed jobs without writing in dry-run mode', async () => {
    const deps = dependencies();

    const report = await reconcileEmailJobs([completedSnapshot()], false, deps);

    expect(report.blocked).toBe(false);
    expect(report.totals).toMatchObject({ queueJobs: 1, missingLogs: 1, inserted: 0 });
    expect(report.campaigns[0]).toMatchObject({ completed: 1, uncertain: 0, missingLogs: 1 });
    expect(deps.database.transaction).not.toHaveBeenCalled();
  });

  it('keeps a webhook-delivered log compatible with a completed Bull send', async () => {
    const hash = generateUniqueHash(
      'campaign-1',
      'recipient@example.com',
      'Subject',
      'sender@example.com',
    );
    const deps = dependencies({ findLogs: jest.fn().mockResolvedValue([log('delivered', hash)]) });

    const report = await reconcileEmailJobs([completedSnapshot()], false, deps);

    expect(report.blocked).toBe(false);
    expect(report.campaigns[0]).toMatchObject({ completed: 1, missingLogs: 0 });
  });

  it('blocks active jobs because their provider delivery state is uncertain', async () => {
    const snapshot = { ...completedSnapshot(), state: 'active' as const, returnvalue: null };

    const report = await reconcileEmailJobs([snapshot], false, dependencies());

    expect(report.blocked).toBe(true);
    expect(report.totals.uncertain).toBe(1);
    expect(report.campaigns[0].blockers).toContain('1 job(s) have an uncertain delivery state');
  });

  it('applies missing logs and summary updates in one transaction', async () => {
    const queryUpdate = jest.fn().mockResolvedValue(1);
    const transaction = Object.assign(
      jest.fn(() => ({ where: jest.fn(() => ({ update: queryUpdate })) })),
      {},
    ) as unknown as Knex.Transaction;
    const transactionRunner = jest.fn(async (callback) => callback(transaction));
    jest.spyOn(EmailLogRepository.prototype, 'createBatch').mockResolvedValue({
      requested: 1,
      inserted: 1,
      existing: 0,
    });
    jest.spyOn(JobRepository.prototype, 'update').mockResolvedValue(campaign);

    const report = await reconcileEmailJobs([completedSnapshot()], true, dependencies({ transaction: transactionRunner }));

    expect(report.blocked).toBe(false);
    expect(report.totals.inserted).toBe(1);
    expect(transactionRunner).toHaveBeenCalledTimes(1);
    expect(queryUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'sent',
      mailgrid_message_id: 'mailgrid-1',
    }));
  });

  it('reports a persisted pending campaign that has no Bull jobs', async () => {
    const report = await reconcileEmailJobs([], false, dependencies());

    expect(report.blocked).toBe(true);
    expect(report.campaigns[0].blockers).toEqual(['Persisted pending campaign has no Bull jobs']);
  });

  it('blocks payload and idempotency-key divergence', async () => {
    const snapshot = completedSnapshot();
    snapshot.data.html = '<p>Different</p>';
    snapshot.data.idempotencyKey = 'not-the-payload-hash';

    const report = await reconcileEmailJobs([snapshot], false, dependencies());

    expect(report.blocked).toBe(true);
    expect(report.campaigns[0].blockers).toEqual(expect.arrayContaining([
      'Bull job payload does not match the persisted campaign',
      'Bull job idempotency key does not match its persisted payload',
    ]));
  });

  it('scopes database-only checks to the requested campaign', async () => {
    const findAllJobs = jest.fn().mockResolvedValue([campaign]);

    await reconcileEmailJobs([], false, dependencies({ findAllJobs }), { campaignId: 'campaign-1' });

    expect(findAllJobs).toHaveBeenCalledWith({ campaign_id: 'campaign-1' });
  });

  it('allows enqueue-missing only for a scoped database-only pending campaign', async () => {
    const pendingLog = log('pending', 'pending-hash');
    const deps = dependencies({ findLogs: jest.fn().mockResolvedValue([pendingLog]) });
    (addBulkEmailJobs as jest.Mock).mockResolvedValue({
      requested: 1,
      created: 1,
      waiting: 0,
      paused: 0,
      delayed: 0,
      active: 0,
      completed: 0,
      failed: 0,
      uncertain: 0,
      entries: [],
    });
    const result = await enqueueMissingPendingCampaign('campaign-1', 'campaign-1', [], deps);

    expect(result).toEqual({ campaignId: 'campaign-1', queued: 1 });
  });

  it('moves matching failed logs to pending before retrying Bull jobs', async () => {
    const snapshot: QueueJobSnapshot = {
      ...completedSnapshot(),
      id: 'failed-job',
      state: 'failed',
      returnvalue: null,
      failedReason: 'provider rejected',
    };
    const hash = snapshot.data.idempotencyKey || generateUniqueHash(
      'campaign-1',
      'recipient@example.com',
      'Subject',
      'sender@example.com',
    );
    const queryUpdate = jest.fn().mockResolvedValue(1);
    const transaction = Object.assign(
      jest.fn(() => ({ whereIn: jest.fn(() => ({ update: queryUpdate })) })),
      {},
    ) as unknown as Knex.Transaction;
    const transactionRunner = jest.fn(async (callback) => callback(transaction));
    const retryJobs = jest.fn().mockResolvedValue(1);
    jest.spyOn(JobRepository.prototype, 'update').mockResolvedValue(campaign);

    const result = await retryFailedCampaign(
      'campaign-1',
      'campaign-1',
      [snapshot],
      dependencies({
        findLogs: jest.fn().mockResolvedValue([log('failed', hash)]),
        transaction: transactionRunner,
      }),
      retryJobs,
    );

    expect(queryUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
    expect(retryJobs).toHaveBeenCalledWith(['failed-job']);
    expect(result.retried).toBe(1);
  });
});
