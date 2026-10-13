-- ============================================================================
-- Smoke test for 20261016000000_league_integrity.sql: deadlines from the
-- first shot and the auto-withdraw (R6), two hours' notice (R7), the 3-hour
-- minimum round (R8), withdraw (R9), admins on their own card / handicap
-- (R10), marker returns (R11), month close (R12), the card timeline (R13),
-- member admin (R15), admin voids keep the month (R15b), several league cards
-- per game (R16) and tournament rounds (R17).
--
-- Same shape as leagues_smoke.sql: each check is one row in the temp table
-- `ig_smoke`, a final DO block RAISEs listing every failed check, and the
-- whole run is one transaction ending in ROLLBACK. It calls
-- league_sweep_cards() once (it touches every league's cards, rolled back
-- with the rest).
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/league_integrity_smoke.sql
--
-- Cast: A Ana and G Gil (admins), members N Nico, M Mar, P Pau, Q Quim,
-- O Olga (not in the league), K Kiko (claims a reserved spot).
-- Dates are relative to now(): "this month", "next month", and a month two
-- back that is always closed.
-- ============================================================================

BEGIN;

CREATE TEMP TABLE ig_smoke (seq serial, name text, ok boolean, detail text) ON COMMIT DROP;
CREATE TEMP TABLE ig_ctx (k text PRIMARY KEY, v text) ON COMMIT DROP;
GRANT ALL ON ig_smoke, ig_ctx TO authenticated, anon;
GRANT USAGE ON SEQUENCE ig_smoke_seq_seq TO authenticated, anon;

