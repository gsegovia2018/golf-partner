-- ============================================================================
-- Smoke test for 20260905000000_scorer_cards.sql — the settledCell rule as it
-- is actually projected onto game_scores / game_shot_details.
--
-- Plain SQL, no pgTAP. Every check is a DO block that RAISEs on a mismatch,
-- so `psql -v ON_ERROR_STOP=1 -f this` exits non-zero on the first failure and
-- silently on success. The whole run is one transaction ending in ROLLBACK:
-- it can be pointed at any database that has this migration applied — local,
-- shadow, or a staging copy — without leaving a row behind.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/scorer_cards_smoke.sql
--
-- Covered: two cards agreeing, two cards disagreeing, a resolution with a
-- matching basis, a re-publication invalidating that resolution, a cleared
-- cell deleting its row, shot-detail source preference, and
-- backfill_scorer_cards producing the same settled cells as the legacy
-- game_score_entries it folds up (plan S15).
-- ============================================================================

BEGIN;

-- Fixture --------------------------------------------------------------------
INSERT INTO public.tournaments (id, name) VALUES ('t_smoke', 'Scorer cards smoke');
INSERT INTO public.game_rounds (id, tournament_id, round_index, body)
VALUES ('r0', 't_smoke', 0, '{}'::jsonb);
INSERT INTO public.game_players (tournament_id, player_id, body)
VALUES ('t_smoke', 'p1', '{}'::jsonb), ('t_smoke', 'p2', '{}'::jsonb);

-- 1) Two cards agreeing on p1, disagreeing on p2 -----------------------------
INSERT INTO public.scorer_cards (tournament_id, round_id, author_id, card)
VALUES ('t_smoke', 'r0', 'devA', jsonb_build_object(
  'scorer', jsonb_build_object('playerId', 'p1', 'userId', NULL),
  'holes',  jsonb_build_object('1', jsonb_build_object(
    'v', 1,
    'entries', jsonb_build_object('p1', 4, 'p2', 5),
    'shots',   jsonb_build_object('p1', jsonb_build_object('club', 'driver')),
    'ts', 1757000000000::bigint))));

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.game_scores
   WHERE tournament_id = 't_smoke' AND round_id = 'r0'
     AND ((player_id, hole, strokes) IN (('p1', 1, 4), ('p2', 1, 5)));
  IF n <> 2 THEN
    RAISE EXCEPTION 'single card: expected p1=4 and p2=5, got % matching rows', n;
  END IF;
END $$;

INSERT INTO public.scorer_cards (tournament_id, round_id, author_id, card)
VALUES ('t_smoke', 'r0', 'devB', jsonb_build_object(
  'scorer', jsonb_build_object('playerId', 'p2', 'userId', NULL),
  'holes',  jsonb_build_object('1', jsonb_build_object(
    'v', 1,
    'entries', jsonb_build_object('p1', 4, 'p2', 6),
    'shots',   jsonb_build_object('p2', jsonb_build_object('club', 'wedge'),
                                  'p1', jsonb_build_object('club', 'iron')),
    'ts', 1757000000001::bigint))));

DO $$
DECLARE v_p1 int; v_p2 int; v_p2_rows int;
BEGIN
  SELECT strokes INTO v_p1 FROM public.game_scores
   WHERE tournament_id='t_smoke' AND round_id='r0' AND player_id='p1' AND hole=1;
  -- Counted separately from the value: a plain SELECT ... INTO on no rows
  -- leaves the variable NULL, which would make the tombstone check below pass
  -- against a row that is not there at all.
  SELECT count(*) INTO v_p2_rows FROM public.game_scores
   WHERE tournament_id='t_smoke' AND round_id='r0' AND player_id='p2' AND hole=1;
  SELECT strokes INTO v_p2 FROM public.game_scores
   WHERE tournament_id='t_smoke' AND round_id='r0' AND player_id='p2' AND hole=1;

  -- agreeing cards settle
  IF v_p1 IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'agreement: expected p1=4, got %', v_p1;
  END IF;
  -- disagreeing cards leave a NULL tombstone — the ROW must exist, so that
  -- get_game_tournament's `strokes IS NOT NULL` filter hides the cell.
  IF v_p2_rows <> 1 THEN
    RAISE EXCEPTION 'dispute: expected exactly 1 row for p2 h1, got %', v_p2_rows;
  END IF;
  IF v_p2 IS NOT NULL THEN
    RAISE EXCEPTION 'dispute: expected NULL strokes for p2 h1, got %', v_p2;
  END IF;
