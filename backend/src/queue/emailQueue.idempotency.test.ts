import { generateUniqueHash } from '../services/idempotencyService';
import type { Queue } from 'bull';
import {
  buildBullJobs,
  EmailJobData,
  enqueueEmailJobs,
  getEmailJobId,
  retryFailedEmailJobs,
} from './emailQueue';

describe('getEmailJobId', () => {
  it('uses the explicit idempotency key', () => {
    expect(getEmailJobId({
      to: 'recipient@example.com',
      subject: 'Subject',
      html: '<p>Body</p>',
      campaignId: 'campaign-1',
      idempotencyKey: 'fixed-key',
    })).toBe('fixed-key');
  });

  it('derives a stable job id for legacy payloads', () => {
    const data = {
      to: 'recipient@example.com',
      subject: 'Subject',
      html: '<p>Body</p>',
      from: 'sender@example.com',
      campaignId: 'campaign-1',
    };

    expect(getEmailJobId(data)).toBe(generateUniqueHash(
      'campaign-1',
      'recipient@example.com',
      'Subject',
      'sender@example.com',
    ));
    expect(getEmailJobId(data)).toBe(getEmailJobId(data));
  });

  it('builds Bull payloads with deterministic ids and retry options', () => {
    const [job] = buildBullJobs([{
      to: 'recipient@example.com',
      subject: 'Subject',
      html: '<p>Body</p>',
      from: 'sender@example.com',
      campaignId: 'campaign-1',
    }]);

    expect(job.opts).toEqual(expect.objectContaining({
      attempts: 3,
      jobId: generateUniqueHash('campaign-1', 'recipient@example.com', 'Subject', 'sender@example.com'),
    }));
  });

  it('adds only missing jobs and reports terminal jobs without re-enqueueing them', async () => {
    const missing: EmailJobData = {
      to: 'missing@example.com',
      subject: 'Subject',
      html: '<p>Body</p>',
      campaignId: 'campaign-1',
    };
    const failed: EmailJobData = {
      ...missing,
      to: 'failed@example.com',
    };
    const addBulk = jest.fn().mockResolvedValue([{ id: getEmailJobId(missing) }]);
    const queue = {
      getJob: jest.fn(async (id: string) => (
        id === getEmailJobId(failed)
          ? { getState: jest.fn().mockResolvedValue('failed') }
          : null
      )),
      addBulk,
    } as unknown as Queue<EmailJobData>;

    const result = await enqueueEmailJobs([missing, failed], queue);

    expect(result).toMatchObject({ requested: 2, created: 1, failed: 1 });
    expect(addBulk).toHaveBeenCalledWith([expect.objectContaining({ data: missing })]);
  });

  it('retries only Bull jobs that are currently failed', async () => {
    const retry = jest.fn().mockResolvedValue(undefined);
    const queue = {
      getJob: jest.fn().mockResolvedValue({
        getState: jest.fn().mockResolvedValue('failed'),
        retry,
      }),
    } as unknown as Queue<EmailJobData>;

    await expect(retryFailedEmailJobs(['job-1'], queue)).resolves.toBe(1);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('skips Redis state lookups for ids verified absent by recovery dry-run', async () => {
    const data: EmailJobData = {
      to: 'new@example.com',
      subject: 'Subject',
      html: '<p>Body</p>',
      campaignId: 'campaign-1',
    };
    const id = getEmailJobId(data)!;
    const queue = {
      getJob: jest.fn(),
      addBulk: jest.fn().mockResolvedValue([{ id }]),
    } as unknown as Queue<EmailJobData>;

    const result = await enqueueEmailJobs([data], queue, { verifiedMissingJobIds: new Set([id]) });

    expect(result.created).toBe(1);
    expect(queue.getJob).not.toHaveBeenCalled();
  });
});
