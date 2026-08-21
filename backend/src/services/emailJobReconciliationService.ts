import type { Knex } from 'knex';
import { addBulkEmailJobs, EmailJobData, EmailJobResult } from '../queue/emailQueue';
import { EmailLogStatus, CreateEmailLogInput } from '../models/EmailLog';
import { Job } from '../models/Job';
import { EmailLogRepository } from '../repositories/emailLogRepository';
import { JobRepository } from '../repositories/jobRepository';
import { generateUniqueHash } from './idempotencyService';

export type ReconciliationQueueState = 'waiting' | 'delayed' | 'completed' | 'failed' | 'active';

export interface QueueJobSnapshot {
  id: string;
  state: ReconciliationQueueState;
  data: EmailJobData;
  attemptsMade: number;
  finishedOn?: number;
  failedReason?: string;
  returnvalue?: EmailJobResult | null;
}

interface PlannedLog {
  snapshot: QueueJobSnapshot;
  uniqueHash: string;
  status: EmailLogStatus | 'uncertain';
  messageId?: string;
  error?: string;
  eventAt?: Date;
}

export interface CampaignReconciliationReport {
  campaignId: string;
  expected: number;
  queueJobs: number;
  databaseLogs: number;
  missingLogs: number;
  completed: number;
  failed: number;
  pending: number;
  uncertain: number;
  inserted: number;
  blockers: string[];
}

export interface ReconciliationReport {
  mode: 'dry-run' | 'apply';
  blocked: boolean;
  totals: {
    queueJobs: number;
    campaigns: number;
    missingLogs: number;
    inserted: number;
    uncertain: number;
  };
  campaigns: CampaignReconciliationReport[];
}

export interface ReconciliationDependencies {
  database: Knex;
  jobRepository: JobRepository;
  emailLogRepository: EmailLogRepository;
}

export interface ReconciliationOptions {
  campaignId?: string;
}

export interface EnqueueMissingResult {
  campaignId: string;
  queued: number;
}

export interface RetryFailedResult {
  campaignId: string;
  retried: number;
}

const successfulStatuses = new Set<EmailLogStatus>([
  'sent',
  'delivered',
  'soft_bounce',
  'hard_bounce',
]);

const eventDate = (timestamp: string | number | undefined): Date => {
  const candidate = timestamp ? new Date(timestamp) : new Date();
  return Number.isNaN(candidate.getTime()) ? new Date() : candidate;
};

const classifySnapshot = (snapshot: QueueJobSnapshot): Omit<PlannedLog, 'uniqueHash'> => {
  if (snapshot.state === 'active') {
    return { snapshot, status: 'uncertain', error: 'Job was active when the stack stopped' };
  }
  if (snapshot.state === 'completed') {
    const result = snapshot.returnvalue;
    if (!result || typeof result.success !== 'boolean') {
      return { snapshot, status: 'uncertain', error: 'Completed job has no trustworthy result' };
    }
    const eventAt = eventDate(result.timestamp || snapshot.finishedOn);
    if (result.success) {
      return { snapshot, status: 'sent', messageId: result.messageId, eventAt };
    }
    return { snapshot, status: 'failed', error: result.error || 'Email provider rejected the job', eventAt };
  }
  if (snapshot.state === 'failed') {
    return {
      snapshot,
      status: 'failed',
      error: snapshot.failedReason || 'Bull job failed',
      eventAt: snapshot.finishedOn ? new Date(snapshot.finishedOn) : undefined,
    };
  }
  return { snapshot, status: 'pending' };
};

const buildPlannedLog = (snapshot: QueueJobSnapshot): PlannedLog | null => {
  const { data } = snapshot;
  if (!data.campaignId || !data.to || !data.subject) return null;
  const sender = data.from || process.env.MAILGRID_SENDER || process.env.SMTP_SENDER || 'noreply@bulkmail.com';
  return {
    ...classifySnapshot(snapshot),
    uniqueHash: generateUniqueHash(data.campaignId, data.to, data.subject, sender),
  };
};

const hasValidIdempotencyKey = (snapshot: QueueJobSnapshot): boolean => {
  if (!snapshot.data.idempotencyKey) return true;
  const planned = buildPlannedLog(snapshot);
  return planned !== null && snapshot.data.idempotencyKey === planned.uniqueHash;
};

const countStatuses = (statuses: EmailLogStatus[]): { completed: number; failed: number; pending: number } => ({
  completed: statuses.filter((status) => successfulStatuses.has(status)).length,
  failed: statuses.filter((status) => ['failed', 'bounced'].includes(status)).length,
  pending: statuses.filter((status) => ['pending', 'processing'].includes(status)).length,
});

