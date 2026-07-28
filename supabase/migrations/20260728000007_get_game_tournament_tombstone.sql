-- ============================================================================
-- get_game_tournament emits `deletedAt` so a client can see a tombstone.
-- ============================================================================
--
-- PROBLEM
-- -------
-- 20260728000004 made deletion a tombstone and filtered it out of the LIST
-- RPC, but deliberately kept get_game_tournament serving tombstoned rows so
-- restore and direct links keep working. It did not, however, TELL the caller
-- the row is tombstoned -- the emitted keys were exactly
-- id,kind,name,rounds,players,settings,createdAt,currentRound.
--
-- Home's "LIVE" hero does not read the list. It reads the ACTIVE tournament:
-- @golf_active_id -> readLocal(activeId) -> the cached blob. deleteTournament
-- clears that pointer and drops the blob, but only on the device that ran the
-- delete. Any other device kept a cached blob and an active pointer it had no
-- way to invalidate: the list said "All caught up" while the hero still
-- advertised a LIVE round for a game deleted hours earlier, with no way to
-- clear it short of wiping storage.
--
-- FIX
-- ---
-- Emit `deletedAt` when, and only when, the tombstone is set. Live rows keep
-- the exact blob shape they had before this migration -- round-trip equality
-- against the client's cached JSON is exacting (see the createdAt comment
-- below), so an always-present key would churn every cached blob.
-- The client can now purge a tombstoned tournament locally on its next read.
--
-- Deliberately unchanged: a tombstoned tournament is still SERVED. Restore and
-- direct links must keep working; only the caller's interpretation changes.
--
-- Identical to the version in 20260712000000_sync_v2_normalized.sql apart from
-- the deletedAt block at the end. Idempotent (CREATE OR REPLACE).
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
    'players', COALESCE((
      SELECT jsonb_agg(gp.body ORDER BY gp.pos, gp.player_id)
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
