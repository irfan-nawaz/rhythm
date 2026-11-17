import { Controller, Get, Inject, Injectable, Res, type BeforeApplicationShutdown } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyReply } from 'fastify';
import { config } from '../../config.js';
import type { Sql } from '../../db.js';
import { CacheService, SQL } from '../../infra.module.js';
import { logger } from '../../logger.js';
import { sleep } from '../../shutdown.js';
import { noRateLimit, Public } from '../common/auth.js';
import { LiveService } from '../live/live.js';

/**
 * Graceful shutdown, step 1. On SIGTERM, readiness starts failing while the
 * server keeps serving for SHUTDOWN_DELAY_MS, giving the load balancer time to
 * stop sending new requests here. Nest then closes the server, which waits
 * for in-flight requests, and only after that are database connections closed.
 */
@Injectable()
export class DrainState implements BeforeApplicationShutdown {
  draining = false;

  constructor(private readonly live: LiveService) {}

  async beforeApplicationShutdown(): Promise<void> {
    this.draining = true;
    logger.info({ delayMs: config.shutdownDelayMs }, 'readiness failing; draining traffic before closing');
    await sleep(config.shutdownDelayMs);
    await this.live.closeAll();
  }
}

async function check(probe: () => Promise<unknown>, timeoutMs = 1000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      probe(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

@Public()
@Controller()
export class HealthController {
  constructor(
    private readonly drain: DrainState,
    private readonly cache: CacheService,
    @Inject(SQL) private readonly sql: Sql,
  ) {}

  /**
   * Liveness: can the process answer at all? It checks nothing else on purpose.
   * If it checked the database, a database outage would make Kubernetes
   * restart every API pod at once.
   */
  @Get('healthz')
  @RouteConfig(noRateLimit)
  liveness() {
    return { status: 'ok' };
  }

  /**
   * Readiness: should this instance get traffic right now? Fails while
   * draining or when the database is unreachable. The cache is reported but
   * doesn't fail readiness, because the API still works (slower) without it.
   */
  @Get('readyz')
  @RouteConfig(noRateLimit)
  async readiness(@Res({ passthrough: true }) reply: FastifyReply) {
    if (this.drain.draining) {
      reply.status(503);
      return { status: 'draining' };
    }
    const [database, cache] = await Promise.all([check(() => this.sql`select 1`), check(() => this.cache.ping())]);
    reply.status(database ? 200 : 503);
    return {
      status: database ? 'ready' : 'not_ready',
      checks: { database: database ? 'ok' : 'failing', cache: cache ? 'ok' : 'degraded' },
    };
  }
}
