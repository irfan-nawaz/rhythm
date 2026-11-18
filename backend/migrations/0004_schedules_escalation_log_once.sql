-- More ways to repeat a task, escalation to a family member, and tasks that
-- tick themselves off when you log a meal or a workout.

-- ── Schedules ─────────────────────────────────────────────────────
--   once          on start_date
--   monthly       on day_of_month; a shorter month uses its last day
--   yearly        on month_of_year and day_of_month; 29 Feb is 28 Feb in
--                 other years
--   every_n_days  every interval_days days, counting from start_date
--   after_done    interval_days after it was last done; start_date until
--                 the first time
-- These five carry over: a missed one stays on Today until it's done, while
-- a missed daily or weekly task is simply missed.
alter table tasks drop constraint tasks_schedule_type_check;
alter table tasks add constraint tasks_schedule_type_check check (schedule_type in
  ('daily', 'weekly', 'weekly_quota', 'once', 'monthly', 'yearly', 'every_n_days', 'after_done'));
alter table tasks add column start_date date;
alter table tasks add column interval_days smallint check (interval_days between 1 and 365);
alter table tasks add column day_of_month smallint check (day_of_month between 1 and 31);
alter table tasks add column month_of_year smallint check (month_of_year between 1 and 12);

-- ── Escalation ────────────────────────────────────────────────────
-- "If Papa hasn't done it, tell me": a member with an account who hears
-- about the task escalate_after_minutes after the overdue reminder's time.
alter table tasks add column escalate_member_id uuid references members (id) on delete set null;
alter table tasks add column escalate_after_minutes smallint not null default 30
  check (escalate_after_minutes between 5 and 1440);
alter table tasks add column next_escalation_at timestamptz;
create index tasks_next_escalation_idx on tasks (next_escalation_at)
  where active and notify and escalate_member_id is not null;

-- ── Log once ──────────────────────────────────────────────────────
-- Logging that meal (or any workout) ticks the task off for the day.
alter table tasks add column auto_complete text
  check (auto_complete in ('breakfast', 'lunch', 'dinner', 'snack', 'workout'));
create index tasks_auto_complete_idx on tasks (auto_complete) where auto_complete is not null;
