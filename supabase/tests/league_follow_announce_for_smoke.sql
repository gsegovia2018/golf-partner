-- ============================================================================
-- Smoke test for 20261026000000_league_follow_and_announce_for.sql —
-- league members read each other's league-card games, and a game's creator
-- announces another member's card.
--
-- Same conventions as league_integrity_smoke.sql: one row per check in
-- `lf_smoke`, a final DO block RAISEs listing every failure, and the whole
-- run is one transaction ending in ROLLBACK. Run it after the migration (or
-- with the migration's body pasted after BEGIN, to try it before applying).
--
-- Cast: A Ana (creates the league and the games; friends with N and M, as
-- create_league needs), N Nico and M Mar (members), O Olga (not in the league).
-- ============================================================================

BEGIN;

CREATE TEMP TABLE lf_smoke (seq serial, name text, ok boolean, detail text) ON COMMIT DROP;
CREATE TEMP TABLE lf_ctx (k text PRIMARY KEY, v text) ON COMMIT DROP;
GRANT ALL ON lf_smoke, lf_ctx TO authenticated, anon;
GRANT USAGE ON SEQUENCE lf_smoke_seq_seq TO authenticated, anon;

CREATE FUNCTION pg_temp.lf_v(p_k text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT v FROM lf_ctx WHERE k = p_k $$;
CREATE FUNCTION pg_temp.lf_as(p_k text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    jsonb_build_object('sub', (SELECT v FROM lf_ctx WHERE k = 'u:' || p_k), 'role', 'authenticated')::text, true) $$;
CREATE FUNCTION pg_temp.lf_ok(p_name text, p_ok boolean, p_detail text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $$ INSERT INTO lf_smoke (name, ok, detail) VALUES (p_name, COALESCE(p_ok, false), p_detail) $$;
CREATE FUNCTION pg_temp.lf_refuses(p_name text, p_sql text, p_hint text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_hint text; v_state text; v_msg text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT, v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO lf_smoke (name, ok, detail) VALUES (p_name,
      p_hint IS NULL OR v_hint IS NOT DISTINCT FROM p_hint,
      v_state || ' ' || COALESCE(NULLIF(v_hint, ''), '-') || ' ' || v_msg);
    RETURN;
  END;
  INSERT INTO lf_smoke (name, ok, detail) VALUES (p_name, false, 'no error');
END $$;
CREATE FUNCTION pg_temp.lf_sql(p_sql text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN EXECUTE p_sql; END $$;
CREATE FUNCTION pg_temp.lf_n(p_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint; BEGIN EXECUTE p_sql INTO n; RETURN n; END $$;
CREATE FUNCTION pg_temp.lf_su(p_sql text) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE n bigint; BEGIN EXECUTE p_sql INTO n; RETURN n; END $$;

INSERT INTO lf_ctx (k, v) VALUES
  ('u:a', 'd2000000-0000-4000-8000-00000000000a'), ('u:n', 'd2000000-0000-4000-8000-00000000000b'),
  ('u:m', 'd2000000-0000-4000-8000-00000000000c'), ('u:o', 'd2000000-0000-4000-8000-00000000000d'),
  ('course', '{"name":"Follow Muni","tee":"Blancas","slope":125,"rating":71.0}');

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT v::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'league-follow-' || substr(k, 3) || '@example.invalid', now(), now()
  FROM lf_ctx WHERE k LIKE 'u:%';
INSERT INTO public.profiles (user_id, display_name)
SELECT v::uuid, 'Follow ' || substr(k, 3) FROM lf_ctx WHERE k LIKE 'u:%'
ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name;
-- create_league takes the creator's friends. The games below have no
-- tournament_participants rows, so friendship alone never opens them.
INSERT INTO public.friendships (requester_id, addressee_id, status)
SELECT pg_temp.lf_v('u:a')::uuid, v::uuid, 'accepted' FROM lf_ctx WHERE k IN ('u:n','u:m');

SET LOCAL ROLE authenticated;

SELECT pg_temp.lf_as('a');
DO $$
DECLARE r jsonb;
BEGIN
  r := public.create_league('Follow Smoke', '2020-01-01', '2030-12-31', NULL, 30, 0,
         jsonb_build_array(
           jsonb_build_object('user_id', pg_temp.lf_v('u:a'), 'handicap', 18),
           jsonb_build_object('user_id', pg_temp.lf_v('u:n'), 'handicap', 12.4),
           jsonb_build_object('user_id', pg_temp.lf_v('u:m'), 'handicap', 18)));
  INSERT INTO lf_ctx VALUES ('league', r->>'id'), ('code', r->>'invite_code');
END $$;
SELECT pg_temp.lf_as(u), public.join_league(pg_temp.lf_v('code'), 18) FROM unnest(ARRAY['n','m']) u;

-- Games by A: t_lf_g (A, N, M), t_lf_h (A, N) and t_lf_c (A alone, no card).
SELECT pg_temp.lf_sql($q$
  INSERT INTO public.tournaments (id, name, props, created_by) VALUES
    ('t_lf_g', 'Follow game', '{"kind":"game"}', 'd2000000-0000-4000-8000-00000000000a'),
    ('t_lf_h', 'Follow game 2', '{"kind":"game"}', 'd2000000-0000-4000-8000-00000000000a'),
    ('t_lf_c', 'Casual only', '{"kind":"game"}', 'd2000000-0000-4000-8000-00000000000a');
  INSERT INTO public.game_rounds (id, tournament_id, round_index, body) VALUES
    ('r0', 't_lf_g', 0, '{}'), ('r0', 't_lf_h', 0, '{}'), ('r0', 't_lf_c', 0, '{}');
  INSERT INTO public.game_players (tournament_id, player_id, user_id, pos, body) VALUES
    ('t_lf_g', 'pA', 'd2000000-0000-4000-8000-00000000000a', 0, '{}'),
    ('t_lf_g', 'pN', 'd2000000-0000-4000-8000-00000000000b', 1, '{}'),
    ('t_lf_g', 'pM', 'd2000000-0000-4000-8000-00000000000c', 2, '{}'),
    ('t_lf_h', 'pA', 'd2000000-0000-4000-8000-00000000000a', 0, '{}'),
    ('t_lf_h', 'pN', 'd2000000-0000-4000-8000-00000000000b', 1, '{}'),
    ('t_lf_c', 'pA', 'd2000000-0000-4000-8000-00000000000a', 0, '{}');
$q$);

-- 1) Before any card, M can't read A's game (no friendship) ------------------------
SELECT pg_temp.lf_as('m');
SELECT pg_temp.lf_ok('no card, no friendship: the game is hidden',
  pg_temp.lf_n($q$SELECT count(*) FROM public.tournaments WHERE id = 't_lf_g'$q$) = 0);

-- 2) A announces N's card in t_lf_g -------------------------------------------------
SELECT pg_temp.lf_as('a');
DO $$
DECLARE r jsonb; r2 jsonb;
BEGIN
  r := public.announce_league_card_for(pg_temp.lf_v('league')::uuid, pg_temp.lf_v('u:n')::uuid,
         pg_temp.lf_v('course')::jsonb, 't_lf_g', 'r0', 'pN', 'stableford');
  INSERT INTO lf_ctx VALUES ('cardN', r->>'id');
  PERFORM pg_temp.lf_ok('the creator announces a member''s card: playing, no deadline yet',
    r->>'status' = 'playing' AND (r->>'existing')::boolean = false AND r->'post_by' = 'null'::jsonb, r::text);
  PERFORM pg_temp.lf_ok('the card is the member''s, with the member''s league handicap',
    pg_temp.lf_su(format($s$SELECT count(*) FROM public.league_cards WHERE id = %L AND user_id = %L
                             AND player_id = 'pN' AND league_handicap = 12.4$s$,
                         r->>'id', pg_temp.lf_v('u:n'))) = 1);
  r2 := public.announce_league_card_for(pg_temp.lf_v('league')::uuid, pg_temp.lf_v('u:n')::uuid,
          pg_temp.lf_v('course')::jsonb, 't_lf_g', 'r0', 'pN', 'stableford');
  PERFORM pg_temp.lf_ok('announcing it again gives back the same card',
    r2->>'id' = r->>'id' AND (r2->>'existing')::boolean);
END $$;
SELECT pg_temp.lf_ok('the timeline says who announced it',
  pg_temp.lf_su(format($s$SELECT count(*) FROM public.league_card_events WHERE card_id = %L AND kind = 'announced'
                          AND actor_user_id = %L$s$, pg_temp.lf_v('cardN'), pg_temp.lf_v('u:a'))) = 1);
SELECT pg_temp.lf_ok('the card''s owner is told',
  pg_temp.lf_su(format($s$SELECT count(*) FROM public.notifications WHERE user_id = %L
                          AND type = 'league_card_announced' AND entity_id = %L$s$,
                       pg_temp.lf_v('u:n'), pg_temp.lf_v('cardN'))) = 1);

-- 3) Refusals -----------------------------------------------------------------------
SELECT pg_temp.lf_as('n');
SELECT pg_temp.lf_refuses('a member who is not the creator can''t count someone else''s card',
  format($s$SELECT public.announce_league_card_for(%L, %L, %L::jsonb, 't_lf_g', 'r0', 'pM')$s$,
         pg_temp.lf_v('league'), pg_temp.lf_v('u:m'), pg_temp.lf_v('course')), 'not_creator');
SELECT pg_temp.lf_as('a');
SELECT pg_temp.lf_refuses('the player in the game must be that member',
  format($s$SELECT public.announce_league_card_for(%L, %L, %L::jsonb, 't_lf_g', 'r0', 'pM')$s$,
         pg_temp.lf_v('league'), pg_temp.lf_v('u:n'), pg_temp.lf_v('course')), 'not_your_player');
SELECT pg_temp.lf_refuses('someone outside the league can''t get a card',
  format($s$SELECT public.announce_league_card_for(%L, %L, %L::jsonb, 't_lf_g', 'r0', 'pM')$s$,
         pg_temp.lf_v('league'), pg_temp.lf_v('u:o'), pg_temp.lf_v('course')), 'not_member');
SELECT pg_temp.lf_refuses('one card a month: N''s month is taken',
  format($s$SELECT public.announce_league_card_for(%L, %L, %L::jsonb, 't_lf_h', 'r0', 'pN')$s$,
         pg_temp.lf_v('league'), pg_temp.lf_v('u:n'), pg_temp.lf_v('course')), 'card_exists');

-- 4) Following ------------------------------------------------------------------------
SELECT pg_temp.lf_as('m');
SELECT pg_temp.lf_ok('a league member reads a league-card game without being a friend',
  pg_temp.lf_n($q$SELECT count(*) FROM public.tournaments WHERE id = 't_lf_g'$q$) = 1);
SELECT pg_temp.lf_ok('…and its round and players',
  pg_temp.lf_n($q$SELECT count(*) FROM public.game_rounds WHERE tournament_id = 't_lf_g'$q$) = 1
  AND pg_temp.lf_n($q$SELECT count(*) FROM public.game_players WHERE tournament_id = 't_lf_g'$q$) = 3);
SELECT pg_temp.lf_ok('a game with no league card stays hidden',
  pg_temp.lf_n($q$SELECT count(*) FROM public.tournaments WHERE id = 't_lf_c'$q$) = 0);
SELECT pg_temp.lf_ok('get_game_tournament returns the followed game',
  public.get_game_tournament('t_lf_g') IS NOT NULL);
SELECT pg_temp.lf_as('o');
SELECT pg_temp.lf_ok('someone outside the league still can''t read it',
  pg_temp.lf_n($q$SELECT count(*) FROM public.tournaments WHERE id = 't_lf_g'$q$) = 0);
SELECT pg_temp.lf_sql(format($s$UPDATE public.league_cards SET status = 'void', void_kind = 'admin' WHERE id = %L$s$,
                             pg_temp.lf_v('cardN')));
SELECT pg_temp.lf_as('m');
SELECT pg_temp.lf_ok('a void card no longer opens the game',
  pg_temp.lf_n($q$SELECT count(*) FROM public.tournaments WHERE id = 't_lf_g'$q$) = 0);

RESET ROLE;
DO $$
DECLARE v_fail text;
BEGIN
  SELECT string_agg(format('#%s %s (%s)', seq, name, COALESCE(detail, '')), E'\n' ORDER BY seq)
    INTO v_fail FROM lf_smoke WHERE NOT ok;
  IF v_fail IS NOT NULL THEN
    RAISE EXCEPTION E'league_follow_announce_for smoke FAILED:\n%', v_fail;
  END IF;
  RAISE NOTICE 'league_follow_announce_for smoke: % checks passed', (SELECT count(*) FROM lf_smoke);
END $$;

ROLLBACK;