export const reconcileEmailJobs = async (
  snapshots: QueueJobSnapshot[],
  apply: boolean,
  dependencies: ReconciliationDependencies,
  options: ReconciliationOptions = {},
): Promise<ReconciliationReport> => {
  const relevantSnapshots = options.campaignId
    ? snapshots.filter((snapshot) => snapshot.data.campaignId === options.campaignId)
    : snapshots;
  const byCampaign = new Map<string, QueueJobSnapshot[]>();
  const malformed = options.campaignId
    ? []
    : relevantSnapshots.filter((snapshot) => !snapshot.data.campaignId);
  for (const snapshot of relevantSnapshots) {
    if (!snapshot.data.campaignId) continue;
    const jobs = byCampaign.get(snapshot.data.campaignId) || [];
    jobs.push(snapshot);
    byCampaign.set(snapshot.data.campaignId, jobs);
  }

  const campaigns: CampaignReconciliationReport[] = [];
  for (const [campaignId, campaignSnapshots] of byCampaign) {
    const blockers: string[] = [];
    const job = await dependencies.jobRepository.findByCampaignId(campaignId);
    if (!job) {
      campaigns.push({
        campaignId,
        expected: 0,
        queueJobs: campaignSnapshots.length,
        databaseLogs: 0,
        missingLogs: campaignSnapshots.length,
        completed: 0,
        failed: 0,
        pending: 0,
        uncertain: campaignSnapshots.length,
        inserted: 0,
        blockers: ['Campaign has Bull jobs but no jobs row'],
      });
      continue;
    }

    if (campaignSnapshots.some((snapshot) => !campaignMatchesQueueData(job, snapshot.data))) {
      blockers.push('Bull job payload does not match the persisted campaign');
    }
    if (campaignSnapshots.some((snapshot) => !hasValidIdempotencyKey(snapshot))) {
      blockers.push('Bull job idempotency key does not match its persisted payload');
    }

    const existingLogs = await dependencies.emailLogRepository.findByJobId(job.id);
    const existingByHash = new Map(existingLogs.map((log) => [log.unique_hash, log]));
    const planned = campaignSnapshots.map(buildPlannedLog);
    if (planned.some((item) => item === null)) blockers.push('One or more Bull jobs have incomplete email data');
    const validPlanned = planned.filter((item): item is PlannedLog => item !== null);
    const uniquePlanned = new Map<string, PlannedLog>();
    for (const item of validPlanned) {
      if (uniquePlanned.has(item.uniqueHash)) blockers.push(`Duplicate Bull job for hash ${item.uniqueHash}`);
      uniquePlanned.set(item.uniqueHash, item);
    }

    for (const item of uniquePlanned.values()) {
      const existing = existingByHash.get(item.uniqueHash);
      const compatibleTerminalState = existing && (
        existing.status === item.status
        || (item.status === 'sent' && successfulStatuses.has(existing.status))
        || (item.status === 'failed' && ['failed', 'bounced'].includes(existing.status))
      );
      if (
        existing
        && item.status !== 'uncertain'
        && !compatibleTerminalState
        && (item.status === 'sent' || item.status === 'failed')
      ) {
        blockers.push(`Existing log ${item.uniqueHash} conflicts with Bull state ${item.status}`);
      }
    }

    const uncertain = validPlanned.filter((item) => item.status === 'uncertain').length;
    if (uncertain > 0) blockers.push(`${uncertain} job(s) have an uncertain delivery state`);

    const observedHashes = new Set([...existingByHash.keys(), ...uniquePlanned.keys()]);
    if (observedHashes.size !== job.valid_recipients) {
      blockers.push(`Expected ${job.valid_recipients} recipients but recovered ${observedHashes.size}`);
    }

    const missing = [...uniquePlanned.values()].filter((item) => !existingByHash.has(item.uniqueHash));
    const projectedStatuses: EmailLogStatus[] = [
      ...existingLogs.map((log) => log.status),
      ...missing.filter((item) => item.status !== 'uncertain').map((item) => item.status as EmailLogStatus),
    ];
    const statusCounts = countStatuses(projectedStatuses);
    let inserted = 0;

    if (apply && blockers.length === 0) {
      inserted = await dependencies.database.transaction(async (transaction) => {
        const emailLogRepository = new EmailLogRepository(transaction);
        const jobRepository = new JobRepository(transaction);
        const inputs: CreateEmailLogInput[] = missing.map((item) => ({
          job_id: job.id,
          recipient_email: item.snapshot.data.to.toLowerCase(),
          subject: item.snapshot.data.subject,
          from_address: item.snapshot.data.from || job.from_address,
          from_name: job.from_name,
          unique_hash: item.uniqueHash,
        }));
        const batch = await emailLogRepository.createBatch(inputs, transaction);

        for (const item of missing) {
          if (item.status === 'sent') {
            await transaction('email_logs').where('unique_hash', item.uniqueHash).update({
              status: 'sent',
              mailgrid_message_id: item.messageId || null,
              sent_at: item.eventAt || new Date(),
              retry_count: item.snapshot.attemptsMade,
              updated_at: new Date(),
            });
          } else if (item.status === 'failed') {
            await transaction('email_logs').where('unique_hash', item.uniqueHash).update({
              status: 'failed',
              error_message: item.error || 'Email job failed',
              retry_count: item.snapshot.attemptsMade,
              updated_at: new Date(),
            });
          }
        }

        const terminal = statusCounts.completed + statusCounts.failed;
        await jobRepository.update(job.id, {
          completed_count: statusCounts.completed,
          failed_count: statusCounts.failed,
          status: terminal === job.valid_recipients ? 'completed' : 'processing',
          completed_at: terminal === job.valid_recipients ? new Date() : null,
        });
        return batch.inserted;
      });
    }

    campaigns.push({
      campaignId,
      expected: job.valid_recipients,
      queueJobs: campaignSnapshots.length,
      databaseLogs: existingLogs.length,
      missingLogs: missing.length,
      completed: statusCounts.completed,
      failed: statusCounts.failed,
      pending: statusCounts.pending,
      uncertain,
      inserted,
      blockers,
    });
  }

  const databaseOnlyJobs = (await dependencies.jobRepository.findAll(
    options.campaignId ? { campaign_id: options.campaignId } : undefined,
  ))
    .filter((job) => ['pending', 'processing'].includes(job.status) && !byCampaign.has(job.campaign_id));
  for (const job of databaseOnlyJobs) {
    const existingLogs = await dependencies.emailLogRepository.findByJobId(job.id);
    const statusCounts = countStatuses(existingLogs.map((log) => log.status));
    campaigns.push({
      campaignId: job.campaign_id,
      expected: job.valid_recipients,
      queueJobs: 0,
      databaseLogs: existingLogs.length,
      missingLogs: Math.max(0, job.valid_recipients - existingLogs.length),
      completed: statusCounts.completed,
      failed: statusCounts.failed,
      pending: statusCounts.pending,
      uncertain: statusCounts.pending,
      inserted: 0,
      blockers: ['Persisted pending campaign has no Bull jobs'],
    });
  }

  if (malformed.length > 0) {
    campaigns.push({
      campaignId: '<missing>',
      expected: 0,
      queueJobs: malformed.length,
      databaseLogs: 0,
      missingLogs: malformed.length,
      completed: 0,
      failed: 0,
      pending: 0,
      uncertain: malformed.length,
      inserted: 0,
      blockers: ['Bull jobs without campaignId require manual review'],
    });
  }

  return {
    mode: apply ? 'apply' : 'dry-run',
    blocked: campaigns.some((campaign) => campaign.blockers.length > 0),
    totals: {
      queueJobs: relevantSnapshots.length,
      campaigns: campaigns.length,
      missingLogs: campaigns.reduce((total, campaign) => total + campaign.missingLogs, 0),
      inserted: campaigns.reduce((total, campaign) => total + campaign.inserted, 0),
      uncertain: campaigns.reduce((total, campaign) => total + campaign.uncertain, 0),
    },
    campaigns,
  };
};

