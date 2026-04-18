-- ============================================================================
-- Users + sharing schema for the `gs/users` branch.
-- ============================================================================
--
-- HOW TO RUN
-- ----------
-- 1. Open: https://supabase.com/dashboard/project/cxqugzmgbcknlxfipfse/sql/new
-- 2. Paste this entire file and click "Run".
-- 3. Run the verification queries at the bottom (inside /* VERIFY */).
--
-- The script is idempotent — safe to re-run if something fails partway.
--
-- WHAT IT ADDS
-- ------------
--   1. tournaments.created_by   → owner of a tournament (FK → auth.users)
--   2. tournament_members       → who else can view a tournament (role)
--   3. tournament_invites       → 6-char invite codes to join
--   4. profiles                 → per-user display_name, handicap, avatar_color
--                                 (auto-created by trigger on auth.users insert)
--   + RLS policies so owners/members only see their own data, and invite
--     codes are lookupable by any signed-in user (needed by
--     joinTournamentByCode in src/store/tournamentStore.js).
--
-- NOTES
-- -----
-- - Pre-existing rows in `tournaments` have created_by = NULL; the policies
--   keep them readable to every signed-in user so historical data isn't lost.
--   Back-fill ownership later if needed:
--     UPDATE public.tournaments SET created_by = '<uid>' WHERE created_by IS NULL;
-- - The `tournament_id` column type matches whatever `tournaments.id` already
--   is (bigint or text) — detected at runtime in the DO block below.
-- ============================================================================

DO $$
DECLARE
  id_type text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
    INTO id_type
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'tournaments'
     AND a.attname = 'id'
     AND a.attnum > 0;

  IF id_type IS NULL THEN
    RAISE EXCEPTION 'public.tournaments.id not found';
  END IF;

  -- 1) Owner column on tournaments
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'tournaments'
       AND column_name = 'created_by'
  ) THEN
    EXECUTE 'ALTER TABLE public.tournaments
               ADD COLUMN created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL';
  END IF;

  -- 2) Members table (composite PK matches the upsert in joinTournamentByCode)
  EXECUTE format($f$
    CREATE TABLE IF NOT EXISTS public.tournament_members (
      tournament_id %s NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
      user_id       uuid NOT NULL REFERENCES auth.users(id)        ON DELETE CASCADE,
      role          text NOT NULL DEFAULT 'viewer',
      created_at    timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tournament_id, user_id)
    )
  $f$, id_type);

  -- 3) Invite codes (one active code per tournament; code is globally unique)
  EXECUTE format($f$
    CREATE TABLE IF NOT EXISTS public.tournament_invites (
      id            bigserial PRIMARY KEY,
      tournament_id %s NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
      code          text NOT NULL UNIQUE,
      created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
      created_at    timestamptz NOT NULL DEFAULT now()
    )
  $f$, id_type);
END $$;

-- Helpful indexes for the queries in src/store/tournamentStore.js
CREATE INDEX IF NOT EXISTS tournament_members_user_id_idx
  ON public.tournament_members (user_id);
CREATE INDEX IF NOT EXISTS tournament_invites_tournament_id_idx
  ON public.tournament_invites (tournament_id);
CREATE INDEX IF NOT EXISTS tournaments_created_by_idx
  ON public.tournaments (created_by);

-- Row-level security.
-- Matches the app's intent: a signed-in user sees tournaments they own,
-- plus legacy rows with NULL created_by, plus any tournament they've
-- been invited into. Invite codes are readable by any signed-in user
-- (required for joinTournamentByCode lookup).

ALTER TABLE public.tournaments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tournaments_select     ON public.tournaments;
DROP POLICY IF EXISTS tournaments_insert     ON public.tournaments;
DROP POLICY IF EXISTS tournaments_update     ON public.tournaments;
DROP POLICY IF EXISTS tournaments_delete     ON public.tournaments;
DROP POLICY IF EXISTS members_select         ON public.tournament_members;
DROP POLICY IF EXISTS members_insert_self    ON public.tournament_members;
DROP POLICY IF EXISTS members_delete_self    ON public.tournament_members;
DROP POLICY IF EXISTS invites_select         ON public.tournament_invites;
DROP POLICY IF EXISTS invites_insert_owner   ON public.tournament_invites;

