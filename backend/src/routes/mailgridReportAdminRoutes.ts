import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { AuthenticatedRequest } from '../middlewares/authentication';
import { getDatabase } from '../config/database';
import type { MailgridReportRun } from '../models/MailgridReport';
import { SystemConfigRepository } from '../repositories/systemConfigRepository';
import { getMailgridReportRepository } from '../services/databaseService';
import { readMailgridReportToken } from '../services/mailgridReportClient';
import {
  MAILGRID_REPORT_SETTINGS_KEY,
  MailgridReportSettings,
  MailgridReportSettingsError,
  getMailgridReportSettings,
  saveMailgridReportSettings,
} from '../services/mailgridReportSettings';
import {
  MailgridReportConflictError,
  applyMailgridReportSchedule,
  enqueueBackfill,
  enqueueManualRun,
} from '../queue/mailgridReportQueue';
import { SettingsAuditEvent, logSettingsChange } from '../services/settingsAudit';
import { accountLabel } from '../services/userAdminService';

const RUN_HISTORY_LIMIT = 50;

export type MailgridTokenState = 'configured' | 'not_configured' | 'auth_failed';

export interface MailgridReportAdminDeps {
  readToken: () => string | null;
  latestConclusiveRun: () => Promise<Pick<MailgridReportRun, 'status' | 'error_code'> | null>;
  listRuns: (limit: number, options: { hideEmptyScheduled: boolean }) => Promise<MailgridReportRun[]>;
  getSettings: () => Promise<MailgridReportSettings>;
  saveSettings: (input: unknown) => Promise<{ settings: MailgridReportSettings; changedFields: string[] }>;
  applySchedule: (settings: MailgridReportSettings) => Promise<void>;
  enqueueManualRun: (triggeredBy: string) => Promise<void>;
  enqueueBackfill: (triggeredBy: string) => Promise<{ blocks: number }>;
  audit: (event: SettingsAuditEvent) => void;
}

const settingsRepository = () => new SystemConfigRepository(getDatabase());

const defaultDeps = (): MailgridReportAdminDeps => ({
  readToken: readMailgridReportToken,
  latestConclusiveRun: () => getMailgridReportRepository().latestConclusiveRun(),
  listRuns: (limit, options) => getMailgridReportRepository().listRuns(limit, options),
  getSettings: () => getMailgridReportSettings(settingsRepository()),
  saveSettings: (input) => saveMailgridReportSettings(settingsRepository(), input),
  applySchedule: (settings) => applyMailgridReportSchedule(settings),
  enqueueManualRun: (triggeredBy) => enqueueManualRun(triggeredBy),
  enqueueBackfill: (triggeredBy) => enqueueBackfill(triggeredBy),
  audit: logSettingsChange,
});

/** The banner state: missing token, or the latest conclusive run failed on credentials, until a later run succeeds. */
export const resolveTokenState = async (deps: Pick<MailgridReportAdminDeps, 'readToken' | 'latestConclusiveRun'>): Promise<MailgridTokenState> => {
  if (!deps.readToken()) return 'not_configured';
  const latest = await deps.latestConclusiveRun();
  const credentialFailure = latest?.status === 'failed'
    && (latest.error_code === 'auth_failed' || latest.error_code === 'token_not_configured');
  return credentialFailure ? 'auth_failed' : 'configured';
};

const actor = (request: Request): string => accountLabel((request as AuthenticatedRequest).auth!.account);

const handle = (operation: (request: Request, response: Response) => Promise<void>) =>
  async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try { await operation(request, response); }
    catch (error) {
      if (error instanceof MailgridReportSettingsError) {
        response.status(400).json({ success: false, error: error.code, field: error.field, message: error.message });
        return;
      }
      if (error instanceof MailgridReportConflictError) {
        response.status(409).json({ success: false, error: error.code, message: error.message });
        return;
      }
      next(error);
    }
  };

export const createMailgridReportAdminRouter = (injected?: MailgridReportAdminDeps): Router => {
  const router = Router();
  const deps = () => injected ?? defaultDeps();

  router.get('/status', handle(async (_request, response) => {
    response.json({ success: true, data: { tokenState: await resolveTokenState(deps()) } });
  }));

  router.get('/settings', handle(async (_request, response) => {
    const current = deps();
    response.json({ success: true, data: { ...(await current.getSettings()), tokenState: await resolveTokenState(current) } });
  }));

  router.put('/settings', handle(async (request, response) => {
    const current = deps();
    const { settings, changedFields } = await current.saveSettings(request.body ?? {});
    await current.applySchedule(settings);
    current.audit({ actor: actor(request), action: 'mailgrid_reports.update_schedule', target: MAILGRID_REPORT_SETTINGS_KEY, fields: changedFields });
    response.json({ success: true, data: { ...settings, tokenState: await resolveTokenState(current) } });
  }));

  router.post('/run', handle(async (request, response) => {
    const current = deps();
    await current.enqueueManualRun(actor(request));
    current.audit({ actor: actor(request), action: 'mailgrid_reports.run_now', target: MAILGRID_REPORT_SETTINGS_KEY });
    response.status(202).json({ success: true });
  }));

  router.post('/backfill', handle(async (request, response) => {
    const current = deps();
    const result = await current.enqueueBackfill(actor(request));
    current.audit({ actor: actor(request), action: 'mailgrid_reports.backfill', target: MAILGRID_REPORT_SETTINGS_KEY });
    response.status(202).json({ success: true, data: result });
  }));

  router.get('/runs', handle(async (request, response) => {
    const hideEmptyScheduled = request.query?.hideEmptyScheduled === 'true';
    response.json({ success: true, data: await deps().listRuns(RUN_HISTORY_LIMIT, { hideEmptyScheduled }) });
  }));

  return router;
};

export default createMailgridReportAdminRouter();
