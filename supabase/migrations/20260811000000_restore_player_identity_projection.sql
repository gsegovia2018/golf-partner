-- ============================================================================
-- get_game_tournament: restore the column projection of player identity.
-- ============================================================================
--
-- REGRESSION
-- ----------
-- 20260728000000 made game_players.user_id (the column) the source of truth:
-- claim/release write ONLY the column, and get_game_tournament projected
-- id/user_id from the columns into each emitted player.
--
-- 20260728000007 then added the deletedAt tombstone by CREATE OR REPLACE-ing
-- get_game_tournament — but its body was branched from the ORIGINAL
-- 20260712000000 version ("Identical to the version in 20260712... apart from
-- the deletedAt block"), which predates the projection. That silently reverted
-- the 'players' aggregate to `jsonb_agg(gp.body)`: identity served from the
-- stale body again, while claim/release kept writing only the column.
--
-- Observable damage on the live schema:
--   * a claim was invisible to every fetch (single RPC and, via delegation,
--     get_my_game_tournaments) — only the realtime patcher (fixed in e14a114)
--     saw it, so identity FLAPPED: claim arrives over the socket, next
--     background fetch strips it, _overlayAndSave persists the stripped
--     roster ("Who are you?" mid-round);
--   * a release kept serving the dead claim from body forever;
--   * once local lost the claim, the client's next game_players upsert wrote
--     user_id = NULL into the COLUMN, destroying the claim at the source.
--
-- FIX
-- ---
-- Re-emit the exact 20260728000007 body with ONE change: the 'players'
-- aggregate is the column-projecting CASE from 20260728000000 (id always from
-- the column; user_id added only when the column is non-null, stripped from
-- body when it is null, so an unclaimed slot has NO user_id key rather than a
-- null-valued one). Everything else — createdAt formatting, rounds assembly,
-- currentRound and deletedAt conditionals — is verbatim from 20260728000007.
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
    -- unclaimed slot still has NO user_id key (not a null-valued one). This
    -- is the projection 20260728000007 accidentally reverted.
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
   -- a slot claimed via claim_tournament_player (column-only write) must now
   -- emit its user_id; an unclaimed slot must OMIT the key even when a stale
   -- body still carries one
   SELECT p->>'id' AS id, p ? 'user_id' AS has_user_id, p->>'user_id' AS user_id
     FROM jsonb_array_elements(
            public.get_game_tournament('<a tournament id>')->'players') p;

   -- cross-check against the columns
   SELECT player_id, user_id FROM public.game_players
    WHERE tournament_id = '<a tournament id>' ORDER BY pos, player_id;
   =========================================================================== */
