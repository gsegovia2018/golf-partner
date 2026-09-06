-- ============================================================================
-- The card projection learns the roster, and stops rewriting rows that did not
-- change.
-- Plan: docs/superpowers/plans/2026-09-04-scorecard-cards-engine.md (§3.3, §5)
-- Idempotent; safe to re-run. Same conventions as
-- 20260905000000_scorer_cards.sql, whose project_round_scores this replaces
-- (CREATE OR REPLACE, identical signature — the scorer_cards /
-- score_resolutions triggers installed there keep working untouched).
-- ============================================================================
--
-- PROBLEM
-- -------
-- 1. REMOVED PLAYERS COME BACK. project_round_scores is a full recompute of a
--    round from every card stored for it, and a card is one scorer's private
--    document that nobody edits when a player leaves the game (deliberately —
--    see the comment on clearPlayerRound in src/store/tournamentRepo.js).
--    Removing a player stamps game_players.deleted_at (20260903000000) and the
--    client deletes that player's game_scores / game_shot_details rows for the
--    round. The very next publication of ANY hole by ANY scorer re-ran the
--    recompute, saw the departed player still marked in the cards, and wrote
--    every one of their cells straight back. The removal survived until the
--    next tap and no longer.
--
-- 2. EVERY PUBLISH REWROTE THE WHOLE ROUND. The upsert's
--    `DO UPDATE SET strokes = EXCLUDED.strokes, updated_at = now()` fires for
--    every conflicting row whether or not anything about it changed, and
--    `now()` guarantees the row is physically different every time. Leaving
--    one hole in a 4-player 18-hole round therefore rewrote up to 72
--    game_scores rows (plus the shot details), and game_scores is in
--    supabase_realtime — so one tap fanned ~72 UPDATE events out to every
--    connected phone, 71 of them carrying no news.
--
-- FIX
-- ---
-- 1. ROSTER FILTER. A cell projects only when its player_id is a CURRENT
--    member of the tournament: a game_players row for (tournament_id,
--    player_id) with deleted_at IS NULL. Cells for anyone else are neither
--    inserted nor updated, and — because the orphan-delete step keys on the
--    same roster-filtered set — any rows they already have are DELETED. The
--    removal is now enforced by the projection itself; the client's delete in
--    clearPlayerRound is just the fast path that makes it visible immediately.
--
-- 2. NO-OP GUARD. `WHERE game_scores.strokes IS DISTINCT FROM EXCLUDED.strokes`
--    (and the game_shot_details equivalent on `detail`) on the DO UPDATE, so a
--    row whose value did not change is not touched, produces no WAL record and
--    no realtime event. A re-publication of an identical hole is now silent,
--    which is also what makes the retry-forever card path (a queued write
--    replayed hours later, a duplicate realtime echo) free.
--
-- THE OFFLINE RACE, AND WHY game_players GETS A TRIGGER
-- ----------------------------------------------------
-- There is deliberately no FK from scorer_cards to game_players or
-- game_rounds: a game created offline can publish its first hole before the
-- setup sync queue has landed either (20260905000000, R7/R8). With the roster
-- filter, such a card's cells simply do not project yet — correct, but only if
-- something re-runs the projection once the roster arrives. Nothing did:
-- project_round_scores was reachable only from the scorer_cards and
-- score_resolutions triggers, so the cells would have waited for the next hole
-- publication (and on the last hole of a round, for nothing at all).
--
-- Hence game_players_project below: an AFTER INSERT OR UPDATE row trigger that
-- re-projects the rounds of that ONE tournament. Two guards keep it honest:
--
--   * It only projects rounds that HAVE at least one scorer_cards row. A round
--     with no cards is not card-managed — its game_scores rows are the only
--     copy (a tournament from before the cutover whose scores never went
--     through game_score_entries, so backfill_scorer_cards produced no cards
--     for it). Running a full recompute there would find zero settled cells
--     and delete the round's entire score history. The guard is what makes
--     this trigger safe to attach to a table every roster edit writes.
--
--   * It only projects rounds present in game_rounds, and game_scores has an
--     FK onto (tournament_id, round_id). Projecting a round whose setup row
--     has not landed yet would raise a foreign-key violation INSIDE the
--     trigger and abort the roster write — the one write we are waiting for.
--     Iterating game_rounds, rather than the round ids found in the cards, is
--     what keeps a roster upsert from failing on a half-synced game.
--
-- game_rounds gets the mirror-image trigger for the arrival order that ends
-- with the round row (card, then roster, then game_rounds), for the same
-- reason and with the same has-cards guard. Together the two mean a card
-- accepted before its setup projects the moment the last missing half lands,
-- without anybody tapping a score.
--
-- The one order that is NOT a projection problem is roster-before-card with
-- the round row still missing: there the card's own publish raises the FK
-- violation and is rejected, exactly as it is today, and the client's
-- retry-forever loop lands it once game_rounds arrives. Unchanged here on
-- purpose — a failed write that retries is already correct.
--
-- RECURSION. None is possible today — project_round_scores writes only
-- game_scores and game_shot_details, and neither has a trigger writing back to
-- game_players or game_rounds. The `pg_trigger_depth() > 1` early return is
-- there so that stays true by construction if one is ever added: these two
-- triggers do their work only for a statement issued directly, never for one
-- another's cascade.
--
-- CLIENT IMPLICATION
-- ------------------
-- Re-adding a removed player must clear game_players.deleted_at, or their
-- scores stay invisible no matter how many cards still hold them.
-- add_tournament_player_if_room already does exactly that on its conflict path
-- (20260903000000, RE-ADDING) — and now the first publication after the re-add
-- projects the cells straight back out of the cards that never lost them.
-- The plain upsertPlayer path still does not touch deleted_at, so a routine
-- field write cannot resurrect anybody.
--
-- HOW TO RUN
-- ----------
--   Paste into the Supabase SQL editor and Run. Idempotent — safe to re-run.
--   Apply AFTER 20260905000000_scorer_cards.sql.
-- ============================================================================

