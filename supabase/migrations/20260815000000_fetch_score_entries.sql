-- ============================================================================
-- get_game_tournament: assemble scoreEntries / scoreResolutions into each round.
-- ============================================================================
--
-- PROBLEM
-- -------
-- game_score_entries (per-author submissions) and game_score_resolutions
-- (resolution stamps) reached other devices ONLY as realtime postgres_changes
-- row events (store/realtimeSync.js's applyScoreEntryRow /
-- applyScoreResolutionRow). This RPC omitted them, so a device that was
-- offline — or simply not subscribed — while a peer's entry broadcast NEVER
-- learned about it: a score conflict stayed one-sided (or invisible), and the
-- finish gate could pass against a server that actually holds a conflict.
--
-- FIX
-- ---
-- Re-emit the 20260811000000 body (the current definition — column-projected
-- players, createdAt formatting, currentRound/deletedAt conditionals verbatim)
-- with ONE change: each round also carries 'scoreEntries' and
-- 'scoreResolutions', assembled from the two tables in exactly the nested
-- shapes the realtime patchers produce client-side, so a plain fetch is now a
-- recovery path for conflict state:
--   scoreEntries[playerId][hole][authorId] = { value, ts }
--   scoreResolutions[playerId][hole]       = { value, by, ts }
-- Hole keys are the plain hole number (as a JSON object key); `ts` is epoch
-- MILLISECONDS, matching the client's `new Date(updated_at).getTime()`.
--
-- Both keys are OMITTED entirely for a round with no rows (the HAVING guards
-- below turn the aggregate into NULL, which COALESCE folds to '{}'), and no
-- empty per-player/per-hole bucket is ever emitted — same contract the
-- patchers keep by pruning empty buckets, so a fetch and a realtime patch
-- converge on the same object.
--
-- get_my_game_tournaments (20260728000004) delegates to this function per
-- tournament, so the Home list inherits the same keys with no change of its own.
--
-- Idempotent (CREATE OR REPLACE). Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_game_tournament(p_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_t   record;
  v_out jsonb;
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
    'players', COALESCE((
      SELECT jsonb_agg(
        CASE WHEN gp.user_id IS NULL
             THEN (gp.body - 'user_id') || jsonb_build_object('id', gp.player_id)
             ELSE gp.body || jsonb_build_object('id', gp.player_id,
                                                'user_id', gp.user_id::text)
        END
        ORDER BY gp.pos, gp.player_id)
      FROM public.game_players gp WHERE gp.tournament_id = p_id), '[]'::jsonb),
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
        -- Per-author entries, three levels deep (player -> hole -> author).
        -- strokes NULL is a real blank submission and is KEPT (it replicates a
        -- cleared cell), unlike game_scores above which filters nulls out.
        || COALESCE((
             SELECT jsonb_build_object('scoreEntries', jsonb_object_agg(byp.player_id, byp.per))
             FROM (
               SELECT byh.player_id, jsonb_object_agg(byh.hole::text, byh.authors) AS per
               FROM (
                 SELECT e.player_id, e.hole,
                        jsonb_object_agg(e.author_id, jsonb_build_object(
                          'value', e.strokes,
                          'ts', (extract(epoch from e.updated_at) * 1000)::bigint)) AS authors
                 FROM public.game_score_entries e
                 WHERE e.round_id = gr.id AND e.tournament_id = gr.tournament_id
                 GROUP BY e.player_id, e.hole) byh
               GROUP BY byh.player_id) byp
             HAVING count(*) > 0), '{}'::jsonb)
        -- One resolution per player+hole; `by` mirrors resolved_by (may be null).
        || COALESCE((
             SELECT jsonb_build_object('scoreResolutions', jsonb_object_agg(byp.player_id, byp.per))
             FROM (
               SELECT r.player_id, jsonb_object_agg(r.hole::text, jsonb_build_object(
                        'value', r.value, 'by', r.resolved_by,
                        'ts', (extract(epoch from r.resolved_at) * 1000)::bigint)) AS per
               FROM public.game_score_resolutions r
               WHERE r.round_id = gr.id AND r.tournament_id = gr.tournament_id
               GROUP BY r.player_id) byp
             HAVING count(*) > 0), '{}'::jsonb)
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

  RETURN v_out;
END $$;

/* ===========================================================================
   HOW TO RUN
   ---------------------------------------------------------------------------
   Paste into the Supabase SQL editor and Run. Idempotent — safe to re-run.

   VERIFY
   ---------------------------------------------------------------------------
   -- a round with entries must emit them player -> hole -> author, ts in ms
   SELECT r->>'id' AS round_id, r->'scoreEntries', r->'scoreResolutions'
     FROM jsonb_array_elements(
            public.get_game_tournament('<a tournament id>')->'rounds') r;

   -- cross-check against the tables
   SELECT round_id, player_id, hole, author_id, strokes,
          (extract(epoch from updated_at) * 1000)::bigint AS ts
     FROM public.game_score_entries WHERE tournament_id = '<a tournament id>'
    ORDER BY round_id, player_id, hole, author_id;

   -- a round with no entries must have NEITHER key (not an empty object)
   SELECT r ? 'scoreEntries' AS has_entries, r ? 'scoreResolutions' AS has_res
     FROM jsonb_array_elements(
            public.get_game_tournament('<a tournament id>')->'rounds') r;
   =========================================================================== */
