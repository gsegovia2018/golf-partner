-- ============================================================================
-- Smoke test for 20260906000000_score_resolutions_first_wins.sql — the
-- first-valid-agreement-wins rule of put_score_resolution().
--
-- Plain SQL, no pgTAP. Every check is a DO block that RAISEs on a mismatch,
-- so `psql -v ON_ERROR_STOP=1 -f this` exits non-zero on the first failure and
-- silently on success. The whole run is one transaction ending in ROLLBACK.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/score_resolutions_first_wins_smoke.sql
--
-- Covered: a first agreement inserting, a second agreement on the SAME basis
-- being ignored (row kept, resolved_at untouched, the standing row returned),
-- a re-send of the winning agreement staying idempotent, an agreement on a
-- DIFFERENT basis replacing the stale row, and the projection following the
-- winner onto game_scores.
-- ============================================================================

BEGIN;

-- Fixture: two scorers disagreeing on p1 / hole 1 --------------------------
INSERT INTO public.tournaments (id, name) VALUES ('t_first', 'First wins smoke');
INSERT INTO public.game_rounds (id, tournament_id, round_index, body)
VALUES ('r0', 't_first', 0, '{}'::jsonb);
INSERT INTO public.game_players (tournament_id, player_id, body)
VALUES ('t_first', 'p1', '{}'::jsonb);

INSERT INTO public.scorer_cards (tournament_id, round_id, author_id, card)
VALUES ('t_first', 'r0', 'devM', jsonb_build_object(
  'scorer', jsonb_build_object('playerId', 'p1', 'userId', NULL),
  'holes',  jsonb_build_object('1', jsonb_build_object(
    'v', 1, 'entries', jsonb_build_object('p1', 5), 'ts', 1757000000000::bigint)))),
       ('t_first', 'r0', 'devG', jsonb_build_object(
  'scorer', jsonb_build_object('playerId', NULL, 'userId', NULL),
  'holes',  jsonb_build_object('1', jsonb_build_object(
    'v', 1, 'entries', jsonb_build_object('p1', 4), 'ts', 1757000000001::bigint))));

DO $$
DECLARE v int;
BEGIN
  SELECT strokes INTO v FROM public.game_scores
   WHERE tournament_id='t_first' AND round_id='r0' AND player_id='p1' AND hole=1;
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'fixture: two cards disagreeing must project NULL, got %', v;
  END IF;
END $$;

-- 1) The first agreement lands ----------------------------------------------
DO $$
DECLARE r public.score_resolutions;
BEGIN
  r := public.put_score_resolution('t_first', 'r0', 'p1', 1, 5, 'devM',
        '{"devM": 1, "devG": 1}'::jsonb);
  IF r.value <> 5 OR r.resolved_by <> 'devM' THEN
    RAISE EXCEPTION 'first agreement: expected 5 by devM, got % by %', r.value, r.resolved_by;
  END IF;
END $$;

-- 2) A second agreement on the SAME basis is ignored, whatever it says -------
--    Key order differs on purpose: basis is compared as jsonb, by value.
DO $$
DECLARE
  r      public.score_resolutions;
  before timestamptz;
  after_ timestamptz;
  n      int;
BEGIN
  SELECT resolved_at INTO before FROM public.score_resolutions
   WHERE tournament_id='t_first' AND round_id='r0' AND player_id='p1' AND hole=1;

  r := public.put_score_resolution('t_first', 'r0', 'p1', 1, 4, 'devG',
        '{"devG": 1, "devM": 1}'::jsonb);

  IF r.value <> 5 OR r.resolved_by <> 'devM' THEN
    RAISE EXCEPTION 'same basis: the standing row must be returned, got % by %',
      r.value, r.resolved_by;
  END IF;

  SELECT count(*), max(resolved_at) INTO n, after_ FROM public.score_resolutions
   WHERE tournament_id='t_first' AND round_id='r0' AND player_id='p1' AND hole=1;
  IF n <> 1 THEN
    RAISE EXCEPTION 'same basis: expected exactly one row, got %', n;
  END IF;
  IF after_ IS DISTINCT FROM before THEN
    RAISE EXCEPTION 'same basis: the ignored write must not touch resolved_at';
  END IF;
END $$;

DO $$
DECLARE v int;
BEGIN
  SELECT strokes INTO v FROM public.game_scores
   WHERE tournament_id='t_first' AND round_id='r0' AND player_id='p1' AND hole=1;
  IF v IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'projection: expected the winning 5, got %', v;
  END IF;
END $$;

-- 3) Re-sending the winning agreement is idempotent --------------------------
DO $$
DECLARE r public.score_resolutions;
BEGIN
  r := public.put_score_resolution('t_first', 'r0', 'p1', 1, 5, 'devM',
        '{"devM": 1, "devG": 1}'::jsonb);
  IF r.value <> 5 THEN
    RAISE EXCEPTION 'replay: expected 5, got %', r.value;
  END IF;
END $$;

-- 4) A different basis is a successor, not a competitor ----------------------
--    devG re-publishes hole 1 (v = 2), which lapses the standing agreement;
--    the next agreement pins the new versions and must replace it.
UPDATE public.scorer_cards
   SET card = jsonb_build_object(
     'scorer', jsonb_build_object('playerId', NULL, 'userId', NULL),
     'holes',  jsonb_build_object('1', jsonb_build_object(
       'v', 2, 'entries', jsonb_build_object('p1', 6), 'ts', 1757000000002::bigint)))
 WHERE tournament_id='t_first' AND round_id='r0' AND author_id='devG';

DO $$
DECLARE v int;
BEGIN
  SELECT strokes INTO v FROM public.game_scores
   WHERE tournament_id='t_first' AND round_id='r0' AND player_id='p1' AND hole=1;
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'lapse: a re-publication must re-open the cell, got %', v;
  END IF;
END $$;

DO $$
DECLARE r public.score_resolutions;
BEGIN
  r := public.put_score_resolution('t_first', 'r0', 'p1', 1, 6, 'devG',
        '{"devM": 1, "devG": 2}'::jsonb);
  IF r.value <> 6 OR r.resolved_by <> 'devG' THEN
    RAISE EXCEPTION 'new basis: expected 6 by devG, got % by %', r.value, r.resolved_by;
  END IF;
END $$;

DO $$
DECLARE v int;
BEGIN
  SELECT strokes INTO v FROM public.game_scores
   WHERE tournament_id='t_first' AND round_id='r0' AND player_id='p1' AND hole=1;
  IF v IS DISTINCT FROM 6 THEN
    RAISE EXCEPTION 'projection: expected the successor agreement 6, got %', v;
  END IF;
END $$;

-- 5) …and the first-wins rule now protects the NEW basis ---------------------
DO $$
DECLARE r public.score_resolutions;
BEGIN
  r := public.put_score_resolution('t_first', 'r0', 'p1', 1, 5, 'devM',
        '{"devM": 1, "devG": 2}'::jsonb);
  IF r.value <> 6 THEN
    RAISE EXCEPTION 'same basis (new): expected the standing 6, got %', r.value;
  END IF;
END $$;

ROLLBACK;
