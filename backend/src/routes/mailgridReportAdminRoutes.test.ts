import type { NextFunction, Request, Response, Router } from 'express';
import { createMailgridReportAdminRouter, MailgridReportAdminDeps } from './mailgridReportAdminRoutes';
import { MailgridReportConflictError } from '../queue/mailgridReportQueue';

type Handler = (request: Request, response: Response, next: NextFunction) => Promise<void>;
interface Layer { route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Handler }> } }

const handler = (router: Router, method: string, path: string): Handler => {
  const layer = (router as unknown as { stack: Layer[] }).stack
    .find((item) => item.route?.path === path && item.route.methods[method]);
  if (!layer?.route) throw new Error(`Route ${method} ${path} not found`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
};

const mockResponse = () => {
  const response = { status: jest.fn(), json: jest.fn() };
  response.status.mockReturnValue(response);
  return response;
};
const adminRequest = (body: unknown = {}) => ({
  auth: { account: { id: 'a', username: 'admin', email: null } }, body, params: {},
}) as unknown as Request;

const makeDeps = (overrides: Partial<MailgridReportAdminDeps> = {}): MailgridReportAdminDeps => ({
  readToken: jest.fn().mockReturnValue('token'),
  latestConclusiveRun: jest.fn().mockResolvedValue(null),
  listRuns: jest.fn().mockResolvedValue([]),
  getSettings: jest.fn().mockResolvedValue({ enabled: true, mode: 'daily', intervalMinutes: 5, time: '03:00', windowHours: 48 }),
  saveSettings: jest.fn().mockResolvedValue({ settings: { enabled: true, mode: 'daily', intervalMinutes: 5, time: '04:30', windowHours: 24 }, changedFields: ['time', 'windowHours'] }),
  applySchedule: jest.fn().mockResolvedValue(undefined),
  enqueueManualRun: jest.fn().mockResolvedValue(undefined),
  enqueueBackfill: jest.fn().mockResolvedValue({ blocks: 13 }),
  audit: jest.fn(),
  ...overrides,
});

describe('mailgrid report admin routes', () => {
  it('reports auth_failed after a failed authentication run', async () => {
    const deps = makeDeps({ latestConclusiveRun: jest.fn().mockResolvedValue({ status: 'failed', error_code: 'auth_failed' }) });
    const response = mockResponse();
    await handler(createMailgridReportAdminRouter(deps), 'get', '/status')(adminRequest(), response as unknown as Response, jest.fn());
    expect(response.json).toHaveBeenCalledWith({ success: true, data: { tokenState: 'auth_failed' } });
  });

  it('reports not_configured when the token is missing and configured after a success', async () => {
    const missing = mockResponse();
    await handler(createMailgridReportAdminRouter(makeDeps({ readToken: jest.fn().mockReturnValue(null) })), 'get', '/status')(
      adminRequest(), missing as unknown as Response, jest.fn());
    expect(missing.json).toHaveBeenCalledWith({ success: true, data: { tokenState: 'not_configured' } });
    const ok = mockResponse();
    await handler(createMailgridReportAdminRouter(makeDeps({ latestConclusiveRun: jest.fn().mockResolvedValue({ status: 'success', error_code: null }) })), 'get', '/status')(
      adminRequest(), ok as unknown as Response, jest.fn());
    expect(ok.json).toHaveBeenCalledWith({ success: true, data: { tokenState: 'configured' } });
  });

  it('rejects invalid settings with the offending field', async () => {
    const { MailgridReportSettingsError } = await import('../services/mailgridReportSettings');
    const deps = makeDeps({ saveSettings: jest.fn().mockRejectedValue(new MailgridReportSettingsError('time', 'Horário inválido. Use HH:MM.')) });
    const response = mockResponse();
    await handler(createMailgridReportAdminRouter(deps), 'put', '/settings')(adminRequest({ time: '25:00' }), response as unknown as Response, jest.fn());
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'invalid_settings', field: 'time' }));
    expect(deps.applySchedule).not.toHaveBeenCalled();
  });

  it('saves settings, reschedules and audits field names only', async () => {
    const deps = makeDeps();
    const response = mockResponse();
    await handler(createMailgridReportAdminRouter(deps), 'put', '/settings')(
      adminRequest({ enabled: true, time: '04:30', windowHours: 24 }), response as unknown as Response, jest.fn());
    expect(deps.applySchedule).toHaveBeenCalledWith({ enabled: true, mode: 'daily', intervalMinutes: 5, time: '04:30', windowHours: 24 });
    expect(deps.audit).toHaveBeenCalledWith({
      actor: 'admin', action: 'mailgrid_reports.update_schedule', target: 'mailgrid_report_schedule', fields: ['time', 'windowHours'],
    });
    expect(response.json).toHaveBeenCalledWith({ success: true, data: { enabled: true, mode: 'daily', intervalMinutes: 5, time: '04:30', windowHours: 24, tokenState: 'configured' } });
  });

  it('starts a manual run with 202 and audits it', async () => {
    const deps = makeDeps();
    const response = mockResponse();
    await handler(createMailgridReportAdminRouter(deps), 'post', '/run')(adminRequest(), response as unknown as Response, jest.fn());
    expect(deps.enqueueManualRun).toHaveBeenCalledWith('admin');
    expect(response.status).toHaveBeenCalledWith(202);
    expect(deps.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'mailgrid_reports.run_now' }));
  });

  it('returns 409 backfill_running for a duplicate backfill', async () => {
    const deps = makeDeps({ enqueueBackfill: jest.fn().mockRejectedValue(new MailgridReportConflictError()) });
    const response = mockResponse();
    await handler(createMailgridReportAdminRouter(deps), 'post', '/backfill')(adminRequest(), response as unknown as Response, jest.fn());
    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'backfill_running' }));
    expect(deps.audit).not.toHaveBeenCalled();
  });

  it('accepts a backfill with 202 and lists the last 50 runs', async () => {
    const deps = makeDeps();
    const backfill = mockResponse();
    const router = createMailgridReportAdminRouter(deps);
    await handler(router, 'post', '/backfill')(adminRequest(), backfill as unknown as Response, jest.fn());
    expect(backfill.status).toHaveBeenCalledWith(202);
    expect(backfill.json).toHaveBeenCalledWith({ success: true, data: { blocks: 13 } });
    await handler(router, 'get', '/runs')(adminRequest(), mockResponse() as unknown as Response, jest.fn());
    expect(deps.listRuns).toHaveBeenCalledWith(50, { hideEmptyScheduled: false });
    await handler(router, 'get', '/runs')({ ...adminRequest(), query: { hideEmptyScheduled: 'true' } } as unknown as Request,
      mockResponse() as unknown as Response, jest.fn());
    expect(deps.listRuns).toHaveBeenLastCalledWith(50, { hideEmptyScheduled: true });
  });
});