-- Helpers ------------------------------------------------------------------------------
-- ig_v(k): a context value. ig_as(user key): sign in as that user.
-- ig_ok(name, ok, detail): record a check. ig_refuses(name, sql, hint, state):
-- run sql as the current role and pass when it raises with that HINT (and
-- SQLSTATE, when given). ig_sql(sql) / ig_n(sql): superuser, to set up a
-- fixture or move a clock (SECURITY DEFINER).
CREATE FUNCTION pg_temp.ig_v(p_k text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT v FROM ig_ctx WHERE k = p_k $$;
CREATE FUNCTION pg_temp.ig_as(p_k text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    jsonb_build_object('sub', (SELECT v FROM ig_ctx WHERE k = 'u:' || p_k), 'role', 'authenticated')::text, true) $$;
CREATE FUNCTION pg_temp.ig_ok(p_name text, p_ok boolean, p_detail text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $$ INSERT INTO ig_smoke (name, ok, detail) VALUES (p_name, COALESCE(p_ok, false), p_detail) $$;
CREATE FUNCTION pg_temp.ig_refuses(p_name text, p_sql text, p_hint text, p_state text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_hint text; v_state text; v_msg text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT, v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO ig_smoke (name, ok, detail) VALUES (p_name,
      (p_hint IS NULL OR v_hint IS NOT DISTINCT FROM p_hint) AND (p_state IS NULL OR v_state = p_state),
      v_state || ' ' || COALESCE(NULLIF(v_hint, ''), '-') || ' ' || v_msg);
    RETURN;
  END;
  INSERT INTO ig_smoke (name, ok, detail) VALUES (p_name, false, 'no error');
END $$;
CREATE FUNCTION pg_temp.ig_sql(p_sql text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN EXECUTE p_sql; END $$;
CREATE FUNCTION pg_temp.ig_n(p_sql text) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE n bigint; BEGIN EXECUTE p_sql INTO n; RETURN n; END $$;
-- Move a card's clock back by p_by, as if it was announced (and teed) earlier.
CREATE FUNCTION pg_temp.ig_rewind(p_card uuid, p_by interval) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE public.league_cards
     SET tee_time = tee_time - p_by, announced_at = announced_at - p_by, post_by = post_by - p_by,
         played_on = ((tee_time - p_by) AT TIME ZONE 'Europe/Madrid')::date
   WHERE id = p_card $$;

-- Fixture --------------------------------------------------------------------------------
INSERT INTO ig_ctx (k, v) VALUES
  ('u:a', 'd1000000-0000-4000-8000-00000000000a'), ('u:g', 'd1000000-0000-4000-8000-00000000000b'),
  ('u:n', 'd1000000-0000-4000-8000-00000000000c'), ('u:m', 'd1000000-0000-4000-8000-00000000000d'),
  ('u:p', 'd1000000-0000-4000-8000-00000000000e'), ('u:q', 'd1000000-0000-4000-8000-00000000000f'),
  ('u:o', 'd1000000-0000-4000-8000-000000000010'), ('u:k', 'd1000000-0000-4000-8000-000000000011'),
  ('this',   (date_trunc('month', now() AT TIME ZONE 'Europe/Madrid'))::date::text),
  ('next',   (date_trunc('month', now() AT TIME ZONE 'Europe/Madrid') + interval '1 month')::date::text),
  ('next2',  (date_trunc('month', now() AT TIME ZONE 'Europe/Madrid') + interval '2 months')::date::text),
  ('closed', (date_trunc('month', now() AT TIME ZONE 'Europe/Madrid') - interval '2 months')::date::text),
  ('closed1',(date_trunc('month', now() AT TIME ZONE 'Europe/Madrid') - interval '3 months')::date::text),
  -- A hand-entered (custom) rated course: par 72, SI 1-18.
  ('course', '{"name":"Integrity Muni","tee":"Blancas","slope":125,"rating":71.0,"holes":[{"n":1,"par":4,"si":1},{"n":2,"par":4,"si":2},{"n":3,"par":4,"si":3},{"n":4,"par":4,"si":4},{"n":5,"par":4,"si":5},{"n":6,"par":4,"si":6},{"n":7,"par":4,"si":7},{"n":8,"par":4,"si":8},{"n":9,"par":4,"si":9},{"n":10,"par":4,"si":10},{"n":11,"par":4,"si":11},{"n":12,"par":4,"si":12},{"n":13,"par":4,"si":13},{"n":14,"par":4,"si":14},{"n":15,"par":4,"si":15},{"n":16,"par":4,"si":16},{"n":17,"par":4,"si":17},{"n":18,"par":4,"si":18}]}'),
  ('h5', (SELECT jsonb_object_agg(h::text, 5) FROM generate_series(1, 18) h)::text);

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT v::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'league-integrity-' || substr(k, 3) || '@example.invalid', now(), now()
  FROM ig_ctx WHERE k LIKE 'u:%';
INSERT INTO public.profiles (user_id, display_name)
SELECT v::uuid, initcap(CASE substr(k, 3) WHEN 'a' THEN 'Ana' WHEN 'g' THEN 'Gil' WHEN 'n' THEN 'Nico'
         WHEN 'm' THEN 'Mar' WHEN 'p' THEN 'Pau' WHEN 'q' THEN 'Quim' WHEN 'o' THEN 'Olga' ELSE 'Kiko' END) || ' Smoke'
  FROM ig_ctx WHERE k LIKE 'u:%'
ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name;
INSERT INTO public.friendships (requester_id, addressee_id, status)
SELECT pg_temp.ig_v('u:a')::uuid, v::uuid, 'accepted' FROM ig_ctx WHERE k IN ('u:g','u:n','u:m','u:p','u:q');

SET LOCAL ROLE authenticated;

-- League: A creates it with G, N, M, P, Q and a reserved spot "Kiko Spot"; G becomes admin.
SELECT pg_temp.ig_as('a');
DO $$
DECLARE r jsonb;
BEGIN
  r := public.create_league('Integrity Smoke', '2020-01-01', '2030-12-31', NULL, 30, 0,
         jsonb_build_array(
           jsonb_build_object('user_id', pg_temp.ig_v('u:a'), 'handicap', 18),
           jsonb_build_object('user_id', pg_temp.ig_v('u:g'), 'handicap', 18),
           jsonb_build_object('user_id', pg_temp.ig_v('u:n'), 'handicap', 18),
           jsonb_build_object('user_id', pg_temp.ig_v('u:m'), 'handicap', 18),
           jsonb_build_object('user_id', pg_temp.ig_v('u:p'), 'handicap', 18),
           jsonb_build_object('user_id', pg_temp.ig_v('u:q'), 'handicap', 18),
           jsonb_build_object('name', 'Kiko Spot', 'handicap', 22)));
  INSERT INTO ig_ctx VALUES ('league', r->>'id'), ('code', r->>'invite_code');
END $$;
SELECT pg_temp.ig_as(u), public.join_league(pg_temp.ig_v('code'), 18) FROM unnest(ARRAY['g','n','m','p','q']) u;
SELECT pg_temp.ig_as('a');
SELECT public.set_league_role(pg_temp.ig_v('league')::uuid, pg_temp.ig_v('u:g')::uuid, 'admin');

-- Games: t_ig_g (a casual game: A, G, N and an unlinked player), t_ig_t (a
-- casual tournament, Q plays rounds r0 and r1), t_ig_o (an official one).
SELECT pg_temp.ig_sql($q$
  INSERT INTO public.tournaments (id, name, props) VALUES
    ('t_ig_g', 'Integrity game', '{"kind":"game"}'),
    ('t_ig_t', 'Integrity tournament', '{"kind":"tournament"}'),
    ('t_ig_o', 'Integrity official', '{"kind":"official"}'),
    ('t_ig_w', 'Integrity withdraw', '{"kind":"game"}');
  INSERT INTO public.game_rounds (id, tournament_id, round_index, body) VALUES
    ('r0', 't_ig_g', 0, '{}'), ('r0', 't_ig_t', 0, '{}'), ('r1', 't_ig_t', 1, '{}'), ('r0', 't_ig_o', 0, '{}');
  INSERT INTO public.game_players (tournament_id, player_id, user_id, pos, body) VALUES
    ('t_ig_g', 'pA', 'd1000000-0000-4000-8000-00000000000a', 0, '{}'),
    ('t_ig_g', 'pG', 'd1000000-0000-4000-8000-00000000000b', 1, '{}'),
    ('t_ig_g', 'pN', 'd1000000-0000-4000-8000-00000000000c', 2, '{}'),
    ('t_ig_g', 'pX', NULL, 3, '{}'),
    ('t_ig_t', 'pQ', 'd1000000-0000-4000-8000-00000000000f', 0, '{}'),
    ('t_ig_t', 'pA', 'd1000000-0000-4000-8000-00000000000a', 1, '{}'),
    ('t_ig_o', 'pQ', 'd1000000-0000-4000-8000-00000000000f', 0, '{}');
$q$);

-- 1) R16: several league cards per game ------------------------------------------------
SELECT pg_temp.ig_as('a');
DO $$
DECLARE r jsonb; lid uuid := pg_temp.ig_v('league')::uuid; c jsonb := pg_temp.ig_v('course')::jsonb;
BEGIN
  r := public.announce_league_card(lid, 'app', c, NULL, 't_ig_g', 'r0', 'pA');
  INSERT INTO ig_ctx VALUES ('cardA', r->>'id');
  PERFORM pg_temp.ig_ok('R6: an app card has no deadline until its first shot',
    r->>'post_by' IS NULL AND NOT (r->>'existing')::boolean AND r->>'status' = 'playing', r::text);
END $$;
SELECT pg_temp.ig_as('g');
SELECT pg_temp.ig_refuses('R16: a member can''t announce for a player who already has a card',
  format($s$SELECT public.announce_league_card(%L, 'app', %L::jsonb, NULL, 't_ig_g', 'r0', 'pA')$s$,
         pg_temp.ig_v('league'), pg_temp.ig_v('course')), 'not_your_player');
SELECT pg_temp.ig_refuses('R16: a member can''t announce for a player of the game who isn''t theirs',
  format($s$SELECT public.announce_league_card(%L, 'app', %L::jsonb, NULL, 't_ig_g', 'r0', 'pX')$s$,
         pg_temp.ig_v('league'), pg_temp.ig_v('course')), 'not_your_player');
DO $$
DECLARE r jsonb; r2 jsonb; lid uuid := pg_temp.ig_v('league')::uuid; c jsonb := pg_temp.ig_v('course')::jsonb;
BEGIN
  r := public.announce_league_card(lid, 'app', c, NULL, 't_ig_g', 'r0', 'pG');
  INSERT INTO ig_ctx VALUES ('cardG', r->>'id');
  r2 := public.announce_league_card(lid, 'app', c, NULL, 't_ig_g', 'r0', 'pG');
  PERFORM pg_temp.ig_ok('R16: a second member of the game announces their own card for it',
    r->>'id' IS NOT NULL AND r->>'id' <> pg_temp.ig_v('cardA'), r::text);
  PERFORM pg_temp.ig_ok('R16: announcing the same round and player again returns the same card',
    r2->>'id' = r->>'id' AND (r2->>'existing')::boolean, r2::text);
END $$;
-- N has scored on this round already: too late to opt in.
SELECT pg_temp.ig_sql($q$INSERT INTO public.game_scores (tournament_id, round_id, player_id, hole, strokes)
                        VALUES ('t_ig_g', 'r0', 'pN', 1, 5)$q$);
SELECT pg_temp.ig_as('n');
SELECT pg_temp.ig_refuses('R16: a member whose round has started can''t announce it',
  format($s$SELECT public.announce_league_card(%L, 'app', %L::jsonb, NULL, 't_ig_g', 'r0', 'pN')$s$,
         pg_temp.ig_v('league'), pg_temp.ig_v('course')), 'round_started');
SELECT pg_temp.ig_as('a');
DO $$
DECLARE r jsonb := public.get_league_game_status(pg_temp.ig_v('league')::uuid, 't_ig_g', 'r0');
BEGIN
  PERFORM pg_temp.ig_ok('R16: get_league_game_status lists the game''s league members with their month status',
    jsonb_array_length(r) = 3
    AND (SELECT bool_and(CASE e->>'player_id'
                           WHEN 'pA' THEN (e->>'has_card')::boolean AND (e->>'this_round')::boolean AND (e->>'is_me')::boolean
                                          AND e->>'card_id' = pg_temp.ig_v('cardA')
                           WHEN 'pG' THEN (e->>'has_card')::boolean AND (e->>'this_round')::boolean AND NOT (e->>'is_me')::boolean
                           WHEN 'pN' THEN NOT (e->>'has_card')::boolean AND NOT (e->>'this_round')::boolean
                                          AND e->>'name' = 'Nico Smoke' AND (e->>'league_handicap')::numeric = 18
                           ELSE false END)
           FROM jsonb_array_elements(r) e),
    r::text);
END $$;
SELECT pg_temp.ig_as('m');
SELECT pg_temp.ig_ok('R16: a member who doesn''t play the game gets an empty list',
  public.get_league_game_status(pg_temp.ig_v('league')::uuid, 't_ig_g', 'r0') = '[]'::jsonb);
SELECT pg_temp.ig_as('o');
SELECT pg_temp.ig_refuses('R16: get_league_game_status is for members only',
  format($s$SELECT public.get_league_game_status(%L, 't_ig_g', 'r0')$s$, pg_temp.ig_v('league')), NULL, '42501');

-- 2) R17: a tournament round counts; an official round doesn't --------------------------
SELECT pg_temp.ig_as('q');
SELECT pg_temp.ig_refuses('R17: an official tournament round can''t be a league card',
  format($s$SELECT public.announce_league_card(%L, 'app', %L::jsonb, NULL, 't_ig_o', 'r0', 'pQ')$s$,
         pg_temp.ig_v('league'), pg_temp.ig_v('course')), 'official_round');
DO $$
DECLARE r jsonb;
BEGIN
  r := public.announce_league_card(pg_temp.ig_v('league')::uuid, 'app', pg_temp.ig_v('course')::jsonb, NULL,
                                   't_ig_t', 'r1', 'pQ');
  INSERT INTO ig_ctx VALUES ('cardQ', r->>'id');
  PERFORM pg_temp.ig_ok('R17: round 2 of a casual tournament is announced as a league card',
    r->>'id' IS NOT NULL AND r->>'month' = pg_temp.ig_v('this'), r::text);
END $$;

-- 3) R6: the first shot starts the 8 hours --------------------------------------------------
-- A's partner (A writes a card carrying pQ) scores Q first: Q's card gets its first shot.
SELECT pg_temp.ig_as('a');
SELECT pg_temp.ig_sql($q$INSERT INTO public.scorer_cards (tournament_id, round_id, author_id, card)
  VALUES ('t_ig_t', 'r1', 'devA', jsonb_build_object('scorer', jsonb_build_object('playerId', 'pA'),
          'holes', jsonb_build_object('1', jsonb_build_object('v', 1, 'entries', jsonb_build_object('pQ', 4)))))$q$);
SELECT pg_temp.ig_ok('R6: the first scorer card carrying the player stamps the first shot and post_by = +8 h',
  pg_temp.ig_n(format($s$SELECT count(*) FROM public.league_cards WHERE id = %L
                          AND first_shot_at = now() AND post_by = now() + interval '8 hours'$s$, pg_temp.ig_v('cardQ'))) = 1
  AND pg_temp.ig_n(format($s$SELECT count(*) FROM public.league_card_events WHERE card_id = %L
                             AND kind = 'first_shot' AND data->>'via' = 'scorecard'$s$, pg_temp.ig_v('cardQ'))) = 1);
SELECT pg_temp.ig_ok('R6: a scorer card of another round leaves the card alone',
  pg_temp.ig_n(format($s$SELECT count(*) FROM public.league_cards WHERE id = %L AND first_shot_at IS NULL$s$,
                      pg_temp.ig_v('cardA'))) = 1);
SELECT public.notify_league_tee_off(pg_temp.ig_v('cardA')::uuid);
SELECT pg_temp.ig_ok('R6: tee-off stamps the first shot and starts the 8 hours',
  pg_temp.ig_n(format($s$SELECT count(*) FROM public.league_cards WHERE id = %L
                          AND first_shot_at = now() AND post_by = now() + interval '8 hours'$s$, pg_temp.ig_v('cardA'))) = 1);
-- A card announced before this migration keeps its deadline.
SELECT pg_temp.ig_sql(format($q$
  INSERT INTO public.league_cards (id, league_id, user_id, month, source, status, tournament_id, round_id, player_id,
                                   course, tee_time, played_on, announced_at, league_handicap, post_by)
  VALUES ('d1c00000-0000-4000-8000-000000000001', %L, %L, %L, 'app', 'playing', 't_ig_old', 'r0', 'pA',
          %L::jsonb, now() - interval '1 hour', now()::date, now() - interval '1 hour', 18, now() + interval '7 hours')$q$,
  pg_temp.ig_v('league'), pg_temp.ig_v('u:a'), pg_temp.ig_v('next'), pg_temp.ig_v('course')));
SELECT public.notify_league_tee_off('d1c00000-0000-4000-8000-000000000001');
SELECT pg_temp.ig_ok('R6: an existing live card keeps its post_by',
  pg_temp.ig_n($s$SELECT count(*) FROM public.league_cards WHERE id = 'd1c00000-0000-4000-8000-000000000001'
                   AND first_shot_at = now() AND post_by = now() + interval '7 hours'$s$) = 1);
-- An app card can't be withdrawn once played.
SELECT pg_temp.ig_refuses('R9: an app card can''t be withdrawn after its first shot',
  format('SELECT public.withdraw_league_card(%L)', pg_temp.ig_v('cardA')), 'withdraw_closed');

-- N: an app card nobody plays is withdrawn 24 h after Start, and the month is free again.
SELECT pg_temp.ig_sql($q$INSERT INTO public.tournaments (id, name, props) VALUES ('t_ig_n', 'N alone', '{"kind":"game"}'),
                                                                               ('t_ig_n2', 'N again', '{"kind":"game"}')$q$);
SELECT pg_temp.ig_as('n');
DO $$
DECLARE r jsonb;
BEGIN
  r := public.announce_league_card(pg_temp.ig_v('league')::uuid, 'app', pg_temp.ig_v('course')::jsonb, NULL,
                                   't_ig_n', 'r0', 'pN');
  INSERT INTO ig_ctx VALUES ('cardN', r->>'id');
END $$;
SELECT pg_temp.ig_sql(format($q$UPDATE public.league_cards SET announced_at = now() - interval '25 hours' WHERE id = %L$q$,
                             pg_temp.ig_v('cardN')));
-- P's card past its deadline (for the 'missed' timeline entry): announced off-app below.
SELECT pg_temp.ig_sql('SELECT public.league_sweep_cards()');
SELECT pg_temp.ig_ok('R6: the sweep withdraws an app card with no first shot 24 h after Start',
  pg_temp.ig_n(format($s$SELECT count(*) FROM public.league_cards WHERE id = %L AND status = 'void'
                          AND void_kind = 'auto_withdrawn' AND voided_reason = 'auto_withdrawn'$s$, pg_temp.ig_v('cardN'))) = 1
  AND pg_temp.ig_n(format($s$SELECT count(*) FROM public.notifications WHERE type = 'league_card_auto_withdrawn'
                             AND user_id = %L AND entity_id = %L$s$, pg_temp.ig_v('u:n'), pg_temp.ig_v('cardN'))) = 1
  AND pg_temp.ig_n(format($s$SELECT count(*) FROM public.league_card_events WHERE card_id = %L
                             AND kind = 'auto_withdrawn'$s$, pg_temp.ig_v('cardN'))) = 1);
SELECT pg_temp.ig_ok('R6: the sweep leaves a card with a first shot alone',
  pg_temp.ig_n(format($s$SELECT count(*) FROM public.league_cards WHERE id IN (%L, %L) AND status = 'playing'$s$,
                      pg_temp.ig_v('cardA'), pg_temp.ig_v('cardQ'))) = 2);
DO $$
DECLARE r jsonb;
BEGIN
  r := public.announce_league_card(pg_temp.ig_v('league')::uuid, 'app', pg_temp.ig_v('course')::jsonb, NULL,
                                   't_ig_n2', 'r0', 'pN');
  INSERT INTO ig_ctx VALUES ('cardN2', r->>'id');
  PERFORM pg_temp.ig_ok('R15b: an auto-withdrawn card frees the month', r->>'id' IS NOT NULL, r::text);
  r := public.withdraw_league_card((r->>'id')::uuid);
  PERFORM pg_temp.ig_ok('R9: an app card is withdrawn before its first shot',
    r->>'status' = 'void' AND r->>'void_kind' = 'withdrawn', r::text);
END $$;

-- 4) R7, R8, R9: off-app notice, minimum round, withdraw (P) ---------------------------------
SELECT pg_temp.ig_as('p');
SELECT pg_temp.ig_refuses('R7: an off-app tee time under 2 hours away is refused',
  format($s$SELECT public.announce_league_card(%L, 'offapp', %L::jsonb, now() + interval '1 hour')$s$,
         pg_temp.ig_v('league'), pg_temp.ig_v('course')), 'short_notice');
