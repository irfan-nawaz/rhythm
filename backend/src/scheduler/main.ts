import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { config } from '../config.js';
import { InfraModule } from '../infra.module.js';
import { logger } from '../logger.js';
import { initMetrics, startMetricsServer } from '../metrics.js';
import { PinoNestLogger } from '../nest-logger.js';
import { SchedulerService } from './scheduler.service.js';

// The scheduler has no public HTTP server: a Nest "application context" gives
// it modules, dependency injection and shutdown hooks without one. It only
// listens on METRICS_PORT for /metrics and /healthz.

@Module({ imports: [InfraModule], providers: [SchedulerService] })
class SchedulerModule {}

async function bootstrap(): Promise<void> {
  initMetrics(config.serviceName);
  startMetricsServer(config.metricsPort, logger);
  const app = await NestFactory.createApplicationContext(SchedulerModule, { logger: new PinoNestLogger(logger) });
  app.enableShutdownHooks(['SIGTERM', 'SIGINT'], { useProcessExit: true });
}

bootstrap().catch((err: unknown) => {
  logger.fatal({ err }, 'scheduler failed to start');
  process.exit(1);
});
