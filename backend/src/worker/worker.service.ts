import { Injectable, type BeforeApplicationShutdown, type OnApplicationBootstrap } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { jobDuration, queueJobs } from '../metrics.js';
import { NOTIFICATIONS_QUEUE, notificationsQueue, workerConnection, type DeliverJob } from '../queue.js';
import { DeliveryService } from './delivery.service.js';

/**
 * Pulls jobs from the notifications queue, up to WORKER_CONCURRENCY at once
 * per process. Scale out by running more worker replicas; the queue depth
 * metric (queue_jobs{state="waiting"}) tells you when you need them.
 */
@Injectable()
export class WorkerService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private worker?: Worker<DeliverJob>;
  private depthTimer?: NodeJS.Timeout;

  constructor(private readonly delivery: DeliveryService) {}

  onApplicationBootstrap(): void {
    this.worker = new Worker<DeliverJob>(
      NOTIFICATIONS_QUEUE,
      async (job: Job<DeliverJob>) => {
        const endTimer = jobDuration.startTimer();
        try {
          const result = await this.delivery.deliver(job.data.notificationId);
          endTimer({ result });
          return result;
        } catch (err) {
          endTimer({ result: 'error' });
          throw err;
        }
      },
      { connection: workerConnection, concurrency: config.WORKER_CONCURRENCY },
    );

    this.worker.on('completed', (job, result) => {
      logger.info({ jobId: job.id, result }, 'notification processed');
    });
    this.worker.on('failed', (job, err) => {
      if (!job) return;
      const final = job.attemptsMade >= (job.opts.attempts ?? 1);
      logger.warn({ jobId: job.id, attempt: job.attemptsMade, final, err: err.message }, 'notification job failed');
      if (final) void this.delivery.markFailed(job.data.notificationId, err.message);
    });
    this.worker.on('error', (err) => logger.error({ err }, 'worker error'));

    this.depthTimer = setInterval(() => void this.reportQueueDepth(), 15_000);
    void this.reportQueueDepth();
    logger.info({ concurrency: config.WORKER_CONCURRENCY }, 'worker started');
  }

  /** Stop taking new jobs and wait for the running ones to finish. */
  async beforeApplicationShutdown(): Promise<void> {
    clearInterval(this.depthTimer);
    await this.worker?.close();
  }

  private async reportQueueDepth(): Promise<void> {
    try {
      const counts = await notificationsQueue().getJobCounts('waiting', 'active', 'delayed', 'failed');
      for (const [state, count] of Object.entries(counts)) queueJobs.set({ state }, count);
    } catch {
      // The queue is unreachable; the worker's own reconnect logs say so.
    }
  }
}