SELECT pg_temp.ig_refuses('R7: an off-app tee time already past is still tee_time_passed',
  format($s$SELECT public.announce_league_card(%L, 'offapp', %L::jsonb, now() - interval '1 minute')$s$,
         pg_temp.ig_v('league'), pg_temp.ig_v('course')), 'tee_time_passed');
DO $$
DECLARE r jsonb;
BEGIN
  r := public.announce_league_card(pg_temp.ig_v('league')::uuid, 'offapp', pg_temp.ig_v('course')::jsonb,
                                   now() + interval '3 hours');
  INSERT INTO ig_ctx VALUES ('cardP', r->>'id');
  PERFORM pg_temp.ig_ok('R7: an off-app card with 3 hours'' notice is announced, post_by = tee + 8 h',
    (r->>'post_by')::timestamptz = now() + interval '11 hours', r::text);
END $$;
SELECT pg_temp.ig_refuses('R7: reschedule to under 2 hours away is refused',
  format($s$SELECT public.reschedule_league_card(%L, now() + interval '90 minutes')$s$, pg_temp.ig_v('cardP')), 'short_notice');
SELECT public.reschedule_league_card(pg_temp.ig_v('cardP')::uuid, now() + interval '4 hours');
SELECT pg_temp.ig_ok('R7: a reschedule is on the timeline and notifies the members',
  pg_temp.ig_n(format($s$SELECT count(*) FROM public.league_card_events WHERE card_id = %L AND kind = 'rescheduled'
                          AND (data->>'to')::timestamptz = now() + interval '4 hours'
                          AND (data->>'from')::timestamptz = now() + interval '3 hours'$s$, pg_temp.ig_v('cardP'))) = 1
  AND pg_temp.ig_n(format($s$SELECT count(*) FROM public.notifications WHERE type = 'league_card_rescheduled'
                             AND entity_id = %L AND data->>'owner_name' = 'Pau Smoke'
                             AND (data->>'old_tee_time')::timestamptz = now() + interval '3 hours'$s$, pg_temp.ig_v('cardP'))) = 5);
