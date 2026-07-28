-- ============================================================================
-- Enable RLS on the golf_* course-geometry tables (public read, admin write).
-- ============================================================================
--
-- CONTEXT
-- -------
-- 20260719000000_course_geometry.sql created golf_course / golf_hole /
-- golf_hazard / golf_green with RLS explicitly DISABLED, on the reasoning that
-- "the 4 friends share the anon key and the seed script writes with it", with a
-- note to switch to public-read + service-role-write "if real auth lands".
-- Real auth landed (Google OAuth; every other table is scoped on auth.uid()),
-- but these four were never revisited. anon holds INSERT/UPDATE/DELETE on all
-- four, so with RLS off anyone holding the project URL + anon key (shipped in
-- every web bundle) can rewrite or delete all course geometry. Supabase's
-- rls_disabled_in_public advisor flagged this as critical on 2026-07-26.
--
-- POLICY SHAPE
-- ------------
-- READ — granted to anon AND authenticated. Deliberate: App.js hydrates
-- geometry at boot (hydrateCourseGeometry) outside any auth gate, so the fetch
-- can race ahead of session restore and go out as anon. The data is
-- OpenStreetMap-derived course outlines — public, non-personal, and already
-- shipped in the bundled seed JSON — so public read costs nothing and avoids a
-- silent "geometry never refreshes" failure. (The store's `if (courses.length)`
-- guard means a blocked read would fail silently rather than loudly.)
--
-- WRITE — no policy for INSERT or DELETE, and UPDATE only on golf_hole for
-- geometry admins. That mirrors the two real writers:
--   * scripts/seedCourseGeometry.mjs — bulk upsert/replace of every table. Now
--     runs with SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS, so it needs no
--     policy. (It previously wrote with the anon key; that is what forced RLS
--     off in the first place.)
--   * HoleGeoEditor — the in-app green front/center/back + tee editor. It only
--     ever UPDATEs golf_hole, and HoleView already gates it behind
--     isAdminUser() from src/lib/admin.js. Until now that gate was client-side
--     only; is_geo_admin() below enforces the same allowlist server-side.
-- This is stricter than the courses/course_holes precedent (write = any
-- authenticated user) because geometry is shared infrastructure edited by a
-- handful of people, not per-user content.
--
-- Idempotent (drop-if-exists then create). Safe to re-run.
-- ============================================================================

-- Server-side mirror of ADMIN_USER_IDS in src/lib/admin.js. KEEP THE TWO LISTS
-- IN SYNC: the client list decides whether the editor button renders, this one
-- decides whether the write is accepted. No admin role exists in the schema,
-- so both are hardcoded allowlists of auth user ids.
create or replace function public.is_geo_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select auth.uid() in (
    '9a2d6444-2777-4ec7-af26-6c5605a31495',  -- guisegma@gmail.com (Guillermo)
    '785bafbe-c2fe-4733-affb-e3c199d3fafe',  -- noepecker@gmail.com (Noé)
    '7a9ec70d-4a4c-4509-bfbb-f1ba09120729',  -- mocander95@gmail.com (Marcos)
    '56d60230-64a6-4c9b-826e-6d91ee6e0843'   -- laertespecker@gmail.com (Marcos, 2nd account)
  );
$$;

alter table public.golf_course enable row level security;
alter table public.golf_hole   enable row level security;
alter table public.golf_hazard enable row level security;
alter table public.golf_green  enable row level security;

-- Public read on all four.
drop policy if exists golf_course_select on public.golf_course;
create policy golf_course_select on public.golf_course
  for select to anon, authenticated using (true);

drop policy if exists golf_hole_select on public.golf_hole;
create policy golf_hole_select on public.golf_hole
  for select to anon, authenticated using (true);

drop policy if exists golf_hazard_select on public.golf_hazard;
create policy golf_hazard_select on public.golf_hazard
  for select to anon, authenticated using (true);

drop policy if exists golf_green_select on public.golf_green;
create policy golf_green_select on public.golf_green
  for select to anon, authenticated using (true);

-- Admin-only write: the HoleGeoEditor path. Everything else (inserts, deletes,
-- and updates to the other three tables) is service-role-only by omission.
drop policy if exists golf_hole_admin_update on public.golf_hole;
create policy golf_hole_admin_update on public.golf_hole
  for update to authenticated
  using (public.is_geo_admin())
  with check (public.is_geo_admin());