END $$;

-- 2) Shot detail comes from the scorer's own card ----------------------------
DO $$
DECLARE v_p1 text; v_p2 text;
BEGIN
  SELECT detail->>'club' INTO v_p1 FROM public.game_shot_details
   WHERE tournament_id='t_smoke' AND round_id='r0' AND player_id='p1' AND hole=1;
  SELECT detail->>'club' INTO v_p2 FROM public.game_shot_details
   WHERE tournament_id='t_smoke' AND round_id='r0' AND player_id='p2' AND hole=1;
  -- devA is p1 (driver, own card) and devB is p2 (wedge, own card); devB's
  -- 'iron' for p1 must lose to p1's own card.
  IF v_p1 IS DISTINCT FROM 'driver' THEN
    RAISE EXCEPTION 'shots: expected p1 driver from own card, got %', v_p1;
  END IF;
  IF v_p2 IS DISTINCT FROM 'wedge' THEN
    RAISE EXCEPTION 'shots: expected p2 wedge from own card, got %', v_p2;
  END IF;
END $$;

-- 3) A resolution whose basis matches both cards settles the cell ------------
INSERT INTO public.score_resolutions
  (tournament_id, round_id, player_id, hole, value, resolved_by, basis)
VALUES ('t_smoke', 'r0', 'p2', 1, 5, 'devA', '{"devA": 1, "devB": 1}'::jsonb);

DO $$
DECLARE v int;
BEGIN
  SELECT strokes INTO v FROM public.game_scores
   WHERE tournament_id='t_smoke' AND round_id='r0' AND player_id='p2' AND hole=1;
  IF v IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'resolution: expected p2 h1 = 5, got %', v;
  END IF;
END $$;

-- 4) devB re-publishes hole 1 (v 1 -> 2): the basis no longer matches, the
--    resolution lapses, and the cell is disputed again (plan S8).
UPDATE public.scorer_cards
   SET card = jsonb_set(card, '{holes,1,v}', '2'::jsonb)
 WHERE tournament_id='t_smoke' AND round_id='r0' AND author_id='devB';

DO $$
DECLARE v int; n int;
BEGIN
  SELECT count(*) INTO n FROM public.game_scores
   WHERE tournament_id='t_smoke' AND round_id='r0' AND player_id='p2' AND hole=1;
  SELECT strokes INTO v FROM public.game_scores
   WHERE tournament_id='t_smoke' AND round_id='r0' AND player_id='p2' AND hole=1;
  IF n <> 1 OR v IS NOT NULL THEN
    RAISE EXCEPTION 'lapsed resolution: expected 1 row with NULL strokes, got % row(s) value %', n, v;
  END IF;
END $$;

-- 4b) A THIRD scorer marking the cell for the first time also invalidates a
--     basis that never mentioned them (plan S13). Re-anchor to v=1/v=2 first
--     so the resolution is valid again, then add devC.
UPDATE public.score_resolutions
   SET basis = '{"devA": 1, "devB": 2}'::jsonb
 WHERE tournament_id='t_smoke' AND round_id='r0' AND player_id='p2' AND hole=1;

