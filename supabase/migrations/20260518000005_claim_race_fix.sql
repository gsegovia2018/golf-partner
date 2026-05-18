-- ============================================================================
-- Shared tournament invite — fix: make claim/release race-safe and
-- LWW-merge-safe.
-- ============================================================================
--
-- HOW TO RUN
-- ----------
--   Paste into the Supabase SQL editor and Run. Idempotent — safe to re-run.
--   Supersedes the claim_tournament_player / release_tournament_player bodies
--   from 20260518000004_shared_invite_claim.sql.
--
-- WHAT IT FIXES
-- -------------
--   1. Both RPCs now SELECT ... FOR UPDATE, so a concurrent claim of the same
--      slot blocks and re-reads the post-claim row instead of racing. A loser
--      now correctly raises SLOT_TAKEN.
--   2. Both RPCs bump data._meta->'players' (the casual-tournament last-write-
--      wins timestamp) so the claim/release wins the next sync merge instead
--      of being silently overwritten by a stale client blob.
-- ============================================================================

-- Atomic, race-safe player-slot claim ----------------------------------------
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
  v_uid     uuid   := auth.uid();
  v_idx     int;
  v_data    jsonb;
  v_players jsonb;
  v_slot    jsonb;
  v_now_ms  bigint := (extract(epoch from now()) * 1000)::bigint;
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

  -- Lock the tournament row. A concurrent claim of the same slot blocks here
  -- and, once this transaction commits, re-reads the post-claim row below.
  SELECT data INTO v_data
    FROM public.tournaments
   WHERE id = p_tournament_id
   FOR UPDATE;
  IF v_data IS NULL THEN
    RAISE EXCEPTION 'No such tournament';
  END IF;

  v_players := v_data -> 'players';
  IF v_players IS NULL THEN
    RAISE EXCEPTION 'Tournament has no players';
  END IF;

  SELECT ord - 1, elem
    INTO v_idx, v_slot
    FROM jsonb_array_elements(v_players) WITH ORDINALITY AS t(elem, ord)
   WHERE elem ->> 'id' = p_player_id
   LIMIT 1;

  IF v_idx IS NULL THEN
    RAISE EXCEPTION 'No such player slot';
  END IF;

  IF v_slot ->> 'user_id' IS NOT NULL
     AND v_slot ->> 'user_id' <> v_uid::text THEN
    RAISE EXCEPTION 'SLOT_TAKEN';
  END IF;

  -- Ensure _meta exists, set the slot's user_id, and bump the players LWW
  -- timestamp so the claim wins the next casual-tournament sync merge.
  v_data := v_data || jsonb_build_object(
              '_meta', COALESCE(v_data -> '_meta', '{}'::jsonb));
  v_data := jsonb_set(v_data,
              ARRAY['players', v_idx::text, 'user_id'],
              to_jsonb(v_uid::text), false);
  v_data := jsonb_set(v_data,
              ARRAY['_meta', 'players'],
              to_jsonb(v_now_ms), true);

  UPDATE public.tournaments SET data = v_data WHERE id = p_tournament_id;

  RETURN p_player_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_tournament_player(text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.claim_tournament_player(text, text) TO authenticated;

-- Owner-only player-slot release ---------------------------------------------
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
  v_uid      uuid   := auth.uid();
  v_idx      int;
  v_data     jsonb;
  v_slot     jsonb;
  v_claimer  text;
  v_now_ms   bigint := (extract(epoch from now()) * 1000)::bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Must be signed in';
  END IF;
  IF NOT public.is_tournament_owner(p_tournament_id, v_uid) THEN
    RAISE EXCEPTION 'Only the tournament owner can release a player';
  END IF;

  SELECT data INTO v_data
    FROM public.tournaments
   WHERE id = p_tournament_id
   FOR UPDATE;
  IF v_data IS NULL THEN
    RAISE EXCEPTION 'No such tournament';
  END IF;

  SELECT ord - 1, elem
    INTO v_idx, v_slot
    FROM jsonb_array_elements(v_data -> 'players') WITH ORDINALITY AS t(elem, ord)
   WHERE elem ->> 'id' = p_player_id
   LIMIT 1;

  IF v_idx IS NULL THEN
    RAISE EXCEPTION 'No such player slot';
  END IF;
  v_claimer := v_slot ->> 'user_id';

  v_data := v_data || jsonb_build_object(
              '_meta', COALESCE(v_data -> '_meta', '{}'::jsonb));
  v_data := jsonb_set(v_data,
              ARRAY['players', v_idx::text],
              (v_slot - 'user_id'), false);
  v_data := jsonb_set(v_data,
              ARRAY['_meta', 'players'],
              to_jsonb(v_now_ms), true);

  UPDATE public.tournaments SET data = v_data WHERE id = p_tournament_id;

  -- Drop the released user's membership (unless they are the owner).
  IF v_claimer IS NOT NULL
     AND NOT public.is_tournament_owner(p_tournament_id, v_claimer::uuid) THEN
    DELETE FROM public.tournament_members
     WHERE tournament_id = p_tournament_id
       AND user_id = v_claimer::uuid;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.release_tournament_player(text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.release_tournament_player(text, text) TO authenticated;