SELECT pg_temp.ig_rewind(pg_temp.ig_v('cardP')::uuid, interval '150 minutes');   -- tee in 90 minutes
SELECT pg_temp.ig_refuses('R7: a card whose tee time is under 2 hours away can''t be moved',
  format($s$SELECT public.reschedule_league_card(%L, now() + interval '5 hours')$s$, pg_temp.ig_v('cardP')), 'reschedule_closed');
SELECT pg_temp.ig_refuses('R9: only the owner can withdraw',
  format('SELECT public.withdraw_league_card(%L)', pg_temp.ig_v('cardP')), NULL, 'P0001')
  FROM (SELECT pg_temp.ig_as('q')) x;
SELECT pg_temp.ig_as('p');
SELECT public.withdraw_league_card(pg_temp.ig_v('cardP')::uuid);
SELECT pg_temp.ig_ok('R9: withdrawn before the tee time: void, reason withdrawn, members told, on the timeline',
  pg_temp.ig_n(format($s$SELECT count(*) FROM public.league_cards WHERE id = %L AND status = 'void'
                          AND void_kind = 'withdrawn' AND voided_reason = 'withdrawn'$s$, pg_temp.ig_v('cardP'))) = 1
  AND pg_temp.ig_n(format($s$SELECT count(*) FROM public.notifications WHERE type = 'league_card_withdrawn'
                             AND entity_id = %L$s$, pg_temp.ig_v('cardP'))) = 5
  AND pg_temp.ig_n(format($s$SELECT count(*) FROM public.league_card_events WHERE card_id = %L
                             AND kind = 'withdrawn'$s$, pg_temp.ig_v('cardP'))) = 1);
DO $$
DECLARE r jsonb;
BEGIN
  r := public.announce_league_card(pg_temp.ig_v('league')::uuid, 'offapp', pg_temp.ig_v('course')::jsonb,
                                   now() + interval '2 hours');
  INSERT INTO ig_ctx VALUES ('cardP2', r->>'id');
  PERFORM pg_temp.ig_ok('R9: after a withdrawal the month is free again', r->>'id' IS NOT NULL, r::text);
END $$;
SELECT pg_temp.ig_rewind(pg_temp.ig_v('cardP2')::uuid, interval '4 hours');      -- teed off 2 hours ago
SELECT pg_temp.ig_refuses('R8: an off-app card can''t be posted before tee time + 3 h',
  format($s$SELECT public.submit_league_card(%L, %L::jsonb, 90, 0, 0, NULL)$s$, pg_temp.ig_v('cardP2'), pg_temp.ig_v('h5')),
  'too_early');
SELECT pg_temp.ig_refuses('R9: an off-app card can''t be withdrawn after its tee time',
  format('SELECT public.withdraw_league_card(%L)', pg_temp.ig_v('cardP2')), 'withdraw_closed');
SELECT pg_temp.ig_rewind(pg_temp.ig_v('cardP2')::uuid, interval '65 minutes');   -- 3 h 05 ago
DO $$
DECLARE r jsonb;
BEGIN
  r := public.submit_league_card(pg_temp.ig_v('cardP2')::uuid, pg_temp.ig_v('h5')::jsonb, 90, 0, 0, NULL);
  PERFORM pg_temp.ig_ok('R8: posted 3 hours after the tee time', r->>'status' = 'submitted' AND NOT (r->>'not_announced')::boolean, r::text);
