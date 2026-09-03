-- ============================================================================
-- game_players: soft delete, so "removed" is a fact a client can FETCH rather
-- than an absence it has to infer.
-- ============================================================================
--
-- PROBLEM
-- -------
--   The client read path replaces `players` with the server snapshot
--   wholesale (tournamentStore's _overlayAndSave, syncWorker's post-drain
--   reconcile) and nothing ever merges a local player back. So a player whose
--   add never reached the server -- a queued mutation dropped after repeated
--   failures, or lost before it was ever enqueued, both far likelier after a
--   spell with no signal -- is DELETED from that device on the next successful
--   fetch, permanently.
--
--   Everything else about them survives, because it is keyed by id in other
--   tables: game_rounds.body.pairs stores ids only, and scores/playerHandicaps
--   are id-keyed maps. So the pair slot and the scores stay and only the NAME
--   goes. Field symptom, repeatedly: "when we suddenly stop getting internet,
--   Guillermo's name disappears."
--
--   The obvious client fix -- keep a local player the fetch didn't return --
--   cannot be done safely against this schema, because removal is a HARD
--   DELETE. "Absent from get_game_tournament" is the only signal a removal
--   ever happened, and it is indistinguishable from "your add never landed".
--   Making local win would therefore trade a disappearing name for a zombie
--   player that no device can ever remove again.
--
-- FIX
-- ---
--   Removal stamps game_players.deleted_at instead of deleting the row.
--   get_game_tournament keeps omitting those players from `players` (so every
--   existing consumer is unchanged) and additionally emits their ids as
--   `deletedPlayerIds`. The client can then tell the two cases apart:
--
--     absent from players, id IN deletedPlayerIds      -> genuinely removed
--     absent from players, id NOT IN deletedPlayerIds  -> never reached the
--                                                          server; keep the
--                                                          local copy and
--                                                          re-queue the write
--
--   `deletedPlayerIds` is emitted only when non-empty, matching how
--   currentRound/deletedAt are handled above it -- a tournament with no
--   removals returns exactly the shape it returns today.
--
-- RE-ADDING
-- ---------
--   A player id is library-stable and REUSED on re-add, so re-adding someone
--   must clear the tombstone. That is add_tournament_player_if_room's job
--   (below): it is the deliberate "add this person" path, so its ON CONFLICT
--   clears deleted_at. The plain game_players upsert (tournamentRepo's
--   upsertPlayer) deliberately does NOT touch deleted_at -- same rule the
--   user_id column already follows there: a device's blob can be stale about
--   a removal made elsewhere, and a routine field write (a handicap edit, the
--   player-library propagation sweep) must never resurrect a removed player.
--
--   The roster-cap count in that RPC now excludes tombstoned rows, or a
--   remove-then-re-add would eat a slot in a 4-player game.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE); safe to re-run.
-- Apply this BEFORE shipping the client that reads deletedPlayerIds: an older
-- client is unaffected (it ignores the new key and never writes deleted_at),
-- but a newer client against the old schema would fail its soft-delete write.
-- ============================================================================

ALTER TABLE public.game_players
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Every read filters on it, and the tombstone list is a per-tournament scan.
CREATE INDEX IF NOT EXISTS game_players_live_idx
  ON public.game_players (tournament_id) WHERE deleted_at IS NULL;

-- ── get_game_tournament ─────────────────────────────────────────────────────
-- Verbatim 20260811000000 (the column-projecting identity version) with two
-- changes, both marked below: the players aggregate skips tombstoned rows,
-- and a conditional deletedPlayerIds key is added.
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

-- ── add_tournament_player_if_room ───────────────────────────────────────────
-- Verbatim 20260715000001 with two changes, both marked: the cap count skips
-- tombstoned rows, and the conflict path clears the tombstone (this is the
-- deliberate re-add path — see RE-ADDING above).
CREATE OR REPLACE FUNCTION public.add_tournament_player_if_room(
  p_tournament_id text,
  p_player        jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_kind      text;
  v_cap       int;
  v_count     int;
  v_player_id text := p_player ->> 'id';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Must be signed in to add a player';
  END IF;
  IF NOT public.can_edit_tournament(p_tournament_id, v_uid) THEN
    RAISE EXCEPTION 'You are not a member of this tournament';
  END IF;
  IF v_player_id IS NULL OR v_player_id = '' THEN
    RAISE EXCEPTION 'Player id required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_tournament_id)::bigint);

  SELECT COALESCE(props ->> 'kind', 'tournament') INTO v_kind
    FROM public.tournaments
   WHERE id = p_tournament_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such tournament';
  END IF;
  v_cap := CASE WHEN v_kind = 'game' THEN 4 ELSE 24 END;

  -- CHANGED: a removed player no longer occupies a roster slot, or a
  -- remove-then-re-add would exhaust a 4-player game.
  SELECT count(*) INTO v_count
    FROM public.game_players
   WHERE tournament_id = p_tournament_id AND deleted_at IS NULL;

  -- A retry of the same player_id (already present) is always allowed — it
  -- doesn't grow the roster, just re-applies the same row.
  IF v_count >= v_cap AND NOT EXISTS (
    SELECT 1 FROM public.game_players
     WHERE tournament_id = p_tournament_id AND player_id = v_player_id
       AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'ROSTER_FULL';
  END IF;

  INSERT INTO public.game_players (tournament_id, player_id, user_id, pos, body, updated_at)
  VALUES (
    p_tournament_id,
    v_player_id,
    NULLIF(p_player ->> 'user_id', '')::uuid,
    v_count,
    p_player,
    now()
  )
  ON CONFLICT (tournament_id, player_id) DO UPDATE
    -- CHANGED: clearing deleted_at is what makes re-adding a removed player
    -- work. Deliberately scoped to THIS RPC; the plain upsert must not.
    SET body = EXCLUDED.body, deleted_at = NULL, updated_at = now();

  RETURN v_player_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.add_tournament_player_if_room(text, jsonb) FROM anon;
GRANT  EXECUTE ON FUNCTION public.add_tournament_player_if_room(text, jsonb) TO authenticated;

/* ===========================================================================
   HOW TO RUN
   ---------------------------------------------------------------------------
   Paste into the Supabase SQL editor and Run. Idempotent — safe to re-run.
   Apply BEFORE shipping the matching client build.

   VERIFY
   ---------------------------------------------------------------------------
   -- 1. A live tournament still returns its roster and NO deletedPlayerIds key
   SELECT public.get_game_tournament('<a tournament id>') ? 'deletedPlayerIds';
   --    -> false

   -- 2. Soft-delete one player, then confirm they leave `players` and appear
   --    in the tombstone list (run in a transaction you ROLL BACK)
   BEGIN;
     UPDATE public.game_players SET deleted_at = now()
      WHERE tournament_id = '<a tournament id>' AND player_id = '<a player id>';
     SELECT jsonb_array_length(public.get_game_tournament('<a tournament id>')->'players') AS live,
            public.get_game_tournament('<a tournament id>')->'deletedPlayerIds' AS removed;
   ROLLBACK;

   -- 3. The cap count ignores tombstoned rows
   SELECT count(*) FILTER (WHERE deleted_at IS NULL) AS counts_toward_cap,
          count(*)                                   AS rows_total
     FROM public.game_players WHERE tournament_id = '<a tournament id>';
   =========================================================================== */
