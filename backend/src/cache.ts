import { Redis } from 'ioredis';
import { config } from './config.js';
import { logger } from './logger.js';
import { cacheRequests } from './metrics.js';

// The cache is a soft dependency. If it is down, every request still works by
// going to Postgres, just more slowly. That is why commands fail fast here
// (no offline queue, one retry) instead of waiting for a reconnect.
//
// Run this Valkey instance with an eviction policy such as allkeys-lru:
// anything stored here may disappear at any time.

let client: Redis | undefined;
let lastWarning = 0;

/** Created on first use, so processes that never touch the cache never connect to it. */
export function cacheClient(): Redis {
  if (!client) {
    client = new Redis(config.CACHE_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2000,
    });
    client.on('error', (err: Error) => {
      if (Date.now() - lastWarning > 30_000) {
        lastWarning = Date.now();
        logger.warn({ err: err.message }, 'cache unavailable, falling back to the database');
      }
    });
  }
  return client;
}

/** Cache-aside: return the cached value, or load it, store it and return it. */
export async function cached<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  try {
    const hit = await cacheClient().get(key);
    if (hit !== null) {
      cacheRequests.inc({ result: 'hit' });
      return JSON.parse(hit) as T;
    }
    cacheRequests.inc({ result: 'miss' });
  } catch {
    cacheRequests.inc({ result: 'error' });
  }
  const value = await load();
  cacheClient()
    .set(key, JSON.stringify(value), 'EX', ttlSeconds)
    .catch(() => {});
  return value;
}

export async function invalidate(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await cacheClient()
    .del(...keys)
    .catch(() => {});
}

export async function closeCache(): Promise<void> {
  if (!client) return;
  await client.quit().catch(() => client?.disconnect());
}
