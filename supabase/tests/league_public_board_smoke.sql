-- ============================================================================
-- Smoke test for 20261017000000_league_public_board.sql: the public board
-- link (D4 B). Anon reads a league only through its token; the returned JSON
-- carries exactly the whitelisted keys and no ids, emails, handicaps or
-- holes; switched-off and replaced tokens stop working; members get the
-- link, only admins switch it or make a new one.
--
-- Same shape as league_integrity_smoke.sql: each check is one row in the
-- temp table `pb_smoke`, a final DO block RAISEs listing every failed check,
-- and the whole run is one transaction ending in ROLLBACK.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/league_public_board_smoke.sql
--
-- Cast: A Ana (admin), B Bea (member), C (member with a username but no
-- display name), O Olga (not in the league).
-- ============================================================================

BEGIN;

CREATE TEMP TABLE pb_smoke (seq serial, name text, ok boolean, detail text) ON COMMIT DROP;
CREATE TEMP TABLE pb_ctx (k text PRIMARY KEY, v text) ON COMMIT DROP;
GRANT ALL ON pb_smoke, pb_ctx TO authenticated, anon;
GRANT USAGE ON SEQUENCE pb_smoke_seq_seq TO authenticated, anon;

-- Helpers ------------------------------------------------------------------------------
-- pb_v(k): a context value. pb_as(user key): sign in as that user ('anon' = signed out).
-- pb_ok(name, ok, detail): record a check. pb_refuses(name, sql, state): pass
-- when sql raises with that SQLSTATE. pb_sql(sql): superuser, for fixtures.
CREATE FUNCTION pg_temp.pb_v(p_k text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT v FROM pb_ctx WHERE k = p_k $$;
CREATE FUNCTION pg_temp.pb_as(p_k text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    CASE WHEN p_k = 'anon' THEN '{"role":"anon"}'
         ELSE jsonb_build_object('sub', (SELECT v FROM pb_ctx WHERE k = 'u:' || p_k), 'role', 'authenticated')::text END,
    true) $$;
CREATE FUNCTION pg_temp.pb_ok(p_name text, p_ok boolean, p_detail text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $$ INSERT INTO pb_smoke (name, ok, detail) VALUES (p_name, COALESCE(p_ok, false), p_detail) $$;
CREATE FUNCTION pg_temp.pb_refuses(p_name text, p_sql text, p_state text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_state text; v_msg text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    INSERT INTO pb_smoke (name, ok, detail) VALUES (p_name, v_state = p_state, v_state || ' ' || v_msg);
    RETURN;
  END;
  INSERT INTO pb_smoke (name, ok, detail) VALUES (p_name, false, 'no error');
END $$;
CREATE FUNCTION pg_temp.pb_sql(p_sql text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN EXECUTE p_sql; END $$;
-- Every key at any depth of a jsonb value.
CREATE FUNCTION pg_temp.pb_keys(j jsonb) RETURNS SETOF text LANGUAGE sql IMMUTABLE AS $$
  WITH RECURSIVE walk(v) AS (
    SELECT j
    UNION ALL
    SELECT x.value FROM walk, LATERAL (
      SELECT e.value FROM jsonb_each(CASE WHEN jsonb_typeof(walk.v) = 'object' THEN walk.v ELSE '{}'::jsonb END) e
      UNION ALL
      SELECT a.value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(walk.v) = 'array' THEN walk.v ELSE '[]'::jsonb END) a
    ) x
  )
  SELECT DISTINCT k FROM walk, jsonb_object_keys(CASE WHEN jsonb_typeof(walk.v) = 'object' THEN walk.v ELSE '{}'::jsonb END) k $$;
-- The sorted key set of one object.
CREATE FUNCTION pg_temp.pb_keyset(j jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(j) k $$;

-- Fixture --------------------------------------------------------------------------------
INSERT INTO pb_ctx (k, v) VALUES
  ('u:a', 'e2000000-0000-4000-8000-00000000000a'),
  ('u:b', 'e2000000-0000-4000-8000-00000000000b'),
  ('u:o', 'e2000000-0000-4000-8000-00000000000c'),
  ('u:c', 'e2000000-0000-4000-8000-00000000000d'),
  ('this', (date_trunc('month', now() AT TIME ZONE 'Europe/Madrid'))::date::text),
  ('prev', (date_trunc('month', now() AT TIME ZONE 'Europe/Madrid') - interval '1 month')::date::text);

INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT v::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'league-board-' || substr(k, 3) || '@example.invalid', now(), now()
  FROM pb_ctx WHERE k LIKE 'u:%';
INSERT INTO public.profiles (user_id, display_name)
SELECT v::uuid, CASE substr(k, 3) WHEN 'a' THEN 'Ana Smoke Board' WHEN 'b' THEN 'Bea' ELSE 'Olga Smoke' END
  FROM pb_ctx WHERE k LIKE 'u:%'
ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name;
-- C's username is their email's local part; they never set a display name.
UPDATE public.profiles SET display_name = NULL, username = 'leaky.localpart' WHERE user_id = pg_temp.pb_v('u:c')::uuid;
INSERT INTO public.friendships (requester_id, addressee_id, status)
VALUES (pg_temp.pb_v('u:a')::uuid, pg_temp.pb_v('u:b')::uuid, 'accepted'),
       (pg_temp.pb_v('u:a')::uuid, pg_temp.pb_v('u:c')::uuid, 'accepted');

SET LOCAL ROLE authenticated;

SELECT pg_temp.pb_as('a');
DO $$
DECLARE r jsonb;
BEGIN
  r := public.create_league('Board Smoke', '2020-01-01', '2030-12-31', NULL, 30, 0,
         jsonb_build_array(
           jsonb_build_object('user_id', pg_temp.pb_v('u:a'), 'handicap', 18),
           jsonb_build_object('user_id', pg_temp.pb_v('u:b'), 'handicap', 22.4),
           jsonb_build_object('user_id', pg_temp.pb_v('u:c'), 'handicap', 15)));
  INSERT INTO pb_ctx VALUES ('league', r->>'id'), ('code', r->>'invite_code');
END $$;
SELECT pg_temp.pb_as('b');
SELECT public.join_league(pg_temp.pb_v('code'), 22.4);
SELECT pg_temp.pb_as('c');
SELECT public.join_league(pg_temp.pb_v('code'), 15);

-- Cards, written as the server would have left them (superuser):
--   A this month: confirmed 36 pts      -> counts
--   B this month: confirmed, tee by hand, not approved -> waits, hidden
--   B last month: confirmed 31 pts      -> counts
--   A last month: void                  -> hidden
--   C this month: confirmed 30 pts      -> counts (C has no display name)
SELECT pg_temp.pb_sql(format($q$
  INSERT INTO public.league_cards (league_id, user_id, month, source, status, course, league_handicap,
                                   playing_handicap, holes, gross, points, tee_verified, confirmation,
                                   confirmed_by_name, proof_path, marker_note)
  VALUES
    (%1$L, %2$L, %4$L, 'offapp', 'confirmed', '{"name":"Golf Santander","tee":"Amarillas","slope":131,"rating":71.2,"holes":[]}',
     18, 20, '{"1":5}', 90, 36, true, 'photo', 'Bea Marker', 'x/secret-proof.jpg', 'a private note'),
    (%1$L, %3$L, %4$L, 'offapp', 'confirmed', '{"name":"Muni Hand"}', 22.4, 25, '{"1":5}', 95, 33, false, 'photo', NULL, NULL, NULL),
    (%1$L, %3$L, %5$L, 'offapp', 'confirmed', '{"name":"RCG Sotogrande"}', 22.4, 25, '{"1":5}', 99, 31, true, 'photo', NULL, NULL, NULL),
    (%1$L, %2$L, %5$L, 'offapp', 'void', '{"name":"Void Course"}', 18, 20, '{"1":5}', 99, 40, true, NULL, NULL, NULL, NULL),
    (%1$L, %6$L, %4$L, 'offapp', 'confirmed', '{"name":"Club C"}', 15, 16, '{"1":5}', 92, 30, true, 'photo', NULL, NULL, NULL)
$q$, pg_temp.pb_v('league'), pg_temp.pb_v('u:a'), pg_temp.pb_v('u:b'), pg_temp.pb_v('this'), pg_temp.pb_v('prev'),
     pg_temp.pb_v('u:c')));

-- 1) Members get the link; outsiders and anon don't --------------------------------------
SELECT pg_temp.pb_as('o');
SELECT pg_temp.pb_refuses('a non-member can''t get the board link',
  format('SELECT public.get_league_share_link(%L)', pg_temp.pb_v('league')), '42501');
SELECT pg_temp.pb_as('b');
DO $$
DECLARE t1 text := public.get_league_share_link(pg_temp.pb_v('league')::uuid);
        t2 text := public.get_league_share_link(pg_temp.pb_v('league')::uuid);
BEGIN
  INSERT INTO pb_ctx VALUES ('token', t1);
  PERFORM pg_temp.pb_ok('a member gets a url-safe token of 20+ chars, created once',
    t1 IS NOT NULL AND length(t1) >= 20 AND t1 ~ '^[A-Za-z0-9_-]+$' AND t1 = t2, t1);
  PERFORM pg_temp.pb_ok('the token is not the invite code',
    t1 <> pg_temp.pb_v('code') AND position(pg_temp.pb_v('code') IN t1) = 0, NULL);
END $$;

RESET ROLE;
SELECT pg_temp.pb_as('anon');
SET LOCAL ROLE anon;
SELECT pg_temp.pb_refuses('anon can''t call get_league_share_link',
  format('SELECT public.get_league_share_link(%L)', pg_temp.pb_v('league')), '42501');
SELECT pg_temp.pb_refuses('anon can''t call set_league_public_board',
  format('SELECT public.set_league_public_board(%L, false)', pg_temp.pb_v('league')), '42501');
SELECT pg_temp.pb_refuses('anon can''t call rotate_league_public_board',
  format('SELECT public.rotate_league_public_board(%L)', pg_temp.pb_v('league')), '42501');
SELECT pg_temp.pb_refuses('anon can''t read the leagues table (nor the token column)',
  'SELECT public_board_token FROM public.leagues', '42501');
SELECT pg_temp.pb_refuses('anon can''t read league_cards',
  'SELECT points FROM public.league_cards', '42501');

-- 2) Anon reads through the token: exactly the whitelist ---------------------------------
DO $$
DECLARE
  r   jsonb := public.get_public_league_board(pg_temp.pb_v('token'));
  txt text;
  ana jsonb;
BEGIN
  INSERT INTO pb_ctx VALUES ('board1', r::text);
  txt := r::text;
  PERFORM pg_temp.pb_ok('anon reads the board with the token',
    r IS NOT NULL AND r #>> '{league,name}' = 'Board Smoke', left(txt, 300));
  PERFORM pg_temp.pb_ok('top-level keys are exactly cards, league, members',
    pg_temp.pb_keyset(r) = 'cards,league,members', pg_temp.pb_keyset(r));
  PERFORM pg_temp.pb_ok('league keys are exactly name, participation_points, points_table, season_end, season_start',
    pg_temp.pb_keyset(r -> 'league') = 'name,participation_points,points_table,season_end,season_start',
    pg_temp.pb_keyset(r -> 'league'));
  PERFORM pg_temp.pb_ok('every member has exactly active, key, name',
    (SELECT bool_and(pg_temp.pb_keyset(m) = 'active,key,name') FROM jsonb_array_elements(r -> 'members') m), NULL);
  PERFORM pg_temp.pb_ok('every card has exactly course, member, month, points, status',
    (SELECT bool_and(pg_temp.pb_keyset(c) = 'course,member,month,points,status') FROM jsonb_array_elements(r -> 'cards') c), NULL);
  PERFORM pg_temp.pb_ok('no forbidden key anywhere in the JSON',
    NOT EXISTS (SELECT 1 FROM pg_temp.pb_keys(r) k
                 WHERE k ~* '(user|email|handicap|hcp|photo|avatar|proof|hole|gross|differential|slope|rating|tee|marker|confirm|invite|token|id$)'),
    (SELECT string_agg(k, ',') FROM pg_temp.pb_keys(r) k));
  PERFORM pg_temp.pb_ok('no user id, email, invite code, token, handicap or private text in the values',
    position(pg_temp.pb_v('u:a') IN txt) = 0 AND position(pg_temp.pb_v('u:b') IN txt) = 0
    AND position('@example.invalid' IN txt) = 0 AND position(pg_temp.pb_v('code') IN txt) = 0
    AND position(pg_temp.pb_v('token') IN txt) = 0 AND position('22.4' IN txt) = 0
    AND position('secret-proof' IN txt) = 0 AND position('private note' IN txt) = 0
    AND position('Bea Marker' IN txt) = 0 AND position('Amarillas' IN txt) = 0, NULL);
  PERFORM pg_temp.pb_ok('only counting cards: confirmed, scored, not waiting for approval, never void',
    jsonb_array_length(r -> 'cards') = 3
    AND (SELECT bool_and(c ->> 'status' = 'confirmed') FROM jsonb_array_elements(r -> 'cards') c)
    AND NOT txt LIKE '%Muni Hand%' AND NOT txt LIKE '%Void Course%'
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(r -> 'cards') c
                 WHERE c ->> 'course' = 'Golf Santander' AND (c ->> 'points')::int = 36
                   AND c ->> 'month' = pg_temp.pb_v('this'))
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(r -> 'cards') c
                 WHERE c ->> 'course' = 'RCG Sotogrande' AND (c ->> 'points')::int = 31
                   AND c ->> 'month' = pg_temp.pb_v('prev')),
    r ->> 'cards');
  SELECT m INTO ana FROM jsonb_array_elements(r -> 'members') m WHERE m ->> 'name' = 'Ana S.';
  PERFORM pg_temp.pb_ok('names are first name + initial of the first surname ("Ana Smoke Board" -> "Ana S.", "Bea" stays)',
    ana IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements(r -> 'members') m WHERE m ->> 'name' = 'Bea')
    AND jsonb_array_length(r -> 'members') = 3, r ->> 'members');
  PERFORM pg_temp.pb_ok('no display name: name is NULL and the username appears nowhere',
    position('leaky' IN txt) = 0 AND position('localpart' IN txt) = 0
    AND (SELECT count(*) FROM jsonb_array_elements(r -> 'members') m
          WHERE m -> 'name' = 'null'::jsonb AND m ? 'name') = 1
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(r -> 'cards') c WHERE c ->> 'course' = 'Club C'), r ->> 'members');
  PERFORM pg_temp.pb_ok('a card points at its member by an opaque key, not the user id',
    length(ana ->> 'key') = 16 AND ana ->> 'key' !~ '-'
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(r -> 'cards') c
                 WHERE c ->> 'member' = ana ->> 'key' AND c ->> 'course' = 'Golf Santander'), ana::text);
  PERFORM pg_temp.pb_ok('the same token gives the same keys',
    public.get_public_league_board(pg_temp.pb_v('token')) = r, NULL);
  PERFORM pg_temp.pb_ok('an unknown, short or empty token gives NULL',
    public.get_public_league_board('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA') IS NULL
    AND public.get_public_league_board('short') IS NULL
    AND public.get_public_league_board('') IS NULL
    AND public.get_public_league_board(NULL) IS NULL
    AND public.get_public_league_board(pg_temp.pb_v('code')) IS NULL, NULL);
