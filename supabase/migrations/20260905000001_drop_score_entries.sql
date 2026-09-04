-- ============================================================================
-- Cutover: the per-cell score layer is retired.
-- Plan: docs/superpowers/plans/2026-09-04-scorecard-cards-engine.md (§5, phase 5)
-- Idempotent; safe to re-run. Same conventions as
-- 20260905000000_scorer_cards.sql.
-- ============================================================================
--
-- WHAT THIS DOES
-- --------------
-- 20260905000000 added scorer_cards / score_resolutions alongside the old
-- game_score_entries / game_score_resolutions, deliberately additive. The
-- client no longer writes or reads the old pair: scores go out as whole card
-- rows (src/engine/store/replicator.js) and come back through the SQL
-- projection into game_scores / game_shot_details. This migration completes
-- the cutover:
--
--   1. Backfill every tournament into scorer_cards while the old tables still
--      exist. backfill_scorer_cards is a no-op wherever cards already exist,
--      so a game that has already been played on the new client is untouched
--      (plan S15).
--   2. Re-declare get_game_tournament WITHOUT the scoreEntries /
--      scoreResolutions round keys 20260815000000 added.
--   3. Drop submit_game_score / resolve_game_score / recompute_game_score /
--      backfill_game_score_entries, unpublish the two tables from
--      supabase_realtime, and drop them.
--
-- ORDER MATTERS. Step 1 reads game_score_entries, so it must run before the
-- drops in step 3. Run this migration AFTER 20260905000000 and AFTER shipping
-- the client that publishes cards — a client still on the old score path
-- would start failing its writes the moment step 3 lands.
--
-- NOT REVERSIBLE. The dropped tables carry the only copy of the per-author
-- history; step 1 folds it into cards, and there is no path back. Take a
-- backup and verify it first (handbook §6).
--
-- HOW TO RUN
-- ----------
--   Paste into the Supabase SQL editor and Run. Idempotent — safe to re-run
--   (steps 2 and 3 are CREATE OR REPLACE / IF EXISTS, and step 1 skips any
--   tournament that already has cards, or is itself skipped once the source
--   tables are gone).
-- ============================================================================

-- 1) Backfill every tournament ------------------------------------------------
-- Guarded on the source table still existing, so a re-run after step 3 is a
-- no-op rather than an error. One call per tournament (the function is
-- per-tournament and idempotent); the row triggers installed by 20260905000000
-- rebuild game_scores / game_shot_details for each round as the cards land.
DO $$
DECLARE
  t record;
BEGIN
  IF to_regclass('public.game_score_entries') IS NULL THEN
    RAISE NOTICE 'game_score_entries already dropped - skipping backfill';
    RETURN;
  END IF;
  FOR t IN SELECT id FROM public.tournaments LOOP
    PERFORM public.backfill_scorer_cards(t.id);
  END LOOP;
END $$;

