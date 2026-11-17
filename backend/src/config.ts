import { z } from 'zod';

// Local development reads backend/.env. In production, configuration comes from
// real environment variables (Kubernetes, systemd, docker run -e ...), never a file.
if (process.env.NODE_ENV !== 'production') {
  try {
    process.loadEnvFile('.env');
  } catch {
    // No .env file: the defaults below are meant for local development.
  }
}

const flag = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true' || v === '1'));

const int = (fallback: number) => z.coerce.number().int().nonnegative().default(fallback);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SERVICE_NAME: z.string().optional(),

  HOST: z.string().default('0.0.0.0'),
  PORT: int(4000),
  METRICS_PORT: z.coerce.number().int().positive().optional(),

  DATABASE_URL: z.string().default('postgres://rhythm:rhythm@localhost:5432/rhythm'),
  DB_POOL_MAX: int(10),
  DB_PREPARE: flag(true),

  CACHE_URL: z.string().default('redis://localhost:6379'),
  QUEUE_URL: z.string().default('redis://localhost:6380'),

  APP_URL: z.string().default('http://localhost:3000'),
  COOKIE_SECURE: flag(false),
  SESSION_TTL_DAYS: int(30),
  TRUST_PROXY: z.string().default('false'),

  RATE_LIMIT_MAX: int(300),
  RATE_LIMIT_AUTH_MAX: int(10),

  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('Rhythm <no-reply@rhythm.local>'),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:admin@rhythm.local'),
  // Allow webhooks to private addresses (192.168.x.x, 10.x.x.x, localhost), for
  // example a Home Assistant on your LAN. Off in production unless you set it.
  WEBHOOK_ALLOW_PRIVATE: z.enum(['true', 'false', '1', '0']).optional(),

  WORKER_CONCURRENCY: int(10),
  SCHEDULER_INTERVAL_MS: int(30_000),
  SCHEDULER_BATCH_SIZE: int(500),
  NOTIFY_MAX_LATENESS_MINUTES: int(180),

  SHUTDOWN_DELAY_MS: z.coerce.number().int().nonnegative().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
  console.error(`Invalid configuration:\n${lines.join('\n')}`);
  process.exit(1);
}
const env = parsed.data;

// In production a missing URL must stop the process, not silently fall back to localhost.
if (env.NODE_ENV === 'production') {
  const missing = ['DATABASE_URL', 'CACHE_URL', 'QUEUE_URL', 'APP_URL'].filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`Missing required configuration: ${missing.join(', ')}`);
    process.exit(1);
  }
}

/** Which process this is, from SERVICE_NAME or the entry file (src/api/main.ts -> "api"). */
function inferServiceName(): string {
  if (env.SERVICE_NAME) return env.SERVICE_NAME;
  const match = /(api|worker|scheduler)[/\\]main\.[jt]s$/.exec(process.argv[1] ?? '');
  return match?.[1] ?? 'rhythm';
}

function parseTrustProxy(value: string): boolean | number | string {
  if (value === 'true') return true;
  if (value === 'false' || value === '') return false;
  if (/^\d+$/.test(value)) return Number(value); // number of proxy hops to trust
  return value; // comma-separated IP addresses or CIDR ranges
}

const serviceName = inferServiceName();
const defaultMetricsPorts: Record<string, number> = { api: 9464, worker: 9465, scheduler: 9466 };

export const config = {
  ...env,
  serviceName,
  isProduction: env.NODE_ENV === 'production',
  metricsPort: env.METRICS_PORT ?? defaultMetricsPorts[serviceName] ?? 9464,
  trustProxy: parseTrustProxy(env.TRUST_PROXY),
  shutdownDelayMs: env.SHUTDOWN_DELAY_MS ?? (env.NODE_ENV === 'production' ? 5000 : 0),
  pushEnabled: Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY),
  webhookAllowPrivate:
    env.WEBHOOK_ALLOW_PRIVATE === undefined ? env.NODE_ENV !== 'production' : ['true', '1'].includes(env.WEBHOOK_ALLOW_PRIVATE),
};
