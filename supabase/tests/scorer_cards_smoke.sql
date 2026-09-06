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
--
-- Sections 7-9 cover 20260906000001_projection_roster_and_noop.sql: a removed
-- player's cells staying out of the projection (and their existing rows being
-- deleted by it), an identical re-publication touching no row at all, and a
-- card that lands before its roster and round row projecting once they arrive.
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

-- 7) A removed player is projected out, and stays out ------------------------
-- Back on t_smoke/r0. State entering this section: p1 h1 = 4 (both cards
-- agree), no p2 score row (section 5 cleared it), and shot details for p1
-- (driver, own card) and p2 (wedge, own card).
UPDATE public.game_players SET deleted_at = now()
 WHERE tournament_id = 't_smoke' AND player_id = 'p1';

DO $$
DECLARE n_scores int; n_shots int; n_p2_shots int;
BEGIN
  -- The roster trigger re-projected the round: p1's rows are gone even though
  -- both cards still mark them.
  SELECT count(*) INTO n_scores FROM public.game_scores
   WHERE tournament_id='t_smoke' AND round_id='r0' AND player_id='p1';
  IF n_scores <> 0 THEN
    RAISE EXCEPTION 'removal: expected p1 to have no score rows, got %', n_scores;
  END IF;
  SELECT count(*) INTO n_shots FROM public.game_shot_details
   WHERE tournament_id='t_smoke' AND round_id='r0' AND player_id='p1';
  IF n_shots <> 0 THEN
    RAISE EXCEPTION 'removal: expected p1 to have no shot rows, got %', n_shots;
  END IF;
  -- ...and only p1's. The filter is per player, not per round.
  SELECT count(*) INTO n_p2_shots FROM public.game_shot_details
   WHERE tournament_id='t_smoke' AND round_id='r0' AND player_id='p2';
  IF n_p2_shots <> 1 THEN
    RAISE EXCEPTION 'removal: p2 shot row must survive, got % row(s)', n_p2_shots;
  END IF;
END $$;

-- The next publication by any scorer must NOT bring the removed player back —
-- this is the regression the roster filter exists for. devA publishes hole 2,
-- marking p1.
UPDATE public.scorer_cards
   SET card = jsonb_set(card, '{holes,2}', jsonb_build_object(
         'v', 1, 'entries', jsonb_build_object('p1', 5), 'ts', 1757000000010::bigint))
 WHERE tournament_id='t_smoke' AND round_id='r0' AND author_id='devA';

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.game_scores
   WHERE tournament_id='t_smoke' AND round_id='r0' AND player_id='p1';
  IF n <> 0 THEN
    RAISE EXCEPTION 'removal: a publish resurrected p1 (% row(s))', n;
  END IF;
END $$;

-- Re-adding clears the tombstone (what add_tournament_player_if_room does on
-- its conflict path) and the cards — which never lost the cells — project them
-- straight back, without anybody tapping a score.
UPDATE public.game_players SET deleted_at = NULL
 WHERE tournament_id = 't_smoke' AND player_id = 'p1';

DO $$
DECLARE v_h1 int; v_h2 int; v_shot text;
BEGIN
  SELECT strokes INTO v_h1 FROM public.game_scores
   WHERE tournament_id='t_smoke' AND round_id='r0' AND player_id='p1' AND hole=1;
  SELECT strokes INTO v_h2 FROM public.game_scores
   WHERE tournament_id='t_smoke' AND round_id='r0' AND player_id='p1' AND hole=2;
  SELECT detail->>'club' INTO v_shot FROM public.game_shot_details
   WHERE tournament_id='t_smoke' AND round_id='r0' AND player_id='p1' AND hole=1;
  IF v_h1 IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 're-add: expected p1 h1 = 4, got %', v_h1;
  END IF;
  IF v_h2 IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 're-add: expected p1 h2 = 5, got %', v_h2;
  END IF;
  IF v_shot IS DISTINCT FROM 'driver' THEN
    RAISE EXCEPTION 're-add: expected p1 h1 shot detail back, got %', v_shot;
  END IF;
END $$;

