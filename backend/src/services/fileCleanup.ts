/**
 * File Cleanup Service
 * Cleans up temporary files older than configured threshold
 */
import fs from 'fs';
import path from 'path';

interface CleanupOptions {
  directory: string;
  maxAgeMs: number;
  extensions?: string[];
  dryRun?: boolean;
}

interface CleanupResult {
  deleted: number;
  failed: number;
  freedBytes: number;
  errors: string[];
}

/**
 * Default cleanup options
 */
const DEFAULT_OPTIONS: CleanupOptions = {
  directory: path.join(__dirname, '../../uploads'),
  maxAgeMs: 24 * 60 * 60 * 1000, // 24 hours
  extensions: ['.xlsx', '.xls', '.csv'],
  dryRun: false,
};

/**
 * Delete a single file
 */
const deleteFile = (filePath: string): { success: boolean; bytes: number; error?: string } => {
  try {
    const stats = fs.statSync(filePath);
    fs.unlinkSync(filePath);
    return { success: true, bytes: stats.size };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, bytes: 0, error: errorMessage };
  }
};

/**
 * Check if file should be deleted based on age and extension
 */
const shouldDelete = (filePath: string, options: CleanupOptions): boolean => {
  try {
    const stats = fs.statSync(filePath);
    const now = Date.now();
    const fileAge = now - stats.mtimeMs;

    // Check age
    if (fileAge < options.maxAgeMs) {
      return false;
    }

    // Check extension if specified
    if (options.extensions && options.extensions.length > 0) {
      const ext = path.extname(filePath).toLowerCase();
      return options.extensions.includes(ext);
    }

    return true;
  } catch {
    return false;
  }
};

/**
 * Clean up old files in a directory
 */
export const cleanupOldFiles = (options: Partial<CleanupOptions> = {}): CleanupResult => {
  const opts: CleanupOptions = { ...DEFAULT_OPTIONS, ...options };

  const result: CleanupResult = {
    deleted: 0,
    failed: 0,
    freedBytes: 0,
    errors: [],
  };

  try {
    // Check if directory exists
    if (!fs.existsSync(opts.directory)) {
      result.errors.push(`Directory does not exist: ${opts.directory}`);
      return result;
    }

    // Read directory contents
    const files = fs.readdirSync(opts.directory);

    for (const file of files) {
      const filePath = path.join(opts.directory, file);

      // Skip directories
      try {
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
          continue;
        }
      } catch {
        continue;
      }

      // Check if should be deleted
      if (shouldDelete(filePath, opts)) {
        if (opts.dryRun) {
          console.log(`[DRY RUN] Would delete: ${filePath}`);
          result.deleted++;
        } else {
          const deleteResult = deleteFile(filePath);
          if (deleteResult.success) {
            result.deleted++;
            result.freedBytes += deleteResult.bytes;
          } else {
            result.failed++;
            result.errors.push(`Failed to delete ${file}: ${deleteResult.error}`);
          }
        }
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    result.errors.push(`Cleanup error: ${errorMessage}`);
  }

  return result;
};

/**
 * Get directory statistics
 */
export const getDirectoryStats = (directory: string): {
  totalFiles: number;
  totalSize: number;
  oldestFile: Date | null;
  newestFile: Date | null;
} => {
  const stats = {
    totalFiles: 0,
    totalSize: 0,
    oldestFile: null as Date | null,
    newestFile: null as Date | null,
  };

  try {
    if (!fs.existsSync(directory)) {
      return stats;
    }

    const files = fs.readdirSync(directory);

    for (const file of files) {
      const filePath = path.join(directory, file);

      try {
        const fileStats = fs.statSync(filePath);
        if (fileStats.isFile()) {
          stats.totalFiles++;
          stats.totalSize += fileStats.size;

          if (!stats.oldestFile || fileStats.mtime < stats.oldestFile) {
            stats.oldestFile = fileStats.mtime;
          }
          if (!stats.newestFile || fileStats.mtime > stats.newestFile) {
            stats.newestFile = fileStats.mtime;
          }
        }
      } catch {
        continue;
      }
    }
  } catch {
    // Ignore errors
  }

  return stats;
};

/**
 * Run cleanup as a scheduled job
 * Returns interval ID that can be cleared to stop
 */
export const startCleanupScheduler = (
  intervalMs: number = 60 * 60 * 1000, // Default: 1 hour
  options: Partial<CleanupOptions> = {}
): NodeJS.Timeout => {
  // Run immediately on start
  cleanupOldFiles(options);

  // Then run at intervals
  const intervalId = setInterval(() => {
    cleanupOldFiles(options);
  }, intervalMs);

  return intervalId;
};

/**
 * Format bytes to human readable string
 */
export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export default {
  cleanupOldFiles,
  getDirectoryStats,
  startCleanupScheduler,
  formatBytes,
};