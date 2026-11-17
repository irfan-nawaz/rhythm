import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { config } from '../config.js';
import { InfraModule } from '../infra.module.js';
import { logger } from '../logger.js';
import { initMetrics, startMetricsServer } from '../metrics.js';
import { PinoNestLogger } from '../nest-logger.js';
import { DeliveryService } from './delivery.service.js';
import { WorkerService } from './worker.service.js';

// Like the scheduler, the worker is a Nest application context with no public
// HTTP server; it only listens on METRICS_PORT for /metrics and /healthz.

@Module({ imports: [InfraModule], providers: [DeliveryService, WorkerService] })
class WorkerModule {}

async function bootstrap(): Promise<void> {
  initMetrics(config.serviceName);
  startMetricsServer(config.metricsPort, logger);
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: new PinoNestLogger(logger) });
  app.enableShutdownHooks(['SIGTERM', 'SIGINT'], { useProcessExit: true });
}

bootstrap().catch((err: unknown) => {
  logger.fatal({ err }, 'worker failed to start');
  process.exit(1);
});
