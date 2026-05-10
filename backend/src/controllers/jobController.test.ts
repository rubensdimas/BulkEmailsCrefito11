import { Request, Response } from 'express';
import { JobController } from './jobController';
import { getJobRepository, getEmailLogRepository } from '../services/databaseService';

// Mock dependencies
jest.mock('../services/databaseService');

describe('JobController', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;
  let jobRepoMock: {
    findAll: jest.Mock;
    count: jest.Mock;
    findById: jest.Mock;
    hardDelete: jest.Mock;
    updateStatus: jest.Mock;
  };
  let emailLogRepoMock: {
    getStatsByJobId: jest.Mock;
  };

  beforeEach(() => {
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    req = { query: {}, params: {} };
    res = { status: statusMock };

    jobRepoMock = {
      findAll: jest.fn(),
      count: jest.fn(),
      findById: jest.fn(),
      hardDelete: jest.fn(),
      updateStatus: jest.fn(),
    };

    emailLogRepoMock = {
      getStatsByJobId: jest.fn(),
    };

    (getJobRepository as jest.Mock).mockReturnValue(jobRepoMock);
    (getEmailLogRepository as jest.Mock).mockReturnValue(emailLogRepoMock);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getJobs', () => {
    it('should return paginated jobs with computed status', async () => {
      const mockJobs = [
        { id: '1', status: 'processing', valid_recipients: 10 },
        { id: '2', status: 'pending', valid_recipients: 5 },
      ];
      jobRepoMock.findAll.mockResolvedValue(mockJobs);
      jobRepoMock.count.mockResolvedValue(2);
      emailLogRepoMock.getStatsByJobId.mockResolvedValue({
        total_logs: 0, pending: 0, processing: 0, sent: 0, failed: 0, bounced: 0,
      });

      req.query = { limit: '10', offset: '0' };

      await JobController.getJobs(req as Request, res as Response);

      expect(jobRepoMock.findAll).toHaveBeenCalledWith({ limit: 10, offset: 0 });
      expect(emailLogRepoMock.getStatsByJobId).toHaveBeenCalledTimes(2);
      expect(statusMock).toHaveBeenCalledWith(200);
    });

    it('should compute status as completed when all emails are terminal', async () => {
      const mockJobs = [
        { id: '1', status: 'processing', valid_recipients: 5 },
      ];
      jobRepoMock.findAll.mockResolvedValue(mockJobs);
      jobRepoMock.count.mockResolvedValue(1);
      emailLogRepoMock.getStatsByJobId.mockResolvedValue({
        total_logs: 5, pending: 0, processing: 0, sent: 4, failed: 1, bounced: 0,
      });

      await JobController.getJobs(req as Request, res as Response);

      const responseData = jsonMock.mock.calls[0][0];
      expect(responseData.data[0].status).toBe('completed');
      // Should also have auto-synced DB
      expect(jobRepoMock.updateStatus).toHaveBeenCalledWith('1', 'completed');
    });

    it('should not sync when DB status already matches', async () => {
      const mockJobs = [
        { id: '1', status: 'completed', valid_recipients: 5 },
      ];
      jobRepoMock.findAll.mockResolvedValue(mockJobs);
      jobRepoMock.count.mockResolvedValue(1);
      emailLogRepoMock.getStatsByJobId.mockResolvedValue({
        total_logs: 5, pending: 0, processing: 0, sent: 5, failed: 0, bounced: 0,
      });

      await JobController.getJobs(req as Request, res as Response);

      expect(jobRepoMock.updateStatus).not.toHaveBeenCalled();
    });

    it('should apply status filter if provided', async () => {
      jobRepoMock.findAll.mockResolvedValue([]);
      jobRepoMock.count.mockResolvedValue(0);

      req.query = { status: 'completed', limit: '5', offset: '10' };

      await JobController.getJobs(req as Request, res as Response);

      expect(jobRepoMock.findAll).toHaveBeenCalledWith({ limit: 5, offset: 10, status: 'completed' });
      expect(jobRepoMock.count).toHaveBeenCalledWith({ limit: 5, offset: 10, status: 'completed' });
    });

    it('should return empty data and 0 total when no jobs found', async () => {
      jobRepoMock.findAll.mockResolvedValue([]);
      jobRepoMock.count.mockResolvedValue(0);

      await JobController.getJobs(req as Request, res as Response);

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        data: [],
        pagination: { total: 0, limit: 10, offset: 0, pages: 0 }
      });
    });

    it('should handle errors', async () => {
      jobRepoMock.findAll.mockRejectedValue(new Error('DB Error'));

      await JobController.getJobs(req as Request, res as Response);

      expect(statusMock).toHaveBeenCalledWith(500);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Failed to retrieve jobs'
      });
    });
  });

  describe('deleteJob', () => {
    it('should return 400 if jobId is missing', async () => {
      await JobController.deleteJob(req as Request, res as Response);
      
      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({ success: false, message: 'Job ID is required' });
    });

    it('should return 404 if job not found', async () => {
      req.params = { jobId: '123' };
      jobRepoMock.findById.mockResolvedValue(null);

      await JobController.deleteJob(req as Request, res as Response);
      
      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({ success: false, message: 'Job not found' });
    });

    it('should return 400 if job is processing or pending', async () => {
      req.params = { jobId: '123' };
      jobRepoMock.findById.mockResolvedValue({ id: '123', status: 'processing' });

      await JobController.deleteJob(req as Request, res as Response);
      
      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({ success: false, message: 'Cannot delete a job that is pending or processing' });
    });

    it('should delete job and return 200', async () => {
      req.params = { jobId: '123' };
      jobRepoMock.findById.mockResolvedValue({ id: '123', status: 'completed' });
      jobRepoMock.hardDelete.mockResolvedValue(true);

      await JobController.deleteJob(req as Request, res as Response);
      
      expect(jobRepoMock.hardDelete).toHaveBeenCalledWith('123');
      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith({ success: true, message: 'Job deleted successfully' });
    });
  });
});
