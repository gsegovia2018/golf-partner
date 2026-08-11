-- ============================================================================
-- create_game_tournament: a retry must never clobber a claim made meanwhile.
-- ============================================================================
--
-- PROBLEM
-- -------
-- The game_players upsert in 20260728000006 ends with
--   ON CONFLICT ... DO UPDATE SET user_id = EXCLUDED.user_id, ...
-- The payload is the roster frozen at ENQUEUE time (mutationWrites carries
-- m.tournament verbatim), and the sync queue retries a create until it
-- succeeds. So: create a game offline (creator slot user_id NULL), a friend
-- claims their slot via claim_tournament_player before the queue drains, then
-- the drained create re-runs and overwrites the fresh claim with NULL.
--
-- FIX
-- ---
-- COALESCE(EXCLUDED.user_id, gp.user_id) on the conflict arm — the same
-- keep-existing rule the sync-v2 backfill used (20260712000000) and the same
-- discipline add_tournament_player_if_room applies (its conflict arm does not
-- touch user_id at all). A create payload can still SET a claim (non-null
-- wins); it can no longer ERASE one. Erasing claims is exclusively
-- release_tournament_player's job.
--
-- Everything except that one line is verbatim from 20260728000006.
-- Idempotent (CREATE OR REPLACE). Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_game_tournament(p_payload jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_t public.tournaments%ROWTYPE;
BEGIN
  v_t := jsonb_populate_record(NULL::public.tournaments, p_payload->'tournament');

  IF v_t.id IS NULL THEN
    RAISE EXCEPTION 'create_game_tournament: payload.tournament.id is required';
  END IF;

  -- `data` is deliberately not written: the legacy blob column is dead
  -- (20260728000002 dropped its NOT NULL) and nothing reads it after sync-v2.
  INSERT INTO public.tournaments AS t
    (id, name, kind, created_at, created_by, props, current_round)
  VALUES
    (v_t.id, v_t.name, COALESCE(v_t.kind, 'casual'), COALESCE(v_t.created_at, now()),
     -- The tournaments_insert policy is WITH CHECK (created_by = auth.uid()),
     -- so default to the caller rather than trusting the client to send it: a
     -- payload without created_by would otherwise be rejected by RLS, not
     -- silently mis-owned.
     COALESCE(v_t.created_by, auth.uid()),
     COALESCE(v_t.props, '{}'::jsonb), v_t.current_round)
  ON CONFLICT (id) DO UPDATE SET
    name          = EXCLUDED.name,
    kind          = EXCLUDED.kind,
    created_at    = EXCLUDED.created_at,
    props         = EXCLUDED.props,
    current_round = EXCLUDED.current_round,
    -- A retry from a signed-out device must never orphan an owned game.
    created_by    = COALESCE(EXCLUDED.created_by, t.created_by);

  INSERT INTO public.game_players AS gp (tournament_id, player_id, user_id, pos, body, updated_at)
  SELECT r.tournament_id, r.player_id, r.user_id, r.pos, r.body, r.updated_at
  FROM jsonb_populate_recordset(NULL::public.game_players,
                                COALESCE(p_payload->'players', '[]'::jsonb)) r
  ON CONFLICT (tournament_id, player_id) DO UPDATE SET
    -- Keep-existing: a stale retry payload must not erase a claim written by
    -- claim_tournament_player between enqueue and drain.
    user_id = COALESCE(EXCLUDED.user_id, gp.user_id), pos = EXCLUDED.pos,
    body = EXCLUDED.body, updated_at = EXCLUDED.updated_at;

  INSERT INTO public.game_rounds (id, tournament_id, round_index, body, updated_at)
  SELECT r.id, r.tournament_id, r.round_index, r.body, r.updated_at
  FROM jsonb_populate_recordset(NULL::public.game_rounds,
                                COALESCE(p_payload->'rounds', '[]'::jsonb)) r
  ON CONFLICT (tournament_id, id) DO UPDATE SET
    round_index = EXCLUDED.round_index,
    body = EXCLUDED.body, updated_at = EXCLUDED.updated_at;

  INSERT INTO public.game_scores (round_id, tournament_id, player_id, hole, strokes, updated_at)
  SELECT r.round_id, r.tournament_id, r.player_id, r.hole, r.strokes, r.updated_at
  FROM jsonb_populate_recordset(NULL::public.game_scores,
                                COALESCE(p_payload->'scores', '[]'::jsonb)) r
  ON CONFLICT (tournament_id, round_id, player_id, hole) DO UPDATE SET
    strokes = EXCLUDED.strokes, updated_at = EXCLUDED.updated_at;

  INSERT INTO public.game_shot_details (round_id, tournament_id, player_id, hole, detail, updated_at)
  SELECT r.round_id, r.tournament_id, r.player_id, r.hole, r.detail, r.updated_at
  FROM jsonb_populate_recordset(NULL::public.game_shot_details,
                                COALESCE(p_payload->'shot_details', '[]'::jsonb)) r
  ON CONFLICT (tournament_id, round_id, player_id, hole) DO UPDATE SET
    detail = EXCLUDED.detail, updated_at = EXCLUDED.updated_at;

  INSERT INTO public.game_round_notes (round_id, tournament_id, hole_key, note, updated_at)
  SELECT r.round_id, r.tournament_id, r.hole_key, r.note, r.updated_at
  FROM jsonb_populate_recordset(NULL::public.game_round_notes,
                                COALESCE(p_payload->'notes', '[]'::jsonb)) r
  ON CONFLICT (tournament_id, round_id, hole_key) DO UPDATE SET
    note = EXCLUDED.note, updated_at = EXCLUDED.updated_at;
END $$;

COMMENT ON FUNCTION public.create_game_tournament(jsonb) IS
  'Atomically create a game: tournaments row + game_players/rounds/scores/shot_details/round_notes in one transaction. SECURITY INVOKER — RLS authorizes every insert. Retries keep existing claims: user_id = COALESCE(EXCLUDED, current).';
