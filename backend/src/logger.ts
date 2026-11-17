import { pino } from 'pino';
import { config } from './config.js';

// JSON logs in production (one object per line, ready for Loki or any log
// collector). Human-readable logs in development.
export const logger = pino({
  level: config.LOG_LEVEL,
  base: { service: config.serviceName },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['req.headers.cookie', 'req.headers.authorization', 'password', '*.password'],
    censor: '[redacted]',
  },
  ...(config.isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }),
});
