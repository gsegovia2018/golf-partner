-- ============================================================================
-- Atomic roster-cap enforcement for the "add yourself as a new player" path
-- (Task 9, audit-tier3).
-- ============================================================================
--
-- PROBLEM
-- -------
--   ClaimPlayerScreen.addNewPlayer gated only on the locally-observed
--   players.length >= rosterCap(kind), then wrote straight through the
--   normal offline-first tournament.addPlayer mutation. Two joiners who each
--   see room (stale or simultaneous reads) can both add, growing the roster
--   past the cap — unlike claimExisting, which already goes through the
--   atomic claim_tournament_player RPC (20260518000004 /
--   20260518000005_claim_race_fix.sql).
--
-- FIX
-- ---
--   add_tournament_player_if_room(p_tournament_id, p_player) — a
--   SECURITY DEFINER RPC that serializes concurrent adds for the same
--   tournament with a transaction-scoped advisory lock (no existing row to
--   SELECT ... FOR UPDATE the way claim_tournament_player does — the player
--   doesn't exist yet), re-counts game_players under that lock, and rejects
--   with ROSTER_FULL once the count has reached the cap. The cap mirrors
--   rosterCap() in src/store/tournamentStore.js: 4 for kind 'game', 24
--   otherwise (kind read from tournaments.props->>'kind' — see
--   tournamentRepo.js's createTournament, which writes the domain kind into
--   props, not the constrained `kind` column).
--
--   The client calls this BEFORE the normal tournament.addPlayer mutation;
--   that mutation's own upsert of the same tournament_id/player_id
--   afterwards (mutationWrites.js -> tournamentRepo.upsertPlayer) is an
--   idempotent no-op overwrite of the row this RPC inserts.
--
-- Idempotent (CREATE OR REPLACE); safe to re-run.
-- ============================================================================

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
  -- can_edit_tournament passes for the owner, legacy NULL-owner rows, and
  -- editor/owner members; the join flow establishes editor membership via
  -- redeem_invite_code before ClaimPlayerScreen is reachable.
  IF NOT public.can_edit_tournament(p_tournament_id, v_uid) THEN
    RAISE EXCEPTION 'You are not a member of this tournament';
  END IF;
  IF v_player_id IS NULL OR v_player_id = '' THEN
    RAISE EXCEPTION 'Player id required';
  END IF;

  -- Serialize concurrent adds for the same tournament: this transaction-
  -- scoped advisory lock blocks a second racing call until the first commits
  -- or rolls back, so the count-then-insert below cannot race.
  PERFORM pg_advisory_xact_lock(hashtext(p_tournament_id)::bigint);

  SELECT COALESCE(props ->> 'kind', 'tournament') INTO v_kind
    FROM public.tournaments
   WHERE id = p_tournament_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such tournament';
  END IF;
  v_cap := CASE WHEN v_kind = 'game' THEN 4 ELSE 24 END;

  SELECT count(*) INTO v_count
    FROM public.game_players
   WHERE tournament_id = p_tournament_id;

  -- A retry of the same player_id (already present) is always allowed — it
  -- doesn't grow the roster, just re-applies the same row.
  IF v_count >= v_cap AND NOT EXISTS (
    SELECT 1 FROM public.game_players
     WHERE tournament_id = p_tournament_id AND player_id = v_player_id
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
    SET body = EXCLUDED.body, updated_at = now();

  RETURN v_player_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.add_tournament_player_if_room(text, jsonb) FROM anon;
GRANT  EXECUTE ON FUNCTION public.add_tournament_player_if_room(text, jsonb) TO authenticated;

/* ===========================================================================
   HOW TO RUN
   ---------------------------------------------------------------------------
   Paste into the Supabase SQL editor and Run. Idempotent — safe to re-run.

   VERIFY
   ---------------------------------------------------------------------------
   SELECT p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_ok,
                     has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_ok
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'add_tournament_player_if_room';
   =========================================================================== */