-- 8) The no-op guard: an identical re-publication touches no row -------------
-- now() is frozen for the whole transaction, so updated_at cannot tell a
-- rewrite from a skip here. ctid can: an UPDATE always writes a new tuple
-- version at a new location, so an unchanged ctid is proof the row was never
-- touched.
CREATE TEMP TABLE before_republish ON COMMIT DROP AS
  -- `loc` rather than `ctid`: a table cannot have a column named after a
  -- system column, and the snapshot is only useful as a plain value.
  SELECT 's'::text AS src, player_id, hole, ctid AS loc FROM public.game_scores
   WHERE tournament_id='t_smoke' AND round_id='r0'
  UNION ALL
  SELECT 'd'::text, player_id, hole, ctid FROM public.game_shot_details
   WHERE tournament_id='t_smoke' AND round_id='r0';

-- A queued write replayed, or a realtime echo: the same card, published again.
UPDATE public.scorer_cards SET card = card
 WHERE tournament_id='t_smoke' AND round_id='r0' AND author_id='devB';
UPDATE public.scorer_cards SET card = card
 WHERE tournament_id='t_smoke' AND round_id='r0' AND author_id='devA';

DO $$
DECLARE n_moved int; n_now int; n_before int;
BEGIN
  SELECT count(*) INTO n_before FROM before_republish;
  SELECT count(*) INTO n_now FROM (
    SELECT player_id, hole FROM public.game_scores
     WHERE tournament_id='t_smoke' AND round_id='r0'
    UNION ALL
    SELECT player_id, hole FROM public.game_shot_details
     WHERE tournament_id='t_smoke' AND round_id='r0') q;
  IF n_before <> n_now OR n_before = 0 THEN
    RAISE EXCEPTION 'no-op: row count changed (% -> %)', n_before, n_now;
  END IF;

  SELECT count(*) INTO n_moved FROM before_republish b
   WHERE NOT EXISTS (
     SELECT 1 FROM public.game_scores g
      WHERE b.src = 's' AND g.tournament_id='t_smoke' AND g.round_id='r0'
        AND g.player_id = b.player_id AND g.hole = b.hole AND g.ctid = b.loc)
     AND NOT EXISTS (
     SELECT 1 FROM public.game_shot_details d
      WHERE b.src = 'd' AND d.tournament_id='t_smoke' AND d.round_id='r0'
        AND d.player_id = b.player_id AND d.hole = b.hole AND d.ctid = b.loc);
  IF n_moved <> 0 THEN
    RAISE EXCEPTION 'no-op: % row(s) were rewritten by an identical re-publish', n_moved;
  END IF;
END $$;

-- The guard must not be a projection that stopped working: a REAL change still
-- rewrites exactly the row that changed, and nothing else.
UPDATE public.scorer_cards
   SET card = jsonb_set(card, '{holes,2,entries,p1}', '6'::jsonb)
 WHERE tournament_id='t_smoke' AND round_id='r0' AND author_id='devA';

DO $$
DECLARE v int; moved boolean; h1_moved boolean;
BEGIN
  SELECT strokes INTO v FROM public.game_scores
   WHERE tournament_id='t_smoke' AND round_id='r0' AND player_id='p1' AND hole=2;
  IF v IS DISTINCT FROM 6 THEN
    RAISE EXCEPTION 'changed cell: expected p1 h2 = 6, got %', v;
  END IF;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.game_scores g JOIN before_republish b
      ON b.src='s' AND b.player_id=g.player_id AND b.hole=g.hole AND b.loc=g.ctid
     WHERE g.tournament_id='t_smoke' AND g.round_id='r0'
       AND g.player_id='p1' AND g.hole=2) INTO moved;
  IF NOT moved THEN
    RAISE EXCEPTION 'changed cell: p1 h2 was not rewritten';
  END IF;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.game_scores g JOIN before_republish b
      ON b.src='s' AND b.player_id=g.player_id AND b.hole=g.hole AND b.loc=g.ctid
     WHERE g.tournament_id='t_smoke' AND g.round_id='r0'
       AND g.player_id='p1' AND g.hole=1) INTO h1_moved;
  IF h1_moved THEN
    RAISE EXCEPTION 'changed cell: p1 h1 was rewritten although nothing changed';
  END IF;
END $$;

