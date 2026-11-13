import type { MailgridReportErrorCode, MailgridReportRun, MailgridReportRunType } from '../models/MailgridReport';
import type { MailgridReportRepository } from '../repositories/mailgridReportRepository';
import { MailgridReportError, fetchMailgridReport, readMailgridReportToken } from './mailgridReportClient';

const MAX_ERROR_MESSAGE_LENGTH = 500;

/** Removes the token from error text before it is stored or shown. */
export const sanitizeErrorMessage = (message: string, token: string | null): string =>
  (token ? message.split(token).join('***') : message).slice(0, MAX_ERROR_MESSAGE_LENGTH);

export const collectMailgridReport = async (
  input: { type: MailgridReportRunType; start: Date; end: Date; triggeredBy: string | null; runId?: string },
  deps: {
    repository: Pick<MailgridReportRepository, 'createRun' | 'finishRun' | 'insertEntries'>;
    fetchReport?: typeof fetchMailgridReport;
    token?: string | null;
  },
): Promise<MailgridReportRun['status']> => {
  const { repository } = deps;
  const token = deps.token === undefined ? readMailgridReportToken() : deps.token;
  const runId = input.runId ?? (await repository.createRun({
    type: input.type, window_start: input.start, window_end: input.end, triggered_by: input.triggeredBy,
  })).id;

  let fetched = 0;
  let skipped = 0;
  let inserted = 0;
  try {
    if (!token) throw new MailgridReportError('token_not_configured', 'TOKEN_AUTH_MAILGRID is not configured');
    const report = await (deps.fetchReport ?? fetchMailgridReport)({ start: input.start, end: input.end }, { token });
    fetched = report.fetched;
    skipped = report.skipped;
    inserted = await repository.insertEntries(runId, report.entries);
    await repository.finishRun(runId, { status: 'success', fetched, inserted, skipped });
    return 'success';
  } catch (error) {
    const code: MailgridReportErrorCode = error instanceof MailgridReportError ? error.code : 'request_failed';
    const message = error instanceof Error ? error.message : String(error);
    await repository.finishRun(runId, {
      status: 'failed', fetched, inserted, skipped, error_code: code, error_message: sanitizeErrorMessage(message, token),
    });
    return 'failed';
  }
};
