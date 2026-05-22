-- ============================================================================
-- Fix: claim_tournament_player never actually stamped the player's user_id.
-- ============================================================================
--
-- HOW TO RUN
-- ----------
--   Paste into the Supabase SQL editor and Run. Idempotent — safe to re-run.
--   Supersedes the claim_tournament_player body from
--   20260518000005_claim_race_fix.sql.
--
-- WHAT IT FIXES
-- -------------
--   "Which player are you?" (ClaimPlayerScreen) silently did nothing: the
--   claim_tournament_player RPC returned success, but the player slot's
--   user_id was never set — so the joining account was never linked to a
--   player, and the next sync correctly reflected a row with no claim.
--
--   Root cause: the RPC stamped the slot with
--
--     jsonb_set(v_data, ARRAY['players', v_idx::text, 'user_id'],
--               to_jsonb(v_uid::text), false)
--                                      ^^^^^  create_missing = false
--
--   jsonb_set() with create_missing = false returns the document UNCHANGED
--   when the addressed key does not already exist. A freshly-created player
--   slot has no 'user_id' key, so the stamp was a silent no-op — verified:
--     jsonb_set('{"players":[{"id":"p"}]}',
--               ARRAY['players','0','user_id'], '"V"', false)
--       => {"players":[{"id":"p"}]}      (unchanged)
--   The RPC still returned the player id, so the client believed it worked.
--
--   The fix flips create_missing to true so the 'user_id' leaf key is
--   created. The player slot itself always exists (the RPC has already
--   located v_idx), so this only ever creates the missing leaf. The
--   _meta.players bump already used true and was unaffected.
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
  -- create_missing = true: a never-claimed slot has no 'user_id' key yet, and
  -- jsonb_set() with false would return the document unchanged (the bug).
  v_data := jsonb_set(v_data,
              ARRAY['players', v_idx::text, 'user_id'],
              to_jsonb(v_uid::text), true);
  v_data := jsonb_set(v_data,
              ARRAY['_meta', 'players'],
              to_jsonb(v_now_ms), true);

  UPDATE public.tournaments SET data = v_data WHERE id = p_tournament_id;

  RETURN p_player_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_tournament_player(text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.claim_tournament_player(text, text) TO authenticated;

/* ===========================================================================
   VERIFY
   ---------------------------------------------------------------------------
   -- End-to-end: an editor picking a player on "Which player are you?"
   -- now stamps players[i].user_id and it survives the next sync.
   =========================================================================== */