END $$;

-- 3) Switch off / on, new link: admin only -----------------------------------------------
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.pb_as('b');
SELECT pg_temp.pb_refuses('a member can''t switch the public board off',
  format('SELECT public.set_league_public_board(%L, false)', pg_temp.pb_v('league')), '42501');
SELECT pg_temp.pb_refuses('a member can''t make a new board link',
  format('SELECT public.rotate_league_public_board(%L)', pg_temp.pb_v('league')), '42501');
SELECT pg_temp.pb_as('o');
SELECT pg_temp.pb_refuses('an outsider can''t switch the public board',
  format('SELECT public.set_league_public_board(%L, false)', pg_temp.pb_v('league')), '42501');

SELECT pg_temp.pb_as('a');
DO $$
DECLARE r jsonb := public.set_league_public_board(pg_temp.pb_v('league')::uuid, false);
BEGIN
  PERFORM pg_temp.pb_ok('the admin switches the public board off', r = '{"enabled": false, "token": null}'::jsonb, r::text);
END $$;
SELECT pg_temp.pb_as('b');
SELECT pg_temp.pb_ok('switched off: members get no link',
  public.get_league_share_link(pg_temp.pb_v('league')::uuid) IS NULL, NULL);
RESET ROLE;
SELECT pg_temp.pb_as('anon');
SET LOCAL ROLE anon;
SELECT pg_temp.pb_ok('switched off: the link gives NULL',
  public.get_public_league_board(pg_temp.pb_v('token')) IS NULL, NULL);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.pb_as('a');
