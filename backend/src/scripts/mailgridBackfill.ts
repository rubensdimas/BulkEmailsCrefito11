/**
 * Enqueues the 90-day Mailgrid report backfill (13 blocks of 7 days); the worker processes it.
 * Run with: npm run mailgrid:backfill
 */
import { initializeDatabase, shutdownDatabase } from '../services/databaseService';
import { MailgridReportConflictError, closeMailgridReportQueue, enqueueBackfill } from '../queue/mailgridReportQueue';

const main = async (): Promise<number> => {
  await initializeDatabase();
  try {
    const { blocks } = await enqueueBackfill('cli');
    console.log(`[MailgridReport] backfill enqueued: ${blocks} blocks`);
    return 0;
  } catch (error) {
    if (error instanceof MailgridReportConflictError) {
      console.error(`[MailgridReport] ${error.message}`);
      return 1;
    }
    throw error;
  } finally {
    await closeMailgridReportQueue();
    await shutdownDatabase();
  }
};

main().then((code) => process.exit(code)).catch((error) => {
  console.error('[MailgridReport] backfill failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