END $$;

-- 5) R11: marker returns (M) ------------------------------------------------------------------
SELECT pg_temp.ig_as('m');
DO $$
DECLARE r jsonb;
BEGIN
  r := public.announce_league_card(pg_temp.ig_v('league')::uuid, 'offapp', pg_temp.ig_v('course')::jsonb,
                                   now() + interval '2 hours');
  INSERT INTO ig_ctx VALUES ('cardM', r->>'id');
  PERFORM pg_temp.ig_rewind((r->>'id')::uuid, interval '5 hours');
  PERFORM public.submit_league_card((r->>'id')::uuid, pg_temp.ig_v('h5')::jsonb, 90, 0, 0, NULL);
  INSERT INTO ig_ctx VALUES ('tokM', public.create_marker_token((r->>'id')::uuid)->>'token');
END $$;
SELECT pg_temp.ig_refuses('R11: the owner can''t confirm their own card through the QR',
  format($s$SELECT public.confirm_marker_card(%L, 'Me', true, NULL)$s$, pg_temp.ig_v('tokM')), 'own_card');
SELECT pg_temp.ig_refuses('R11: nor send it back',
  format($s$SELECT public.confirm_marker_card(%L, 'Me', false, 'nope')$s$, pg_temp.ig_v('tokM')), 'own_card');
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT public.confirm_marker_card(pg_temp.ig_v('tokM'), 'Lucía', false, 'Hole 3 was a 6');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ig_ok('R13: a marker''s return is on the timeline with the marker''s name and note',
  pg_temp.ig_n(format($s$SELECT count(*) FROM public.league_card_events WHERE card_id = %L AND kind = 'returned'
                          AND actor_user_id IS NULL AND actor_name = 'Lucía' AND note = 'Hole 3 was a 6' AND how = 'qr'$s$,
                      pg_temp.ig_v('cardM'))) = 1);
-- The 8 hours run out; the return allows one resubmission.
SELECT pg_temp.ig_sql(format($q$UPDATE public.league_cards SET post_by = now() - interval '1 minute' WHERE id = %L$q$,
                             pg_temp.ig_v('cardM')));
SELECT pg_temp.ig_as('m');
DO $$
DECLARE r jsonb;
BEGIN
  r := public.submit_league_card(pg_temp.ig_v('cardM')::uuid,
         (SELECT jsonb_object_agg(h::text, CASE WHEN h = 3 THEN 6 ELSE 5 END) FROM generate_series(1, 18) h), 91, 0, 0, NULL);
  PERFORM pg_temp.ig_ok('R11: after a return the owner resubmits once past post_by', r->>'status' = 'submitted', r::text);
END $$;
SELECT pg_temp.ig_refuses('R11: a second resubmission past post_by is refused',
  format($s$SELECT public.submit_league_card(%L, %L::jsonb, 90, 0, 0, NULL)$s$, pg_temp.ig_v('cardM'), pg_temp.ig_v('h5')),
  'post_deadline_passed');
INSERT INTO ig_ctx SELECT 'tokM2', public.create_marker_token(pg_temp.ig_v('cardM')::uuid)->>'token';
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT public.confirm_marker_card(pg_temp.ig_v('tokM2'), 'Lucía', false, 'Still wrong');
SET LOCAL ROLE authenticated;
SELECT pg_temp.ig_sql(format($q$UPDATE public.league_cards SET returned_at = now() - interval '25 hours' WHERE id = %L$q$,
                             pg_temp.ig_v('cardM')));
SELECT pg_temp.ig_as('m');
SELECT pg_temp.ig_refuses('R11: a return older than 24 h no longer allows a resubmission',
  format($s$SELECT public.submit_league_card(%L, %L::jsonb, 90, 0, 0, NULL)$s$, pg_temp.ig_v('cardM'), pg_temp.ig_v('h5')),
  'post_deadline_passed');
SELECT pg_temp.ig_sql(format($q$UPDATE public.league_cards SET returned_at = now() WHERE id = %L$q$, pg_temp.ig_v('cardM')));
SELECT public.submit_league_card(pg_temp.ig_v('cardM')::uuid, pg_temp.ig_v('h5')::jsonb, 90, 0, 0, NULL);
INSERT INTO ig_ctx SELECT 'tokM3', public.create_marker_token(pg_temp.ig_v('cardM')::uuid)->>'token';
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT public.confirm_marker_card(pg_temp.ig_v('tokM3'), 'Lucía', true, NULL);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ig_ok('R13: a QR confirmation is on the timeline, how = qr, by the marker''s name',
  pg_temp.ig_n(format($s$SELECT count(*) FROM public.league_card_events WHERE card_id = %L AND kind = 'confirmed'
                          AND how = 'qr' AND actor_name = 'Lucía'$s$, pg_temp.ig_v('cardM'))) = 1);

-- 6) R10 + R15b: admins on their own card and handicap ------------------------------------------
SELECT pg_temp.ig_as('a');
SELECT pg_temp.ig_refuses('R10: an admin can''t void their own card while another admin exists',
  format($s$SELECT public.void_league_card(%L, 'mine')$s$, pg_temp.ig_v('cardA')), 'own_card', '42501');
SELECT pg_temp.ig_refuses('R10: nor set their own league handicap',
  format($s$SELECT public.set_league_handicap(%L, %L, 10)$s$, pg_temp.ig_v('league'), pg_temp.ig_v('u:a')),
  'own_handicap', '42501');
-- Fixtures: A's missed card next month, A's unannounced card the month after.
SELECT pg_temp.ig_sql(format($q$
  UPDATE public.league_cards SET status = 'missed', post_by = now() - interval '1 hour'
   WHERE id = 'd1c00000-0000-4000-8000-000000000001';
  INSERT INTO public.league_cards (id, league_id, user_id, month, source, status, course, played_on,
                                   not_announced, league_handicap, playing_handicap, holes, gross, points, tee_verified)
  VALUES ('d1c00000-0000-4000-8000-000000000002', %L, %L, %L, 'offapp', 'submitted', %L::jsonb, %L::date + 1,
          true, 18, 20, %L::jsonb, 90, 30, false)$q$,
  pg_temp.ig_v('league'), pg_temp.ig_v('u:a'), pg_temp.ig_v('next2'), pg_temp.ig_v('course'), pg_temp.ig_v('next2'),
  pg_temp.ig_v('h5')));
SELECT pg_temp.ig_refuses('R10: an admin can''t reopen their own card while another admin exists',
  $s$SELECT public.reopen_league_card('d1c00000-0000-4000-8000-000000000001')$s$, 'own_card', '42501');
SELECT pg_temp.ig_refuses('R10: nor approve it',
  $s$SELECT public.approve_league_card('d1c00000-0000-4000-8000-000000000002')$s$, 'own_card', '42501');
