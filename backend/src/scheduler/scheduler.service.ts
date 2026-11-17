import { Inject, Injectable, type BeforeApplicationShutdown, type OnApplicationBootstrap } from '@nestjs/common';
import { config } from '../config.js';
import type { Sql } from '../db.js';
import { QueueService, SQL } from '../infra.module.js';
import { logger } from '../logger.js';
import { schedulerTickDuration } from '../metrics.js';
import { checkDueTasks, deleteExpiredSessions, findStuckNotifications } from './due-tasks.js';

const MAX_BATCHES_PER_TICK = 20;
const SESSION_CLEANUP_EVERY_MS = 3600_000;

/**
 * Wakes up every SCHEDULER_INTERVAL_MS and checks which task deadlines have
 * passed. Ticks never overlap: the next one is scheduled after the previous
 * finishes. It's safe to run more than one replica (see due-tasks.ts).
 */
@Injectable()
export class SchedulerService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private stopping = false;
  private loop?: Promise<void>;
  private wake?: () => void;
  private lastCleanup = 0;

  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly queue: QueueService,
  ) {}

  onApplicationBootstrap(): void {
    logger.info({ intervalMs: config.SCHEDULER_INTERVAL_MS, batchSize: config.SCHEDULER_BATCH_SIZE }, 'scheduler started');
    this.loop = this.run();
  }

  /** Finish the tick in progress, then stop. */
  async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    this.wake?.();
    await this.loop;
  }

  private async run(): Promise<void> {
    while (!this.stopping) {
      await this.tick();
      if (this.stopping) break;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, config.SCHEDULER_INTERVAL_MS);
        this.wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
  }

  private async tick(): Promise<void> {
    const endTimer = schedulerTickDuration.startTimer();
    try {
      let checked = 0;
      let notified = 0;
      for (let batch = 0; batch < MAX_BATCHES_PER_TICK && !this.stopping; batch += 1) {
        const result = await checkDueTasks(this.sql, config.SCHEDULER_BATCH_SIZE, config.NOTIFY_MAX_LATENESS_MINUTES);
        checked += result.checked;
        notified += result.notificationIds.length;
        await this.enqueue(result.notificationIds);
        if (result.checked < config.SCHEDULER_BATCH_SIZE) break; // backlog drained
      }
      await this.enqueue(await findStuckNotifications(this.sql));

      if (Date.now() - this.lastCleanup > SESSION_CLEANUP_EVERY_MS) {
        const removed = await deleteExpiredSessions(this.sql);
        this.lastCleanup = Date.now();
        if (removed > 0) logger.info({ removed }, 'deleted expired sessions');
      }
      if (checked > 0) logger.info({ checked, notified }, 'checked task deadlines');
    } catch (err) {
      // Log and carry on: the next tick retries, and nothing is lost because
      // next_check_at only moves forward inside a committed transaction.
      logger.error({ err }, 'scheduler tick failed');
    } finally {
      endTimer();
    }
  }

  private async enqueue(ids: string[]): Promise<void> {
    for (const id of ids) {
      try {
        await this.queue.enqueueNotification(id);
      } catch (err) {
        logger.warn({ err, notificationId: id }, 'could not enqueue; a later tick will retry');
      }
    }
  }
}
