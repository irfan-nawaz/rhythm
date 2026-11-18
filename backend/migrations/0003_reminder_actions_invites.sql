-- Reminders you can act on, and family invite links.

-- ── "Remind me when it's due" ─────────────────────────────────────
-- An optional heads-up at the due time, before the overdue reminder at due
-- time plus grace. Off by default; weekly quotas never use it.
alter table tasks add column remind_at_due boolean not null default false;
-- When the scheduler should next send that heads-up. Null when it's off.
alter table tasks add column next_nudge_at timestamptz;
create index tasks_next_nudge_idx on tasks (next_nudge_at) where active and notify and remind_at_due;

-- ── Snooze ────────────────────────────────────────────────────────
-- A snoozed reminder is a row delivered later: the queue job is delayed until
-- send_after, and the scheduler's sweep leaves the row alone until then.
alter table notifications add column send_after timestamptz;

-- cancelled: never sent, because the task was done before delivery (someone
-- ticked it off while the reminder was waiting in the queue or snoozed).
alter table notifications drop constraint notifications_status_check;
alter table notifications add constraint notifications_status_check
  check (status in ('queued', 'sent', 'skipped', 'failed', 'cancelled'));

-- ── Invite links ──────────────────────────────────────────────────
-- A link that lets someone join a shared group without the owner knowing
-- their email. Only the SHA-256 of the token is stored, as for sessions, so
-- a leaked database doesn't hand out working links.
create table invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  -- Set: the link lets one person take over this managed member, keeping its
  -- tasks and history (a parent who had been managed by their child gets
  -- their own login). Null: anyone with the link joins as a new member.
  member_id uuid references members (id) on delete cascade,
  token_hash text not null unique,
  max_uses smallint not null check (max_uses between 1 and 50),
  uses smallint not null default 0,
  created_by uuid references users (id) on delete set null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index invites_group_id_idx on invites (group_id);
