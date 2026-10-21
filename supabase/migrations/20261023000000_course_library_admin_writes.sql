-- ============================================================================
-- Course library: everyone reads, only admins write.
--
-- courses, course_holes, course_tees and clubs were an any-authenticated-user
-- editable library (`*_write FOR ALL USING (true)`, migrations 20260518000003,
-- 20260519000000, 20260715000003). With the federation import the library is
-- shared by every user, so one person could rename or delete a course for all.
--
-- Writes now go through public.is_geo_admin() (migration 20260728000007), the
-- same allowlist that guards the course-geometry tables and mirrors
-- ADMIN_USER_IDS in src/lib/admin.js. Reads are unchanged (`*_select`, any
-- authenticated user). Policies are permissive, so the SELECT policy keeps
-- reads open while this one limits INSERT / UPDATE / DELETE.
--
-- Not affected: favorite_courses (per-user rows, own policies); a round's own
-- holes and tees (stored with the game); scripts that seed with the service
-- role key (bypasses RLS).
--
-- Idempotent (drop-if-exists then create). Safe to re-run.
-- ============================================================================

drop policy if exists courses_write on public.courses;
drop policy if exists courses_admin_write on public.courses;
create policy courses_admin_write on public.courses
  for all to authenticated
  using (public.is_geo_admin())
  with check (public.is_geo_admin());

drop policy if exists course_holes_write on public.course_holes;
drop policy if exists course_holes_admin_write on public.course_holes;
create policy course_holes_admin_write on public.course_holes
  for all to authenticated
  using (public.is_geo_admin())
  with check (public.is_geo_admin());

drop policy if exists course_tees_write on public.course_tees;
drop policy if exists course_tees_admin_write on public.course_tees;
create policy course_tees_admin_write on public.course_tees
  for all to authenticated
  using (public.is_geo_admin())
  with check (public.is_geo_admin());

drop policy if exists clubs_write on public.clubs;
drop policy if exists clubs_admin_write on public.clubs;
create policy clubs_admin_write on public.clubs
  for all to authenticated
  using (public.is_geo_admin())
  with check (public.is_geo_admin());

comment on function public.is_geo_admin() is
  'App admins (hardcoded allowlist, mirrors ADMIN_USER_IDS in src/lib/admin.js). '
  'Guards writes to the course geometry (golf_*) and the course library '
  '(courses, course_holes, course_tees, clubs).';

/* =========================================================================
   VERIFY (run after applying)

   select tablename, policyname, cmd, qual, with_check from pg_policies
   where schemaname = 'public'
     and tablename in ('courses', 'course_holes', 'course_tees', 'clubs')
   order by tablename, policyname;
   -- expect per table: <t>_select (SELECT, true) and <t>_admin_write
   -- (ALL, is_geo_admin()), and no <t>_write.
   ========================================================================= */
