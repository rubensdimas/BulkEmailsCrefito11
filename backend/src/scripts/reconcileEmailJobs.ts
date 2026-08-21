import type { Job } from 'bull';
import { getDatabase } from '../config/database';
import {
  EmailJobData,
  EmailJobResult,
  getEmailQueue,
  retryFailedEmailJobs,
} from '../queue/emailQueue';
import { getEmailLogRepository, getJobRepository, initializeDatabase, shutdownDatabase } from '../services/databaseService';
import {
  createQueueJobSnapshot,
  enqueueMissingPendingCampaign,
  QueueJobSnapshot,
  ReconciliationQueueState,
  reconcileEmailJobs,
  retryFailedCampaign,
} from '../services/emailJobReconciliationService';

const PAGE_SIZE = 1000;

const loadState = async (
  state: ReconciliationQueueState,
  fetchPage: (start: number, end: number) => Promise<Array<Job<EmailJobData>>>,
): Promise<QueueJobSnapshot[]> => {
  const snapshots: QueueJobSnapshot[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const jobs = await fetchPage(start, start + PAGE_SIZE - 1);
    snapshots.push(...jobs.map((job) => createQueueJobSnapshot(state, {
      ...job,
      returnvalue: job.returnvalue as EmailJobResult | null,
    })));
    if (jobs.length < PAGE_SIZE) break;
  }
  return snapshots;
};

const main = async (): Promise<void> => {
  const actions = ['--dry-run', '--apply', '--enqueue-missing', '--retry-failed']
    .filter((action) => process.argv.includes(action));
  if (actions.length !== 1) {
    throw new Error('Choose exactly one action: --dry-run, --apply, --enqueue-missing or --retry-failed');
  }
  const action = actions[0];
  const apply = action === '--apply';
  const enqueueMissing = process.argv.includes('--enqueue-missing');
  const retryFailed = process.argv.includes('--retry-failed');
  const campaignId = process.argv.find((argument) => argument.startsWith('--campaign='))?.slice('--campaign='.length);
  const confirmation = process.argv
    .find((argument) => argument.startsWith('--confirm-provider-unsent='))
    ?.slice('--confirm-provider-unsent='.length);
  const validArgument = (argument: string): boolean => (
    ['--apply', '--dry-run', '--enqueue-missing', '--retry-failed'].includes(argument)
    || argument.startsWith('--campaign=')
    || argument.startsWith('--confirm-provider-unsent=')
    || argument === process.argv[0]
    || argument === process.argv[1]
  );
  if (process.argv.some((argument) => !validArgument(argument))) {
    throw new Error('Usage: reconcile:email-jobs -- --dry-run|--apply [--campaign=ID] | --enqueue-missing|--retry-failed --campaign=ID --confirm-provider-unsent=ID');
  }
  if ((enqueueMissing || retryFailed) && (!campaignId || !confirmation)) {
    throw new Error('Manual queue actions require --campaign=ID and --confirm-provider-unsent=ID');
  }

  let queue: ReturnType<typeof getEmailQueue> | null = null;
  try {
    await initializeDatabase();
    queue = getEmailQueue();
    const snapshots = (await Promise.all([
      loadState('waiting', (start, end) => queue!.getWaiting(start, end)),
      loadState('delayed', (start, end) => queue!.getDelayed(start, end)),
      loadState('completed', (start, end) => queue!.getCompleted(start, end)),
      loadState('failed', (start, end) => queue!.getFailed(start, end)),
      loadState('active', (start, end) => queue!.getActive(start, end)),
    ])).flat();

    const dependencies = {
      database: getDatabase(),
      jobRepository: getJobRepository(),
      emailLogRepository: getEmailLogRepository(),
    };
    const report = await reconcileEmailJobs(
      snapshots,
      apply,
      dependencies,
      campaignId ? { campaignId } : {},
    );
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

    if (enqueueMissing && campaignId && confirmation) {
      const result = await enqueueMissingPendingCampaign(
        campaignId,
        confirmation,
        snapshots,
        dependencies,
      );
      process.stdout.write(`${JSON.stringify({ enqueueMissing: result }, null, 2)}\n`);
    } else if (retryFailed && campaignId && confirmation) {
      const result = await retryFailedCampaign(
        campaignId,
        confirmation,
        snapshots,
        dependencies,
        (jobIds) => retryFailedEmailJobs(jobIds, queue!),
      );
      process.stdout.write(`${JSON.stringify({ retryFailed: result }, null, 2)}\n`);
    } else if (report.blocked) {
      process.exitCode = 2;
    }
  } finally {
    if (queue) await queue.close().catch(() => undefined);
    await shutdownDatabase().catch(() => undefined);
  }
};

main().catch((error) => {
  console.error('Email job reconciliation failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