export const createQueueJobSnapshot = (
  state: ReconciliationQueueState,
  job: {
    id: string | number;
    data: EmailJobData;
    attemptsMade: number;
    finishedOn?: number;
    failedReason?: string;
    returnvalue?: EmailJobResult | null;
  },
): QueueJobSnapshot => ({
  id: String(job.id),
  state,
  data: job.data,
  attemptsMade: job.attemptsMade,
  finishedOn: job.finishedOn,
  failedReason: job.failedReason,
  returnvalue: job.returnvalue,
});

export const campaignMatchesQueueData = (job: Job, data: EmailJobData): boolean => (
  job.campaign_id === data.campaignId
  && job.subject === data.subject
  && (job.html || '') === (data.html || '')
  && (job.text || '') === (data.text || '')
  && job.from_address.toLowerCase() === (data.from || job.from_address).toLowerCase()
  && (job.reply_to || '') === (data.replyTo || '')
  && (job.template_id || '') === (data.templateId || '')
  && canonicalJson(job.variables) === canonicalJson(data.variables || null)
);

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value ?? null);
};

export const enqueueMissingPendingCampaign = async (
  campaignId: string,
  confirmation: string,
  snapshots: QueueJobSnapshot[],
  dependencies: ReconciliationDependencies,
): Promise<EnqueueMissingResult> => {
  if (confirmation !== campaignId) {
    throw new Error('Explicit campaign confirmation does not match');
  }
  const report = await reconcileEmailJobs(snapshots, false, dependencies, { campaignId });
  const campaignReport = report.campaigns.find((campaign) => campaign.campaignId === campaignId);
  const allowedBlocker = 'Persisted pending campaign has no Bull jobs';
  if (
    !campaignReport
    || report.campaigns.length !== 1
    || campaignReport.blockers.length !== 1
    || campaignReport.blockers[0] !== allowedBlocker
  ) {
    throw new Error('Campaign is not eligible for enqueue-missing; review reconciliation blockers');
  }

  const job = await dependencies.jobRepository.findByCampaignId(campaignId);
  if (!job) throw new Error(`Campaign not found: ${campaignId}`);
  const logs = await dependencies.emailLogRepository.findByJobId(job.id);
  if (logs.some((log) => log.status === 'processing')) {
    throw new Error('Campaign has processing logs with an uncertain delivery state');
  }

  const observedHashes = new Set(
    snapshots
      .filter((snapshot) => snapshot.data.campaignId === campaignId)
      .map(buildPlannedLog)
      .filter((item): item is PlannedLog => item !== null)
      .map((item) => item.uniqueHash),
  );
  const missing = logs.filter((log) => log.status === 'pending' && !observedHashes.has(log.unique_hash));
  if (missing.length === 0) return { campaignId, queued: 0 };

  const jobsData: EmailJobData[] = missing.map((log) => ({
    to: log.recipient_email,
    subject: job.subject,
    html: job.html || '',
    text: job.text || undefined,
    from: job.from_address,
    replyTo: job.reply_to || undefined,
    templateId: job.template_id || undefined,
    variables: job.variables || undefined,
    campaignId,
    idempotencyKey: log.unique_hash,
  }));

  const queue = await addBulkEmailJobs(jobsData, {
    verifiedMissingJobIds: new Set(jobsData.map((data) => data.idempotencyKey!)),
  });
  if (queue.failed > 0 || queue.completed > 0 || queue.active > 0 || queue.uncertain > 0) {
    throw new Error('Bull state changed during enqueue-missing; reconciliation is required');
  }
  await dependencies.jobRepository.updateStatus(job.id, 'processing');
  return { campaignId, queued: queue.created };
};