-- 2) get_game_tournament without scoreEntries / scoreResolutions --------------
-- Verbatim the 20260903000000 definition (identity projection from columns,
-- tournament + player tombstones, conditional currentRound/deletedAt/
-- deletedPlayerIds keys). That version is already free of the two keys
-- 20260815000000 added, so it is re-declared here rather than edited: the
-- point of this step is to make the shape unambiguous no matter which order
-- the migrations were applied in.
--
-- `scores` and `shotDetails` keep being assembled from game_scores /
-- game_shot_details exactly as before — those tables are now the SQL
-- projection of the cards (20260905000000's project_round_scores), so every
-- existing reader (feed, stats, shared board, Home, notifications) is
-- unaffected.
CREATE OR REPLACE FUNCTION public.get_game_tournament(p_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_t       record;
  v_out     jsonb;
  v_removed jsonb;
BEGIN
  SELECT * INTO v_t FROM public.tournaments WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- createdAt must byte-match what the legacy client wrote with JS
  -- `new Date().toISOString()` — "YYYY-MM-DDTHH:MM:SS.mmmZ" (milliseconds
  -- always exactly 3 digits, literal trailing 'Z'). jsonb_build_object on a
  -- raw timestamptz would emit "+00:00" instead of "Z", failing round-trip
  -- equality, so format explicitly.
  v_out := v_t.props || jsonb_build_object(
    'id', v_t.id, 'name', v_t.name,
    'kind', COALESCE(v_t.props->>'kind', v_t.kind),
    'createdAt', to_char(v_t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    -- id ALWAYS from the column. user_id added ONLY when non-null, so an
    -- unclaimed slot still has NO user_id key (not a null-valued one).
    -- CHANGED: tombstoned rows are excluded — they are reported separately as
    -- deletedPlayerIds below rather than served as roster members.
    'players', COALESCE((
      SELECT jsonb_agg(
        CASE WHEN gp.user_id IS NULL
             THEN (gp.body - 'user_id') || jsonb_build_object('id', gp.player_id)
             ELSE gp.body || jsonb_build_object('id', gp.player_id,
                                                'user_id', gp.user_id::text)
        END
        ORDER BY gp.pos, gp.player_id)
      FROM public.game_players gp
      WHERE gp.tournament_id = p_id AND gp.deleted_at IS NULL), '[]'::jsonb),
    'rounds', COALESCE((
      SELECT jsonb_agg(
        (gr.body - 'notes')
        || jsonb_build_object('id', gr.id)
        || jsonb_build_object('scores', COALESCE((
             SELECT jsonb_object_agg(q.player_id, q.per) FROM (
               SELECT s.player_id, jsonb_object_agg(s.hole::text, s.strokes) AS per
               FROM public.game_scores s
               WHERE s.round_id = gr.id AND s.tournament_id = gr.tournament_id AND s.strokes IS NOT NULL
               GROUP BY s.player_id) q), '{}'::jsonb))
        || jsonb_build_object('shotDetails', COALESCE((
             SELECT jsonb_object_agg(q.player_id, q.per) FROM (
               SELECT d.player_id, jsonb_object_agg(d.hole::text, d.detail) AS per
               FROM public.game_shot_details d
               WHERE d.round_id = gr.id AND d.tournament_id = gr.tournament_id AND d.detail IS NOT NULL
               GROUP BY d.player_id) q), '{}'::jsonb))
        || COALESCE((
             SELECT jsonb_build_object('notes',
               COALESCE((SELECT jsonb_build_object('round', n.note)
                         FROM public.game_round_notes n
                         WHERE n.round_id = gr.id AND n.tournament_id = gr.tournament_id AND n.hole_key = 'round' AND n.note IS NOT NULL), '{}'::jsonb)
               || COALESCE((SELECT jsonb_build_object('hole', jsonb_object_agg(n.hole_key, n.note))
                            FROM public.game_round_notes n
                            WHERE n.round_id = gr.id AND n.tournament_id = gr.tournament_id AND n.hole_key <> 'round' AND n.note IS NOT NULL
                            HAVING count(*) > 0), '{}'::jsonb))
             WHERE EXISTS (SELECT 1 FROM public.game_round_notes n2
                           WHERE n2.round_id = gr.id AND n2.tournament_id = gr.tournament_id AND n2.note IS NOT NULL)), '{}'::jsonb)
        ORDER BY gr.round_index, gr.id)
      FROM public.game_rounds gr WHERE gr.tournament_id = p_id), '[]'::jsonb));

  -- Same stale-key defense for the tournament level: 'currentRound' is only
  -- conditionally added, so a stale copy inside props must not survive when
  -- the column is NULL — strip it in both branches, re-adding the live
  -- column value only when present.
  IF v_t.current_round IS NOT NULL THEN
    v_out := (v_out - 'currentRound') || jsonb_build_object('currentRound', v_t.current_round);
  ELSE
    v_out := v_out - 'currentRound';
  END IF;

  -- The tombstone, same conditional treatment: present only while the row is
  -- deleted, so restoring it (deleted_at -> NULL) returns the blob to exactly
  -- the shape a never-deleted tournament has.
  IF v_t.deleted_at IS NOT NULL THEN
    v_out := (v_out - 'deletedAt') || jsonb_build_object('deletedAt',
      to_char(v_t.deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  ELSE
    v_out := v_out - 'deletedAt';
  END IF;

  -- NEW: the removed-player tombstone list. Same conditional-key discipline —
  -- absent (not an empty array) when nothing has been removed, so a tournament
  -- that has never lost a player round-trips to exactly its previous shape,
  -- and props can never leak a stale copy of the key.
  SELECT jsonb_agg(gp.player_id ORDER BY gp.player_id) INTO v_removed
    FROM public.game_players gp
   WHERE gp.tournament_id = p_id AND gp.deleted_at IS NOT NULL;
  IF v_removed IS NOT NULL THEN
    v_out := (v_out - 'deletedPlayerIds') || jsonb_build_object('deletedPlayerIds', v_removed);
  ELSE
    v_out := v_out - 'deletedPlayerIds';
  END IF;

  RETURN v_out;
END $$;

-- 3) Retire the per-cell score layer ------------------------------------------
-- The RPCs first: dropping them before the tables avoids leaving a function
-- whose body references a table that no longer exists.
DROP FUNCTION IF EXISTS public.submit_game_score(text, text, text, int, text, int);
DROP FUNCTION IF EXISTS public.resolve_game_score(text, text, text, int, int, text);
DROP FUNCTION IF EXISTS public.recompute_game_score(text, text, text, int);
DROP FUNCTION IF EXISTS public.backfill_game_score_entries(text);

-- Realtime publication membership. Guarded per table: an already-absent table
-- raises undefined_object (or undefined_table once dropped), and neither must
-- abort the migration.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE public.game_score_entries;
EXCEPTION WHEN undefined_object OR undefined_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE public.game_score_resolutions;
EXCEPTION WHEN undefined_object OR undefined_table THEN NULL; END $$;

DROP TABLE IF EXISTS public.game_score_entries;
DROP TABLE IF EXISTS public.game_score_resolutions;

/* ===========================================================================
   VERIFY (run after applying)
   ---------------------------------------------------------------------------
   -- The old tables are gone:
   SELECT to_regclass('public.game_score_entries')     AS entries,
          to_regclass('public.game_score_resolutions') AS resolutions;
   -- expected: NULL | NULL

   -- The old RPCs are gone:
   SELECT proname FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('submit_game_score', 'resolve_game_score',
                      'recompute_game_score', 'backfill_game_score_entries');
   -- expected: 0 rows

   -- Neither table is still published:
   SELECT tablename FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename IN ('game_score_entries', 'game_score_resolutions');
   -- expected: 0 rows

   -- ...while the cards tables still are:
   SELECT tablename FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename IN ('scorer_cards', 'score_resolutions') ORDER BY 1;
   -- expected: score_resolutions | scorer_cards

   -- Every tournament that had scores now has cards (0 rows = fully migrated):
   SELECT t.id, t.name
     FROM public.tournaments t
    WHERE EXISTS (SELECT 1 FROM public.game_scores s WHERE s.tournament_id = t.id)
      AND NOT EXISTS (SELECT 1 FROM public.scorer_cards c WHERE c.tournament_id = t.id)
    ORDER BY t.id;

   -- The assembled round no longer carries the two retired keys (replace <tid>):
   SELECT r ? 'scoreEntries'     AS has_entries,
          r ? 'scoreResolutions' AS has_resolutions,
          r ? 'scores'           AS has_scores
     FROM jsonb_array_elements(public.get_game_tournament('<tid>') -> 'rounds') r;
   -- expected: f | f | t   for every round

   -- Parity spot check (plan S15): the projection agrees with the cards for
   -- one round (replace <tid>/<rid>). 0 rows = the projected game_scores rows
   -- are exactly the settled cells.
   SELECT * FROM (
     SELECT player_id, hole, strokes FROM public.settled_round_cells('<tid>', '<rid>')
     EXCEPT
     SELECT player_id, hole, strokes FROM public.game_scores
      WHERE tournament_id = '<tid>' AND round_id = '<rid>'
   ) d;
   =========================================================================== */
