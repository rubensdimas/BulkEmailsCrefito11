/**
 * Database Service
 * Central module for database initialization and repository access
 */
import {
  initDatabase,
  closeDatabase,
  DatabaseConfig,
} from "../config/database";
import {
  JobRepository,
  createJobRepository,
} from "../repositories/jobRepository";
import {
  EmailLogRepository,
  createEmailLogRepository,
} from "../repositories/emailLogRepository";

// Singleton instances
let jobRepository: JobRepository | null = null;
let emailLogRepository: EmailLogRepository | null = null;

/**
 * Initialize database and repositories
 */
export const initializeDatabase = async (): Promise<void> => {
  try {
    const db = await initDatabase();
    jobRepository = createJobRepository(db);
    emailLogRepository = createEmailLogRepository(db);
    console.log("✅ Database and repositories initialized");
  } catch (error) {
    console.error("❌ Failed to initialize database:", error);
    throw error;
  }
};

/**
 * Get JobRepository instance
 */
export const getJobRepository = (): JobRepository => {
  if (!jobRepository) {
    throw new Error(
      "Database not initialized. Call initializeDatabase() first.",
    );
  }
  return jobRepository;
};

/**
 * Get EmailLogRepository instance
 */
export const getEmailLogRepository = (): EmailLogRepository => {
  if (!emailLogRepository) {
    throw new Error(
      "Database not initialized. Call initializeDatabase() first.",
    );
  }
  return emailLogRepository;
};

/**
 * Check if database is ready
 */
export const isDatabaseReady = (): boolean => {
  return jobRepository !== null && emailLogRepository !== null;
};

/**
 * Close database connection
 */
export const shutdownDatabase = async (): Promise<void> => {
  await closeDatabase();
  jobRepository = null;
  emailLogRepository = null;
};

// Export for backward compatibility
export { DatabaseConfig };
