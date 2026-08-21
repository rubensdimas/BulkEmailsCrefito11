import Bull, { Queue } from 'bull';
import { v4 as uuidv4 } from 'uuid';
import { EmailJobData, enqueueEmailJobs } from './emailQueue';

const describeRedis = process.env.RUN_REDIS_INTEGRATION === 'true' ? describe : describe.skip;

describeRedis('email queue Redis integration', () => {
  let queue: Queue<EmailJobData>;

  beforeAll(() => {
    queue = Bull(`email-queue-integration-${uuidv4()}`, {
      redis: {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: Number(process.env.REDIS_PORT || 6379),
      },
    });
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
  });

  it('does not add a second Bull job for the same deterministic id', async () => {
    const data: EmailJobData = {
      to: 'redis-integration@example.com',
      subject: 'Integration subject',
      html: '<p>Integration</p>',
      from: 'integration@example.com',
      campaignId: `campaign-${uuidv4()}`,
    };

    const first = await enqueueEmailJobs([data], queue);
    const second = await enqueueEmailJobs([data], queue);

    expect(first).toMatchObject({ created: 1, waiting: 0 });
    expect(second).toMatchObject({ created: 0, waiting: 1 });
    await expect(queue.getWaitingCount()).resolves.toBe(1);
  });
});
