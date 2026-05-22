-- ============================================================================
-- Fix: anonymous sign-in fails with "Database error creating anonymous user".
-- ============================================================================
--
-- HOW TO RUN
-- ----------
--   Paste into the Supabase SQL editor and Run. Idempotent — safe to re-run.
--
-- WHAT IT FIXES
-- -------------
--   The "Continue without an account" button (guest / anonymous sign-in) hit
--   POST /auth/v1/signup -> 500 "Database error creating anonymous user".
--
--   Root cause: schema drift. 20260418000000_add_users.sql creates
--   public.profiles.display_name as a NULLABLE column, but on the live
--   database the column had acquired a NOT NULL constraint.
--
--   The on_auth_user_created trigger runs handle_new_user(), which does:
--       INSERT INTO public.profiles (user_id, display_name)
--       VALUES (new.id, split_part(new.email, '@', 1)) ...
--
--   An anonymous user has new.email IS NULL, so split_part(...) is NULL.
--   With display_name NOT NULL that INSERT raises a not-null violation,
--   the trigger aborts, the auth.users INSERT rolls back, and GoTrue
--   returns 500. Email / OAuth users are unaffected because they have an
--   email, so split_part() yields a non-null local-part.
--
--   sync_player_from_profile() already early-returns when display_name is
--   NULL/blank, so a nullable display_name is the design the rest of the
--   schema expects. This migration simply restores it.
-- ============================================================================

ALTER TABLE public.profiles
  ALTER COLUMN display_name DROP NOT NULL;

/* ===========================================================================
   VERIFY
   ---------------------------------------------------------------------------
   -- display_name is nullable again (is_nullable = 'YES'):
   SELECT column_name, is_nullable
     FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'display_name';

   -- End-to-end: "Continue without an account" now establishes a guest
   -- session instead of returning 500.
   =========================================================================== */