DO $$
DECLARE v int;
BEGIN
  SELECT strokes INTO v FROM public.game_scores
   WHERE tournament_id='t_smoke' AND round_id='r0' AND player_id='p2' AND hole=1;
  IF v IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 're-anchored resolution: expected p2 h1 = 5, got %', v;
  END IF;
END $$;

INSERT INTO public.scorer_cards (tournament_id, round_id, author_id, card)
VALUES ('t_smoke', 'r0', 'devC', jsonb_build_object(
  'scorer', jsonb_build_object('playerId', NULL, 'userId', NULL),
  'holes',  jsonb_build_object('1', jsonb_build_object(
    'v', 1, 'entries', jsonb_build_object('p2', 7), 'ts', 1757000000002::bigint))));

DO $$
DECLARE v int;
BEGIN
  SELECT strokes INTO v FROM public.game_scores
   WHERE tournament_id='t_smoke' AND round_id='r0' AND player_id='p2' AND hole=1;
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'new scorer must invalidate the basis: expected NULL, got %', v;
  END IF;
END $$;

DELETE FROM public.scorer_cards
 WHERE tournament_id='t_smoke' AND round_id='r0' AND author_id='devC';

-- 5) A cleared cell: no card marks p2 h1 any more, so the row goes -----------
--    (a JSON null entry is "no opinion", exactly like a missing key).
UPDATE public.scorer_cards
   SET card = jsonb_set(card, '{holes,1,entries}', jsonb_build_object('p1', 4))
 WHERE tournament_id='t_smoke' AND round_id='r0' AND author_id='devA';
UPDATE public.scorer_cards
   SET card = jsonb_set(card, '{holes,1,entries}',
                        jsonb_build_object('p1', 4, 'p2', 'null'::jsonb))
 WHERE tournament_id='t_smoke' AND round_id='r0' AND author_id='devB';

DO $$
DECLARE n int; v_p1 int;
BEGIN
  SELECT count(*) INTO n FROM public.game_scores
   WHERE tournament_id='t_smoke' AND round_id='r0' AND player_id='p2' AND hole=1;
  IF n <> 0 THEN
    RAISE EXCEPTION 'cleared cell: expected the p2 h1 row to be deleted, % left', n;
  END IF;
  SELECT strokes INTO v_p1 FROM public.game_scores
   WHERE tournament_id='t_smoke' AND round_id='r0' AND player_id='p1' AND hole=1;
  IF v_p1 IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'cleared cell: p1 h1 must be untouched at 4, got %', v_p1;
  END IF;
END $$;

-- 6) Backfill from legacy game_score_entries ---------------------------------
-- A second tournament so the "skip if any card exists" guard does not fire.
-- Cell shapes seeded: h1/p1 agreed by two authors, h1/p2 disputed,
-- h2/p1 marked by one author only, and a legacy resolution on h1/p2.
INSERT INTO public.tournaments (id, name) VALUES ('t_bf', 'Backfill smoke');
INSERT INTO public.game_rounds (id, tournament_id, round_index, body)
VALUES ('r0', 't_bf', 0, '{}'::jsonb);
INSERT INTO public.game_players (tournament_id, player_id, user_id, body)
VALUES ('t_bf', 'p1', '11111111-1111-1111-1111-111111111111'::uuid, '{}'::jsonb),
       ('t_bf', 'p2', NULL, '{}'::jsonb);

INSERT INTO public.game_score_entries
  (tournament_id, round_id, player_id, hole, author_id, strokes)
VALUES ('t_bf','r0','p1',1,'11111111-1111-1111-1111-111111111111', 4),
       ('t_bf','r0','p1',1,'devB', 4),
       ('t_bf','r0','p2',1,'11111111-1111-1111-1111-111111111111', 5),
       ('t_bf','r0','p2',1,'devB', 6),
       ('t_bf','r0','p1',2,'devB', 3),
       ('t_bf','r0','p2',2,'devB', NULL);   -- blank submission: no opinion

