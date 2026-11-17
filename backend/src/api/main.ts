import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import { StandardSchemaValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { LogController, type FastifyRequest } from 'fastify';
import { cacheClient } from '../cache.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { initMetrics, startMetricsServer } from '../metrics.js';
import { PinoNestLogger } from '../nest-logger.js';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter, validationException } from './common/errors.js';
import { registerHttpHooks } from './common/http-hooks.js';
import { registerSessionHook } from './common/session.js';

/** TRUST_PROXY=2 means "trust the nearest 2 proxies", e.g. Cloudflare and the ingress. */
const trustHops = (hops: number) => (_address: string, hop: number) => hop < hops;

async function bootstrap(): Promise<void> {
  initMetrics(config.serviceName);

  const adapter = new FastifyAdapter({
    loggerInstance: logger,
    // Behind a load balancer or Cloudflare, the client's IP arrives in
    // X-Forwarded-For. Trust it only from your proxies (see TRUST_PROXY),
    // or every visitor looks like the proxy's IP to the rate limiter.
    trustProxy: typeof config.trustProxy === 'number' ? trustHops(config.trustProxy) : config.trustProxy,
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
    bodyLimit: 64 * 1024,
    // One log line per request is written in http-hooks.ts instead of Fastify's two.
    logController: new LogController({ requestIdLogLabel: 'requestId', disableRequestLogging: true }),
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: new PinoNestLogger(logger),
  });

  // Errors raised inside Fastify (bad JSON, the rate limiter's 429) also reach
  // Nest's exception layer, so AllExceptionsFilter formats every error response.
  const fastify = app.getHttpAdapter().getInstance();
  await app.register(fastifyCookie);
  await app.register(fastifyHelmet, { contentSecurityPolicy: false }); // JSON API; the frontend server sets its own CSP
  registerHttpHooks(fastify);
  registerSessionHook(fastify);

  // Counted in the cache, so the limit is shared by every API replica. Keyed by
  // user when signed in, by IP otherwise. If the cache is down, requests are
  // allowed rather than rejected (skipOnError).
  await app.register(fastifyRateLimit, {
    global: true,
    max: config.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    hook: 'preHandler',
    redis: cacheClient(),
    nameSpace: 'ratelimit:',
    skipOnError: true,
    keyGenerator: (req: FastifyRequest) => (req.user ? `user:${req.user.id}` : `ip:${req.ip}`),
  });

  app.useGlobalPipes(new StandardSchemaValidationPipe({ exceptionFactory: validationException }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks(['SIGTERM', 'SIGINT'], { useProcessExit: true });

  startMetricsServer(config.metricsPort, logger);
  await app.listen({ host: config.HOST, port: config.PORT });
  logger.info({ port: config.PORT }, 'api listening');
}

bootstrap().catch((err: unknown) => {
  logger.fatal({ err }, 'api failed to start');
  process.exit(1);
});