SELECT pg_temp.ig_as('g');
SELECT public.void_league_card(pg_temp.ig_v('cardA')::uuid, 'Wrong tee');
SELECT public.set_league_handicap(pg_temp.ig_v('league')::uuid, pg_temp.ig_v('u:a')::uuid, 16);
SELECT public.reopen_league_card('d1c00000-0000-4000-8000-000000000001');
SELECT public.approve_league_card('d1c00000-0000-4000-8000-000000000002');
SELECT pg_temp.ig_ok('R10: the other admin voids, sets the handicap, reopens and approves; members are told of each',
  pg_temp.ig_n(format($s$SELECT count(*) FROM public.notifications WHERE type = 'league_card_voided' AND entity_id = %L
                          AND data->>'reason' = 'Wrong tee' AND data->>'owner_name' = 'Ana Smoke'$s$, pg_temp.ig_v('cardA'))) = 5
  AND pg_temp.ig_n(format($s$SELECT count(*) FROM public.notifications WHERE type = 'league_handicap_changed'
                             AND data->>'subject_id' = %L AND (data->>'old')::numeric = 18 AND (data->>'new')::numeric = 16$s$,
                          pg_temp.ig_v('u:a'))) = 5
  AND pg_temp.ig_n($s$SELECT count(*) FROM public.notifications WHERE type = 'league_card_reopened'
                      AND entity_id = 'd1c00000-0000-4000-8000-000000000001'$s$) = 5
  AND pg_temp.ig_n($s$SELECT count(*) FROM public.notifications WHERE type = 'league_card_approved'
                      AND entity_id = 'd1c00000-0000-4000-8000-000000000002'$s$) = 5);
SELECT pg_temp.ig_ok('R13: void, reopen and approve are on the timeline, by the admin',
  pg_temp.ig_n(format($s$SELECT count(*) FROM public.league_card_events
                          WHERE actor_user_id = %L AND actor_name = 'Gil Smoke'
                            AND ((card_id = %L AND kind = 'voided' AND note = 'Wrong tee')
                              OR (card_id = 'd1c00000-0000-4000-8000-000000000001' AND kind = 'reopened')
                              OR (card_id = 'd1c00000-0000-4000-8000-000000000002' AND kind = 'approved'))$s$,
                      pg_temp.ig_v('u:g'), pg_temp.ig_v('cardA'))) = 3);
SELECT pg_temp.ig_ok('R15b: an admin void is void_kind admin',
  pg_temp.ig_n(format($s$SELECT count(*) FROM public.league_cards WHERE id = %L AND status = 'void' AND void_kind = 'admin'$s$,
                      pg_temp.ig_v('cardA'))) = 1);
SELECT pg_temp.ig_refuses('R15b: a void card can''t be voided again',
  format($s$SELECT public.void_league_card(%L, 'again')$s$, pg_temp.ig_v('cardA')), 'already_void');
SELECT pg_temp.ig_as('a');
SELECT pg_temp.ig_refuses('R15b: after an admin void the month stays taken',
  format($s$SELECT public.announce_league_card(%L, 'offapp', %L::jsonb, now() + interval '3 hours')$s$,
         pg_temp.ig_v('league'), pg_temp.ig_v('course')), 'card_exists');
SELECT pg_temp.ig_refuses('R15b: ... for an app card in another game too',
  format($s$SELECT public.announce_league_card(%L, 'app', %L::jsonb, NULL, 't_ig_t', 'r0', 'pA')$s$,
         pg_temp.ig_v('league'), pg_temp.ig_v('course')), 'card_exists');
SELECT pg_temp.ig_refuses('R15b: ... and the voided card''s own round is not handed back',
  format($s$SELECT public.announce_league_card(%L, 'app', %L::jsonb, NULL, 't_ig_g', 'r0', 'pA')$s$,
         pg_temp.ig_v('league'), pg_temp.ig_v('course')), 'card_exists');

-- 7) R12: a closed month refuses every write -----------------------------------------------------
SELECT pg_temp.ig_ok('R12: a month closes at the end of the 3rd day of the next month, Madrid time',
  pg_temp.ig_n($s$SELECT count(*) WHERE public.league_month_closes_at('2026-09-01') = '2026-10-04 00:00:00+02'::timestamptz
                     AND public.league_month_closes_at('2026-12-01') = '2027-01-04 00:00:00+01'::timestamptz$s$) = 1);
SELECT pg_temp.ig_sql(format($q$
  INSERT INTO public.league_cards (id, league_id, user_id, month, source, status, course, tee_time, played_on, announced_at,
                                   not_announced, league_handicap, playing_handicap, holes, gross, points, tee_verified, post_by)
  VALUES ('d1c00000-0000-4000-8000-000000000003', %1$L, %2$L, %3$L, 'offapp', 'submitted', %4$L::jsonb,
          %3$L::date + interval '10 hours', %3$L::date, %3$L::date, true, 18, 20, %5$L::jsonb, 90, 30, false, NULL),
         ('d1c00000-0000-4000-8000-000000000004', %1$L, %6$L, %3$L, 'offapp', 'announced', %4$L::jsonb,
          now() + interval '1 day', %3$L::date, now(), false, 18, NULL, NULL, NULL, NULL, NULL, now() + interval '32 hours');
  INSERT INTO public.league_marker_tokens (token, card_id, snapshot_hash, expires_at)
  SELECT 'ig-closed-token', id, public.league_card_hash(c), now() + interval '1 hour'
    FROM public.league_cards c WHERE id = 'd1c00000-0000-4000-8000-000000000003'$q$,
  pg_temp.ig_v('league'), pg_temp.ig_v('u:n'), pg_temp.ig_v('closed'), pg_temp.ig_v('course'), pg_temp.ig_v('h5'),
  pg_temp.ig_v('u:m')));
SELECT pg_temp.ig_as('n');
SELECT pg_temp.ig_refuses('R12 ' || x.name, x.q, 'month_closed')
  FROM (VALUES
    ('submit',            format($s$SELECT public.submit_league_card('d1c00000-0000-4000-8000-000000000003', %L::jsonb, 90, 0, 0, NULL)$s$, pg_temp.ig_v('h5'))),
    ('partner confirm',   $s$SELECT public.confirm_league_card_by_partner('d1c00000-0000-4000-8000-000000000003')$s$),
    ('proof photo',       format($s$SELECT public.attach_league_proof('d1c00000-0000-4000-8000-000000000003', %L, 'photo', 'X')$s$,
                                 pg_temp.ig_v('league') || '/d1c00000-0000-4000-8000-000000000003.jpg')),
    ('QR',                $s$SELECT public.create_marker_token('d1c00000-0000-4000-8000-000000000003')$s$),
    ('marker request',    format($s$SELECT public.request_league_marker('d1c00000-0000-4000-8000-000000000003', %L)$s$, pg_temp.ig_v('u:g'))),
    ('add unannounced',   format($s$SELECT public.add_unannounced_league_card(%L, %L::jsonb, NULL, %L::date + 2, %L::jsonb, 90, 0, 0)$s$,
                                 pg_temp.ig_v('league'), pg_temp.ig_v('course'), pg_temp.ig_v('closed1'), pg_temp.ig_v('h5')))
  ) x(name, q);