-- 9) A card that arrives before its setup ------------------------------------
-- The offline-created game: scorer_cards has no FK to game_players or
-- game_rounds, so the card lands first. Its cells must wait (no roster to
-- admit them, and no round row for game_scores' FK to point at) and then
-- project the moment each half arrives — in either order, with no tap.
INSERT INTO public.tournaments (id, name) VALUES ('t_race', 'Card before roster');

INSERT INTO public.scorer_cards (tournament_id, round_id, author_id, card)
VALUES ('t_race', 'r0', 'devA', jsonb_build_object(
  'scorer', jsonb_build_object('playerId', 'p1', 'userId', NULL),
  'holes',  jsonb_build_object('1', jsonb_build_object(
    'v', 1,
    'entries', jsonb_build_object('p1', 4, 'p2', 5),
    'shots',   jsonb_build_object('p1', jsonb_build_object('club', 'driver')),
    'ts', 1757000000020::bigint))));

DO $$
DECLARE n int;
BEGIN
  -- Nothing projected, and — the part that matters — the card write itself
  -- succeeded rather than dying on game_scores' FK to game_rounds.
  SELECT count(*) INTO n FROM public.game_scores WHERE tournament_id='t_race';
  IF n <> 0 THEN
    RAISE EXCEPTION 'race: expected no projected rows before setup, got %', n;
  END IF;
  SELECT count(*) INTO n FROM public.scorer_cards WHERE tournament_id='t_race';
  IF n <> 1 THEN
    RAISE EXCEPTION 'race: the card must be accepted regardless, got % row(s)', n;
  END IF;
END $$;

-- The roster lands next, while the round row is still missing. The trigger
-- must skip a round that has no game_rounds row: projecting it would raise a
-- foreign-key violation inside the trigger and abort this very insert.
INSERT INTO public.game_players (tournament_id, player_id, body)
VALUES ('t_race', 'p1', '{}'::jsonb);

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.game_scores WHERE tournament_id='t_race';
  IF n <> 0 THEN
    RAISE EXCEPTION 'race: nothing can project before the round row, got %', n;
  END IF;
END $$;

-- The round row lands last: now the card projects, for the roster only.
INSERT INTO public.game_rounds (id, tournament_id, round_index, body)
VALUES ('r0', 't_race', 0, '{}'::jsonb);

DO $$
DECLARE v int; n_p2 int; v_shot text;
BEGIN
  SELECT strokes INTO v FROM public.game_scores
   WHERE tournament_id='t_race' AND round_id='r0' AND player_id='p1' AND hole=1;
  IF v IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'race: expected p1 h1 = 4 once setup landed, got %', v;
  END IF;
  SELECT detail->>'club' INTO v_shot FROM public.game_shot_details
   WHERE tournament_id='t_race' AND round_id='r0' AND player_id='p1' AND hole=1;
  IF v_shot IS DISTINCT FROM 'driver' THEN
    RAISE EXCEPTION 'race: expected p1 h1 shot detail, got %', v_shot;
  END IF;
  -- p2 is marked by the card but is not on the roster yet.
  SELECT count(*) INTO n_p2 FROM public.game_scores
   WHERE tournament_id='t_race' AND round_id='r0' AND player_id='p2';
  IF n_p2 <> 0 THEN
    RAISE EXCEPTION 'race: p2 is not on the roster, got % row(s)', n_p2;
  END IF;
END $$;

-- p2 joins: the same card, still untouched, now projects their cell too.
INSERT INTO public.game_players (tournament_id, player_id, body)
VALUES ('t_race', 'p2', '{}'::jsonb);

DO $$
DECLARE v int;
BEGIN
  SELECT strokes INTO v FROM public.game_scores
   WHERE tournament_id='t_race' AND round_id='r0' AND player_id='p2' AND hole=1;
  IF v IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'race: expected p2 h1 = 5 once they joined, got %', v;
  END IF;
END $$;

-- A round with NO cards is not card-managed: the roster trigger must leave its
-- game_scores alone rather than recompute them to nothing (a pre-cutover
-- tournament whose scores never went through game_score_entries has no cards,
-- and game_scores is the only copy).
INSERT INTO public.game_rounds (id, tournament_id, round_index, body)
VALUES ('r1', 't_race', 1, '{}'::jsonb);
INSERT INTO public.game_scores (round_id, tournament_id, player_id, hole, strokes)
VALUES ('r1', 't_race', 'p1', 1, 3);

INSERT INTO public.game_players (tournament_id, player_id, body)
VALUES ('t_race', 'p3', '{}'::jsonb);

DO $$
DECLARE v int;
BEGIN
  SELECT strokes INTO v FROM public.game_scores
   WHERE tournament_id='t_race' AND round_id='r1' AND player_id='p1' AND hole=1;
  IF v IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'cardless round: a roster edit erased its scores (got %)', v;
  END IF;
END $$;

ROLLBACK;