CREATE POLICY tournaments_select ON public.tournaments
  FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR created_by IS NULL
    OR EXISTS (
      SELECT 1 FROM public.tournament_members m
       WHERE m.tournament_id = tournaments.id
         AND m.user_id = auth.uid()
    )
  );

CREATE POLICY tournaments_insert ON public.tournaments
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() OR created_by IS NULL);

CREATE POLICY tournaments_update ON public.tournaments
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR created_by IS NULL)
  WITH CHECK (created_by = auth.uid() OR created_by IS NULL);

CREATE POLICY tournaments_delete ON public.tournaments
  FOR DELETE TO authenticated
  USING (created_by = auth.uid());

CREATE POLICY members_select ON public.tournament_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.tournaments t
       WHERE t.id = tournament_members.tournament_id
         AND t.created_by = auth.uid()
    )
  );

CREATE POLICY members_insert_self ON public.tournament_members
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY members_delete_self ON public.tournament_members
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.tournaments t
       WHERE t.id = tournament_members.tournament_id
         AND t.created_by = auth.uid()
    )
  );

-- Invites: any signed-in user can read (needed to resolve a code).
-- Only the tournament owner can create them.
CREATE POLICY invites_select ON public.tournament_invites
  FOR SELECT TO authenticated USING (true);

CREATE POLICY invites_insert_owner ON public.tournament_invites
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tournaments t
       WHERE t.id = tournament_invites.tournament_id
         AND (t.created_by = auth.uid() OR t.created_by IS NULL)
    )
  );

-- ============================================================================
-- profiles: per-user display info (display_name, handicap, avatar_color)
-- ============================================================================

-- Handles both fresh install and a pre-existing legacy profiles table
-- (earlier iterations had column `id` instead of `user_id` and lacked
-- avatar_color / updated_at). Rename + add columns in place rather than
-- drop — the legacy row is the real user's profile.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='profiles' AND column_name='id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='profiles' AND column_name='user_id'
  ) THEN
    EXECUTE 'ALTER TABLE public.profiles RENAME COLUMN id TO user_id';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.profiles (
  user_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  text,
  handicap      int,
  avatar_color  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Add any columns the legacy table was missing
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_color text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select ON public.profiles;
DROP POLICY IF EXISTS profiles_insert ON public.profiles;
DROP POLICY IF EXISTS profiles_update ON public.profiles;

-- Any authenticated user can read profiles (so UIs can show "John joined your
-- tournament"). Only the profile owner can insert/update their own row.
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY profiles_insert ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Trigger: auto-create a profile row whenever a new auth.users row is
-- inserted. Pre-fills display_name with the email local-part so the first
-- sign-in already has something sensible.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (new.id, split_part(new.email, '@', 1))
  ON CONFLICT (user_id) DO NOTHING;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- One-off back-fill: create rows for any users that already existed before
-- the trigger was installed. Safe to re-run.
INSERT INTO public.profiles (user_id, display_name)
SELECT u.id, split_part(u.email, '@', 1)
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.user_id = u.id
 WHERE p.user_id IS NULL;

/* =========================================================================
   VERIFY — run these one at a time after the migration to confirm success.
   =========================================================================

-- (a) Tables exist with the expected columns
SELECT table_name, column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name IN ('tournaments', 'tournament_members', 'tournament_invites', 'profiles')
 ORDER BY table_name, ordinal_position;

-- (b) RLS is enabled on all four
SELECT relname, relrowsecurity
  FROM pg_class
 WHERE relname IN ('tournaments', 'tournament_members', 'tournament_invites', 'profiles');

-- (c) Policies are in place
SELECT tablename, policyname, cmd
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('tournaments', 'tournament_members', 'tournament_invites', 'profiles')
 ORDER BY tablename, policyname;

-- (d) Trigger installed + back-fill worked (count should equal auth.users count)
SELECT tgname FROM pg_trigger WHERE tgname = 'on_auth_user_created';
SELECT (SELECT count(*) FROM auth.users)     AS auth_users,
       (SELECT count(*) FROM public.profiles) AS profiles;

========================================================================= */