-- 1) project_round_scores ------------------------------------------------------
-- Verbatim 20260905000000 apart from the roster filter on both upserts, the
-- roster filter inside both `kept` CTEs (which is what turns "not projected"
-- into "actively removed"), and the two IS DISTINCT FROM guards. Still a full
-- idempotent recompute of one round; still SECURITY INVOKER, for the reason
-- given there.
CREATE OR REPLACE FUNCTION public.project_round_scores(
  p_tournament_id text, p_round_id text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- Scores: upsert every marked cell (NULL strokes = disputed tombstone)
  -- belonging to a player who is still on the roster. The DO UPDATE is skipped
  -- when the value is unchanged, so a re-published identical hole touches
  -- nothing and broadcasts nothing.
  INSERT INTO public.game_scores
    (round_id, tournament_id, player_id, hole, strokes, updated_at)
  SELECT p_round_id, p_tournament_id, s.player_id, s.hole, s.strokes, now()
    FROM public.settled_round_cells(p_tournament_id, p_round_id) s
   WHERE EXISTS (SELECT 1 FROM public.game_players gp
                  WHERE gp.tournament_id = p_tournament_id
                    AND gp.player_id     = s.player_id
                    AND gp.deleted_at IS NULL)
  ON CONFLICT (tournament_id, round_id, player_id, hole)
  DO UPDATE SET strokes = EXCLUDED.strokes, updated_at = now()
   WHERE public.game_scores.strokes IS DISTINCT FROM EXCLUDED.strokes;

  -- Scores: a row not backed by a marked cell OF A CURRENT ROSTER MEMBER goes.
  -- That is two removals in one step — a cell whose scorer cleared it, and
  -- every cell of a player who has left the game (or has not joined it yet:
  -- see THE OFFLINE RACE above, where the row cannot exist).
  -- MATERIALIZED so the helper is evaluated once, not once per candidate row.
  WITH kept AS MATERIALIZED (
    SELECT s.player_id, s.hole
      FROM public.settled_round_cells(p_tournament_id, p_round_id) s
     WHERE EXISTS (SELECT 1 FROM public.game_players gp
                    WHERE gp.tournament_id = p_tournament_id
                      AND gp.player_id     = s.player_id
                      AND gp.deleted_at IS NULL))
  DELETE FROM public.game_scores g
   WHERE g.tournament_id = p_tournament_id
     AND g.round_id      = p_round_id
     AND NOT EXISTS (SELECT 1 FROM kept k
                      WHERE k.player_id = g.player_id AND k.hole = g.hole);

  -- Shot details: same shape, one winning card per cell.
  INSERT INTO public.game_shot_details
    (round_id, tournament_id, player_id, hole, detail, updated_at)
  SELECT p_round_id, p_tournament_id, d.player_id, d.hole, d.detail, now()
    FROM public.projected_round_shots(p_tournament_id, p_round_id) d
   WHERE EXISTS (SELECT 1 FROM public.game_players gp
                  WHERE gp.tournament_id = p_tournament_id
                    AND gp.player_id     = d.player_id
                    AND gp.deleted_at IS NULL)
  ON CONFLICT (tournament_id, round_id, player_id, hole)
  DO UPDATE SET detail = EXCLUDED.detail, updated_at = now()
   WHERE public.game_shot_details.detail IS DISTINCT FROM EXCLUDED.detail;

  WITH kept AS MATERIALIZED (
    SELECT d.player_id, d.hole
      FROM public.projected_round_shots(p_tournament_id, p_round_id) d
     WHERE EXISTS (SELECT 1 FROM public.game_players gp
                    WHERE gp.tournament_id = p_tournament_id
                      AND gp.player_id     = d.player_id
                      AND gp.deleted_at IS NULL))
  DELETE FROM public.game_shot_details g
   WHERE g.tournament_id = p_tournament_id
     AND g.round_id      = p_round_id
     AND NOT EXISTS (SELECT 1 FROM kept k
                      WHERE k.player_id = g.player_id AND k.hole = g.hole);
END $$;

-- 2) Re-project when the setup tables catch up ---------------------------------
-- One shared body for both triggers: re-project every CARD-MANAGED round of
-- one tournament. See THE OFFLINE RACE in the header for why each guard is
-- there — none of them is decoration.
CREATE OR REPLACE FUNCTION public.project_tournament_rounds(p_tournament_id text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_round record;
BEGIN
  FOR v_round IN
    SELECT gr.id
      FROM public.game_rounds gr
     WHERE gr.tournament_id = p_tournament_id
       -- Card-managed only. A round with no card has no projection to rebuild,
       -- and recomputing it would delete the scores it does have.
       AND EXISTS (SELECT 1 FROM public.scorer_cards c
                    WHERE c.tournament_id = p_tournament_id
                      AND c.round_id      = gr.id)
  LOOP
    PERFORM public.project_round_scores(p_tournament_id, v_round.id);
  END LOOP;
END $$;

-- Roster changes: a player arriving (their cells can project at last) or a
-- deleted_at flipping either way (removed -> their rows go; re-added -> their
-- rows come back). Any other column change — a handicap edit, the
-- player-library propagation sweep, a pos rewrite — is skipped: it cannot
-- change what the roster filter admits, and a sweep across a 24-player
-- tournament would otherwise re-project every round 24 times.
CREATE OR REPLACE FUNCTION public.game_players_project()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.deleted_at    IS NOT DISTINCT FROM NEW.deleted_at
     AND OLD.player_id     IS NOT DISTINCT FROM NEW.player_id
     AND OLD.tournament_id IS NOT DISTINCT FROM NEW.tournament_id THEN
    RETURN NULL;
  END IF;
  PERFORM public.project_tournament_rounds(NEW.tournament_id);
  IF TG_OP = 'UPDATE' AND OLD.tournament_id IS DISTINCT FROM NEW.tournament_id THEN
    PERFORM public.project_tournament_rounds(OLD.tournament_id);
  END IF;
  RETURN NULL;                                -- AFTER trigger: value ignored
END $$;

DROP TRIGGER IF EXISTS game_players_project ON public.game_players;
CREATE TRIGGER game_players_project
  AFTER INSERT OR UPDATE ON public.game_players
  FOR EACH ROW EXECUTE FUNCTION public.game_players_project();

-- The other arrival order: the roster landed first and the round row is only
-- now here, so the cards for it can finally be projected without tripping
-- game_scores' FK. INSERT only — an UPDATE of a round's body (course, pairs,
-- notes) cannot change a settled cell.
CREATE OR REPLACE FUNCTION public.game_rounds_project()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.scorer_cards c
              WHERE c.tournament_id = NEW.tournament_id
                AND c.round_id      = NEW.id) THEN
    PERFORM public.project_round_scores(NEW.tournament_id, NEW.id);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS game_rounds_project ON public.game_rounds;
