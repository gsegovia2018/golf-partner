-- ============================================================================
-- Deleting a game stops destroying its history.
--
-- PROBLEM
-- -------
--   deleteTournament ran a hard DELETE on public.tournaments, and every
--   history table cascades off it:
--     game_players, game_rounds -> game_scores, game_score_entries,
--     game_score_resolutions, game_shot_details, game_round_notes
--   One tap from History or the finished-game screen therefore destroyed the
--   round permanently -- every stroke, every per-author entry, every shot
--   detail -- with no undo, no archive and no export. For an app whose whole
--   point is keeping a record of rounds played, that was the single largest
--   risk to the data.
--
-- FIX
-- ---
--   A tombstone column. `deleted_at` marks a tournament as removed; the row
--   and ALL its children stay exactly where they are. The list RPC filters
--   tombstoned rows out, so the app behaves as before -- the game disappears
--   -- but nothing is destroyed and a restore is one UPDATE away.
--
--   get_game_tournament deliberately still serves a tombstoned tournament:
--   restoring one, or opening it from a direct link, must work. Only the
--   LIST hides them.
--
-- No purge job. Rows stay until somebody consciously removes them; see the
-- RESTORE / PURGE snippets at the bottom.
--
-- Idempotent (IF NOT EXISTS / CREATE OR REPLACE); safe to re-run. Adds a
-- nullable column and rewrites one function -- no existing row is modified.
-- ============================================================================

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMENT ON COLUMN public.tournaments.deleted_at IS
  'Soft-delete tombstone. Non-null = hidden from the tournament list but '
  'fully intact, including every game_* child row. Restore by setting NULL.';

-- Partial index: the list RPC filters on `deleted_at IS NULL` on every read,
-- and live rows are the overwhelming majority.
CREATE INDEX IF NOT EXISTS tournaments_live_idx
  ON public.tournaments (created_at DESC)
  WHERE deleted_at IS NULL;

-- The list RPC hides tombstoned tournaments. Identical to the version in
-- 20260712000000_sync_v2_normalized.sql apart from the added
-- `deleted_at IS NULL` predicates (one per branch of the role union, plus the
-- anonymous branch).
CREATE OR REPLACE FUNCTION public.get_my_game_tournaments()
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN
    SELECT COALESCE(jsonb_agg(
             jsonb_build_object('tournament', public.get_game_tournament(t.id), 'role', 'owner')
             ORDER BY t.created_at DESC), '[]'::jsonb)
      INTO v_out
      FROM public.tournaments t
     WHERE t.deleted_at IS NULL;
    RETURN v_out;
  END IF;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object('tournament', public.get_game_tournament(x.id), 'role', x.role)
           ORDER BY x.created_at DESC), '[]'::jsonb)
    INTO v_out
    FROM (
      SELECT DISTINCT ON (u.id) u.id, u.created_at, u.role
      FROM (
        -- owner: created_by = me, or NULL (anonymous-era rows) — prio 1
        SELECT t.id, t.created_at, 'owner'::text AS role, 1 AS prio
        FROM public.tournaments t
        WHERE (t.created_by = v_uid OR t.created_by IS NULL)
          AND t.deleted_at IS NULL
        UNION ALL
        -- member: tournament_members row for me, role carried through as-is — prio 2
        SELECT t.id, t.created_at, tm.role, 2 AS prio
        FROM public.tournament_members tm
        JOIN public.tournaments t ON t.id = tm.tournament_id
        WHERE tm.user_id = v_uid
          AND t.deleted_at IS NULL
        UNION ALL
        -- participant fallback (see tournamentStore.js comment on the
        -- tournament_participants query) — prio 3
        SELECT t.id, t.created_at, 'participant'::text AS role, 3 AS prio
        FROM public.tournament_participants tp
        JOIN public.tournaments t ON t.id = tp.tournament_id
        WHERE tp.user_id = v_uid
          AND t.deleted_at IS NULL
      ) u
      ORDER BY u.id, u.prio) x;

  RETURN v_out;
END $$;

/* ===========================================================================
   HOW TO RUN
   ---------------------------------------------------------------------------
   Paste into the Supabase SQL editor and Run. Idempotent -- safe to re-run.
   Destroys nothing.

   VERIFY
   ---------------------------------------------------------------------------
   SELECT count(*) AS total, count(deleted_at) AS tombstoned
     FROM public.tournaments;

   RESTORE a deleted game
   ---------------------------------------------------------------------------
   UPDATE public.tournaments SET deleted_at = NULL WHERE id = '<id>';

   LIST what is currently tombstoned, and how much history each still holds
   ---------------------------------------------------------------------------
   SELECT t.id, t.name, t.deleted_at,
          (SELECT count(*) FROM public.game_scores s WHERE s.tournament_id = t.id)
            AS strokes_held
     FROM public.tournaments t
    WHERE t.deleted_at IS NOT NULL
    ORDER BY t.deleted_at DESC;

   PURGE FOR REAL (irreversible -- cascades every game_* child row)
   ---------------------------------------------------------------------------
   -- Only run deliberately, and take a backup first.
   -- DELETE FROM public.tournaments
   --  WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '90 days';
   =========================================================================== */
