import { NextFunction, Request, Response } from 'express';
import { getJobStatus } from './statusController';
import {
  getEmailLogRepository,
  getJobRepository,
  isDatabaseReady,
} from '../services/databaseService';

jest.mock('../services/databaseService');
jest.mock('../queue/emailQueue', () => ({
  getEmailQueue: jest.fn(),
  getQueueStats: jest.fn(),
}));

describe('getJobStatus pagination', () => {
  const status = jest.fn();
  const json = jest.fn();
  const next = jest.fn() as NextFunction;
  const findPageByJobId = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    status.mockReturnValue({ json });
    (isDatabaseReady as jest.Mock).mockReturnValue(true);
    (getJobRepository as jest.Mock).mockReturnValue({
      findById: jest.fn().mockResolvedValue({
        id: 'job-1',
        campaign_id: 'campaign-1',
        status: 'processing',
        valid_recipients: 101,
        created_at: new Date('2026-01-01T00:00:00Z'),
        updated_at: new Date('2026-01-01T00:00:00Z'),
      }),
      findByCampaignId: jest.fn(),
      updateStatus: jest.fn(),
    });
    (getEmailLogRepository as jest.Mock).mockReturnValue({
      getStatsByJobId: jest.fn().mockResolvedValue({
        total_logs: 101,
        pending: 0,
        processing: 0,
        sent: 100,
        delivered: 1,
        failed: 0,
        bounced: 0,
        soft_bounce: 0,
        hard_bounce: 0,
      }),
      findPageByJobId,
    });
  });

  it('returns 100-item pagination metadata and delivery rows', async () => {
    findPageByJobId.mockResolvedValue({
      total: 101,
      data: [{
        mailgrid_message_id: 'msg-1',
        recipient_email: 'recipient@example.com',
        status: 'delivered',
        mailgrid_status_message: 'Entregue com sucesso',
        error_message: null,
        mailgrid_sent_at: new Date('2026-01-01T00:00:00Z'),
        sent_at: null,
        mailgrid_event_at: new Date('2026-01-01T00:00:05Z'),
      }],
    });

    const req = { params: { jobId: 'job-1' }, query: { page: '2' } } as unknown as Request;
    const res = { status, json } as unknown as Response;
    await getJobStatus(req, res, next);

    expect(findPageByJobId).toHaveBeenCalledWith('job-1', 2, 100, {});
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      completed: 101,
      emails: [expect.objectContaining({ messageId: 'msg-1', status: 'delivered' })],
      pagination: { page: 2, pageSize: 100, total: 101, totalPages: 2 },
    }));
  });

  it('rejects invalid page numbers', async () => {
    const req = { params: { jobId: 'job-1' }, query: { page: '0' } } as unknown as Request;
    const res = { status, json } as unknown as Response;
    await getJobStatus(req, res, next);
    expect(status).toHaveBeenCalledWith(400);
  });

  it('normalizes and combines recipient and status filters', async () => {
    findPageByJobId.mockResolvedValue({ total: 0, data: [] });
    const req = {
      params: { jobId: 'job-1' },
      query: {
        page: '1',
        recipient: ' Recipient@Example.COM ',
        status: 'hard_bounce',
      },
    } as unknown as Request;
    const res = { status, json } as unknown as Response;

    await getJobStatus(req, res, next);

    expect(findPageByJobId).toHaveBeenCalledWith('job-1', 1, 100, {
      recipient: 'recipient@example.com',
      status: 'hard_bounce',
    });
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      total: 101,
      pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
    }));
  });

  it.each([
    [{ recipient: 'not-an-email' }, 'Recipient must be a valid email address'],
    [{ status: 'sent' }, 'Status must be one of'],
    [{ status: ['pending'] }, 'Status must be one of'],
  ])('rejects invalid delivery filters %#', async (query, expectedError) => {
    const req = { params: { jobId: 'job-1' }, query } as unknown as Request;
    const res = { status, json } as unknown as Response;

    await getJobStatus(req, res, next);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringContaining(expectedError),
    }));
    expect(findPageByJobId).not.toHaveBeenCalled();
  });
});
