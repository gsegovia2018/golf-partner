-- GPS course geometry, moved out of the bundled src/data/courseGeometry.json
-- into Postgres so courses can be added/edited without shipping an app build.
-- Coordinates are [lat, lng] pairs stored as jsonb, matching the shape the
-- client geo helpers already consume (src/lib/geo.js). No PostGIS: all
-- distance math runs on-device (haversine), the server only stores/serves.
--
-- RLS disabled to mirror the existing tournaments/media tables — the 4 friends
-- share the anon key and the seed script writes with it. If real auth lands,
-- switch to public-read + service-role-write in a follow-up.

-- One row per course/layout.
create table if not exists public.golf_course (
  id           text primary key,          -- stable slug, e.g. 'lomas-bosque'
  name         text not null,
  mode         text not null check (mode in ('holes', 'greens')),
  match_tokens jsonb not null,            -- [["villa de madrid"], ["ccvm"], ...]
  source       text,                       -- provenance, e.g. 'OpenStreetMap (ODbL)'
  updated_at   timestamptz not null default now()
);

-- Per-hole geometry for mode='holes' courses. Polygons/points are jsonb:
--   green        [[lat,lng], ...] | null   (green outline)
--   green_center [lat,lng]                 (centroid; pin fallback)
--   pin          [lat,lng] | null
--   tees         [[lat,lng], ...] | null
--   start_pt     [lat,lng] | null          (teeing ground reference)
create table if not exists public.golf_hole (
  course_id    text not null references public.golf_course (id) on delete cascade,
  number       int  not null,
  par          int,
  green        jsonb,
  green_center jsonb,
  pin          jsonb,
  tees         jsonb,
  start_pt     jsonb,
  primary key (course_id, number)
);

-- Hazards for a hole (bunker/water). ordinal keeps a stable order per hole.
create table if not exists public.golf_hazard (
  id          bigint generated always as identity primary key,
  course_id   text not null references public.golf_course (id) on delete cascade,
  hole_number int  not null,
  kind        text not null check (kind in ('bunker', 'water')),
  poly        jsonb not null,             -- [[lat,lng], ...]
  ordinal     int  not null default 0
);
create index if not exists golf_hazard_hole_idx
  on public.golf_hazard (course_id, hole_number);

-- Greens for mode='greens' courses (per-hole numbering unknown; nearest-green
-- targeting). center is optional — geo.js recomputes the centroid from poly.
create table if not exists public.golf_green (
  id        bigint generated always as identity primary key,
  course_id text not null references public.golf_course (id) on delete cascade,
  ordinal   int  not null default 0,
  poly      jsonb not null,               -- [[lat,lng], ...]
  center    jsonb
);
create index if not exists golf_green_course_idx
  on public.golf_green (course_id, ordinal);

alter table public.golf_course disable row level security;
alter table public.golf_hole   disable row level security;
alter table public.golf_hazard disable row level security;
alter table public.golf_green  disable row level security;
