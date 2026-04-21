import { computeJobStatus, shouldSyncStatus } from './jobStatusService';
import { Job } from '../models/Job';
import { EmailStats } from '../models/EmailLog';

// Factory helper for a minimal Job object
function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    campaign_id: 'camp-1',
    subject: 'Test',
    html: null,
    text: null,
    from_address: 'test@test.com',
    from_name: null,
    reply_to: null,
    template_id: null,
    variables: null,
    status: 'processing',
    priority: 'normal',
    total_recipients: 100,
    valid_recipients: 100,
    invalid_recipients: 0,
    completed_count: 0,
    failed_count: 0,
    throttle_rate: 50,
    started_at: null,
    completed_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function makeStats(overrides: Partial<EmailStats> = {}): EmailStats {
  return {
    total_logs: 0,
    pending: 0,
    processing: 0,
    sent: 0,
    failed: 0,
    bounced: 0,
    ...overrides,
  };
}

describe('JobStatusService', () => {
  describe('computeJobStatus', () => {
    it('should return "completed" when all emails reached terminal state', () => {
      const job = makeJob({ status: 'processing', valid_recipients: 10 });
      const stats = makeStats({ sent: 8, failed: 1, bounced: 1 });

      const result = computeJobStatus(job, stats);

      expect(result.status).toBe('completed');
      expect(result.progress).toBe(100);
      expect(result.terminalCount).toBe(10);
    });

    it('should return "completed" when DB status is already "completed"', () => {
      const job = makeJob({ status: 'completed', valid_recipients: 10 });
      const stats = makeStats({ sent: 10 });

      const result = computeJobStatus(job, stats);

      expect(result.status).toBe('completed');
    });

    it('should return "failed" when DB status is "failed"', () => {
      const job = makeJob({ status: 'failed', valid_recipients: 10 });
      const stats = makeStats({ sent: 3, failed: 2 });

      const result = computeJobStatus(job, stats);

      expect(result.status).toBe('failed');
    });

    it('should return "cancelled" when DB status is "cancelled"', () => {
      const job = makeJob({ status: 'cancelled', valid_recipients: 10 });
      const stats = makeStats({ sent: 3 });

      const result = computeJobStatus(job, stats);

      expect(result.status).toBe('cancelled');
    });

    it('should return "processing" when there are emails being processed', () => {
      const job = makeJob({ status: 'processing', valid_recipients: 10 });
      const stats = makeStats({ sent: 3, processing: 2, pending: 5 });

      const result = computeJobStatus(job, stats);

      expect(result.status).toBe('processing');
      expect(result.progress).toBe(30);
    });

    it('should return "processing" when DB status is "processing" even with no active processing', () => {
      const job = makeJob({ status: 'processing', valid_recipients: 10 });
      const stats = makeStats({ sent: 3, pending: 7 });

      const result = computeJobStatus(job, stats);

      expect(result.status).toBe('processing');
    });

    it('should return "pending" when DB status is "pending" and nothing is processing', () => {
      const job = makeJob({ status: 'pending', valid_recipients: 10 });
      const stats = makeStats({ pending: 10 });

      const result = computeJobStatus(job, stats);

      expect(result.status).toBe('pending');
    });

    it('should cap progress at 100', () => {
      // Edge case where terminal count exceeds valid_recipients due to retries
      const job = makeJob({ status: 'processing', valid_recipients: 5 });
      const stats = makeStats({ sent: 4, failed: 2 });

      const result = computeJobStatus(job, stats);

      expect(result.progress).toBe(100);
      expect(result.status).toBe('completed');
    });

    it('should return 0 progress when valid_recipients is 0', () => {
      const job = makeJob({ status: 'pending', valid_recipients: 0 });
      const stats = makeStats();

      const result = computeJobStatus(job, stats);

      expect(result.progress).toBe(0);
      expect(result.status).toBe('pending');
    });

    it('should correctly separate counts', () => {
      const job = makeJob({ status: 'processing', valid_recipients: 20 });
      const stats = makeStats({ sent: 5, failed: 3, bounced: 2, processing: 4, pending: 6 });

      const result = computeJobStatus(job, stats);

      expect(result.completedCount).toBe(5);
      expect(result.failedCount).toBe(3);
      expect(result.bouncedCount).toBe(2);
      expect(result.processingCount).toBe(4);
      expect(result.waitingCount).toBe(6);
      expect(result.terminalCount).toBe(10);
      expect(result.progress).toBe(50);
    });
  });

  describe('shouldSyncStatus', () => {
    it('should return "completed" when DB has "processing" but computed is "completed"', () => {
      const job = makeJob({ status: 'processing' });
      const computed = computeJobStatus(job, makeStats({ sent: 100 }));

      const result = shouldSyncStatus(job, computed);

      expect(result).toBe('completed');
    });

    it('should return null when DB and computed status match', () => {
      const job = makeJob({ status: 'completed', valid_recipients: 10 });
      const computed = computeJobStatus(job, makeStats({ sent: 10 }));

      const result = shouldSyncStatus(job, computed);

      expect(result).toBeNull();
    });

    it('should return null when computed is not "completed" even if different from DB', () => {
      const job = makeJob({ status: 'pending', valid_recipients: 10 });
      const computed = computeJobStatus(job, makeStats({ processing: 5, pending: 5 }));

      // pending → processing is not a sync we auto-trigger
      const result = shouldSyncStatus(job, computed);

      expect(result).toBeNull();
    });
  });
});