INSERT INTO public.game_score_resolutions
  (tournament_id, round_id, player_id, hole, value, resolved_by)
VALUES ('t_bf','r0','p2',1, 5, NULL);

SELECT public.backfill_scorer_cards('t_bf');

DO $$
DECLARE n int; v int; v_scorer jsonb;
BEGIN
  -- One card per (round, author).
  SELECT count(*) INTO n FROM public.scorer_cards WHERE tournament_id='t_bf';
  IF n <> 2 THEN
    RAISE EXCEPTION 'backfill: expected 2 cards, got %', n;
  END IF;

  -- The uuid-shaped author is identified as the player who owns that user id.
  SELECT card->'scorer' INTO v_scorer FROM public.scorer_cards
   WHERE tournament_id='t_bf' AND author_id='11111111-1111-1111-1111-111111111111';
  IF v_scorer->>'playerId' IS DISTINCT FROM 'p1'
     OR v_scorer->>'userId' IS DISTINCT FROM '11111111-1111-1111-1111-111111111111' THEN
    RAISE EXCEPTION 'backfill: scorer identity wrong: %', v_scorer;
  END IF;

  -- Every hole is published at v = 1.
  SELECT count(*) INTO n FROM public.scorer_cards c,
       LATERAL jsonb_each(c.card->'holes') h(key, value)
   WHERE c.tournament_id='t_bf' AND (h.value->>'v') <> '1';
  IF n <> 0 THEN
    RAISE EXCEPTION 'backfill: % hole(s) not at v=1', n;
  END IF;

  -- Projection equals what the legacy tables meant: h1/p1 agreed at 4,
  -- h1/p2 carried by the legacy resolution at 5, h2/p1 single-scorer 3,
  -- and h2/p2 (blank submission only) has no row at all.
  SELECT strokes INTO v FROM public.game_scores
   WHERE tournament_id='t_bf' AND player_id='p1' AND hole=1;
  IF v IS DISTINCT FROM 4 THEN RAISE EXCEPTION 'backfill: p1 h1 = %, want 4', v; END IF;

  SELECT strokes INTO v FROM public.game_scores
   WHERE tournament_id='t_bf' AND player_id='p2' AND hole=1;
  IF v IS DISTINCT FROM 5 THEN RAISE EXCEPTION 'backfill: p2 h1 = %, want 5 (legacy resolution)', v; END IF;

  SELECT strokes INTO v FROM public.game_scores
   WHERE tournament_id='t_bf' AND player_id='p1' AND hole=2;
  IF v IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'backfill: p1 h2 = %, want 3', v; END IF;

  SELECT count(*) INTO n FROM public.game_scores
   WHERE tournament_id='t_bf' AND player_id='p2' AND hole=2;
  IF n <> 0 THEN RAISE EXCEPTION 'backfill: blank-only cell must have no row, got %', n; END IF;

  -- The backfilled resolution carries a basis pinning both marking authors.
  SELECT count(*) INTO n FROM public.score_resolutions
   WHERE tournament_id='t_bf' AND player_id='p2' AND hole=1
     AND basis = '{"devB": 1, "11111111-1111-1111-1111-111111111111": 1}'::jsonb
     AND resolved_by = 'legacy';
  IF n <> 1 THEN RAISE EXCEPTION 'backfill: resolution basis/resolved_by wrong'; END IF;
END $$;

-- Idempotent: a straggler re-run must change nothing.
SELECT public.backfill_scorer_cards('t_bf');

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.scorer_cards WHERE tournament_id='t_bf';
  IF n <> 2 THEN RAISE EXCEPTION 're-run: expected 2 cards, got %', n; END IF;
  SELECT count(*) INTO n FROM public.score_resolutions WHERE tournament_id='t_bf';
  IF n <> 1 THEN RAISE EXCEPTION 're-run: expected 1 resolution, got %', n; END IF;
END $$;

ROLLBACK;