DO $$
DECLARE r jsonb := public.set_league_public_board(pg_temp.pb_v('league')::uuid, true);
BEGIN
  PERFORM pg_temp.pb_ok('switched back on: the same link works again',
    r ->> 'token' = pg_temp.pb_v('token') AND (r ->> 'enabled')::boolean
    AND public.get_public_league_board(pg_temp.pb_v('token')) IS NOT NULL, r::text);
END $$;
DO $$
DECLARE r jsonb := public.rotate_league_public_board(pg_temp.pb_v('league')::uuid);
BEGIN
  INSERT INTO pb_ctx VALUES ('token2', r ->> 'token');
  PERFORM pg_temp.pb_ok('a new link replaces the old one',
    r ->> 'token' IS NOT NULL AND r ->> 'token' <> pg_temp.pb_v('token') AND length(r ->> 'token') >= 20
    AND (r ->> 'enabled')::boolean, r::text);
END $$;
SELECT pg_temp.pb_as('b');
SELECT pg_temp.pb_ok('members now get the new link',
  public.get_league_share_link(pg_temp.pb_v('league')::uuid) = pg_temp.pb_v('token2'), NULL);
RESET ROLE;
SELECT pg_temp.pb_as('anon');
SET LOCAL ROLE anon;
SELECT pg_temp.pb_ok('the replaced link gives NULL, the new one reads',
  public.get_public_league_board(pg_temp.pb_v('token')) IS NULL
  AND public.get_public_league_board(pg_temp.pb_v('token2')) #>> '{league,name}' = 'Board Smoke', NULL);
SELECT pg_temp.pb_ok('a new link gives new member keys',
  (public.get_public_league_board(pg_temp.pb_v('token2')) -> 'members' -> 0 ->> 'key')
    <> (pg_temp.pb_v('board1')::jsonb -> 'members' -> 0 ->> 'key'), NULL);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.pb_as('a');
DO $$
DECLARE r jsonb;
BEGIN
  PERFORM public.set_league_public_board(pg_temp.pb_v('league')::uuid, false);
  r := public.rotate_league_public_board(pg_temp.pb_v('league')::uuid);
  PERFORM pg_temp.pb_ok('a new link while switched off stays off and shows no token',
    r = '{"enabled": false, "token": null}'::jsonb
    AND public.get_public_league_board(pg_temp.pb_v('token2')) IS NULL, r::text);
END $$;

-- 4) The name rule, case by case (the same cases as leagueShare.test.js) ---------------------
RESET ROLE;
INSERT INTO pb_smoke (name, ok, detail)
SELECT 'league_public_name_rule: ' || COALESCE(input, 'NULL') || ' -> ' || COALESCE(want, 'NULL'),
       public.league_public_name_rule(input) IS NOT DISTINCT FROM want,
       public.league_public_name_rule(input)
  FROM (VALUES
    ('Íñigo Echeverría Ruiz', 'Íñigo E.'),
    ('Miguel Ángel Domínguez', 'Miguel Á.'),
    ('  Javier   ortega ', 'Javier O.'),
    ('ana ' || chr(160) || 'émile', 'ana É.'),
    ('Pepe 🏌️Golf', 'Pepe 🏌.'),
    ('Luna 😀', 'Luna 😀.'),
    ('😀 Smile', '😀 S.'),
    ('Luis', 'Luis'),
    ('', NULL),
    ('   ', NULL),
    (NULL, NULL)
  ) AS cases(input, want);

