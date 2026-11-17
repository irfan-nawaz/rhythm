-- Rhythm: initial schema.
-- Migrations run once per deploy, before the new code starts (npm run db:migrate,
-- or node dist/scripts/migrate.js in production). Never edit a migration that
-- has been applied somewhere; add a new numbered file instead.

-- People with an account.
create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  name text not null,
  timezone text not null default 'Asia/Kolkata',
  notify_push boolean not null default true,
  notify_email boolean not null default true,
  kcal_target integer,
  protein_target_g integer,
  carbs_target_g integer,
  fat_target_g integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index users_email_key on users (lower(email));

-- Signed-in browsers. The id is a SHA-256 hash of the cookie token, so a
-- database leak does not leak usable sessions.
create table sessions (
  id text primary key,
  user_id uuid not null references users (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  user_agent text,
  ip text
);
create index sessions_user_id_idx on sessions (user_id);
create index sessions_expires_at_idx on sessions (expires_at);

-- Groups: everyone has a 'personal' group; 'shared' groups are Home, Family, ...
create table groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'shared' check (kind in ('personal', 'shared')),
  timezone text not null default 'Asia/Kolkata',
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Members of a group. user_id is null for managed members without an
-- account, such as children.
create table members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  user_id uuid references users (id) on delete cascade,
  name text not null,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now()
);
create unique index members_group_user_key on members (group_id, user_id);
create index members_user_id_idx on members (user_id);

-- Things to do. Schedules:
--   daily         every day, by due_time
--   weekly        on days_of_week (1 = Monday ... 7 = Sunday), by due_time
--   weekly_quota  times_per_week times in a Monday-Sunday week, checked on
--                 days_of_week (normally Sunday) at due_time
create table tasks (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  assignee_member_id uuid references members (id) on delete set null,
  title text not null,
  emoji text,
  notes text,
  schedule_type text not null check (schedule_type in ('daily', 'weekly', 'weekly_quota')),
  days_of_week smallint[],
  due_time text not null check (due_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  times_per_week smallint check (times_per_week between 1 and 7),
  grace_minutes smallint not null default 15 check (grace_minutes between 0 and 240),
  notify boolean not null default true,
  active boolean not null default true,
  sort_order integer not null default 0,
  -- When the scheduler should next check this task (the next due time plus grace).
  next_check_at timestamptz,
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_group_id_idx on tasks (group_id);
create index tasks_assignee_idx on tasks (assignee_member_id);
-- The scheduler's hot query, "which tasks need a check now?", reads only this index.
create index tasks_next_check_idx on tasks (next_check_at) where active and notify;

-- One row per task per local calendar day it was done.
create table task_completions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks (id) on delete cascade,
  member_id uuid references members (id) on delete set null,
  completed_by uuid references users (id) on delete set null,
  occurrence_date date not null,
  completed_at timestamptz not null default now()
);
create unique index task_completions_task_date_key on task_completions (task_id, occurrence_date);

-- Notifications double as an outbox: the scheduler writes a row in the same
-- transaction as its decision, then a worker delivers it.
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  task_id uuid references tasks (id) on delete cascade,
  kind text not null,
  occurrence_key text not null,
  title text not null,
  body text not null,
  url text not null default '/',
  status text not null default 'queued' check (status in ('queued', 'sent', 'skipped', 'failed')),
  channels text[] not null default '{}',
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
-- Idempotency: one notification per user, task and occurrence, no matter how
-- many scheduler replicas run or how often a check is retried.
create unique index notifications_dedupe_key on notifications (user_id, task_id, kind, occurrence_key);
create index notifications_user_created_idx on notifications (user_id, created_at desc);
create index notifications_queued_idx on notifications (created_at) where status = 'queued';

-- Browsers and phones that accept push notifications.
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on push_subscriptions (user_id);

-- Exercise catalog (owner_user_id is null) plus each user's own exercises.
create table exercises (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references users (id) on delete cascade,
  name text not null,
  muscle_group text not null,
  equipment text not null,
  kind text not null check (kind in ('weight_reps', 'bodyweight_reps', 'duration', 'distance_duration')),
  created_at timestamptz not null default now()
);
create index exercises_owner_idx on exercises (owner_user_id);
create unique index exercises_catalog_name_key on exercises (lower(name)) where owner_user_id is null;

create table workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  title text not null default 'Workout',
  notes text,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index workouts_user_started_idx on workouts (user_id, started_at desc);

create table workout_sets (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references workouts (id) on delete cascade,
  exercise_id uuid not null references exercises (id) on delete restrict,
  position integer not null,
  reps integer check (reps >= 0),
  weight_kg real check (weight_kg >= 0),
  duration_sec integer check (duration_sec >= 0),
  distance_m integer check (distance_m >= 0),
  rpe real check (rpe between 1 and 10),
  created_at timestamptz not null default now()
);
create index workout_sets_workout_idx on workout_sets (workout_id, position);
create index workout_sets_exercise_idx on workout_sets (exercise_id);

-- Food catalog plus each user's own foods. Nutrition values are per 100 g.
create table foods (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references users (id) on delete cascade,
  name text not null,
  brand text,
  kcal real not null check (kcal >= 0),
  protein_g real not null check (protein_g >= 0),
  carbs_g real not null check (carbs_g >= 0),
  fat_g real not null check (fat_g >= 0),
  fiber_g real not null default 0 check (fiber_g >= 0),
  serving_g real not null default 100 check (serving_g > 0),
  serving_label text,
  created_at timestamptz not null default now()
);
create index foods_owner_idx on foods (owner_user_id);
create unique index foods_catalog_name_key on foods (lower(name)) where owner_user_id is null;

-- What someone ate. Name and macros are copied at the time of logging, so
-- editing or deleting a food never rewrites history.
create table food_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  food_id uuid references foods (id) on delete set null,
  food_name text not null,
  eaten_on date not null,
  meal text not null check (meal in ('breakfast', 'lunch', 'dinner', 'snack')),
  quantity_g real not null check (quantity_g > 0),
  kcal real not null,
  protein_g real not null,
  carbs_g real not null,
  fat_g real not null,
  created_at timestamptz not null default now()
);
create index food_entries_user_day_idx on food_entries (user_id, eaten_on);
