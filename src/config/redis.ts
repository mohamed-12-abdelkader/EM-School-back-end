import { Redis } from 'ioredis';
import { config } from './env';
import { logger } from '../utils';

let redis: Redis | null = null;
let redisAvailable = false;

export function isRedisAvailable(): boolean {
  return redisAvailable && !!redis && redis.status === 'ready';
}

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
      retryStrategy: () => null,
    });

    redis.on('error', (err) => {
      if (redisAvailable) {
        logger.warn({ err }, 'Redis connection error');
      }
    });

    redis.on('ready', () => {
      redisAvailable = true;
    });

    redis.on('end', () => {
      redisAvailable = false;
    });
  }
  return redis;
}

export async function connectRedis(): Promise<Redis> {
  const client = getRedis();
  if (client.status === 'wait' || client.status === 'end') {
    await client.connect();
  }
  redisAvailable = client.status === 'ready';
  return client;
}

export async function disconnectRedis(): Promise<void> {
  if (redis) {
    await redis.quit().catch(() => undefined);
    redis = null;
    redisAvailable = false;
  }
}
