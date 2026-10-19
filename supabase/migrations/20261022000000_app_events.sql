-- Usage telemetry: which features friends actually use. Written by
-- src/lib/telemetry.js (`track(name, props)`), batched from an offline queue;
-- users can turn it off in Settings (`usageStats`).
--
-- `id` is generated on the phone so a retried batch is a no-op
-- (upsert ... on conflict do nothing). `created_at` is when the event
-- happened on the phone, not when it arrived.
--
-- Users insert their own rows and can read back only their own (needed by
-- the upsert below); there is no update/delete policy. Everyone's events
-- are read through the service role / SQL editor.
create table if not exists public.app_events (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 64),
  props       jsonb check (props is null or pg_column_size(props) <= 2048),
  app_version text check (char_length(app_version) <= 32),
  created_at  timestamptz not null default now()
);

create index if not exists app_events_name_created_idx on public.app_events (name, created_at);
create index if not exists app_events_user_idx on public.app_events (user_id);

alter table public.app_events enable row level security;

create policy app_events_insert on public.app_events
  for insert to authenticated with check (user_id = (select auth.uid()));

-- The client writes with upsert ... on conflict do nothing (retry-safe), and
-- Postgres only allows that under RLS when the row is also visible to the user.
create policy app_events_select_own on public.app_events
  for select to authenticated using (user_id = (select auth.uid()));

-- Queries (SQL editor):
--
-- 1. What gets used, last 30 days: events and distinct users per event.
--   select name, count(*) as events, count(distinct user_id) as users
--   from app_events where created_at > now() - interval '30 days'
--   group by name order by users desc, events desc;
--
-- 2. Tab and stats-tab reach: who opens which screen, last 30 days.
--   select name, props->>'tab' as tab, count(distinct user_id) as users, count(*) as views
--   from app_events
--   where name in ('tab_viewed', 'stats_tab_viewed') and created_at > now() - interval '30 days'
--   group by 1, 2 order by 1, users desc;
--
-- 3. Rounds vs shot logging per user: rounds started/finished, shots
--    logged and on how many days any shot was logged.
--   select user_id,
--     count(distinct props->>'tid') filter (where name = 'round_started') as games_started,
--     count(*) filter (where name = 'round_finished') as rounds_finished,
--     count(*) filter (where name = 'shot_logged') as shots,
--     count(distinct created_at::date) filter (where name = 'shot_logged') as days_with_shots
--   from app_events group by user_id order by rounds_finished desc;
--
-- 4. Weekly active users per feature area (rounds / swing / coach / league).
--   select date_trunc('week', created_at) as week,
--     count(distinct user_id) filter (where name like 'round_%' or name = 'shot_logged') as golfers,
--     count(distinct user_id) filter (where name = 'swing_recorded') as swing,
--     count(distinct user_id) filter (where name = 'stats_tab_viewed' and props->>'tab' = 'coach') as coach,
--     count(distinct user_id) filter (where name = 'league_action') as league
--   from app_events group by 1 order by 1 desc;
