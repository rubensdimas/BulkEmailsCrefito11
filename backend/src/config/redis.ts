/**
 * Redis Configuration for Bull Queue
 * Connection settings and pool configuration
 */
import Redis, { RedisOptions } from 'ioredis';

// Redis connection options
const getRedisOptions = (): RedisOptions => {
  const host = process.env.REDIS_HOST || 'localhost';
  const port = parseInt(process.env.REDIS_PORT || '6379', 10);
  const password = process.env.REDIS_PASSWORD;

  const options: RedisOptions = {
    host,
    port,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    connectTimeout: 10000,
  };

  // Add password if provided
  if (password) {
    options.password = password;
  }

  return options;
};

// Create Redis client instance
let redisClient: Redis | null = null;

/**
 * Get or create Redis client
 * @returns Redis client instance
 */
export const getRedisClient = (): Redis => {
  if (!redisClient) {
    redisClient = new Redis(getRedisOptions());

    redisClient.on('connect', () => {
      console.log('✅ Redis connected successfully');
    });

    redisClient.on('error', (err: Error) => {
      console.error('❌ Redis connection error:', err.message);
    });
  }

  return redisClient;
};

/**
 * Close Redis connection
 */
export const closeRedisConnection = async (): Promise<void> => {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    console.log('🔌 Redis connection closed');
  }
};

// Export Redis options for Bull Queue
export const redisOptions = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD,
  prefix: process.env.REDIS_PREFIX || 'bulkmail',
};

export default redisOptions;