-- Explicit green front/back points for accurate distances, set by admins in
-- the in-app hole-geometry editor. Center already exists (green_center); the
-- tee reference reuses start_pt. When these are null, geo.js falls back to the
-- traced green polygon's nearest/farthest vertex.
alter table public.golf_hole
  add column if not exists green_front jsonb,  -- [lat,lng] front edge
  add column if not exists green_back  jsonb;  -- [lat,lng] back edge
