import http from 'node:http';
import client from '@prometheus-io/client';
import type { Logger } from 'pino';

// Every process exposes Prometheus metrics on its own port (METRICS_PORT),
// separate from the public API port, so /metrics is never reachable from the
// internet.
export const registry = new client.Registry();

export function initMetrics(service: string): void {
  registry.setDefaultLabels({ service });
  client.collectDefaultMetrics({ register: registry });
}

export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds, by route template',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const cacheRequests = new client.Counter({
  name: 'cache_requests_total',
  help: 'Cache lookups by result (hit, miss, error)',
  labelNames: ['result'] as const,
  registers: [registry],
});

export const authAttempts = new client.Counter({
  name: 'auth_attempts_total',
  help: 'Sign-in and registration attempts by result',
  labelNames: ['action', 'result'] as const,
  registers: [registry],
});

export const notificationsCreated = new client.Counter({
  name: 'notifications_created_total',
  help: 'Notifications written to the outbox, by kind',
  labelNames: ['kind'] as const,
  registers: [registry],
});

export const notificationDeliveries = new client.Counter({
  name: 'notification_deliveries_total',
  help: 'Delivery attempts by channel and result',
  labelNames: ['channel', 'result'] as const,
  registers: [registry],
});

export const jobDuration = new client.Histogram({
  name: 'notification_job_duration_seconds',
  help: 'Time to process one notification job',
  labelNames: ['result'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [registry],
});

export const queueJobs = new client.Gauge({
  name: 'queue_jobs',
  help: 'Jobs in the notifications queue, by state',
  labelNames: ['state'] as const,
  registers: [registry],
});

export const schedulerTickDuration = new client.Histogram({
  name: 'scheduler_tick_duration_seconds',
  help: 'Duration of one scheduler pass',
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [registry],
});

export const schedulerTasksChecked = new client.Counter({
  name: 'scheduler_tasks_checked_total',
  help: 'Task deadlines checked by the scheduler, by outcome',
  labelNames: ['outcome'] as const,
  registers: [registry],
});

export const sseConnections = new client.Gauge({
  name: 'sse_connections',
  help: 'Open live-update (Server-Sent Events) connections on this process',
  registers: [registry],
});

/** Small HTTP server with /metrics and /healthz, used by every process. */
export function startMetricsServer(port: number, log: Logger): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url === '/metrics') {
      registry
        .metrics()
        .then((body) => {
          res.setHeader('Content-Type', registry.contentType);
          res.end(body);
        })
        .catch((err: unknown) => {
          log.error({ err }, 'failed to render metrics');
          res.statusCode = 500;
          res.end();
        });
      return;
    }
    if (req.url === '/healthz') {
      res.end('ok');
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  server.listen(port, () => log.info({ port }, 'metrics server listening'));
  return server;
}
