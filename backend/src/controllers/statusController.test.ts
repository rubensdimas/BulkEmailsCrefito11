import { JobStatusResponse } from './statusController';

describe('StatusController', () => {
  describe('JobStatusResponse interface', () => {
    it('should accept valid status values', () => {
      const validStatuses: JobStatusResponse['status'][] = [
        'pending',
        'processing',
        'completed',
        'failed',
        'not-found',
      ];

      validStatuses.forEach((status) => {
        const response: JobStatusResponse = {
          success: true,
          jobId: 'test-123',
          status,
          total: 100,
          completed: 50,
          failed: 5,
          processing: 10,
          waiting: 35,
          progress: 55,
          timestamp: new Date().toISOString(),
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          startedAt: '2024-01-01T00:00:00.000Z',
          completedAt: '2024-01-01T00:00:00.000Z',
        };

        expect(response.status).toBe(status);
      });
    });

    it('should handle undefined timestamps', () => {
      const response: JobStatusResponse = {
        success: true,
        jobId: 'test-123',
        status: 'pending',
        total: 100,
        completed: 0,
        failed: 0,
        processing: 0,
        waiting: 100,
        progress: 0,
        timestamp: new Date().toISOString(),
      };

      expect(response.createdAt).toBeUndefined();
      expect(response.updatedAt).toBeUndefined();
      expect(response.startedAt).toBeUndefined();
      expect(response.completedAt).toBeUndefined();
    });

    it('should handle completed job with timestamps', () => {
      const response: JobStatusResponse = {
        success: true,
        jobId: 'test-123',
        campaignId: 'campaign-123',
        status: 'completed',
        total: 100,
        completed: 100,
        failed: 0,
        processing: 0,
        waiting: 0,
        progress: 100,
        timestamp: new Date().toISOString(),
        createdAt: '2024-01-01T10:00:00.000Z',
        updatedAt: '2024-01-01T10:05:00.000Z',
        startedAt: '2024-01-01T10:00:00.000Z',
        completedAt: '2024-01-01T10:05:00.000Z',
      };

      expect(response.status).toBe('completed');
      expect(response.progress).toBe(100);
      expect(response.completedAt).toBeDefined();
      expect(response.createdAt).toBeDefined();
    });

    it('should handle failed job', () => {
      const response: JobStatusResponse = {
        success: true,
        jobId: 'test-123',
        status: 'failed',
        total: 100,
        completed: 50,
        failed: 50,
        processing: 0,
        waiting: 0,
        progress: 100,
        timestamp: new Date().toISOString(),
        createdAt: '2024-01-01T10:00:00.000Z',
        updatedAt: '2024-01-01T10:05:00.000Z',
        startedAt: '2024-01-01T10:00:00.000Z',
        completedAt: '2024-01-01T10:05:00.000Z',
      };

      expect(response.status).toBe('failed');
      expect(response.failed).toBe(50);
    });

    it('should handle processing job', () => {
      const response: JobStatusResponse = {
        success: true,
        jobId: 'test-123',
        status: 'processing',
        total: 100,
        completed: 30,
        failed: 2,
        processing: 5,
        waiting: 63,
        progress: 32,
        timestamp: new Date().toISOString(),
      };

      expect(response.status).toBe('processing');
      expect(response.progress).toBe(32);
    });
  });
});