CREATE TRIGGER game_rounds_project
  AFTER INSERT ON public.game_rounds
  FOR EACH ROW EXECUTE FUNCTION public.game_rounds_project();

/* ===========================================================================
   VERIFY (run after applying)
   ---------------------------------------------------------------------------
   -- The three functions and the two new triggers are in place:
   SELECT proname FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('project_round_scores', 'project_tournament_rounds',
                      'game_players_project', 'game_rounds_project')
    ORDER BY proname;

   SELECT tgrelid::regclass::text AS tbl, tgname FROM pg_trigger
    WHERE tgrelid IN ('public.game_players'::regclass,
                      'public.game_rounds'::regclass)
      AND NOT tgisinternal ORDER BY 1, 2;
   -- expected to include: game_players game_players_project
   --                      game_rounds  game_rounds_project

   -- Full behavioural coverage lives in supabase/tests/scorer_cards_smoke.sql
   -- (sections 7-9: removal, the no-op guard, and the card-before-roster race):
   --   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/scorer_cards_smoke.sql

   -- Spot-check on real data — a removed player must have no projected rows,
   -- however many cards still mark them:
   -- SELECT g.player_id, count(*) AS projected_rows
   --   FROM public.game_scores g
   --   JOIN public.game_players p
   --     ON p.tournament_id = g.tournament_id AND p.player_id = g.player_id
   --  WHERE g.tournament_id = '<tid>' AND p.deleted_at IS NOT NULL
   --  GROUP BY 1;
   -- expected: no rows
   =========================================================================== */
