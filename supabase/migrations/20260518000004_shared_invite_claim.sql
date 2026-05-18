-- ============================================================================
-- Shared tournament invite: editor write access, immutable ownership,
-- and atomic player-slot claim / release.
-- ============================================================================
--
-- HOW TO RUN
-- ----------
--   Paste into the Supabase SQL editor and Run. Idempotent — safe to re-run.
--
-- WHAT IT ADDS
-- ------------
--   1. tournaments_update policy now uses can_edit_tournament, so editor
--      members (incl. anonymous guests) can persist casual-tournament writes.
--   2. tournaments_created_by_immutable trigger pins created_by on UPDATE so
--      a non-owner editor's save cannot hijack ownership.
--   3. claim_tournament_player(text, text)   — atomic slot claim.
--   4. release_tournament_player(text, text) — owner-only slot release.
-- ============================================================================

-- 1) Editor members may UPDATE the tournament row -----------------------------
-- The original policy (20260418000000_add_users.sql) was owner-only. Casual
-- scoring by editor members goes through a direct UPDATE to tournaments.data,
-- so editors must be allowed. can_edit_tournament covers owner, legacy
-- NULL-owner rows, and editor/owner members.
DROP POLICY IF EXISTS tournaments_update ON public.tournaments;
CREATE POLICY tournaments_update ON public.tournaments
  FOR UPDATE TO authenticated
  USING (public.can_edit_tournament(id, auth.uid()))
  WITH CHECK (public.can_edit_tournament(id, auth.uid()));

-- 2) created_by is immutable once set ----------------------------------------
-- persistRemote() upserts the whole row with created_by = the current user.
-- For a non-owner editor that would transfer ownership. Pin it.
CREATE OR REPLACE FUNCTION public.lock_tournament_created_by()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Allow a one-time set when the row had no owner (legacy back-fill);
  -- otherwise the original owner always wins.
  IF OLD.created_by IS NOT NULL THEN
    NEW.created_by := OLD.created_by;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tournaments_created_by_immutable ON public.tournaments;
CREATE TRIGGER tournaments_created_by_immutable
  BEFORE UPDATE ON public.tournaments
  FOR EACH ROW EXECUTE FUNCTION public.lock_tournament_created_by();

-- 3) Atomic player-slot claim ------------------------------------------------
-- Sets data.players[i].user_id to the caller, but ONLY if that slot is still
-- unclaimed. The whole read-test-write happens in one statement so two
-- racing claimers cannot both win. The caller must already be an editor
-- member (established by redeem_invite_code) — that is the authorization.
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
  v_idx     int;
  v_players jsonb;
  v_slot    jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Must be signed in to claim a player';
  END IF;
  IF NOT public.can_edit_tournament(p_tournament_id, v_uid) THEN
    RAISE EXCEPTION 'You are not a member of this tournament';
  END IF;

  SELECT data -> 'players' INTO v_players
    FROM public.tournaments WHERE id = p_tournament_id;
  IF v_players IS NULL THEN
    RAISE EXCEPTION 'Tournament has no players';
  END IF;

  -- Locate the slot index by player id.
  SELECT ord - 1, elem
    INTO v_idx, v_slot
    FROM jsonb_array_elements(v_players) WITH ORDINALITY AS t(elem, ord)
   WHERE elem ->> 'id' = p_player_id
   LIMIT 1;

  IF v_idx IS NULL THEN
    RAISE EXCEPTION 'No such player slot';
  END IF;

  -- Already claimed by someone else → race lost.
  IF v_slot ->> 'user_id' IS NOT NULL
     AND v_slot ->> 'user_id' <> v_uid::text THEN
    RAISE EXCEPTION 'SLOT_TAKEN';
  END IF;

  UPDATE public.tournaments
     SET data = jsonb_set(
           data,
           ARRAY['players', v_idx::text, 'user_id'],
           to_jsonb(v_uid::text),
           false)
   WHERE id = p_tournament_id;

  RETURN p_player_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_tournament_player(text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.claim_tournament_player(text, text) TO authenticated;

-- 4) Owner-only player-slot release ------------------------------------------
-- Clears data.players[i].user_id and removes that user's editor membership so
-- the slot reopens. Scores already entered stay attached (keyed by player id).
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
  v_uid       uuid := auth.uid();
  v_idx       int;
  v_slot      jsonb;
  v_claimer   text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Must be signed in';
  END IF;
  IF NOT public.is_tournament_owner(p_tournament_id, v_uid) THEN
    RAISE EXCEPTION 'Only the tournament owner can release a player';
  END IF;

  SELECT ord - 1, elem
    INTO v_idx, v_slot
    FROM public.tournaments t,
         jsonb_array_elements(t.data -> 'players') WITH ORDINALITY AS e(elem, ord)
   WHERE t.id = p_tournament_id
     AND elem ->> 'id' = p_player_id
   LIMIT 1;

  IF v_idx IS NULL THEN
    RAISE EXCEPTION 'No such player slot';
  END IF;
  v_claimer := v_slot ->> 'user_id';

  UPDATE public.tournaments
     SET data = jsonb_set(
           data,
           ARRAY['players', v_idx::text],
           (v_slot - 'user_id'),
           false)
   WHERE id = p_tournament_id;

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

/* ===========================================================================
   VERIFY
   ---------------------------------------------------------------------------
   -- tournaments_update now references can_edit_tournament:
   SELECT policyname, qual FROM pg_policies
    WHERE tablename = 'tournaments' AND policyname = 'tournaments_update';

   -- trigger present:
   SELECT tgname FROM pg_trigger WHERE tgname = 'tournaments_created_by_immutable';

   -- RPCs present and granted to authenticated only:
   SELECT p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_ok,
                     has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_ok
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('claim_tournament_player','release_tournament_player');
   =========================================================================== */
