/**
 * Email Worker
 * Bull Queue worker process for sending emails
 * Updated with database initialization
 * Run with: npm run worker
 */
import { getEmailQueue, EMAIL_QUEUE_NAME, EmailJobData } from "./emailQueue";
import { emailJobProcessor } from "./processors";
import {
  applyMailgridReportSchedule,
  closeMailgridReportQueue,
  getMailgridReportQueue,
  processMailgridReportJob,
} from "./mailgridReportQueue";

interface BullJobData {
  id?: string | number;
  data: EmailJobData;
  attemptsMade?: number;
}

// Worker configuration
const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || "3", 10);
const THROTTLE_RATE = parseInt(process.env.THROTTLE_RATE || "50", 10);

/**
 * Start the email worker
 */
const startWorker = async (): Promise<void> => {
  // Initialize database (if available)
  let dbInitialized = false;
  try {
    const { initializeDatabase } = await import("../services/databaseService");
    await initializeDatabase();
    dbInitialized = true;
  } catch (error) {
    if (process.env.NODE_ENV === 'production') throw error;
    console.warn("⚠️  Database not available in development");
  }

  console.log(`
 ╔═══════════════════════════════════════════════════════════╗
 ║          BulkMail Pro - Email Worker                 ║
 ╠═══════════════════════════════════════════════════════════╣
 ║  Queue: ${EMAIL_QUEUE_NAME.padEnd(50)}║
 ║  Concurrency: ${WORKER_CONCURRENCY.toString().padEnd(45)}║
 ║  Throttle: ${THROTTLE_RATE}/min                        ║
 ║  Database: ${dbInitialized ? "✅ Connected" : "❌ Not available".padEnd(35)}║
 ╚═══════════════════════════════════════════════════════════════════╝
  `);

  const queue = getEmailQueue();

  // Set limiter on queue
  (queue as unknown as { limiter: { max: number; duration: number } }).limiter =
    {
      max: THROTTLE_RATE,
      duration: 60000,
    };

  // Create worker - process jobs without specific processor name (default)
  // Jobs are added without a name in emailQueue.ts, so we use default processor
  queue.process(WORKER_CONCURRENCY, async (job) =>
    emailJobProcessor(job as unknown as BullJobData),
  );

  console.log("✅ Email worker started");

  // Mailgrid report collection shares this worker; its failures must not stop email delivery.
  if (dbInitialized) {
    try {
      const { getDatabase } = await import("../config/database");
      const { SystemConfigRepository } = await import("../repositories/systemConfigRepository");
      const { getMailgridReportSettings } = await import("../services/mailgridReportSettings");
      getMailgridReportQueue().process(1, (job) => processMailgridReportJob(job));
      await applyMailgridReportSchedule(await getMailgridReportSettings(new SystemConfigRepository(getDatabase())));
      console.log("✅ Mailgrid report worker started");
    } catch (error) {
      console.error("❌ Mailgrid report worker failed to start:", error instanceof Error ? error.message : error);
    }
  }

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    console.log("\n🛑 Shutting down worker...");
    await queue.close();
    await closeMailgridReportQueue();

    // Close database
    try {
      const { shutdownDatabase } = await import("../services/databaseService");
      await shutdownDatabase();
    } catch (err) {
      // Database might not be initialized
    }

    console.log("🔌 Worker closed");
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
};

// Start if called directly
if (require.main === module) {
  startWorker().catch((err) => {
    console.error("❌ Failed to start worker:", err);
    process.exit(1);
  });
}

export { startWorker };
export default startWorker;
