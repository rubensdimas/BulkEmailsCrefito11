import Bull, { Queue } from 'bull';
import { readSecret } from '../config/secret';
import { getDatabase } from '../config/database';
import { SystemConfigRepository } from '../repositories/systemConfigRepository';
import type { MailgridReportRepository } from '../repositories/mailgridReportRepository';
import { getMailgridReportRepository } from '../services/databaseService';
import { collectMailgridReport } from '../services/mailgridReportCollector';
import { MailgridReportSettings, getMailgridReportSettings } from '../services/mailgridReportSettings';

export const MAILGRID_REPORT_QUEUE_NAME = 'mailgrid-report';
export const DAILY_JOB_ID = 'mailgrid-report-daily';
const DAY_MS = 24 * 60 * 60 * 1000;
// The API counts its 90-day retention by calendar date, so the oldest accepted dataini is today - 89.
const BACKFILL_DAYS = 89;
const SAO_PAULO_OFFSET_MS = -3 * 60 * 60 * 1000;
const BACKFILL_BLOCK_DAYS = 7;
const JOB_RETENTION = { removeOnComplete: 100, removeOnFail: 100 };

export type MailgridReportJobData =
  | { kind: 'scheduled' }
  | { kind: 'manual'; triggeredBy: string }
  | { kind: 'backfill'; runId: string; start: string; end: string };

type ReportQueue = Pick<Queue<MailgridReportJobData>, 'getRepeatableJobs' | 'removeRepeatableByKey' | 'add'>;

export class MailgridReportConflictError extends Error {
  readonly code = 'backfill_running';
  constructor() {
    super('Já existe uma carga inicial em andamento.');
    this.name = 'MailgridReportConflictError';
  }
}

let queue: Queue<MailgridReportJobData> | null = null;

export const getMailgridReportQueue = (): Queue<MailgridReportJobData> => {
  if (!queue) {
    queue = Bull<MailgridReportJobData>(MAILGRID_REPORT_QUEUE_NAME, {
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: readSecret('REDIS_PASSWORD', 'REDIS_PASSWORD_FILE'),
      },
    });
  }
  return queue;
};

export const closeMailgridReportQueue = async (): Promise<void> => {
  if (queue) {
    await queue.close();
    queue = null;
  }
};

/** Replaces the daily repeatable job; Redis keeps a single schedule shared by every replica. */
export const applyMailgridReportSchedule = async (
  settings: MailgridReportSettings, target: ReportQueue = getMailgridReportQueue(),
): Promise<void> => {
  for (const repeatable of await target.getRepeatableJobs()) await target.removeRepeatableByKey(repeatable.key);
  if (!settings.enabled) return;
  const [hours, minutes] = settings.time.split(':').map(Number);
  await target.add({ kind: 'scheduled' }, {
    jobId: DAILY_JOB_ID, repeat: { cron: `${minutes} ${hours} * * *`, tz: 'America/Sao_Paulo' }, ...JOB_RETENTION,
  });
};

export const enqueueManualRun = async (triggeredBy: string, target: ReportQueue = getMailgridReportQueue()): Promise<void> => {
  await target.add({ kind: 'manual', triggeredBy }, JOB_RETENTION);
};

/** São Paulo midnight of (today - 89) until now, in contiguous blocks of at most 7 days. */
export const backfillWindows = (now: Date): Array<{ start: Date; end: Date }> => {
  const windows: Array<{ start: Date; end: Date }> = [];
  const localNow = now.getTime() + SAO_PAULO_OFFSET_MS;
  const firstStart = Math.floor(localNow / DAY_MS) * DAY_MS - BACKFILL_DAYS * DAY_MS - SAO_PAULO_OFFSET_MS;
  for (let start = firstStart; start < now.getTime(); start += BACKFILL_BLOCK_DAYS * DAY_MS) {
    windows.push({ start: new Date(start), end: new Date(Math.min(start + BACKFILL_BLOCK_DAYS * DAY_MS, now.getTime())) });
  }
  return windows;
};

export const enqueueBackfill = async (
  triggeredBy: string,
  deps: {
    queue?: ReportQueue;
    repository?: Pick<MailgridReportRepository, 'hasRunningBackfill' | 'createRun' | 'finishRun'>;
    now?: Date;
  } = {},
): Promise<{ blocks: number }> => {
  const repository = deps.repository ?? getMailgridReportRepository();
  const target = deps.queue ?? getMailgridReportQueue();
  if (await repository.hasRunningBackfill()) throw new MailgridReportConflictError();
  const windows = backfillWindows(deps.now ?? new Date());
  for (const window of windows) {
    const run = await repository.createRun({
      type: 'backfill', window_start: window.start, window_end: window.end, triggered_by: triggeredBy,
    });
    try {
      await target.add({ kind: 'backfill', runId: run.id, start: window.start.toISOString(), end: window.end.toISOString() }, JOB_RETENTION);
    } catch (error) {
      // A run without a job would stay "running" and block later backfills.
      await repository.finishRun(run.id, {
        status: 'failed', fetched: 0, inserted: 0, skipped: 0, error_code: 'request_failed', error_message: 'Falha ao enfileirar o bloco.',
      });
      throw error;
    }
  }
  return { blocks: windows.length };
};

type CollectInput = Parameters<typeof collectMailgridReport>[0];

export const processMailgridReportJob = async (
  job: { data: MailgridReportJobData },
  deps: {
    collect?: (input: CollectInput) => Promise<unknown>;
    settings?: () => Promise<MailgridReportSettings>;
    now?: () => Date;
  } = {},
): Promise<void> => {
  const collect = deps.collect ?? ((input: CollectInput) => collectMailgridReport(input, { repository: getMailgridReportRepository() }));
  const settings = deps.settings ?? (() => getMailgridReportSettings(new SystemConfigRepository(getDatabase())));
  const { data } = job;
  if (data.kind === 'backfill') {
    await collect({ type: 'backfill', start: new Date(data.start), end: new Date(data.end), triggeredBy: null, runId: data.runId });
    return;
  }
  const end = (deps.now ?? (() => new Date()))();
  const { windowHours } = await settings();
  await collect({
    type: data.kind, start: new Date(end.getTime() - windowHours * 60 * 60 * 1000), end,
    triggeredBy: data.kind === 'manual' ? data.triggeredBy : null,
  });
};
