# Rhythm

Daily routines, chores, workouts and meals for a family, in one app. Rhythm
reminds you when something isn't done on time, keeps a shared list of chores
for the home, tracks gym sessions and logs food against macro goals.

This repository is a complete product built to practise operations on. The
application code is finished and tested. Everything that turns it into a
production service (container images, infrastructure, CI/CD, TLS, monitoring,
backups, load testing) is deliberately left out. That is the exercise.

Start with [docs/architecture.md](docs/architecture.md): it's the handover
document, describing what each process needs, how it behaves and what will
break first under load.

## What's inside

```
rhythm/
├── frontend/        Next.js 16 web app and installable PWA
├── backend/         NestJS 12 on Fastify: one codebase, three processes
│   ├── src/api/        HTTP API, sessions, server-sent events
│   ├── src/worker/     delivers notifications (push, email, webhooks)
│   ├── src/scheduler/  finds late tasks, creates reminders
│   ├── src/scripts/    migrate and seed
│   └── migrations/     plain SQL, applied in order
├── docs/            architecture and runtime contract
└── compose.yaml     local Postgres, Valkey x2 and Mailpit (dependencies only)
```

| Layer | Choices |
|---|---|
| Web | Next.js 16 (App Router, standalone output), React 19, TanStack Query, Tailwind CSS 4, shadcn/ui, next-intl, next-themes |
| API | NestJS 12 on Fastify 5, Zod validation, postgres.js, argon2 password hashing |
| Background work | BullMQ on Valkey, Web Push (VAPID), SMTP via Nodemailer, signed webhooks |
| Data | PostgreSQL 18, Valkey 9 as a cache and, separately, as a queue |
| Live updates | Server-sent events, fanned out through Valkey pub/sub |
| Observability | JSON logs (pino) with request IDs, Prometheus metrics on a separate port, health and readiness endpoints |

## Features

- **Today**: the day as a timeline, with each task due at its time. Overdue
  tasks turn turmeric; the header follows the real sky. Bills and one-offs
  that are still waiting stay at the top until they're done.
- **Week, month and year**: the same tasks from further away. A week grid of
  what got done each day, a month calendar coloured by how much got done with
  bills and birthdays on their dates, and a year of small heatmaps with how
  often each task got done.
- **Tasks**: daily, on chosen weekdays ("Tue and Fri"), a number of times a
  week ("clean the bathroom twice a week"), every N days ("water filter every
  90 days"), N days after it was last done ("change the bedsheets 7 days
  after"), monthly ("rent on the 1st"), yearly (birthdays) or once.
- **Family groups**: a personal group plus shared ones (home, parents).
  Members can have accounts, or be managed by you (children). Invite people
  with a link you can send on WhatsApp; someone you set up yourself, such as
  a parent, can take over their own tasks on their own phone the same way.
- **Reminders**: push, email and webhooks (Slack, Discord, Home Assistant)
  when a task isn't done in time, and an optional heads-up when it's due. On
  Android and desktop, the notification has Done and Snooze buttons. If it's
  still not done a while later, Rhythm can tell someone else: "if Papa hasn't
  taken his BP tablet by 9:30, tell me".
- **Fitness**: workouts, sets, records and an estimated 1-rep max trend.
- **Food**: a catalogue of Indian and everyday foods, custom foods, meals,
  macros against daily goals.
- **Log once**: logging lunch on Food, or a workout on Fitness, ticks off the
  Lunch or Gym task on Today.
- **Themes**: light, dark, kids (brighter, rounder, bigger) and large text
  (for parents and grandparents). Saved per account.
- **Languages**: English and Hindi. Missing translations fall back to English.

## Run it locally

You need Node.js 24 (`nvm use` reads `.nvmrc`) and Docker for the dependencies.

```bash
# 1. Postgres, Valkey (cache and queue) and Mailpit
docker compose up -d

# 2. Backend: API on :4000, plus the worker and the scheduler
cd backend
cp .env.example .env
npm install
npm run vapid:keys        # optional: paste the two keys into .env for push
npm run db:migrate
npm run db:seed:demo      # food and exercise catalogues, plus a demo account
npm run dev

# 3. Frontend on :3000, in a second terminal
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

Open http://localhost:3000 and sign in as `demo@rhythm.local` with password
`rhythm-demo`, or create an account. The demo has six weeks of history and an
example of each kind of schedule. `papa@rhythm.local` (same password) is Papa,
whose BP tablet tells Demo when it's missed. Emails land in Mailpit at
http://localhost:8025.

| URL | What |
|---|---|
| http://localhost:3000 | the app |
| http://localhost:4000/healthz, /readyz | API liveness and readiness |
| http://localhost:9464/metrics | API metrics (worker 9465, scheduler 9466) |
| http://localhost:8025 | Mailpit inbox |

## Production commands

Build once, then run each process with `node` directly (not through `npm`), so
it receives SIGTERM and shuts down cleanly.

| Process | Build | Run |
|---|---|---|
| Migrations (once per deploy) | `npm run build` in backend | `node dist/scripts/migrate.js` |
| Catalogues (first deploy) | | `node dist/scripts/seed.js` |
| API | | `node dist/api/main.js` |
| Worker | | `node dist/worker/main.js` |
| Scheduler | | `node dist/scheduler/main.js` |
| Web | `npm run build` in frontend | `node .next/standalone/server.js` |

## Checks

```bash
cd backend && npm run typecheck && npm test
cd frontend && npm run typecheck && npm run build
```

Translation keys are typed against `frontend/messages/en.json`, so a missing
or misspelled key fails the type check.

## Your exercise

A suggested order, each step building on the last:

1. Write Dockerfiles for the backend (one image, three commands) and the
   frontend, and a compose file that runs the whole stack.
2. Add CI: type check, tests, build and push images on every commit.
3. Design the network: VPC, public and private subnets, a load balancer that
   sends `/api/*` to the API and everything else to the web app.
4. Deploy: managed Postgres and Valkey, the four processes, migrations as a
   pre-deploy job, secrets from a secret store.
5. Observe: scrape the metrics, ship the logs, build dashboards and alerts on
   latency, errors, queue depth and notification failures.
6. Load test from several regions, find the first bottleneck, fix it, repeat.
   [docs/architecture.md](docs/architecture.md) lists the likely candidates.
