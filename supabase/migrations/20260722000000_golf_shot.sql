-- Personal GPS shot log. One row per shot the player marks during a round.
-- Shots are private to their author (never part of the shared round blob or
-- scoring consensus), so RLS scopes every operation to auth.uid(). Carry
-- distances are derived client-side from consecutive shots (see shotStats.js);
-- we store only the raw marked position + the club hit.
create table if not exists public.golf_shot (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  round_id     text not null,            -- game/tournament id this shot belongs to
  round_index  int  not null,            -- which round within that tournament
  hole_number  int  not null,
  seq          int  not null,            -- 1-based shot order within the hole
  lat          double precision not null,
  lng          double precision not null,
  club         text,                     -- clubs.js key ('7i', 'driver', …); null = unspecified
  holed        boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (user_id, round_id, round_index, hole_number, seq)
);

create index if not exists golf_shot_owner_round_idx
  on public.golf_shot (user_id, round_id, round_index, hole_number, seq);

alter table public.golf_shot enable row level security;

-- Owner-only: a user sees and mutates only their own shots.
create policy golf_shot_select on public.golf_shot
  for select using (user_id = auth.uid());
create policy golf_shot_insert on public.golf_shot
  for insert with check (user_id = auth.uid());
create policy golf_shot_update on public.golf_shot
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy golf_shot_delete on public.golf_shot
  for delete using (user_id = auth.uid());
