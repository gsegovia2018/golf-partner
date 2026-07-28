-- ============================================================================
-- Drop the pre-sync-v2 tournaments.data blob.
--
-- Since sync-v2 the roster/rounds live in game_players/game_rounds and
-- get_game_tournament assembles from those. data was kept alive only because
-- the column is NOT NULL (so createTournament had to write a placeholder --
-- omitting it raised 23502, which the drain dropped as permanent, and no new
-- game reached the server) and because claim/release mirrored into it
-- best-effort.
--
-- Verified 2026-07-28 on prod: no RLS policy, index or view depends on the
-- column; the only trigger on tournaments (tournaments_created_by_immutable)
-- does not read it. The three functions that referenced it are handled here:
-- backfill_game_tournament is dropped outright (its one-time blob ->
-- normalized backfill is long done), and claim/release lose their mirror
-- blocks.
--
-- SCOPE: this migration removes every READER/WRITER of the column and makes it
-- nullable. The actual DROP COLUMN is deferred until every device has the
-- matching client build -- see section 4 for why.
--
-- Idempotent (CREATE OR REPLACE / IF EXISTS); safe to re-run.
-- ============================================================================

-- 1) The one-time blob -> normalized backfill has done its job.
DROP FUNCTION IF EXISTS public.backfill_game_tournament(text);

-- 2) claim/release: drop the legacy mirror blocks. Identical to the versions
--    in 20260728000000 minus the tournaments.data reads/writes.
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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Must be signed in to claim a player';
  END IF;
  IF NOT public.can_edit_tournament(p_tournament_id, v_uid) THEN
    RAISE EXCEPTION 'You are not a member of this tournament';
  END IF;

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
         updated_at = now()
   WHERE tournament_id = p_tournament_id AND player_id = p_player_id;

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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Must be signed in';
  END IF;
  IF NOT public.is_tournament_owner(p_tournament_id, v_uid) THEN
    RAISE EXCEPTION 'Only the tournament owner can release a player';
  END IF;

  SELECT user_id INTO v_claimer
    FROM public.game_players
   WHERE tournament_id = p_tournament_id AND player_id = p_player_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such player slot';
  END IF;

  UPDATE public.game_players
     SET user_id    = NULL,
         updated_at = now()
   WHERE tournament_id = p_tournament_id AND player_id = p_player_id;

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

-- 3) Make the column nullable. This is the ONLY schema change here, and it is
--    what lets the new client stop writing the blob: an insert that omits
--    `data` no longer raises 23502.
ALTER TABLE public.tournaments ALTER COLUMN data DROP NOT NULL;

-- 4) DROPPING THE COLUMN IS DEFERRED -- do NOT run this until every device
--    has installed a build containing the matching tournamentRepo.js change.
--
--    Learned the hard way on 2026-07-28: the column was dropped, and an
--    already-installed build (which still sends `data` in its insert) was
--    immediately rejected by PostgREST with
--      PGRST204 "Could not find the 'data' column of 'tournaments'"
--    meaning that phone could no longer create a game at all. The column was
--    restored as nullable within minutes. There is no OTA here, so the server
--    must stay compatible with the OLDEST installed build, not just the newest
--    source.
--
--    Nullable-but-unused is harmless in the meantime: nothing reads it, new
--    builds omit it, old builds keep writing a blob nobody consumes.
--
--    Once all four devices are updated, run:
--
--      ALTER TABLE public.tournaments DROP COLUMN IF EXISTS data;
--
--    Pre-drop contents are archived outside the repo (they contain real player
--    names and scores) at:
--      ~/golf-partner-backups/backup-tournaments-data-2026-07-28.json

/* ===========================================================================
   HOW TO RUN
   ---------------------------------------------------------------------------
   Paste into the Supabase SQL editor and Run AFTER the tournamentRepo.js
   change has shipped. Idempotent -- safe to re-run.

   VERIFY
   ---------------------------------------------------------------------------
   SELECT is_nullable
     FROM information_schema.columns
    WHERE table_name = 'tournaments' AND column_name = 'data';
   -- expected: YES  (the column still exists; the drop is deferred -- see 4)

   SELECT p.proname::text
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND pg_get_functiondef(p.oid) ~* '(v_data|SET data|data *->)';
   -- expected: only notification functions (they use notifications.data)
   =========================================================================== */
