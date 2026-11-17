import type { FastifyInstance } from 'fastify';
import { httpRequestDuration } from '../../metrics.js';

const PROBES = new Set(['/healthz', '/readyz']);

/**
 * Fastify-level hooks for every request:
 * - echo the request id back in an x-request-id header (pass one in from the
 *   load balancer and you can follow a request across every log line);
 * - record latency in a Prometheus histogram, labelled by route template
 *   (/api/tasks/:id, never the raw URL, which would create a new time series
 *   per task id);
 * - write one log line per request. Health probes are skipped: Kubernetes
 *   calls them every few seconds on every pod.
 */
export function registerHttpHooks(fastify: FastifyInstance): void {
  fastify.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  fastify.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions.url ?? 'unmatched';
    const seconds = reply.elapsedTime / 1000;
    httpRequestDuration.observe({ method: req.method, route, status_code: String(reply.statusCode) }, seconds);
    if (PROBES.has(route)) return;
    req.log.info(
      {
        method: req.method,
        url: req.url,
        route,
        statusCode: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
        userId: req.user?.id,
      },
      'request',
    );
  });
}
