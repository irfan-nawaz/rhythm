import type { LoggerService } from '@nestjs/common';
import type { Logger } from 'pino';

// Sends NestJS's own log lines through pino, so every line from every process
// is JSON in the same format.
const quietContexts = new Set(['InstanceLoader', 'RoutesResolver', 'RouterExplorer', 'NestFactory']);

export class PinoNestLogger implements LoggerService {
  constructor(private readonly pino: Logger) {}

  log(message: unknown, context?: string) {
    if (context && quietContexts.has(context)) this.pino.debug({ context }, String(message));
    else this.pino.info({ context }, String(message));
  }

  error(message: unknown, trace?: string, context?: string) {
    this.pino.error({ context, trace }, String(message));
  }

  warn(message: unknown, context?: string) {
    this.pino.warn({ context }, String(message));
  }

  debug(message: unknown, context?: string) {
    this.pino.debug({ context }, String(message));
  }

  verbose(message: unknown, context?: string) {
    this.pino.trace({ context }, String(message));
  }

  fatal(message: unknown, context?: string) {
    this.pino.fatal({ context }, String(message));
  }
}
