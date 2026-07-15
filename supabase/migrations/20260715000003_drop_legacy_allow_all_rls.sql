-- ============================================================================
-- Close the legacy "allow-all" RLS hole + revoke anon DML on core tables.
-- ============================================================================
--
-- WHY
-- ---
-- Five tables in production carry pre-migrations legacy policies that apply to
-- PUBLIC with `USING (true)`, and `anon` holds full DML grants on them. Because
-- Postgres OR's permissive policies together, these make the correctly-scoped
-- policies (which already exist for `tournaments` and `profiles`) inert, and
-- leave `players`/`courses`/`course_holes` wide open. Net effect: any caller,
-- including unauthenticated (anon), can read/write/delete the entire dataset —
-- and every sync-v2 `game_*` table delegates its own RLS to `tournaments`
-- visibility, so the open `tournaments` policy exposes all scores/rosters too.
--
-- Confirmed live on prod 2026-07-15:
--   tournaments  | allow_all  | ALL    | PUBLIC | USING true
--   players      | allow all  | ALL    | PUBLIC | USING true
--   profiles     | read_all   | SELECT | PUBLIC | USING true
--   courses      | allow all  | ALL    | PUBLIC | USING true
--   course_holes | allow all  | ALL    | PUBLIC | USING true
-- None of these five are defined by any migration file.
--
-- WHAT THIS DOES
-- --------------
--   1. Drops the five legacy policies.
--   2. Revokes all anon grants on the five tables (anon must never touch them).
--   3. Adds scoped policies ONLY for players/courses/course_holes, which would
--      otherwise be left with no policy at all (= deny-all, app broken).
--      `tournaments` and `profiles` already have full scoped policy sets that
--      activate the moment their legacy policy is gone — nothing to add there.
--
-- ACCESS MODEL (verified against src/store/libraryStore.js)
-- --------------------------------------------------------
--   players      → shared library, read by any signed-in user (fetchPlayers
--                  reads all; fetchMyPlayers scopes client-side). Writes are
--                  owner-scoped via players.created_by (DEFAULT auth.uid()).
--   courses /    → globally shared, any-authenticated-user-editable library.
--   course_holes   There is NO owner column, so writes stay authenticated-wide
--                  (matches current app behaviour). Tightening to per-owner
--                  would require adding courses.created_by first — out of scope.
--
-- NOTE ON ANON READ: this revokes anon access entirely. The official-tournament
-- flow for invited/anonymous users goes through SECURITY DEFINER token RPCs,
-- not direct table reads, so no anon table read is expected. If a signed-out
-- course-browse path is ever needed, add an explicit `TO anon` SELECT policy on
-- courses/course_holes — do NOT restore a blanket allow-all.
--
-- Idempotent (drop-if-exists then create). Safe to re-run.
-- ============================================================================

-- 1) Drop the legacy PUBLIC allow-all / read-all policies --------------------
DROP POLICY IF EXISTS "allow_all"  ON public.tournaments;
DROP POLICY IF EXISTS "allow all"  ON public.players;
DROP POLICY IF EXISTS "read_all"   ON public.profiles;
DROP POLICY IF EXISTS "allow all"  ON public.courses;
DROP POLICY IF EXISTS "allow all"  ON public.course_holes;

-- 2) Revoke anon DML (RLS is enabled on all five; anon should have no reach) --
REVOKE ALL ON public.tournaments  FROM anon;
REVOKE ALL ON public.players      FROM anon;
REVOKE ALL ON public.profiles     FROM anon;
REVOKE ALL ON public.courses      FROM anon;
REVOKE ALL ON public.course_holes FROM anon;

-- 3) Scoped policies for the three tables that would otherwise be deny-all ----

-- players: shared read for signed-in users; owner-scoped writes. -------------
DROP POLICY IF EXISTS players_select ON public.players;
CREATE POLICY players_select ON public.players
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS players_insert ON public.players;
CREATE POLICY players_insert ON public.players
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());   -- created_by DEFAULT auth.uid() stamps it

DROP POLICY IF EXISTS players_update ON public.players;
CREATE POLICY players_update ON public.players
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS players_delete ON public.players;
CREATE POLICY players_delete ON public.players
  FOR DELETE TO authenticated
  USING (created_by = auth.uid());

-- courses: shared, any-authenticated-user-editable library (no owner column). -
DROP POLICY IF EXISTS courses_select ON public.courses;
CREATE POLICY courses_select ON public.courses
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS courses_write ON public.courses;
CREATE POLICY courses_write ON public.courses
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- course_holes: same shared-library model, scoped to authenticated. ----------
DROP POLICY IF EXISTS course_holes_select ON public.course_holes;
CREATE POLICY course_holes_select ON public.course_holes
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS course_holes_write ON public.course_holes;
CREATE POLICY course_holes_write ON public.course_holes
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

/* =========================================================================
   VERIFY (run after applying)
   ---------------------------
   -- No PUBLIC allow-all left on any of the five:
   SELECT c.relname, p.polname, p.polroles::regrole[] AS roles,
          pg_get_expr(p.polqual, p.polrelid) AS using_expr
     FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    WHERE c.relname IN ('tournaments','players','profiles','courses','course_holes')
    ORDER BY c.relname, p.polname;
   -- Expect: no row with roles {-} and using_expr 'true' except profiles.manage_own
   --         (auth.uid() = user_id, which anon can never satisfy).

   -- Anon holds no grants on the five:
   SELECT table_name, grantee, privilege_type
     FROM information_schema.role_table_grants
    WHERE table_schema='public'
      AND table_name IN ('tournaments','players','profiles','courses','course_holes')
      AND grantee='anon';
   -- Expect: zero rows.

   -- Smoke (must all succeed for the app): as an authenticated user, SELECT
   -- players/courses returns rows; INSERT a player (created_by auto-stamped)
   -- succeeds; UPDATE/DELETE of a player you did NOT create is denied.
   ========================================================================= */
