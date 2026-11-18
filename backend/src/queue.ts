import { Queue } from 'bullmq';
import { config } from './config.js';

// The job queue lives in its own Valkey instance, separate from the cache.
// Run it with maxmemory-policy noeviction and append-only persistence: unlike
// cache entries, a lost job is a notification that never arrives.
export const NOTIFICATIONS_QUEUE = 'notifications';

export interface DeliverJob {
  notificationId: string;
}

/** Workers block while waiting for jobs, so BullMQ requires maxRetriesPerRequest: null. */
export const workerConnection = { url: config.QUEUE_URL, maxRetriesPerRequest: null };

let queue: Queue<DeliverJob> | undefined;

export function notificationsQueue(): Queue<DeliverJob> {
  queue ??= new Queue<DeliverJob>(NOTIFICATIONS_QUEUE, {
    // Producers give up after two reconnect attempts instead of hanging an API
    // request while the queue is down. (Commands issued before the first
    // connection completes wait for it, rather than failing.)
    connection: { url: config.QUEUE_URL, maxRetriesPerRequest: 2 },
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: { age: 24 * 3600, count: 10_000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });
  return queue;
}

/**
 * The notification row is the source of truth (an outbox); the job only points
 * at it. Using the row id as the job id means adding the same notification
 * twice creates one job. delayMs holds a snoozed reminder back until it's due.
 */
export async function enqueueNotification(notificationId: string, delayMs = 0): Promise<void> {
  await notificationsQueue().add('deliver', { notificationId }, { jobId: notificationId, ...(delayMs > 0 ? { delay: delayMs } : {}) });
}

export async function closeQueue(): Promise<void> {
  await queue?.close();
}
