import { collectMailgridReport, sanitizeErrorMessage } from './mailgridReportCollector';
import { MailgridReportError } from './mailgridReportClient';
import type { MailgridReportEntryInput } from '../models/MailgridReport';

const window = { start: new Date('2026-11-10T03:00:00Z'), end: new Date('2026-11-12T03:00:00Z') };
const entry = { msgid: 'm' } as MailgridReportEntryInput;

const makeRepository = () => ({
  createRun: jest.fn().mockResolvedValue({ id: 'run-1' }),
  finishRun: jest.fn().mockResolvedValue(undefined),
  insertEntries: jest.fn().mockResolvedValue(1),
});

describe('collectMailgridReport', () => {
  it('records success with fetched/inserted/skipped counters', async () => {
    const repository = makeRepository();
    const fetchReport = jest.fn().mockResolvedValue({ entries: [entry, entry], fetched: 3, skipped: 1 });
    await expect(collectMailgridReport({ type: 'manual', ...window, triggeredBy: 'admin' },
      { repository, fetchReport, token: 'tok' })).resolves.toBe('success');
    expect(repository.createRun).toHaveBeenCalledWith({
      type: 'manual', window_start: window.start, window_end: window.end, triggered_by: 'admin',
    });
    expect(fetchReport).toHaveBeenCalledWith(window, { token: 'tok' });
    expect(repository.insertEntries).toHaveBeenCalledWith('run-1', [entry, entry]);
    expect(repository.finishRun).toHaveBeenCalledWith('run-1', { status: 'success', fetched: 3, inserted: 1, skipped: 1 });
  });

  it('reuses an existing run id without creating a new run', async () => {
    const repository = makeRepository();
    const fetchReport = jest.fn().mockResolvedValue({ entries: [], fetched: 0, skipped: 0 });
    await collectMailgridReport({ type: 'backfill', ...window, triggeredBy: 'admin', runId: 'existing' },
      { repository, fetchReport, token: 'tok' });
    expect(repository.createRun).not.toHaveBeenCalled();
    expect(repository.finishRun).toHaveBeenCalledWith('existing', expect.objectContaining({ status: 'success' }));
  });

  it('records failed auth_failed and inserts nothing', async () => {
    const repository = makeRepository();
    const fetchReport = jest.fn().mockRejectedValue(new MailgridReportError('auth_failed', 'codigo 207'));
    await expect(collectMailgridReport({ type: 'scheduled', ...window, triggeredBy: null },
      { repository, fetchReport, token: 'tok' })).resolves.toBe('failed');
    expect(repository.insertEntries).not.toHaveBeenCalled();
    expect(repository.finishRun).toHaveBeenCalledWith('run-1', expect.objectContaining({
      status: 'failed', error_code: 'auth_failed', inserted: 0,
    }));
  });

  it('records token_not_configured without calling fetch', async () => {
    const repository = makeRepository();
    const fetchReport = jest.fn();
    await expect(collectMailgridReport({ type: 'scheduled', ...window, triggeredBy: null },
      { repository, fetchReport, token: null })).resolves.toBe('failed');
    expect(fetchReport).not.toHaveBeenCalled();
    expect(repository.finishRun).toHaveBeenCalledWith('run-1', expect.objectContaining({ error_code: 'token_not_configured' }));
  });

  it('error_message never contains the token', async () => {
    const repository = makeRepository();
    const fetchReport = jest.fn().mockRejectedValue(new Error('POST failed body token_auth=SECRET123 again SECRET123'));
    await collectMailgridReport({ type: 'manual', ...window, triggeredBy: 'admin' },
      { repository, fetchReport, token: 'SECRET123' });
    const [, result] = repository.finishRun.mock.calls[0];
    expect(result).toMatchObject({ status: 'failed', error_code: 'request_failed' });
    expect(result.error_message).not.toContain('SECRET123');
    expect(result.error_message).toContain('***');
  });

  it('sanitizeErrorMessage truncates to 500 characters', () => {
    expect(sanitizeErrorMessage('x'.repeat(900), null)).toHaveLength(500);
  });
});