export const retryFailedCampaign = async (
  campaignId: string,
  confirmation: string,
  snapshots: QueueJobSnapshot[],
  dependencies: ReconciliationDependencies,
  retryJobs: (jobIds: string[]) => Promise<number>,
): Promise<RetryFailedResult> => {
  if (confirmation !== campaignId) {
    throw new Error('Explicit campaign confirmation does not match');
  }

  const report = await reconcileEmailJobs(snapshots, false, dependencies, { campaignId });
  if (report.blocked || report.campaigns.length !== 1) {
    throw new Error('Campaign has reconciliation blockers and cannot retry failed jobs');
  }

  const job = await dependencies.jobRepository.findByCampaignId(campaignId);
  if (!job) throw new Error(`Campaign not found: ${campaignId}`);
  const failedSnapshots = snapshots.filter((snapshot) => (
    snapshot.data.campaignId === campaignId && snapshot.state === 'failed'
  ));
  if (failedSnapshots.length === 0) return { campaignId, retried: 0 };

  const failedPlans = failedSnapshots
    .map(buildPlannedLog)
    .filter((item): item is PlannedLog => item !== null);
  const failedHashes = failedPlans.map((item) => item.uniqueHash);
  const failedHashSet = new Set(failedHashes);
  const logs = await dependencies.emailLogRepository.findByJobId(job.id);
  const logsByHash = new Map(logs.map((log) => [log.unique_hash, log]));
  if (failedHashes.some((hash) => !['failed', 'bounced'].includes(logsByHash.get(hash)?.status || ''))) {
    throw new Error('One or more failed Bull jobs do not have a matching failed database log');
  }

  await dependencies.database.transaction(async (transaction) => {
    await transaction('email_logs').whereIn('unique_hash', failedHashes).update({
      status: 'pending',
      error_message: null,
      error_code: null,
      updated_at: new Date(),
    });
    const remainingStatuses = logs.map((log) => (
      failedHashSet.has(log.unique_hash) ? 'pending' as const : log.status
    ));
    const counts = countStatuses(remainingStatuses);
    await new JobRepository(transaction).update(job.id, {
      completed_count: counts.completed,
      failed_count: counts.failed,
      status: 'processing',
      completed_at: null,
    });
  });

  const retried = await retryJobs(failedSnapshots.map((snapshot) => snapshot.id));
  return { campaignId, retried };
};