SELECT pg_temp.ig_as('m');
SELECT pg_temp.ig_refuses('R12 ' || x.name, x.q, 'month_closed')
  FROM (VALUES
    ('withdraw',   $s$SELECT public.withdraw_league_card('d1c00000-0000-4000-8000-000000000004')$s$),
    ('reschedule', $s$SELECT public.reschedule_league_card('d1c00000-0000-4000-8000-000000000004', now() + interval '2 days')$s$)
  ) x(name, q);
SELECT pg_temp.ig_as('a');
SELECT pg_temp.ig_refuses('R12 ' || x.name, x.q, 'month_closed')
  FROM (VALUES
    ('approve', $s$SELECT public.approve_league_card('d1c00000-0000-4000-8000-000000000003')$s$),
    ('void',    $s$SELECT public.void_league_card('d1c00000-0000-4000-8000-000000000003', 'late')$s$),
    ('reopen',  $s$SELECT public.reopen_league_card('d1c00000-0000-4000-8000-000000000003')$s$)
  ) x(name, q);
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT pg_temp.ig_refuses('R12 marker confirmation', $s$SELECT public.confirm_marker_card('ig-closed-token', 'Late', true, NULL)$s$,
  'month_closed');
SET LOCAL ROLE authenticated;

-- 8) R13: the timeline is for members, and only the server writes it ---------------------------
SELECT pg_temp.ig_as('q');
DO $$
DECLARE r jsonb := public.get_league_card_events(pg_temp.ig_v('cardP2')::uuid);
BEGIN
  PERFORM pg_temp.ig_ok('R13: any member reads a card''s timeline, oldest first',
    (SELECT array_agg(e->>'kind' ORDER BY ord) FROM jsonb_array_elements(r) WITH ORDINALITY t(e, ord))
      = ARRAY['announced','submitted']
    AND r->0->>'actor_name' = 'Pau Smoke' AND (r->1->'data'->>'points') IS NOT NULL,
    r::text);
  PERFORM pg_temp.ig_ok('R13: members SELECT league_card_events directly (RLS)',
    (SELECT count(*) FROM public.league_card_events WHERE card_id = pg_temp.ig_v('cardP')::uuid) = 3);
END $$;
SELECT pg_temp.ig_refuses('R13: nobody inserts a timeline entry directly',
  format($s$INSERT INTO public.league_card_events (card_id, league_id, kind) VALUES (%L, %L, 'confirmed')$s$,
         pg_temp.ig_v('cardP2'), pg_temp.ig_v('league')), NULL, '42501');
SELECT pg_temp.ig_as('o');
SELECT pg_temp.ig_ok('R13: an outsider sees no timeline rows',
  (SELECT count(*) FROM public.league_card_events WHERE league_id = pg_temp.ig_v('league')::uuid) = 0);
SELECT pg_temp.ig_refuses('R13: an outsider can''t read a timeline',
  format('SELECT public.get_league_card_events(%L)', pg_temp.ig_v('cardP2')), NULL, 'P0001');

-- 9) R15: membership ----------------------------------------------------------------------------
-- K claims the reserved spot; the admins hear about it; the claim is K's.
SELECT pg_temp.ig_as('a');
INSERT INTO ig_ctx SELECT 'spot', id::text FROM public.get_league_invitees(pg_temp.ig_v('league')::uuid)
  WHERE name = 'Kiko Spot';
SELECT pg_temp.ig_as('n');
SELECT pg_temp.ig_refuses('R15: an active member can''t claim a reserved spot',
  format($s$SELECT public.join_league(%L, NULL, NULL, %L)$s$, pg_temp.ig_v('code'), pg_temp.ig_v('spot')), 'already_member');
SELECT pg_temp.ig_as('k');
SELECT public.join_league(pg_temp.ig_v('code'), NULL, NULL, pg_temp.ig_v('spot')::uuid);
SELECT pg_temp.ig_ok('R15: a claim is logged as the claimer''s, and the admins are told',
  pg_temp.ig_n(format($s$SELECT count(*) FROM public.league_handicap_events WHERE league_id = %L AND user_id = %L
                          AND reason = 'set' AND new = 22 AND by_user = %L$s$,
                      pg_temp.ig_v('league'), pg_temp.ig_v('u:k'), pg_temp.ig_v('u:k'))) = 1
  AND pg_temp.ig_n(format($s$SELECT count(*) FROM public.notifications WHERE type = 'league_spot_claimed'
                             AND data->>'spot_name' = 'Kiko Spot' AND data->>'actor_name' = 'Kiko Smoke'
                             AND user_id IN (%L, %L)$s$, pg_temp.ig_v('u:a'), pg_temp.ig_v('u:g'))) = 2
  AND pg_temp.ig_n(format($s$SELECT count(*) FROM public.league_member_events WHERE league_id = %L
                             AND kind = 'spot_claimed' AND user_id = %L$s$, pg_temp.ig_v('league'), pg_temp.ig_v('u:k'))) = 1);
SELECT pg_temp.ig_refuses('R15: a member can''t release a spot',
  format('SELECT public.release_league_invitee(%L, %L)', pg_temp.ig_v('league'), pg_temp.ig_v('spot')), NULL, '42501');
SELECT pg_temp.ig_as('a');
SELECT public.release_league_invitee(pg_temp.ig_v('league')::uuid, pg_temp.ig_v('spot')::uuid);
SELECT pg_temp.ig_ok('R15: release: the claimer leaves, the spot is open again with its name and handicap, both told',
  pg_temp.ig_n(format($s$SELECT count(*) FROM public.league_members WHERE league_id = %L AND user_id = %L AND left_at = now()$s$,
                      pg_temp.ig_v('league'), pg_temp.ig_v('u:k'))) = 1
  AND (SELECT count(*) FROM public.get_league_invitees(pg_temp.ig_v('league')::uuid) WHERE name = 'Kiko Spot' AND handicap = 22) = 1
  AND pg_temp.ig_n(format($s$SELECT count(*) FROM public.notifications WHERE type = 'league_spot_released'
                             AND user_id = %L AND (data->>'you')::boolean$s$, pg_temp.ig_v('u:k'))) = 1
  AND pg_temp.ig_n($s$SELECT count(*) FROM public.notifications WHERE type = 'league_spot_released'
                      AND NOT COALESCE((data->>'you')::boolean, false)$s$) = 5);
SELECT pg_temp.ig_refuses('R15: releasing an open spot is refused',
  format('SELECT public.release_league_invitee(%L, %L)', pg_temp.ig_v('league'), pg_temp.ig_v('spot')), 'not_claimed');
-- A new invite code: the old one stops working.
DO $$
DECLARE r jsonb := public.rotate_league_invite_code(pg_temp.ig_v('league')::uuid);
BEGIN
  INSERT INTO ig_ctx VALUES ('code2', r->>'invite_code');
  PERFORM pg_temp.ig_ok('R15: rotate_league_invite_code returns a new code',
    r->>'invite_code' IS NOT NULL AND r->>'invite_code' <> pg_temp.ig_v('code'), r::text);
END $$;
SELECT pg_temp.ig_as('k');
SELECT pg_temp.ig_refuses('R15: the old invite code stops working',
  format($s$SELECT public.join_league(%L, NULL, NULL, %L)$s$, pg_temp.ig_v('code'), pg_temp.ig_v('spot')), NULL, 'P0001');
