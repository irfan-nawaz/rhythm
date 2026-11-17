import { Redis } from 'ioredis';
import { config } from './config.js';
import { logger } from './logger.js';

// Live updates. Something changes (a task ticked off, a reminder sent) and
// every signed-in screen of the people involved should refresh.
//
// Each browser holds one Server-Sent Events connection to *one* API replica,
// but the change can happen on any replica, or in the worker. So events go
// through Valkey pub/sub: publishers send to a channel per user, and every
// API replica subscribes once and forwards messages to the connections it
// holds. No sticky sessions needed.
//
// Pub/sub uses the cache instance. It stores no keys, so eviction doesn't
// touch it; if the cache is down, live updates pause and screens fall back to
// refreshing on their own timer.

export interface LiveEvent {
  type: 'task.changed' | 'group.changed' | 'notification';
  groupId?: string;
  taskId?: string;
  title?: string;
  body?: string;
}

const CHANNEL_PREFIX = 'rhythm:events:user:';

let publisher: Redis | undefined;

function publisherClient(): Redis {
  publisher ??= new Redis(config.CACHE_URL, { maxRetriesPerRequest: 1, connectTimeout: 2000 });
  publisher.on('error', () => {}); // reported by the cache client's own logging
  return publisher;
}

/** Fire and forget: a lost live update only means a screen refreshes a little later. */
export function publishToUsers(userIds: Iterable<string>, event: LiveEvent): void {
  const message = JSON.stringify(event);
  const client = publisherClient();
  for (const userId of new Set(userIds)) {
    client.publish(CHANNEL_PREFIX + userId, message).catch(() => {});
  }
}

export type EventHandler = (userId: string, event: LiveEvent) => void;

/** One subscriber connection per API process, shared by all its SSE streams. */
export function subscribeToAllUsers(handler: EventHandler): () => Promise<void> {
  const subscriber = new Redis(config.CACHE_URL, { maxRetriesPerRequest: null });
  subscriber.on('error', (err: Error) => logger.warn({ err: err.message }, 'live updates: subscriber connection error'));
  subscriber.psubscribe(`${CHANNEL_PREFIX}*`).catch((err: unknown) => logger.warn({ err }, 'live updates: subscribe failed'));
  subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
    try {
      handler(channel.slice(CHANNEL_PREFIX.length), JSON.parse(message) as LiveEvent);
    } catch {
      // ignore malformed messages
    }
  });
  return async () => {
    await subscriber.quit().catch(() => subscriber.disconnect());
  };
}

export async function closePublisher(): Promise<void> {
  await publisher?.quit().catch(() => publisher?.disconnect());
}
