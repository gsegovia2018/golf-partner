-- ============================================================================
-- create_game_tournament: write a whole new game in ONE transaction.
-- ============================================================================
--
-- CONTEXT
-- -------
-- tournamentRepo.createTournament used to issue six sequential upserts from the
-- client: `tournaments` first, then game_players, game_rounds, game_scores,
-- game_shot_details, game_round_notes. Six statements, six transactions, no
-- atomicity — so between the first and the third the server held a tournament
-- with NO rounds.
--
-- Any fetch landing in that window returned a round-less tournament, and
-- _overlayAndSave (tournamentStore.js) replaces players/rounds with the remote
-- snapshot wholesale, so it erased the just-created game's rounds locally and
-- saved that. HomeScreen then read `rounds[selectedRound]` as undefined, passed
-- `?? null` into roundLeaderboard, and threw:
--
--   TypeError: Cannot read properties of null (reading 'playerHandicaps')
--
-- which the app-wide ErrorBoundary showed as "Algo salió mal" on a game that
-- had in fact been saved. c054e1a taught the merge to refuse such a partial
-- snapshot; this removes the window that produces one. A plpgsql function body
-- runs inside a single transaction, so callers now observe the game either
-- complete or not at all.
--
-- AUTHORIZATION
-- -------------
-- SECURITY INVOKER (the default) — deliberately NOT security definer. Every
-- insert below is checked against the same RLS policies the client's direct
-- upserts already had to satisfy (20260715000005): `tournaments` insert plus
-- can_edit_tournament() on each game_* table. The tournaments row is inserted
-- first, so by the time the game_* inserts run, can_edit_tournament() sees the
-- caller as creator within this same transaction. No privilege escalation and
-- no new writer: this function can do nothing the caller could not already do
-- statement by statement.
--
-- SHAPE
-- -----
-- The payload carries rows already shaped by the client, NOT a tournament blob:
-- the client keeps owning props/kind mapping and stripRoundHotKeys, so this
-- function cannot drift from get_game_tournament's reassembly (whose round-trip
-- equality is exacting). Keys must match column names — jsonb_populate_recordset
-- maps by name and ignores extras.
--
--   {
--     "tournament":   { id, name, kind, created_at, created_by, props, current_round },
--     "players":      [ { tournament_id, player_id, user_id, pos, body, updated_at } ],
--     "rounds":       [ { id, tournament_id, round_index, body, updated_at } ],
--     "scores":       [ { round_id, tournament_id, player_id, hole, strokes, updated_at } ],
--     "shot_details": [ { round_id, tournament_id, player_id, hole, detail, updated_at } ],
--     "notes":        [ { round_id, tournament_id, hole_key, note, updated_at } ]
--   }
--
-- Upsert semantics are preserved on every table because the sync queue retries
-- a create until it succeeds — a retry after a partial failure must converge,
-- not raise a duplicate-key error.
--
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

  INSERT INTO public.game_players (tournament_id, player_id, user_id, pos, body, updated_at)
  SELECT r.tournament_id, r.player_id, r.user_id, r.pos, r.body, r.updated_at
  FROM jsonb_populate_recordset(NULL::public.game_players,
                                COALESCE(p_payload->'players', '[]'::jsonb)) r
  ON CONFLICT (tournament_id, player_id) DO UPDATE SET
    user_id = EXCLUDED.user_id, pos = EXCLUDED.pos,
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
  'Atomically create a game: tournaments row + game_players/rounds/scores/shot_details/round_notes in one transaction. SECURITY INVOKER — RLS authorizes every insert.';
