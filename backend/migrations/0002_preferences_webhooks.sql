-- Per-person display preferences, and outgoing webhooks as a reminder channel.

alter table users
  add column theme text not null default 'system'
    check (theme in ('system', 'light', 'dark', 'kids', 'large')),
  add column locale text not null default 'en'
    check (locale in ('en', 'hi'));

-- POSTed to by the worker when a reminder goes out. Each delivery is signed
-- with the secret (HMAC-SHA256), so the receiver can check it came from Rhythm.
create table webhooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  url text not null,
  secret text not null,
  description text,
  last_status integer,
  last_delivery_at timestamptz,
  created_at timestamptz not null default now()
);
create index webhooks_user_idx on webhooks (user_id);
