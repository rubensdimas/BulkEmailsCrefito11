import { NextFunction, Request, Response } from 'express';
import { importJobStatuses } from './statusController';
import { getEmailLogRepository, getJobRepository, isDatabaseReady } from '../services/databaseService';
import { importEmailStatusCsv } from '../services/emailStatusImportService';

jest.mock('../services/databaseService');
jest.mock('../services/emailStatusImportService');

describe('importJobStatuses', () => {
  const status = jest.fn();
  const json = jest.fn();
  const next = jest.fn() as NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
    status.mockReturnValue({ json });
    (isDatabaseReady as jest.Mock).mockReturnValue(true);
    (getJobRepository as jest.Mock).mockReturnValue({
      findById: jest.fn().mockResolvedValue({ id: 'job-1', campaign_id: 'campaign-1' }),
      findByCampaignId: jest.fn(),
    });
    (getEmailLogRepository as jest.Mock).mockReturnValue({});
    (importEmailStatusCsv as jest.Mock).mockResolvedValue({
      totalRows: 2,
      validRows: 2,
      updated: 1,
      unchanged: 0,
      ignoredStale: 0,
      notFound: 1,
      otherCampaign: 0,
      recipientMismatch: 0,
      duplicateRows: 0,
      invalidRows: 0,
      invalidRowNumbers: [],
      invalidRowNumbersTruncated: false,
    });
  });

  it('imports the file for a job and returns the reconciliation summary', async () => {
    const req = {
      params: { jobId: 'job-1' },
      file: { path: '/tmp/status-import.csv' },
    } as unknown as Request;
    const res = { status, json } as unknown as Response;

    await importJobStatuses(req, res, next);

    expect(importEmailStatusCsv).toHaveBeenCalledWith('/tmp/status-import.csv', 'job-1', {});
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      jobId: 'job-1',
      campaignId: 'campaign-1',
    }));
  });

  it('rejects the request without a file', async () => {
    const req = { params: { jobId: 'job-1' } } as unknown as Request;
    const res = { status, json } as unknown as Response;

    await importJobStatuses(req, res, next);

    expect(status).toHaveBeenCalledWith(400);
    expect(importEmailStatusCsv).not.toHaveBeenCalled();
  });
});
