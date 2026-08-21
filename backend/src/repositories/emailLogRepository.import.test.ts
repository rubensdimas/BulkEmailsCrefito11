import type { Knex } from 'knex';
import { EmailLogRepository } from './emailLogRepository';

describe('EmailLogRepository.applyImportedStatuses', () => {
  it('returns an empty reconciliation without opening a transaction', async () => {
    const db = jest.fn() as unknown as Knex & { transaction: jest.Mock };
    db.transaction = jest.fn();

    await expect(new EmailLogRepository(db).applyImportedStatuses('job-1', [])).resolves.toEqual({
      updated: 0,
      unchanged: 0,
      ignoredStale: 0,
      notFound: 0,
      otherCampaign: 0,
      recipientMismatch: 0,
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