-- 5) Grants and search_path ------------------------------------------------------------------
INSERT INTO pb_smoke (name, ok, detail)
SELECT 'member and admin RPCs: authenticated only',
       bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE')
                AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')) AND count(*) = 3,
       string_agg(p.proname, ',')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('get_league_share_link', 'set_league_public_board', 'rotate_league_public_board');
INSERT INTO pb_smoke (name, ok, detail)
SELECT 'get_public_league_board: anon and authenticated',
       bool_and(has_function_privilege('anon', p.oid, 'EXECUTE')
                AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) AND count(*) = 1, NULL
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'get_public_league_board';
INSERT INTO pb_smoke (name, ok, detail)
SELECT 'internal helpers: nobody executes them',
       count(*) = 3 AND bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                                 AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')),
       string_agg(p.proname, ',')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN ('league_new_board_token', 'league_public_name', 'league_public_name_rule');
INSERT INTO pb_smoke (name, ok, detail)
SELECT 'the new SECURITY DEFINER functions pin search_path',
       count(*) = 4 AND bool_and(COALESCE(p.proconfig @> ARRAY['search_path=public'], false)),
       string_agg(p.proname, ',')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prosecdef
   AND p.proname IN ('get_league_share_link', 'set_league_public_board', 'rotate_league_public_board',
                     'get_public_league_board');

-- Verdict ------------------------------------------------------------------------------------------
DO $$
DECLARE v_failed text;
BEGIN
  SELECT string_agg(name || ' [' || COALESCE(detail, '') || ']', E'\n' ORDER BY seq) INTO v_failed
    FROM pb_smoke WHERE ok IS NOT TRUE;
  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION E'league public board smoke failed:\n%', v_failed;
  END IF;
END $$;

SELECT seq, name, ok FROM pb_smoke ORDER BY seq;

ROLLBACK;