SELECT public.join_league(pg_temp.ig_v('code2'), NULL, NULL, pg_temp.ig_v('spot')::uuid);
SELECT pg_temp.ig_ok('R15: the new code works, and a released spot can be claimed again',
  pg_temp.ig_n(format($s$SELECT count(*) FROM public.league_members WHERE league_id = %L AND user_id = %L AND left_at IS NULL$s$,
                      pg_temp.ig_v('league'), pg_temp.ig_v('u:k'))) = 1);
-- Remove a member.
SELECT pg_temp.ig_refuses('R15: a member can''t remove anyone',
  format('SELECT public.remove_league_member(%L, %L)', pg_temp.ig_v('league'), pg_temp.ig_v('u:n')), NULL, '42501');
SELECT pg_temp.ig_as('a');
SELECT pg_temp.ig_refuses('R15: an admin can''t remove themselves',
  format('SELECT public.remove_league_member(%L, %L)', pg_temp.ig_v('league'), pg_temp.ig_v('u:a')), 'use_leave');
SELECT pg_temp.ig_refuses('R15: nor the only other admin',
  format('SELECT public.remove_league_member(%L, %L)', pg_temp.ig_v('league'), pg_temp.ig_v('u:g')), 'last_admin');
SELECT public.remove_league_member(pg_temp.ig_v('league')::uuid, pg_temp.ig_v('u:n')::uuid);
SELECT pg_temp.ig_ok('R15: a removed member leaves (cards stay), is told, the members are told, it is logged',
  pg_temp.ig_n(format($s$SELECT count(*) FROM public.league_members WHERE league_id = %L AND user_id = %L
                          AND left_at = now() AND role = 'member'$s$, pg_temp.ig_v('league'), pg_temp.ig_v('u:n'))) = 1
  AND pg_temp.ig_n(format($s$SELECT count(*) FROM public.league_cards WHERE league_id = %L AND user_id = %L$s$,
                          pg_temp.ig_v('league'), pg_temp.ig_v('u:n'))) = 3
  AND pg_temp.ig_n(format($s$SELECT count(*) FROM public.notifications WHERE type = 'league_member_removed'
                             AND user_id = %L AND (data->>'you')::boolean$s$, pg_temp.ig_v('u:n'))) = 1
  AND pg_temp.ig_n(format($s$SELECT count(*) FROM public.notifications WHERE type = 'league_member_removed'
                             AND data->>'subject_name' = 'Nico Smoke' AND user_id <> %L$s$, pg_temp.ig_v('u:n'))) = 5
  AND pg_temp.ig_n(format($s$SELECT count(*) FROM public.league_member_events WHERE league_id = %L
                             AND kind = 'removed' AND user_id = %L AND actor_user_id = %L$s$,
                          pg_temp.ig_v('league'), pg_temp.ig_v('u:n'), pg_temp.ig_v('u:a'))) = 1);
SELECT pg_temp.ig_refuses('R15: removing someone not in the league',
  format('SELECT public.remove_league_member(%L, %L)', pg_temp.ig_v('league'), pg_temp.ig_v('u:o')), 'not_member');
SELECT pg_temp.ig_ok('R15: members read the membership log; an outsider doesn''t',
  (SELECT count(*) FROM public.league_member_events WHERE league_id = pg_temp.ig_v('league')::uuid) = 5
  AND (SELECT count(*) FROM (SELECT pg_temp.ig_as('o')) x, public.league_member_events
        WHERE league_id = pg_temp.ig_v('league')::uuid) = 0);

-- 10) Timeline kinds the run produced, and the sweep's 'missed' --------------------------------
SELECT pg_temp.ig_sql(format($q$UPDATE public.league_cards SET status = 'announced', post_by = now() - interval '1 minute'
                                 WHERE id = 'd1c00000-0000-4000-8000-000000000001'$q$));
SELECT pg_temp.ig_sql('SELECT public.league_sweep_cards()');
SELECT pg_temp.ig_ok('R13: the sweep logs a missed card',
  pg_temp.ig_n($s$SELECT count(*) FROM public.league_card_events WHERE card_id = 'd1c00000-0000-4000-8000-000000000001'
                   AND kind = 'missed'$s$) = 1);
SELECT pg_temp.ig_ok('R13: every kind this run went through is on some timeline',
  pg_temp.ig_n(format($s$SELECT count(DISTINCT kind) FROM public.league_card_events WHERE league_id = %L
                          AND kind IN ('announced','rescheduled','first_shot','submitted','returned','confirmed',
                                       'approved','reopened','missed','withdrawn','auto_withdrawn','voided')$s$,
                      pg_temp.ig_v('league'))) = 12);

-- 11) Grants -------------------------------------------------------------------------------------
RESET ROLE;
INSERT INTO ig_smoke (name, ok, detail)
SELECT 'new RPCs: authenticated only (not anon)',
       count(*) = 6 AND bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE')
                                 AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')),
       string_agg(p.proname, ',')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('withdraw_league_card','get_league_card_events','get_league_game_status',
                     'remove_league_member','rotate_league_invite_code','release_league_invitee');
INSERT INTO ig_smoke (name, ok, detail)
SELECT 'internal helpers: nobody executes them',
       count(*) = 8 AND bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                                 AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')),
       string_agg(p.proname, ',')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('league_takes_month','league_month_closes_at','league_assert_month_open','league_other_admin',
                     'league_card_log','league_card_notice','league_cards_first_shot_from_scorer','league_sweep_cards');
INSERT INTO ig_smoke (name, ok, detail)
SELECT 'every SECURITY DEFINER league function pins search_path',
       count(*) FILTER (WHERE NOT COALESCE(p.proconfig @> ARRAY['search_path=public'], false)) = 0,
       string_agg(p.proname, ',') FILTER (WHERE NOT COALESCE(p.proconfig @> ARRAY['search_path=public'], false))
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prosecdef AND (p.proname LIKE '%league%' OR p.proname LIKE '%marker%');
INSERT INTO ig_smoke (name, ok, detail)
SELECT 'timeline and membership log: authenticated reads, nobody writes, anon nothing',
       has_table_privilege('authenticated', 'public.league_card_events', 'SELECT')
       AND NOT has_table_privilege('authenticated', 'public.league_card_events', 'INSERT')
       AND NOT has_table_privilege('authenticated', 'public.league_member_events', 'INSERT')
       AND NOT has_table_privilege('anon', 'public.league_card_events', 'SELECT')
       AND NOT has_table_privilege('anon', 'public.league_member_events', 'SELECT'),
       NULL;

-- Verdict ------------------------------------------------------------------------------------------
DO $$
DECLARE v_failed text;
BEGIN
  SELECT string_agg(name || ' [' || COALESCE(detail, '') || ']', E'\n' ORDER BY seq) INTO v_failed
    FROM ig_smoke WHERE ok IS NOT TRUE;
  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION E'league integrity smoke failed:\n%', v_failed;
  END IF;
END $$;

SELECT seq, name, ok FROM ig_smoke ORDER BY seq;

ROLLBACK;
