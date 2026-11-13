import {
  DAILY_JOB_ID,
  MailgridReportConflictError,
  applyMailgridReportSchedule,
  backfillWindows,
  enqueueBackfill,
  processMailgridReportJob,
} from './mailgridReportQueue';

const DAY = 24 * 60 * 60 * 1000;

const fakeQueue = (repeatables: Array<{ key: string }> = []) => ({
  getRepeatableJobs: jest.fn().mockResolvedValue(repeatables),
  removeRepeatableByKey: jest.fn().mockResolvedValue(undefined),
  add: jest.fn().mockResolvedValue(undefined),
});

describe('mailgridReportQueue', () => {
  it("applyMailgridReportSchedule removes previous repeatables and adds cron '30 4 * * *' tz America/Sao_Paulo with fixed jobId", async () => {
    const queue = fakeQueue([{ key: 'old-1' }, { key: 'old-2' }]);
    await applyMailgridReportSchedule({ enabled: true, mode: 'daily', intervalMinutes: 5, time: '04:30', windowHours: 24 }, queue as never);
    expect(queue.removeRepeatableByKey.mock.calls).toEqual([['old-1'], ['old-2']]);
    expect(queue.add).toHaveBeenCalledWith({ kind: 'scheduled' }, {
      jobId: DAILY_JOB_ID, repeat: { cron: '30 4 * * *', tz: 'America/Sao_Paulo' },
      removeOnComplete: 100, removeOnFail: 100,
    });
  });

  it.each([[5, '*/5 * * * *'], [15, '*/15 * * * *'], [60, '0 * * * *']])(
    'applyMailgridReportSchedule interval %i min uses cron %s', async (intervalMinutes, cron) => {
      const queue = fakeQueue();
      await applyMailgridReportSchedule({ enabled: true, mode: 'interval', time: '03:00', intervalMinutes, windowHours: 2 }, queue as never);
      expect(queue.add).toHaveBeenCalledWith({ kind: 'scheduled' }, expect.objectContaining({
        jobId: DAILY_JOB_ID, repeat: { cron, tz: 'America/Sao_Paulo' },
      }));
    });

  it('applyMailgridReportSchedule with enabled=false only removes', async () => {
    const queue = fakeQueue([{ key: 'old-1' }]);
    await applyMailgridReportSchedule({ enabled: false, mode: 'daily', intervalMinutes: 5, time: '03:00', windowHours: 48 }, queue as never);
    expect(queue.removeRepeatableByKey).toHaveBeenCalledWith('old-1');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('backfillWindows starts at São Paulo midnight of today minus 89 days in at most 13 contiguous blocks', () => {
    // 00:19 on 13/11 in São Paulo: the API already rejects any dataini of 15/08.
    const now = new Date('2026-11-13T03:19:00Z');
    const windows = backfillWindows(now);
    expect(windows.length).toBeLessThanOrEqual(13);
    expect(windows[0].start).toEqual(new Date('2026-08-16T03:00:00Z'));
    expect(windows[windows.length - 1].end).toEqual(now);
    windows.forEach((block, index) => {
      expect(block.end.getTime() - block.start.getTime()).toBeLessThanOrEqual(7 * DAY);
      if (index > 0) expect(block.start).toEqual(windows[index - 1].end);
    });
  });

  it('enqueueBackfill throws backfill_running and enqueues nothing when a backfill is running', async () => {
    const queue = fakeQueue();
    const repository = { hasRunningBackfill: jest.fn().mockResolvedValue(true), createRun: jest.fn(), finishRun: jest.fn() };
    await expect(enqueueBackfill('admin', { queue: queue as never, repository })).rejects.toBeInstanceOf(MailgridReportConflictError);
    expect(repository.createRun).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('enqueueBackfill creates one backfill run and job per block', async () => {
    const queue = fakeQueue();
    let id = 0;
    const repository = {
      hasRunningBackfill: jest.fn().mockResolvedValue(false),
      createRun: jest.fn().mockImplementation(async () => ({ id: `run-${++id}` })),
      finishRun: jest.fn(),
    };
    await expect(enqueueBackfill('admin', { queue: queue as never, repository, now: new Date('2026-11-12T12:00:00Z') }))
      .resolves.toEqual({ blocks: 13 });
    expect(repository.createRun).toHaveBeenCalledTimes(13);
    expect(repository.createRun.mock.calls[0][0]).toMatchObject({ type: 'backfill', triggered_by: 'admin' });
    expect(queue.add.mock.calls[0][0]).toMatchObject({ kind: 'backfill', runId: 'run-1' });
  });

  it('enqueueBackfill marks the run failed when the job cannot be enqueued', async () => {
    const queue = fakeQueue();
    queue.add.mockRejectedValueOnce(new Error('Redis down'));
    const repository = {
      hasRunningBackfill: jest.fn().mockResolvedValue(false),
      createRun: jest.fn().mockResolvedValue({ id: 'run-1' }),
      finishRun: jest.fn().mockResolvedValue(undefined),
    };
    await expect(enqueueBackfill('admin', { queue: queue as never, repository })).rejects.toThrow('Redis down');
    expect(repository.finishRun).toHaveBeenCalledWith('run-1', expect.objectContaining({ status: 'failed', error_code: 'request_failed' }));
  });

  it('processMailgridReportJob scheduled uses windowHours from settings', async () => {
    const collect = jest.fn().mockResolvedValue('success');
    const purgeScheduledRuns = jest.fn().mockResolvedValue(3);
    const now = new Date('2026-11-12T06:00:00Z');
    await processMailgridReportJob({ data: { kind: 'scheduled' } }, {
      collect, now: () => now, settings: async () => ({ enabled: true, mode: 'daily', intervalMinutes: 5, time: '03:00', windowHours: 24 }), purgeScheduledRuns,
    });
    expect(collect).toHaveBeenCalledWith({
      type: 'scheduled', start: new Date('2026-11-11T06:00:00Z'), end: now, triggeredBy: null,
    });
    expect(purgeScheduledRuns).toHaveBeenCalledWith(30);
  });

  it('processMailgridReportJob backfill uses the job window and run id', async () => {
    const collect = jest.fn().mockResolvedValue('success');
    await processMailgridReportJob({ data: { kind: 'backfill', runId: 'r', start: '2026-08-14T12:00:00.000Z', end: '2026-08-21T12:00:00.000Z' } },
      { collect, now: () => new Date(), settings: jest.fn(), purgeScheduledRuns: jest.fn() });
    expect(collect).toHaveBeenCalledWith({
      type: 'backfill', start: new Date('2026-08-14T12:00:00Z'), end: new Date('2026-08-21T12:00:00Z'), triggeredBy: null, runId: 'r',
    });
  });
});
