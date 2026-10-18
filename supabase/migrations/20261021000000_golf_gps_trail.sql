-- GPS trail experiment: the raw position feed of a player's own phone during
-- a live round, recorded only when they turn on the "Record GPS trail (test)"
-- setting. Used offline to evaluate automatic stop/shot detection
-- (scripts/analyzeGpsTrail.mjs); nothing in the app reads it back.
--
-- One row per chunk of up to 500 points, appended client-side by
-- src/store/gpsTrailStore.js: `points` is [{ t, lat, lng, acc, spd? }, ...]
-- with `t` in epoch ms. A growing tail chunk is re-upserted under the same
-- seq. tournament_id is part of the key because round ids are only unique
-- per tournament ("r0", "r1", ... — see 20260712000000_sync_v2_normalized).
--
-- Private to its author: RLS scopes every operation to auth.uid().
create table if not exists public.golf_gps_trail (
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tournament_id text not null,
  round_id      text not null,
  round_index   int  not null,
  seq           int  not null,           -- 0-based chunk number within the round
  points        jsonb not null,
  created_at    timestamptz not null default now(),
  primary key (user_id, tournament_id, round_id, round_index, seq)
);

alter table public.golf_gps_trail enable row level security;

-- Owner-only: a user sees and mutates only their own trail.
create policy golf_gps_trail_select on public.golf_gps_trail
  for select using (user_id = auth.uid());
create policy golf_gps_trail_insert on public.golf_gps_trail
  for insert with check (user_id = auth.uid());
create policy golf_gps_trail_update on public.golf_gps_trail
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy golf_gps_trail_delete on public.golf_gps_trail
  for delete using (user_id = auth.uid());
