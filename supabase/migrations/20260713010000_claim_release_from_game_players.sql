-- ============================================================================
-- Claim/release source the player slot from game_players (the sync-v2 source of
-- truth), not the frozen tournaments.data blob.
--
-- Since sync-v2, get_game_tournament serves the roster from game_players.body,
-- and player mutations (add/remove/update) write ONLY game_players — never
-- tournaments.data. So data->'players' is frozen at creation. The prior
-- claim_tournament_player looked the slot up in data->'players', so a player
-- ADDED AFTER creation (present in game_players, shown in the claim picker)
-- failed with 'No such player slot'. release_tournament_player was worse: it
-- read AND wrote only data, never touching game_players, so a "release" left
-- the slot still claimed to every client (get_game_tournament reads
-- game_players).
--
-- Both now look up + write game_players as primary, and best-effort mirror the
-- creation-time data blob so any remaining legacy reader of data->'players'
-- doesn't regress (a post-creation player simply isn't in data — the mirror is
-- a no-op for it, never an error). Idempotent (CREATE OR REPLACE); safe to
-- re-run. Security posture unchanged: SECURITY DEFINER, own auth checks,
-- anon REVOKE + authenticated GRANT.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.claim_tournament_player(
  p_tournament_id text,
  p_player_id     text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_gp_user uuid;
  v_data    jsonb;
  v_idx     int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Must be signed in to claim a player';
  END IF;
  -- can_edit_tournament passes for the owner, legacy NULL-owner rows, and
  -- editor/owner members; the join flow establishes editor membership via
  -- redeem_invite_code before this is called.
  IF NOT public.can_edit_tournament(p_tournament_id, v_uid) THEN
    RAISE EXCEPTION 'You are not a member of this tournament';
  END IF;

  -- Source of truth: game_players (keyed tournament_id+player_id). Locking this
  -- row serializes concurrent claims of the same slot.
  SELECT user_id INTO v_gp_user
    FROM public.game_players
   WHERE tournament_id = p_tournament_id AND player_id = p_player_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such player slot';
  END IF;
  IF v_gp_user IS NOT NULL AND v_gp_user <> v_uid THEN
    RAISE EXCEPTION 'SLOT_TAKEN';
  END IF;

  UPDATE public.game_players
     SET user_id    = v_uid,
         body       = jsonb_set(body, '{user_id}', to_jsonb(v_uid::text), true),
         updated_at = now()
   WHERE tournament_id = p_tournament_id AND player_id = p_player_id;

  -- Best-effort legacy mirror: keep data.players[idx].user_id current when the
  -- slot exists in the (creation-time) blob. A post-creation player is not in
  -- data, so v_idx is NULL and this is skipped — never an error.
  SELECT data INTO v_data FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF v_data IS NOT NULL AND jsonb_typeof(v_data -> 'players') = 'array' THEN
    SELECT ord - 1 INTO v_idx
      FROM jsonb_array_elements(v_data -> 'players') WITH ORDINALITY AS t(elem, ord)
     WHERE elem ->> 'id' = p_player_id
     LIMIT 1;
    IF v_idx IS NOT NULL THEN
      UPDATE public.tournaments
         SET data = jsonb_set(v_data, ARRAY['players', v_idx::text, 'user_id'],
                              to_jsonb(v_uid::text), true)
       WHERE id = p_tournament_id;
    END IF;
  END IF;

  RETURN p_player_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_tournament_player(text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.claim_tournament_player(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.release_tournament_player(
  p_tournament_id text,
  p_player_id     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_claimer uuid;
  v_data    jsonb;
  v_idx     int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Must be signed in';
  END IF;
  IF NOT public.is_tournament_owner(p_tournament_id, v_uid) THEN
    RAISE EXCEPTION 'Only the tournament owner can release a player';
  END IF;

  -- Source of truth: game_players. The claimer is whoever holds this slot in
  -- game_players (what every client sees via get_game_tournament).
  SELECT user_id INTO v_claimer
    FROM public.game_players
   WHERE tournament_id = p_tournament_id AND player_id = p_player_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such player slot';
  END IF;

  UPDATE public.game_players
     SET user_id    = NULL,
         body       = body - 'user_id',
         updated_at = now()
   WHERE tournament_id = p_tournament_id AND player_id = p_player_id;

  -- Best-effort legacy mirror: clear data.players[idx].user_id when present.
  SELECT data INTO v_data FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF v_data IS NOT NULL AND jsonb_typeof(v_data -> 'players') = 'array' THEN
    SELECT ord - 1 INTO v_idx
      FROM jsonb_array_elements(v_data -> 'players') WITH ORDINALITY AS t(elem, ord)
     WHERE elem ->> 'id' = p_player_id
     LIMIT 1;
    IF v_idx IS NOT NULL THEN
      UPDATE public.tournaments
         SET data = jsonb_set(v_data, ARRAY['players', v_idx::text],
                              ((v_data -> 'players' -> v_idx) - 'user_id'), false)
       WHERE id = p_tournament_id;
    END IF;
  END IF;

  -- Drop the released user's membership (unless they are the owner).
  IF v_claimer IS NOT NULL
     AND NOT public.is_tournament_owner(p_tournament_id, v_claimer) THEN
    DELETE FROM public.tournament_members
     WHERE tournament_id = p_tournament_id
       AND user_id = v_claimer;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.release_tournament_player(text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.release_tournament_player(text, text) TO authenticated;
