import type { Knex } from 'knex';
import {
  EMAIL_LOG_INSERT_CHUNK_SIZE,
  EmailLogRepository,
} from './emailLogRepository';
import { CreateEmailLogInput } from '../models/EmailLog';

const input = (index: number): CreateEmailLogInput => ({
  job_id: '11111111-1111-1111-1111-111111111111',
  recipient_email: `recipient-${index}@example.com`,
  subject: 'Subject',
  from_address: 'sender@example.com',
  unique_hash: index.toString(16).padStart(64, '0'),
});

const createInsertDatabase = () => {
  const chunks: unknown[][] = [];
  const executor = jest.fn(() => {
    const builder: Record<string, jest.Mock> = {};
    builder.insert = jest.fn((values: unknown[]) => {
      chunks.push(values);
      return builder;
    });
    builder.onConflict = jest.fn(() => builder);
    builder.ignore = jest.fn(() => builder);
    builder.returning = jest.fn(async () => chunks[chunks.length - 1].map((_, index) => ({ unique_hash: String(index) })));
    return builder;
  }) as unknown as Knex & { transaction: jest.Mock };
  executor.transaction = jest.fn(async (callback) => callback(executor));
  return { executor, chunks };
};

describe('EmailLogRepository.createBatch', () => {
  it('keeps a 3,908-recipient insert below the PostgreSQL bind limit', async () => {
    const { executor, chunks } = createInsertDatabase();
    const repository = new EmailLogRepository(executor);

    const result = await repository.createBatch(Array.from({ length: 3908 }, (_, index) => input(index)));

    expect(chunks.map((chunk) => chunk.length)).toEqual([1000, 1000, 1000, 908]);
    const columnsPerRow = Object.keys(chunks[0][0] as Record<string, unknown>).length;
    expect(Math.max(...chunks.map((chunk) => chunk.length * columnsPerRow))).toBeLessThan(65535);
    expect(result).toEqual({ requested: 3908, inserted: 3908, existing: 0 });
    expect(executor.transaction).toHaveBeenCalledTimes(1);
  });

  it('returns an empty summary without opening a transaction', async () => {
    const { executor, chunks } = createInsertDatabase();
    const repository = new EmailLogRepository(executor);

    await expect(repository.createBatch([])).resolves.toEqual({ requested: 0, inserted: 0, existing: 0 });
    expect(chunks).toHaveLength(0);
    expect(executor.transaction).not.toHaveBeenCalled();
  });

  it('uses the configured chunk boundary', () => {
    expect(EMAIL_LOG_INSERT_CHUNK_SIZE).toBe(1000);
  });
});
