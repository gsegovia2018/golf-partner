-- ============================================================================
-- Smoke test for 20261015000000_league_server_scoring.sql — the server scores
-- every league card (R3), takes the tee from the course library (R4), checks
-- an app card against the game (R5), and leagues carry participation points
-- (R2). Also: implausible tees/layouts refused, unknown library tees
-- refused, hand-entered tees wait for an admin's approval, scramble rounds
-- refused.
--
-- Same shape as leagues_smoke.sql: plain SQL, each check one row in the temp
-- table `ss_smoke`, a final DO block RAISEs listing every failed check, and
-- the whole run is one transaction ending in ROLLBACK.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/league_server_scoring_smoke.sql
--
-- Cast: A Ana (admin, female), G Gonzalo (male), N Nico (no gender set).
-- Library course "Smoke CNG": tee Amarillas 130 / 71.4, women 135 / 73.9,
-- par 72 (CNG's holes), plus an unrated tee Rojas.
-- Expected scores come from src/store/leagueRules.js scoreCard on the same
-- holes (league handicap 18):
--   women's Amarillas 135/73.9 -> ph 23, 45 pts, differential 10.1
--   men's   Amarillas 130/71.4 -> ph 20, 42 pts, differential 12.7
--   custom  Blancas   120/70.0 -> ph 17, 40 pts, differential 14.1
--   app card, 18 x 4 on a par-72 SI 1-18 layout off 130/71.4 -> ph 20, 56 pts
-- ============================================================================

BEGIN;

CREATE TEMP TABLE ss_smoke (seq serial, name text, ok boolean, detail text) ON COMMIT DROP;
CREATE TEMP TABLE ss_ctx (k text PRIMARY KEY, v text) ON COMMIT DROP;
GRANT ALL ON ss_smoke, ss_ctx TO authenticated, anon;
GRANT USAGE ON SEQUENCE ss_smoke_seq_seq TO authenticated, anon;

-- 20261016000000 (R7, R8): an off-app card is announced 2 h ahead and posted
-- 3 h after its tee time. This moves a card's clock back, as if announced
-- earlier, so it can be posted in the same transaction.
CREATE FUNCTION pg_temp.ss_rewind(p_card uuid, p_by interval) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE public.league_cards
     SET tee_time = tee_time - p_by, announced_at = announced_at - p_by, post_by = post_by - p_by,
         played_on = ((tee_time - p_by) AT TIME ZONE 'Europe/Madrid')::date
   WHERE id = p_card $$;

-- Fixture: users, profiles, friendships, library course --------------------------
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT u.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'league-scoring-smoke-' || u.k || '@example.invalid', now(), now()
  FROM (VALUES ('a', 'b1000000-0000-4000-8000-00000000000a'),
               ('g', 'b1000000-0000-4000-8000-00000000000b'),
               ('n', 'b1000000-0000-4000-8000-00000000000c')) u(k, id);

INSERT INTO public.profiles (user_id, display_name, gender)
VALUES ('b1000000-0000-4000-8000-00000000000a', 'Ana Smoke', 'female'),
       ('b1000000-0000-4000-8000-00000000000b', 'Gonzalo Smoke', 'male'),
       ('b1000000-0000-4000-8000-00000000000c', 'Nico Smoke', NULL)
ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name, gender = EXCLUDED.gender;

INSERT INTO public.friendships (requester_id, addressee_id, status)
VALUES ('b1000000-0000-4000-8000-00000000000a', 'b1000000-0000-4000-8000-00000000000b', 'accepted'),
       ('b1000000-0000-4000-8000-00000000000a', 'b1000000-0000-4000-8000-00000000000c', 'accepted');

INSERT INTO public.courses (id, name) VALUES ('b1c00000-0000-4000-8000-000000000001', 'Smoke CNG');
INSERT INTO public.course_holes (course_id, number, par, stroke_index)
SELECT 'b1c00000-0000-4000-8000-000000000001', h.n, h.par, h.si
  FROM (VALUES (1,4,3),(2,4,5),(3,3,7),(4,5,1),(5,4,9),(6,4,11),(7,3,13),(8,4,15),(9,5,17),
               (10,4,4),(11,3,6),(12,5,2),(13,4,8),(14,4,10),(15,4,12),(16,3,14),(17,5,16),(18,4,18)) h(n, par, si);
INSERT INTO public.course_tees (course_id, label, rating, slope, rating_women, slope_women, sort_order)
VALUES ('b1c00000-0000-4000-8000-000000000001', 'Amarillas', 71.4, 130, 73.9, 135, 0),
       ('b1c00000-0000-4000-8000-000000000001', 'Rojas', NULL, NULL, NULL, NULL, 1);

-- The client's snapshot of that course. Its holes/slope/rating are what an
-- older build would have frozen; the server replaces them from the library.
-- hcng = gross 86 (CNG worked example in leagues_smoke.sql 9b).
INSERT INTO ss_ctx VALUES
  ('lib', '{"course_id":"b1c00000-0000-4000-8000-000000000001","name":"Smoke CNG","tee":" amarillas ","slope":99,"rating":60.0,"holes":[{"n":1,"par":4,"si":1},{"n":2,"par":4,"si":2},{"n":3,"par":4,"si":3},{"n":4,"par":4,"si":4},{"n":5,"par":4,"si":5},{"n":6,"par":4,"si":6},{"n":7,"par":4,"si":7},{"n":8,"par":4,"si":8},{"n":9,"par":4,"si":9},{"n":10,"par":4,"si":10},{"n":11,"par":4,"si":11},{"n":12,"par":4,"si":12},{"n":13,"par":4,"si":13},{"n":14,"par":4,"si":14},{"n":15,"par":4,"si":15},{"n":16,"par":4,"si":16},{"n":17,"par":4,"si":17},{"n":18,"par":4,"si":18}]}'),
  ('custom', '{"name":"Smoke Muni","tee":"Blancas","slope":120,"rating":70.0,"holes":[{"n":1,"par":4,"si":3},{"n":2,"par":4,"si":5},{"n":3,"par":3,"si":7},{"n":4,"par":5,"si":1},{"n":5,"par":4,"si":9},{"n":6,"par":4,"si":11},{"n":7,"par":3,"si":13},{"n":8,"par":4,"si":15},{"n":9,"par":5,"si":17},{"n":10,"par":4,"si":4},{"n":11,"par":3,"si":6},{"n":12,"par":5,"si":2},{"n":13,"par":4,"si":8},{"n":14,"par":4,"si":10},{"n":15,"par":4,"si":12},{"n":16,"par":3,"si":14},{"n":17,"par":5,"si":16},{"n":18,"par":4,"si":18}]}'),
  ('std', '[{"n":1,"par":4,"si":1},{"n":2,"par":4,"si":2},{"n":3,"par":4,"si":3},{"n":4,"par":4,"si":4},{"n":5,"par":4,"si":5},{"n":6,"par":4,"si":6},{"n":7,"par":4,"si":7},{"n":8,"par":4,"si":8},{"n":9,"par":4,"si":9},{"n":10,"par":4,"si":10},{"n":11,"par":4,"si":11},{"n":12,"par":4,"si":12},{"n":13,"par":4,"si":13},{"n":14,"par":4,"si":14},{"n":15,"par":4,"si":15},{"n":16,"par":4,"si":16},{"n":17,"par":4,"si":17},{"n":18,"par":4,"si":18}]'),
  ('hcng', '{"1":5,"2":5,"3":3,"4":9,"5":5,"6":5,"7":3,"8":5,"9":6,"10":5,"11":3,"12":6,"13":5,"14":4,"15":5,"16":3,"17":5,"18":4}');

-- 1) Participation points (R2) ------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"b1000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE r jsonb; r5 jsonb;
BEGIN
  -- The 7-argument call every installed build makes still works (default 10).
  r := public.create_league('Scoring Smoke', '2026-01-01', '2027-12-31', NULL, 30, 0,
         '[{"user_id":"b1000000-0000-4000-8000-00000000000a","handicap":18},
           {"user_id":"b1000000-0000-4000-8000-00000000000b","handicap":18},
           {"user_id":"b1000000-0000-4000-8000-00000000000c","handicap":18}]'::jsonb);
  INSERT INTO ss_ctx VALUES ('league', r->>'id'), ('code', r->>'invite_code');
  r5 := public.create_league(p_name => 'Scoring Smoke 5', p_season_start => '2026-01-01', p_season_end => '2027-12-31',
          p_points_table => NULL, p_cap => 30, p_fee_cents => 0, p_members => '[]'::jsonb,
          p_participation_points => 5);
  INSERT INTO ss_ctx VALUES ('league5', r5->>'id');
  INSERT INTO ss_smoke (name, ok, detail)
  SELECT 'create_league: participation points default 10, or the value given',
         (SELECT participation_points FROM public.leagues WHERE id = (r->>'id')::uuid) = 10
         AND (SELECT participation_points FROM public.leagues WHERE id = (r5->>'id')::uuid) = 5,
         NULL;
  BEGIN
    PERFORM public.create_league('Bad', '2026-01-01', '2027-12-31', NULL, 30, 0, '[]'::jsonb, -1);
    INSERT INTO ss_smoke (name, ok, detail) VALUES ('create_league refuses negative participation points', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO ss_smoke (name, ok, detail) VALUES ('create_league refuses negative participation points',
      SQLSTATE = 'P0001' AND SQLERRM = 'Points for playing can''t be negative.', SQLSTATE || ' ' || SQLERRM);
  END;

  PERFORM public.update_league_rules((r->>'id')::uuid, NULL, NULL, NULL, NULL, NULL, NULL, 0);
  INSERT INTO ss_smoke (name, ok, detail)
  SELECT 'update_league_rules sets participation points (0 allowed)', participation_points = 0, participation_points::text
    FROM public.leagues WHERE id = (r->>'id')::uuid;
  -- The old 7-argument call keeps the value.
  PERFORM public.update_league_rules((r->>'id')::uuid, 'Scoring Smoke', NULL, NULL, NULL, NULL, NULL);
  PERFORM public.update_league_rules((r->>'id')::uuid, NULL, NULL, NULL, NULL, NULL, NULL, 12);
  PERFORM public.update_league_rules((r->>'id')::uuid, NULL, NULL, NULL, NULL, 30, NULL);
  INSERT INTO ss_smoke (name, ok, detail)
  SELECT 'update_league_rules without participation points keeps them', participation_points = 12, participation_points::text
    FROM public.leagues WHERE id = (r->>'id')::uuid;
  BEGIN
    PERFORM public.update_league_rules((r->>'id')::uuid, NULL, NULL, NULL, NULL, NULL, NULL, -5);
    INSERT INTO ss_smoke (name, ok, detail) VALUES ('update_league_rules refuses negative participation points', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO ss_smoke (name, ok, detail) VALUES ('update_league_rules refuses negative participation points',
      SQLSTATE = 'P0001' AND SQLERRM = 'Points for playing can''t be negative.', SQLSTATE || ' ' || SQLERRM);
  END;
END $$;

SELECT set_config('request.jwt.claims', '{"sub":"b1000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
SELECT public.join_league((SELECT v FROM ss_ctx WHERE k='code'), 18);
DO $$
BEGIN
  PERFORM public.update_league_rules((SELECT v::uuid FROM ss_ctx WHERE k='league'), NULL, NULL, NULL, NULL, NULL, NULL, 99);
  INSERT INTO ss_smoke (name, ok, detail) VALUES ('a member cannot change participation points', false, 'no error');
EXCEPTION WHEN others THEN
  INSERT INTO ss_smoke (name, ok, detail) VALUES ('a member cannot change participation points', SQLSTATE = '42501', SQLERRM);
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"b1000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
SELECT public.join_league((SELECT v FROM ss_ctx WHERE k='code'), 18);

-- 2) Library tee, women's pair, forged numbers ignored (R3, R4) ---------------------
SELECT set_config('request.jwt.claims', '{"sub":"b1000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
DO $$
DECLARE lid uuid := (SELECT v::uuid FROM ss_ctx WHERE k='league'); r jsonb;
        lib jsonb := (SELECT v::jsonb FROM ss_ctx WHERE k='lib');
        h   jsonb := (SELECT v::jsonb FROM ss_ctx WHERE k='hcng');
BEGIN
  -- Incomplete cards are refused before anything is stored.
  BEGIN
    PERFORM public.add_unannounced_league_card(lid, lib, NULL, '2027-03-02', h - '18', 86, 30, 20);
    INSERT INTO ss_smoke (name, ok, detail) VALUES ('17 strokes refused as incomplete_card', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO ss_smoke (name, ok, detail) VALUES ('17 strokes refused as incomplete_card',
      SQLSTATE = 'P0001' AND SQLERRM = 'A league card needs a score on every hole, 1 to 18.',
      SQLSTATE || ' ' || SQLERRM);
  END;

  -- Forged: ph -54, 99 points, gross 1. Ana is female: the women's pair.
  r := public.add_unannounced_league_card(lid, lib, NULL, '2027-03-02', h, 1, 99, -54);
  INSERT INTO ss_ctx VALUES ('cardW', r->>'id');
  INSERT INTO ss_smoke (name, ok, detail) VALUES ('add-unannounced returns the server score, not the client''s',
    (r->>'points')::int = 45 AND (r->>'playing_handicap')::int = 23 AND (r->>'gross')::int = 86
      AND (r->>'tee_verified')::boolean, r::text);
END $$;

RESET ROLE;
INSERT INTO ss_smoke (name, ok, detail)
SELECT 'women''s tee: library 135/73.9 frozen, ph 23, 45 pts, differential 10.1, verified',
       points = 45 AND playing_handicap = 23 AND gross = 86 AND differential = 10.1
       AND net_differential = -7.9 AND tee_verified
       AND (course->>'slope')::numeric = 135 AND (course->>'rating')::numeric = 73.9
       AND (course->>'par')::int = 72 AND course->>'tee' = 'Amarillas'
       AND course->>'course_id' = 'b1c00000-0000-4000-8000-000000000001'
       AND course->'holes'->3 = '{"n":4,"par":5,"si":1}'::jsonb
       AND course->>'name' = 'Smoke CNG',
       points || ' pts / ph ' || playing_handicap || ' / ' || differential || ' / ' || course::text
  FROM public.league_cards WHERE id = (SELECT v::uuid FROM ss_ctx WHERE k='cardW');

-- Gonzalo (male) on the same tee: the men's pair. Nico has no gender: men's too.
SELECT set_config('request.jwt.claims', '{"sub":"b1000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE r jsonb;
BEGIN
  r := public.add_unannounced_league_card((SELECT v::uuid FROM ss_ctx WHERE k='league'),
         (SELECT v::jsonb FROM ss_ctx WHERE k='lib'), NULL, '2027-03-03',
         (SELECT v::jsonb FROM ss_ctx WHERE k='hcng'), 86, 0, 54);
  INSERT INTO ss_ctx VALUES ('cardM', r->>'id');
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"b1000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
DO $$
DECLARE r jsonb;
BEGIN
  r := public.add_unannounced_league_card((SELECT v::uuid FROM ss_ctx WHERE k='league'),
         (SELECT v::jsonb FROM ss_ctx WHERE k='lib'), NULL, '2027-03-04',
         (SELECT v::jsonb FROM ss_ctx WHERE k='hcng'), 86, 36, 18);
  INSERT INTO ss_ctx VALUES ('cardN', r->>'id');
END $$;
RESET ROLE;
INSERT INTO ss_smoke (name, ok, detail)
SELECT 'men''s tee (male, and no gender set): 130/71.4, ph 20, 42 pts, differential 12.7',
       count(*) = 2
       AND bool_and(points = 42 AND playing_handicap = 20 AND differential = 12.7 AND tee_verified
                    AND (course->>'slope')::numeric = 130 AND (course->>'rating')::numeric = 71.4),
       string_agg(points || ' pts / ph ' || playing_handicap || ' / ' || differential, '; ')
  FROM public.league_cards
 WHERE id IN ((SELECT v::uuid FROM ss_ctx WHERE k='cardM'), (SELECT v::uuid FROM ss_ctx WHERE k='cardN'));

-- 3) Custom / unknown courses keep the client tee, unverified (R4) ------------------
SELECT set_config('request.jwt.claims', '{"sub":"b1000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE lid uuid := (SELECT v::uuid FROM ss_ctx WHERE k='league'); r jsonb;
        h jsonb := (SELECT v::jsonb FROM ss_ctx WHERE k='hcng');
        custom jsonb := (SELECT v::jsonb FROM ss_ctx WHERE k='custom');
        lib jsonb := (SELECT v::jsonb FROM ss_ctx WHERE k='lib');
        cng_holes jsonb := (SELECT v::jsonb FROM ss_ctx WHERE k='custom') -> 'holes';
BEGIN
  r := public.add_unannounced_league_card(lid, custom, NULL, '2027-04-02', h, 86, 99, -54);
  INSERT INTO ss_ctx VALUES ('cardC', r->>'id');
  INSERT INTO ss_smoke (name, ok, detail) VALUES ('custom course: client tee 120/70.0 kept, unverified, server score',
    (r->>'points')::int = 40 AND (r->>'playing_handicap')::int = 17 AND NOT (r->>'tee_verified')::boolean, r::text);

  -- A library course id but a tee the library doesn't have: refused, never the client's tee.
  BEGIN
    PERFORM public.add_unannounced_league_card(lid,
              lib || jsonb_build_object('tee', 'Negras', 'slope', 140, 'rating', 74.0, 'holes', cng_holes),
              NULL, '2027-05-02', h, 86, 99, -54);
    INSERT INTO ss_smoke (name, ok, detail) VALUES ('library course, unknown tee refused', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO ss_smoke (name, ok, detail) VALUES ('library course, unknown tee refused',
      SQLSTATE = 'P0001' AND SQLERRM = 'That tee isn''t one of this course''s tees in the course library. Pick one of its tees.',
      SQLSTATE || ' ' || SQLERRM);
  END;
  -- The label matches whatever the case and spacing: verified.
  r := public.add_unannounced_league_card(lid, lib || '{"tee":"  AMARILLAS "}'::jsonb, NULL, '2027-05-02', h, 86, 99, -54);
  INSERT INTO ss_smoke (name, ok, detail) VALUES ('library tee label matched case- and space-insensitively',
    (r->>'tee_verified')::boolean AND (r->>'points')::int = 42, r::text);

  -- The library's unrated tee: nothing to verify against, and no client rating either.
  BEGIN
    PERFORM public.add_unannounced_league_card(lid, lib || '{"tee":"Rojas","slope":null,"rating":null}'::jsonb,
              NULL, '2027-06-02', h, 86, 30, 20);
    INSERT INTO ss_smoke (name, ok, detail) VALUES ('unrated library tee with no client rating refused', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO ss_smoke (name, ok, detail) VALUES ('unrated library tee with no client rating refused',
      SQLSTATE = 'P0001' AND SQLERRM = 'This tee has no slope and course rating, so it can''t count for the league.',
      SQLSTATE || ' ' || SQLERRM);
  END;

  -- A custom course with a hole missing its SI is incomplete (R3).
  BEGIN
    PERFORM public.add_unannounced_league_card(lid,
              jsonb_set(custom, '{holes,6}', '{"n":7,"par":3}'::jsonb), NULL, '2027-06-02', h, 86, 30, 20);
    INSERT INTO ss_smoke (name, ok, detail) VALUES ('a hole without SI refused as incomplete_card', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO ss_smoke (name, ok, detail) VALUES ('a hole without SI refused as incomplete_card',
      SQLSTATE = 'P0001' AND SQLERRM = 'Every hole of a league card needs a score, a par and a stroke index.',
      SQLSTATE || ' ' || SQLERRM);
  END;
END $$;

-- Implausible tees and layouts are refused, whatever the client sends (R3/R4 bounds).
DO $$
DECLARE lid uuid := (SELECT v::uuid FROM ss_ctx WHERE k='league');
        h jsonb := (SELECT v::jsonb FROM ss_ctx WHERE k='hcng');
        custom jsonb := (SELECT v::jsonb FROM ss_ctx WHERE k='custom');
        v_hint text;
        hints text := '';
        bad jsonb;
BEGIN
  FOREACH bad IN ARRAY ARRAY[
    custom || '{"slope":160}'::jsonb,                                   -- slope above 155
    custom || '{"slope":54}'::jsonb,                                    -- slope below 55
    custom || '{"rating":98.0}'::jsonb,                                 -- par 72 + 26
    custom || '{"rating":56.9}'::jsonb,                                 -- par 72 - 15.1
    jsonb_set(custom, '{holes,0}', '{"n":1,"par":7,"si":3}'::jsonb),    -- a par 7
    jsonb_set(custom, '{holes,0}', '{"n":1,"par":2,"si":3}'::jsonb),    -- a par 2
    jsonb_set(custom, '{holes,0}', '{"n":1,"par":4,"si":5}'::jsonb),    -- SI 5 twice, no SI 3
    jsonb_set(custom, '{holes,0}', '{"n":1,"par":4,"si":19}'::jsonb)    -- SI 19
  ] LOOP
    BEGIN
      PERFORM public.add_unannounced_league_card(lid, bad, NULL, '2027-06-02', h, 86, 30, 20);
      hints := hints || 'none,';
    EXCEPTION WHEN others THEN
      GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT; hints := hints || v_hint || ',';
    END;
  END LOOP;
  INSERT INTO ss_smoke (name, ok, detail) VALUES ('implausible slope/rating -> implausible_tee; bad par/SI -> invalid_layout',
    hints = 'implausible_tee,implausible_tee,implausible_tee,implausible_tee,invalid_layout,invalid_layout,invalid_layout,invalid_layout,',
    hints);
END $$;

-- The HINT of each refusal (the client branches on it).
DO $$
DECLARE lid uuid := (SELECT v::uuid FROM ss_ctx WHERE k='league');
        h jsonb := (SELECT v::jsonb FROM ss_ctx WHERE k='hcng');
        custom jsonb := (SELECT v::jsonb FROM ss_ctx WHERE k='custom');
        v_hint text;
        hints text := '';
BEGIN
  BEGIN
    PERFORM public.add_unannounced_league_card(lid, custom, NULL, '2027-06-02', h - '9', 86, 30, 20);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT; hints := hints || v_hint || ',';
  END;
  BEGIN
    PERFORM public.add_unannounced_league_card(lid,
              jsonb_set(custom, '{holes,6}', '{"n":7,"par":3}'::jsonb), NULL, '2027-06-02', h, 86, 30, 20);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT; hints := hints || v_hint;
  END;
  INSERT INTO ss_smoke (name, ok, detail) VALUES ('incomplete cards carry HINT incomplete_card',
    hints = 'incomplete_card,incomplete_card', hints);
END $$;
RESET ROLE;
-- The edges are allowed: slope 55 and 155, rating par - 15 and par + 25.
INSERT INTO ss_smoke (name, ok, detail)
SELECT 'the bounds themselves are plausible',
       public.league_course_problem(c.v::jsonb || '{"slope":55,"rating":57.0}'::jsonb) IS NULL
       AND public.league_course_problem(c.v::jsonb || '{"slope":155,"rating":97.0}'::jsonb) IS NULL,
       NULL
  FROM ss_ctx c WHERE c.k = 'custom';
INSERT INTO ss_smoke (name, ok, detail)
SELECT 'refused cards left nothing behind (Gonzalo: March, April, May only)',
       string_agg(to_char(month, 'MM'), ',' ORDER BY month) = '03,04,05', string_agg(to_char(month, 'MM'), ',' ORDER BY month)
  FROM public.league_cards
 WHERE league_id = (SELECT v::uuid FROM ss_ctx WHERE k='league') AND user_id = 'b1000000-0000-4000-8000-00000000000b';

-- 4) App card: must match the game; library tee from the game round (R4, R5) --------
-- An older build's snapshot: no course_id, no slope/rating, its own holes. The
-- game round knows the library course and Ana's tee.
INSERT INTO public.tournaments (id, name) VALUES ('t_ss_app', 'Scoring smoke app');
INSERT INTO public.game_rounds (id, tournament_id, round_index, body)
VALUES ('r0', 't_ss_app', 0, jsonb_build_object(
  'courseId', 'b1c00000-0000-4000-8000-000000000001',
  'playerTees', '{"pA":{"label":"Amarillas","slope":135,"rating":73.9}}'::jsonb));
INSERT INTO public.game_players (tournament_id, player_id, user_id, body)
VALUES ('t_ss_app', 'pA', 'b1000000-0000-4000-8000-00000000000a', '{}'::jsonb);
-- The game has Ana's hcng except hole 5 (6, not 5) and nothing on hole 18.
INSERT INTO public.game_scores (tournament_id, round_id, player_id, hole, strokes)
SELECT 't_ss_app', 'r0', 'pA', key::int, CASE WHEN key = '5' THEN 6 ELSE value::int END
  FROM jsonb_each_text((SELECT v::jsonb FROM ss_ctx WHERE k='hcng'))
 WHERE key <> '18';
WITH x AS (
  INSERT INTO public.league_cards (league_id, user_id, month, source, status, tournament_id, round_id, player_id,
                                   course, tee_time, played_on, announced_at, league_handicap)
  VALUES ((SELECT v::uuid FROM ss_ctx WHERE k='league'), 'b1000000-0000-4000-8000-00000000000a', '2027-07-01',
          'app', 'playing', 't_ss_app', 'r0', 'pA',
          jsonb_build_object('name', 'Smoke CNG', 'holes', (SELECT v::jsonb FROM ss_ctx WHERE k='std')),
          '2027-07-05 09:00+02', '2027-07-05', now(), 18)
  RETURNING id)
INSERT INTO ss_ctx SELECT 'cardApp', id::text FROM x;

SELECT set_config('request.jwt.claims', '{"sub":"b1000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE cid uuid := (SELECT v::uuid FROM ss_ctx WHERE k='cardApp');
        h jsonb := (SELECT v::jsonb FROM ss_ctx WHERE k='hcng');
        v_hint text;
        r jsonb;
BEGIN
  BEGIN
    PERFORM public.submit_league_card(cid, h, 86, 45, 23, NULL);
    INSERT INTO ss_smoke (name, ok, detail) VALUES ('app card that differs from the game refused', false, 'no error');
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    INSERT INTO ss_smoke (name, ok, detail) VALUES ('app card that differs from the game refused (holes 5, 18)',
      SQLSTATE = 'P0001' AND v_hint = 'holes_mismatch'
      AND SQLERRM = 'This card doesn''t match your scores in the game on holes: 5, 18. Wait for every hole to sync, or fix it in the scorecard.',
      SQLSTATE || ' ' || v_hint || ' ' || SQLERRM);
  END;
END $$;
RESET ROLE;
INSERT INTO ss_smoke (name, ok, detail)
SELECT 'a refused app card stays playing with no score', status = 'playing' AND holes IS NULL AND points IS NULL, status
  FROM public.league_cards WHERE id = (SELECT v::uuid FROM ss_ctx WHERE k='cardApp');

UPDATE public.game_scores SET strokes = 5
 WHERE tournament_id = 't_ss_app' AND round_id = 'r0' AND player_id = 'pA' AND hole = 5;
INSERT INTO public.game_scores (tournament_id, round_id, player_id, hole, strokes)
VALUES ('t_ss_app', 'r0', 'pA', 18, 4);
SELECT set_config('request.jwt.claims', '{"sub":"b1000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE r jsonb;
BEGIN
  r := public.submit_league_card((SELECT v::uuid FROM ss_ctx WHERE k='cardApp'),
         (SELECT v::jsonb FROM ss_ctx WHERE k='hcng'), 1, 99, -54, NULL);
  INSERT INTO ss_smoke (name, ok, detail) VALUES ('app card matching the game is scored by the server',
    (r->>'points')::int = 45 AND (r->>'playing_handicap')::int = 23 AND (r->>'gross')::int = 86
      AND (r->>'tee_verified')::boolean AND (r->>'differential')::numeric = 10.1, r::text);
END $$;
RESET ROLE;
INSERT INTO ss_smoke (name, ok, detail)
SELECT 'app card from an older build: library course and tee found through the game round',
       tee_verified AND course->>'course_id' = 'b1c00000-0000-4000-8000-000000000001'
       AND course->>'tee' = 'Amarillas' AND (course->>'slope')::numeric = 135
       AND course->'holes'->0 = '{"n":1,"par":4,"si":3}'::jsonb,
       course::text
  FROM public.league_cards WHERE id = (SELECT v::uuid FROM ss_ctx WHERE k='cardApp');

-- 4b) A hand-entered tee waits for an admin; a library tee doesn't (R4) ---------------
-- Announced off-app cards (not_announced = false) so only the tee decides.
SELECT set_config('request.jwt.claims', '{"sub":"b1000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE r jsonb;
BEGIN
  r := public.announce_league_card((SELECT v::uuid FROM ss_ctx WHERE k='league'), 'offapp',
         (SELECT v::jsonb FROM ss_ctx WHERE k='custom'), now() + interval '2 hours');
  INSERT INTO ss_ctx VALUES ('cardHand', r->>'id');
  PERFORM pg_temp.ss_rewind((r->>'id')::uuid, interval '5 hours');
  r := public.submit_league_card((r->>'id')::uuid, (SELECT v::jsonb FROM ss_ctx WHERE k='hcng'), 86, 40, 17, NULL);
  INSERT INTO ss_smoke (name, ok, detail) VALUES ('announced custom-tee card: announced, but tee not verified',
    NOT (r->>'not_announced')::boolean AND NOT (r->>'tee_verified')::boolean, r::text);
  BEGIN
    PERFORM public.approve_league_card((SELECT v::uuid FROM ss_ctx WHERE k='cardHand'));
    INSERT INTO ss_smoke (name, ok, detail) VALUES ('a member cannot approve a hand-entered tee', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO ss_smoke (name, ok, detail) VALUES ('a member cannot approve a hand-entered tee', SQLSTATE = '42501', SQLERRM);
  END;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"b1000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
DO $$
DECLARE r jsonb;
BEGIN
  r := public.announce_league_card((SELECT v::uuid FROM ss_ctx WHERE k='league'), 'offapp',
         (SELECT v::jsonb FROM ss_ctx WHERE k='lib'), now() + interval '2 hours');
  INSERT INTO ss_ctx VALUES ('cardLib', r->>'id');
  PERFORM pg_temp.ss_rewind((r->>'id')::uuid, interval '5 hours');
  PERFORM public.submit_league_card((r->>'id')::uuid, (SELECT v::jsonb FROM ss_ctx WHERE k='hcng'), 86, 40, 17, NULL);
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"b1000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
DO $$
DECLARE r jsonb;
BEGIN
  r := public.approve_league_card((SELECT v::uuid FROM ss_ctx WHERE k='cardHand'));
  INSERT INTO ss_smoke (name, ok, detail) VALUES ('the admin approves a hand-entered tee', r->>'approved_at' IS NOT NULL, r::text);
  BEGIN
    PERFORM public.approve_league_card((SELECT v::uuid FROM ss_ctx WHERE k='cardLib'));
    INSERT INTO ss_smoke (name, ok, detail) VALUES ('an announced library-tee card needs no approval', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO ss_smoke (name, ok, detail) VALUES ('an announced library-tee card needs no approval',
      SQLSTATE = 'P0001' AND SQLERRM = 'This card doesn''t need approving.', SQLERRM);
  END;
  -- Own-card rule (20261016000000, R10): A is the league's only admin, so she
  -- may approve her own unannounced card (cardW). With another admin she
  -- can't (league_integrity_smoke.sql).
  r := public.approve_league_card((SELECT v::uuid FROM ss_ctx WHERE k='cardW'));
  INSERT INTO ss_smoke (name, ok, detail) VALUES ('the only admin approves their own card', r->>'approved_at' IS NOT NULL, r::text);
END $$;
RESET ROLE;
INSERT INTO ss_smoke (name, ok, detail)
SELECT 'approval stamped on the hand-entered card; the library card is verified and unapproved',
       (SELECT approved_by = 'b1000000-0000-4000-8000-00000000000a' AND NOT tee_verified
          FROM public.league_cards WHERE id = (SELECT v::uuid FROM ss_ctx WHERE k='cardHand'))
       AND (SELECT tee_verified AND approved_at IS NULL
              FROM public.league_cards WHERE id = (SELECT v::uuid FROM ss_ctx WHERE k='cardLib')),
       NULL;

-- 4c) Scramble rounds are never league cards ----------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"b1000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_hint text;
BEGIN
  PERFORM public.announce_league_card((SELECT v::uuid FROM ss_ctx WHERE k='league'), 'app',
            (SELECT v::jsonb FROM ss_ctx WHERE k='lib'), now(), 't_ss_scr0', 'r0', 'pG', 'scramble4');
  INSERT INTO ss_smoke (name, ok, detail) VALUES ('announce refuses a scramble round', false, 'no error');
EXCEPTION WHEN others THEN
  GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
  INSERT INTO ss_smoke (name, ok, detail) VALUES ('announce refuses a scramble round',
    SQLSTATE = 'P0001' AND v_hint = 'scramble_round', SQLSTATE || ' ' || v_hint || ' ' || SQLERRM);
END $$;
RESET ROLE;
-- Rounds that are scrambles through their own mode, or the tournament's.
INSERT INTO public.tournaments (id, name, props)
VALUES ('t_ss_scr', 'Scoring smoke scramble', '{}'::jsonb),
       ('t_ss_scr2', 'Scoring smoke scramble 2', '{"settings":{"scoringMode":"scramble3v1"}}'::jsonb);
INSERT INTO public.game_rounds (id, tournament_id, round_index, body)
VALUES ('r0', 't_ss_scr', 0, '{"scoringMode":"scramblepairs"}'::jsonb),
       ('r0', 't_ss_scr2', 0, '{}'::jsonb);
INSERT INTO public.game_scores (tournament_id, round_id, player_id, hole, strokes)
SELECT t, 'r0', 'pA', key::int, value::int
  FROM jsonb_each_text((SELECT v::jsonb FROM ss_ctx WHERE k='hcng')), unnest(ARRAY['t_ss_scr', 't_ss_scr2']) t;
INSERT INTO public.league_cards (league_id, user_id, month, source, status, tournament_id, round_id, player_id,
                                 course, tee_time, played_on, announced_at, league_handicap)
SELECT (SELECT v::uuid FROM ss_ctx WHERE k='league'), 'b1000000-0000-4000-8000-00000000000a', m::date,
       'app', 'playing', t, 'r0', 'pA', (SELECT v::jsonb FROM ss_ctx WHERE k='custom'), now(), m::date, now(), 18
  FROM (VALUES ('t_ss_scr', '2027-08-01'), ('t_ss_scr2', '2027-09-01')) v(t, m);
SELECT set_config('request.jwt.claims', '{"sub":"b1000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE cid uuid; v_hint text; hints text := '';
BEGIN
  FOR cid IN SELECT id FROM public.league_cards WHERE tournament_id IN ('t_ss_scr', 't_ss_scr2') ORDER BY month LOOP
    BEGIN
      PERFORM public.submit_league_card(cid, (SELECT v::jsonb FROM ss_ctx WHERE k='hcng'), 86, 40, 17, NULL);
      hints := hints || 'none,';
    EXCEPTION WHEN others THEN
      GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT; hints := hints || v_hint || ',';
    END;
  END LOOP;
  INSERT INTO ss_smoke (name, ok, detail) VALUES ('submit refuses a scramble round (round mode, or the tournament''s)',
    hints = 'scramble_round,scramble_round,', hints);
END $$;
RESET ROLE;

-- 5) Invariants and grants ------------------------------------------------------------
INSERT INTO ss_smoke (name, ok, detail)
SELECT 'every scored card stores the points its frozen data gives (backfill + writes)',
       count(*) = 0, string_agg(id::text, ',')
  FROM public.league_cards
 WHERE status <> 'void' AND holes IS NOT NULL
   AND public.league_card_score(holes, course, league_handicap) IS NOT NULL
   AND (points IS DISTINCT FROM (public.league_card_score(holes, course, league_handicap) ->> 'points')::int
        OR playing_handicap IS DISTINCT FROM (public.league_card_score(holes, course, league_handicap) ->> 'playing_handicap')::int);

INSERT INTO ss_smoke (name, ok, detail)
SELECT 'a card the server can''t score carries no points to rank on (backfill)',
       count(*) = 0, string_agg(id::text, ',')
  FROM public.league_cards
 WHERE status <> 'void' AND holes IS NOT NULL
   AND public.league_card_score(holes, course, league_handicap) IS NULL
   AND (points IS NOT NULL OR playing_handicap IS NOT NULL);

INSERT INTO ss_smoke (name, ok, detail)
SELECT 'nobody but the owner executes the scoring helpers',
       NOT bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')
                   OR has_function_privilege('anon', p.oid, 'EXECUTE')),
       string_agg(p.proname, ',')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('league_card_holes','league_card_score','league_user_is_female','league_library_course',
                     'league_course_problem','league_assert_plausible_course','league_round_scoring_mode',
                     'league_is_scramble','league_assert_not_scramble');
INSERT INTO ss_smoke (name, ok, detail)
SELECT 'authenticated (not anon) executes the changed RPCs, one signature each',
       count(*) = 6
       AND bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')),
       string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ' | ')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('create_league','update_league_rules','submit_league_card','add_unannounced_league_card',
                     'announce_league_card','approve_league_card');
INSERT INTO ss_smoke (name, ok, detail)
SELECT 'every SECURITY DEFINER league function pins search_path',
       count(*) FILTER (WHERE NOT COALESCE(p.proconfig @> ARRAY['search_path=public'], false)) = 0,
       string_agg(p.proname, ',') FILTER (WHERE NOT COALESCE(p.proconfig @> ARRAY['search_path=public'], false))
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prosecdef
   AND p.proname IN ('create_league','update_league_rules','submit_league_card','add_unannounced_league_card',
                     'announce_league_card','approve_league_card');
INSERT INTO ss_smoke (name, ok, detail)
SELECT 'scoring backup table is closed to anon and authenticated',
       NOT has_table_privilege('anon', 'public.league_cards_scoring_backup', 'SELECT')
       AND NOT has_table_privilege('authenticated', 'public.league_cards_scoring_backup', 'SELECT'),
       NULL;

-- Verdict ------------------------------------------------------------------------------------
DO $$
DECLARE v_failed text;
BEGIN
  SELECT string_agg(name || ' [' || COALESCE(detail, '') || ']', E'\n' ORDER BY seq) INTO v_failed
    FROM ss_smoke WHERE ok IS NOT TRUE;
  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION E'league server scoring smoke failed:\n%', v_failed;
  END IF;
END $$;

SELECT seq, name, ok FROM ss_smoke ORDER BY seq;

ROLLBACK;
