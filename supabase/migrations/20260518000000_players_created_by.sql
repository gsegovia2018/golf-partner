-- ============================================================================
-- Player ownership: who created each player row.
-- ============================================================================
--
-- WHAT IT ADDS
-- ------------
--   players.created_by  → the auth user who created the player row.
--                         DEFAULT auth.uid() auto-stamps every new INSERT.
--                         Upserts of an existing player send only name/handicap,
--                         so created_by is never overwritten on update.
--
-- Backfill attributes each player to the owner of the EARLIEST tournament they
-- appear in, then attributes app-user player rows to themselves. Orphaned rows
-- (no owned tournament, no user_id) keep created_by = NULL and stop appearing
-- in any picker.
--
-- HOW TO RUN
-- ----------
--   Paste into the Supabase SQL editor and Run, or `supabase db push`.
--   Idempotent — safe to re-run.
-- ============================================================================

-- 1) Ownership column --------------------------------------------------------
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS created_by uuid
    REFERENCES auth.users(id) ON DELETE SET NULL
    DEFAULT auth.uid();

-- The scoped player readers (fetchMyPlayers / fetchMyGuestPlayers) filter on
-- created_by, so index it.
CREATE INDEX IF NOT EXISTS players_created_by_idx
  ON public.players (created_by);

-- 2) Backfill from tournament history ----------------------------------------
-- Each player is attributed to the owner of the earliest tournament that lists
-- them in its data->'players' JSON array.
UPDATE public.players p
   SET created_by = sub.owner
  FROM (
    SELECT DISTINCT ON ((pl->>'id'))
           (pl->>'id') AS player_id,
           t.created_by AS owner
      FROM public.tournaments t,
           LATERAL jsonb_array_elements(
             COALESCE(t.data->'players', '[]'::jsonb)) pl
     WHERE t.created_by IS NOT NULL
     ORDER BY (pl->>'id'), t.created_at
  ) sub
 WHERE p.id::text = sub.player_id
   AND p.created_by IS NULL;

-- 3) App users own their own player row --------------------------------------
UPDATE public.players
   SET created_by = user_id
 WHERE created_by IS NULL
   AND user_id IS NOT NULL;

/* =========================================================================
   VERIFY
   -------
   -- Column exists:
   SELECT column_name, data_type, column_default
     FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'players'
      AND column_name = 'created_by';

   -- How many rows got an owner vs stayed orphaned:
   SELECT
     count(*) FILTER (WHERE created_by IS NOT NULL) AS owned,
     count(*) FILTER (WHERE created_by IS NULL)     AS orphaned
   FROM public.players;
   ========================================================================= */
