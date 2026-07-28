-- ============================================================================
-- game_players.pos is assigned once and never changes.
--
-- PROBLEM
-- -------
--   Every client write stamped pos from the WRITER'S OWN local array index --
--   mutationWrites.js's tournament.addPlayer / claimPlayer / updatePlayer all
--   did `upsertPlayer(id, player, findPlayerIndex(localTournament, ...))`.
--   get_game_tournament orders the roster by (pos, player_id), so whenever a
--   device's local order differed from the server's even briefly, its next
--   write reassigned positions and EVERY device re-spliced its roster
--   (realtimeSync's applyPlayerRow places each row at row.pos).
--
--   Field symptom, 2026-07-27: "the order of players was changing", "I was
--   jumping between players" -- you tap a score into the second row, the
--   roster reorders under you, and the second row is now somebody else.
--   Adding a player, or editing a handicap in the library (which sweeps
--   tournament.updatePlayer across every tournament that rosters that
--   player), was enough to trigger it.
--
--   Order is NOT load-bearing for scoring -- scores, handicaps, points and
--   shot details are all keyed by player id, so a reshuffle can never
--   misattribute a stroke. It matters for (a) which row you see where, and
--   (b) match play, where matchPlayRoundTally takes the first two players
--   POSITIONALLY as sides A and B (scoring.js).
--
-- FIX
-- ---
--   Enforce it in the database rather than trusting every present and future
--   caller: pos is set on INSERT (explicitly, or appended at the end when the
--   caller omits it) and is FROZEN on UPDATE. A client that still sends a
--   stale pos is now silently ignored instead of reshuffling everyone.
--
--   Existing writers keep working unchanged:
--     createTournament               INSERTs the roster with pos 0..n-1 -> kept
--     add_tournament_player_if_room  INSERTs with pos = current count   -> kept
--     upsertPlayer on an existing player  UPDATEs                       -> frozen
--
-- Idempotent (CREATE OR REPLACE / DROP IF EXISTS); safe to re-run. No rows are
-- modified: existing positions are preserved exactly as they are.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.game_players_freeze_pos()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Position is decided once, at insert. Ignore whatever the caller sent.
    NEW.pos := OLD.pos;
    RETURN NEW;
  END IF;

  -- INSERT: honour an explicit position (the creation-time roster order),
  -- otherwise append after the current last player. COALESCE(max, -1) + 1
  -- yields 0 for the first player in an empty tournament.
  IF NEW.pos IS NULL THEN
    SELECT COALESCE(max(gp.pos), -1) + 1 INTO NEW.pos
      FROM public.game_players gp
     WHERE gp.tournament_id = NEW.tournament_id;
  END IF;
  RETURN NEW;
END;
$$;

-- pos must be nullable for "append at the end" to be expressible. The column
-- was NOT NULL DEFAULT 0, which silently turned every omitted pos into 0.
ALTER TABLE public.game_players ALTER COLUMN pos DROP NOT NULL;
ALTER TABLE public.game_players ALTER COLUMN pos DROP DEFAULT;

DROP TRIGGER IF EXISTS game_players_freeze_pos ON public.game_players;
CREATE TRIGGER game_players_freeze_pos
  BEFORE INSERT OR UPDATE ON public.game_players
  FOR EACH ROW EXECUTE FUNCTION public.game_players_freeze_pos();

/* ===========================================================================
   HOW TO RUN
   ---------------------------------------------------------------------------
   Paste into the Supabase SQL editor and Run. Idempotent -- safe to re-run.

   VERIFY
   ---------------------------------------------------------------------------
   -- trigger present
   SELECT tgname FROM pg_trigger
    WHERE tgrelid = 'public.game_players'::regclass AND NOT tgisinternal;

   -- an UPDATE that tries to move a player must leave pos untouched
   SELECT tournament_id, player_id, pos FROM public.game_players LIMIT 1;

   -- no duplicate positions anywhere
   SELECT tournament_id, pos, count(*) FROM public.game_players
    GROUP BY 1, 2 HAVING count(*) > 1;
   -- expected: no rows
   =========================================================================== */
