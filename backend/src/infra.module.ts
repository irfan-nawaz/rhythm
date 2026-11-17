import { Global, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { cached, cacheClient, closeCache, invalidate } from './cache.js';
import { closeDb, sql } from './db.js';
import { closePublisher } from './events.js';
import { closeQueue, enqueueNotification } from './queue.js';

// Shared infrastructure for all three processes (API, worker, scheduler):
// the Postgres pool, the cache and the job queue, plus closing them on shutdown.

export const SQL = Symbol('SQL');

@Injectable()
export class CacheService {
  cached<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
    return cached(key, ttlSeconds, load);
  }

  invalidate(...keys: string[]): Promise<void> {
    return invalidate(...keys);
  }

  ping(): Promise<string> {
    return cacheClient().ping();
  }
}

@Injectable()
export class QueueService {
  enqueueNotification(notificationId: string): Promise<void> {
    return enqueueNotification(notificationId);
  }
}

@Injectable()
class ConnectionsShutdown implements OnApplicationShutdown {
  // Runs last: after the HTTP server has closed and in-flight work has finished.
  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([closeDb(), closeCache(), closeQueue(), closePublisher()]);
  }
}

@Global()
@Module({
  providers: [{ provide: SQL, useValue: sql }, CacheService, QueueService, ConnectionsShutdown],
  exports: [SQL, CacheService, QueueService],
})
export class InfraModule {}
