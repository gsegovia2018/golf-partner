-- ============================================================================
-- Smoke test for 20261004000000_leagues.sql (+ 20261005000001_league_net_differential.sql,
-- 20261013000000_league_marker_request.sql)
-- — the league RPCs under a
-- simulated auth uid, their refusals, RLS, and the anon surface.
--
-- Plain SQL, no pgTAP. Each check writes one row into the temp table
-- `league_smoke` (name, ok, detail); a final DO block RAISEs listing every
-- failed check, so `psql -v ON_ERROR_STOP=1 -f this` exits non-zero on any
-- failure. The whole run is one transaction ending in ROLLBACK, so it can be
-- pointed at any database that has the migration applied without leaving a
-- row behind (fixture users, games, leagues and notifications included).
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/leagues_smoke.sql
--
-- Identity switching: `set_config('request.jwt.claims', {"sub": …})` makes
-- auth.uid() return that user, and `SET LOCAL ROLE authenticated|anon` makes
-- RLS and grants apply exactly as they do over PostgREST. RESET ROLE goes
-- back to the owner for fixture writes and assertions on raw rows.
--
-- Cast: A Marcos (admin), B Javi, C Pablo, D Diego, E Eve (not a friend).
-- ============================================================================

BEGIN;

CREATE TEMP TABLE league_smoke (seq serial, name text, ok boolean, detail text) ON COMMIT DROP;
CREATE TEMP TABLE league_ctx (k text PRIMARY KEY, v text) ON COMMIT DROP;
GRANT ALL ON league_smoke, league_ctx TO authenticated, anon;
GRANT USAGE ON SEQUENCE league_smoke_seq_seq TO authenticated, anon;

-- Fixture: users, profiles, friendships ---------------------------------------
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT u.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'league-smoke-' || u.k || '@example.invalid', now(), now()
  FROM (VALUES ('a', 'a0000000-0000-4000-8000-00000000000a'),
               ('b', 'a0000000-0000-4000-8000-00000000000b'),
               ('c', 'a0000000-0000-4000-8000-00000000000c'),
               ('d', 'a0000000-0000-4000-8000-00000000000d'),
               ('e', 'a0000000-0000-4000-8000-00000000000e')) u(k, id);

INSERT INTO public.profiles (user_id, display_name)
VALUES ('a0000000-0000-4000-8000-00000000000a', 'Marcos Test'),
       ('a0000000-0000-4000-8000-00000000000b', 'Javi Test'),
       ('a0000000-0000-4000-8000-00000000000c', 'Pablo Test'),
       ('a0000000-0000-4000-8000-00000000000d', 'Diego Test'),
       ('a0000000-0000-4000-8000-00000000000e', 'Eve Test')
ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name;

INSERT INTO public.friendships (requester_id, addressee_id, status)
VALUES ('a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000b', 'accepted'),
       ('a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000c', 'accepted'),
       ('a0000000-0000-4000-8000-00000000000d', 'a0000000-0000-4000-8000-00000000000a', 'accepted');

-- 1) create_league (as A) ------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE r jsonb;
BEGIN
  r := public.create_league('Club del Mulligan', '2026-01-01', '2026-12-31', NULL, 30, 2000,
         '[{"user_id":"a0000000-0000-4000-8000-00000000000a","handicap":18},
           {"user_id":"a0000000-0000-4000-8000-00000000000b","handicap":18},
           {"user_id":"a0000000-0000-4000-8000-00000000000c","handicap":20},
           {"user_id":"a0000000-0000-4000-8000-00000000000d","handicap":40}]'::jsonb);
  INSERT INTO league_ctx VALUES ('league', r->>'id'), ('code', r->>'invite_code');
  INSERT INTO league_smoke (name, ok, detail) VALUES
    ('create_league returns id + 8-char unambiguous code',
     r->>'id' IS NOT NULL AND (r->>'invite_code') ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$', r::text);
END $$;

DO $$
BEGIN
  PERFORM public.create_league('Bad', '2026-01-01', '2026-12-31', NULL, 30, 0,
            '[{"user_id":"a0000000-0000-4000-8000-00000000000e","handicap":10}]'::jsonb);
  INSERT INTO league_smoke (name, ok, detail) VALUES ('create_league refuses a non-friend', false, 'no error');
EXCEPTION WHEN others THEN
  INSERT INTO league_smoke (name, ok, detail) VALUES ('create_league refuses a non-friend',
    SQLERRM = 'You can only add friends to a league.', SQLERRM);
END $$;

INSERT INTO league_smoke (name, ok, detail)
SELECT 'creator sees league + 4 rows; only the creator has joined',
       (SELECT count(*) FROM public.leagues) = 1
       AND (SELECT count(*) FROM public.league_members) = 4
       AND (SELECT count(*) FROM public.league_members WHERE joined_at IS NOT NULL) = 1,
       NULL;

-- 2) join (B, C, D) and get_league_by_code ---------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);

INSERT INTO league_smoke (name, ok, detail)
SELECT 'invited B cannot read the league before joining',
       (SELECT count(*) FROM public.leagues) = 0, NULL;

DO $$
DECLARE r jsonb;
BEGIN
  r := public.get_league_by_code(lower((SELECT v FROM league_ctx WHERE k='code')));
  INSERT INTO league_smoke (name, ok, detail) VALUES ('get_league_by_code: name, proposed hcp, not member',
    r->>'name' = 'Club del Mulligan' AND (r->>'proposed_handicap')::numeric = 18
      AND (r->>'is_member')::boolean = false AND (r->>'member_count')::int = 1, r::text);
  INSERT INTO league_smoke (name, ok, detail) VALUES ('get_league_by_code: unknown code -> NULL',
    public.get_league_by_code('ZZZZZZZZ') IS NULL, NULL);
  PERFORM public.join_league((SELECT v FROM league_ctx WHERE k='code'), 18);
END $$;

INSERT INTO league_smoke (name, ok, detail)
SELECT 'B joined: sees 4 member rows and the league',
       (SELECT count(*) FROM public.league_members) = 4 AND (SELECT count(*) FROM public.leagues) = 1, NULL;

SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
SELECT public.join_league((SELECT v FROM league_ctx WHERE k='code'), 22);
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000d","role":"authenticated"}', true);
SELECT public.join_league((SELECT v FROM league_ctx WHERE k='code'), NULL);

SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);
INSERT INTO league_smoke (name, ok, detail)
SELECT 'outsider E reads no league rows',
       (SELECT count(*) FROM public.leagues) = 0 AND (SELECT count(*) FROM public.league_members) = 0, NULL;

RESET ROLE;
INSERT INTO league_smoke (name, ok, detail)
SELECT 'handicaps: A 18, B 18, C stays 20 (22 proposed), D clamped to cap 30',
       string_agg(right(user_id::text, 1) || '=' || league_handicap, ',' ORDER BY user_id) = 'a=18.0,b=18.0,c=20.0,d=30.0',
       string_agg(right(user_id::text, 1) || '=' || league_handicap, ',' ORDER BY user_id)
  FROM public.league_members WHERE league_id::text = (SELECT v FROM league_ctx WHERE k='league');
INSERT INTO league_smoke (name, ok, detail)
SELECT 'create_league notifies each invited friend once with league_invite',
       count(*) = 3
         AND bool_and(user_id IN ('a0000000-0000-4000-8000-00000000000b',
                                  'a0000000-0000-4000-8000-00000000000c',
                                  'a0000000-0000-4000-8000-00000000000d'))
         AND bool_and(data->>'invite_code' = (SELECT v FROM league_ctx WHERE k='code')
                      AND data->>'league_id' = (SELECT v FROM league_ctx WHERE k='league')
                      AND data->>'league_name' = 'Club del Mulligan'
                      AND data->>'inviter_name' = 'Marcos Test'),
       count(*)::text
  FROM public.notifications WHERE type = 'league_invite'
   AND data->>'league_id' = (SELECT v FROM league_ctx WHERE k='league');
INSERT INTO league_smoke (name, ok, detail)
SELECT 'join with a different handicap records one proposed event (C 20 -> 22)',
       count(*) = 1 AND min(old) = 20 AND min(new) = 22, count(*)::text
  FROM public.league_handicap_events WHERE reason = 'proposed'
   AND league_id::text = (SELECT v FROM league_ctx WHERE k='league');

-- 3) admin-only RPCs refused for a member -----------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE lid uuid := (SELECT v::uuid FROM league_ctx WHERE k='league');
BEGIN
  BEGIN
    PERFORM public.set_league_handicap(lid, 'a0000000-0000-4000-8000-00000000000c', 10);
    INSERT INTO league_smoke (name, ok, detail) VALUES ('member cannot set_league_handicap', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('member cannot set_league_handicap', SQLSTATE = '42501', SQLERRM);
  END;
  BEGIN
    PERFORM public.set_league_fee_paid(lid, 'a0000000-0000-4000-8000-00000000000b', true);
    INSERT INTO league_smoke (name, ok, detail) VALUES ('member cannot set_league_fee_paid', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('member cannot set_league_fee_paid', SQLSTATE = '42501', SQLERRM);
  END;
  BEGIN
    PERFORM public.update_league_rules(lid, 'Hacked', NULL, NULL, NULL, NULL, NULL);
    INSERT INTO league_smoke (name, ok, detail) VALUES ('member cannot update_league_rules', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('member cannot update_league_rules', SQLSTATE = '42501', SQLERRM);
  END;
  BEGIN
    PERFORM public.record_league_final(lid, 't_lg_a', '{}'::jsonb);
    INSERT INTO league_smoke (name, ok, detail) VALUES ('member cannot record_league_final', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('member cannot record_league_final', SQLSTATE = '42501', SQLERRM);
  END;
  BEGIN
    INSERT INTO public.league_cards (league_id, user_id, month, source, status)
    VALUES (lid, 'a0000000-0000-4000-8000-00000000000b', '2026-10-01', 'offapp', 'confirmed');
    INSERT INTO league_smoke (name, ok, detail) VALUES ('direct INSERT into league_cards refused', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('direct INSERT into league_cards refused', SQLSTATE = '42501', SQLERRM);
  END;
  BEGIN
    UPDATE public.league_members SET league_handicap = 0 WHERE league_id = lid;
    INSERT INTO league_smoke (name, ok, detail) VALUES ('direct UPDATE of league_members refused', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('direct UPDATE of league_members refused', SQLSTATE = '42501', SQLERRM);
  END;
END $$;

-- 4) Admin RPCs (as A) ------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
DO $$
DECLARE lid uuid := (SELECT v::uuid FROM league_ctx WHERE k='league'); v numeric;
BEGIN
  v := public.set_league_handicap(lid, 'a0000000-0000-4000-8000-00000000000b', 45);
  INSERT INTO league_smoke (name, ok, detail) VALUES ('set_league_handicap clamps to the cap', v = 30, v::text);
  PERFORM public.set_league_handicap(lid, 'a0000000-0000-4000-8000-00000000000b', 18);
  PERFORM public.set_league_fee_paid(lid, 'a0000000-0000-4000-8000-00000000000b', true);
  INSERT INTO league_smoke (name, ok, detail)
  SELECT 'set_league_fee_paid', fee_paid, NULL FROM public.league_members
   WHERE league_id = lid AND user_id = 'a0000000-0000-4000-8000-00000000000b';
END $$;

-- 5) App card for A: announce, one-card rule, tee-off -------------------------------
DO $$
DECLARE lid uuid := (SELECT v::uuid FROM league_ctx WHERE k='league'); r jsonb;
BEGIN
  r := public.announce_league_card(lid, 'app',
         '{"name":"La Moraleja","tee":"Yellow","holes":[{"n":1,"par":4,"si":7},{"n":2,"par":3,"si":15}]}'::jsonb,
         '2026-10-10 08:00+02', 't_lg_a', 'r0', 'pA');
  INSERT INTO league_ctx VALUES ('cardA', r->>'id');
  INSERT INTO league_smoke (name, ok, detail) VALUES ('announce app card: month October, league hcp copied',
    r->>'month' = '2026-10-01' AND (r->>'league_handicap')::numeric = 18, r::text);
END $$;

INSERT INTO league_smoke (name, ok, detail)
SELECT 'app card starts as playing with announced_at = now()',
       status = 'playing' AND announced_at = now(), status
  FROM public.league_cards WHERE id = (SELECT v::uuid FROM league_ctx WHERE k='cardA');

DO $$
DECLARE lid uuid := (SELECT v::uuid FROM league_ctx WHERE k='league');
BEGIN
  PERFORM public.announce_league_card(lid, 'offapp', '{"slope":130,"rating":71.4,"name":"Somewhere"}'::jsonb, '2026-10-25 09:00+02');
  INSERT INTO league_smoke (name, ok, detail) VALUES ('second October card refused', false, 'no error');
EXCEPTION WHEN others THEN
  INSERT INTO league_smoke (name, ok, detail) VALUES ('second October card refused',
    SQLSTATE = 'P0001' AND SQLERRM = 'You already have your October card.', SQLSTATE || ' ' || SQLERRM);
END $$;

SELECT public.notify_league_tee_off((SELECT v::uuid FROM league_ctx WHERE k='cardA'));
SELECT public.notify_league_tee_off((SELECT v::uuid FROM league_ctx WHERE k='cardA'));

RESET ROLE;
INSERT INTO league_smoke (name, ok, detail)
SELECT 'announce notifies the 3 other members, not the actor, with push data',
       count(*) = 3 AND bool_and(user_id <> 'a0000000-0000-4000-8000-00000000000a')
         AND bool_and(data->>'league_name' = 'Club del Mulligan' AND data->>'actor_name' = 'Marcos Test'
                      AND data->>'course_name' = 'La Moraleja' AND data->>'card_id' IS NOT NULL
                      AND data->>'league_id' IS NOT NULL),
       count(*)::text
  FROM public.notifications WHERE type = 'league_card_announced'
   AND entity_id::text = (SELECT v FROM league_ctx WHERE k='cardA');
INSERT INTO league_smoke (name, ok, detail)
SELECT 'tee-off notifies 3 members once (idempotent)', count(*) = 3, count(*)::text
  FROM public.notifications WHERE type = 'league_tee_off'
   AND entity_id::text = (SELECT v FROM league_ctx WHERE k='cardA');
INSERT INTO league_smoke (name, ok, detail)
SELECT 'tee-off stamps first_shot_at with the server clock', first_shot_at = now(), first_shot_at::text
  FROM public.league_cards WHERE id = (SELECT v::uuid FROM league_ctx WHERE k='cardA');

-- Game fixture for A's card: A plays pA. A's own device scores A, and A ALSO
-- writes a forged card under another author_id that claims to be Javi's
-- (scorer.userId = B). Javi's real card is written later, as B.
-- startedAt is AFTER the announcement.
INSERT INTO public.tournaments (id, name) VALUES ('t_lg_a', 'League smoke A');
INSERT INTO public.game_rounds (id, tournament_id, round_index, body)
VALUES ('r0', 't_lg_a', 0, jsonb_build_object('startedAt', to_char((now() + interval '1 hour') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        -- A's tee: card A's snapshot (older-build shape) has no slope/rating.
        'playerTees', '{"pA":{"label":"Yellow","slope":125,"rating":72}}'::jsonb));
INSERT INTO public.game_players (tournament_id, player_id, user_id, body)
VALUES ('t_lg_a', 'pA', 'a0000000-0000-4000-8000-00000000000a', '{}'::jsonb),
       ('t_lg_a', 'pB', 'a0000000-0000-4000-8000-00000000000b', '{}'::jsonb);
CREATE TEMP TABLE smoke_card_a ON COMMIT DROP AS
SELECT (SELECT jsonb_object_agg(h::text, jsonb_build_object(
          'v', 1, 'entries', jsonb_build_object('pA', 4, 'pB', 5), 'ts', 1757000000000::bigint))
          FROM generate_series(1, 18) h) AS holes;
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
INSERT INTO public.scorer_cards (tournament_id, round_id, author_id, card)
SELECT 't_lg_a', 'r0', dev, jsonb_build_object(
         'scorer', jsonb_build_object('playerId', pid, 'userId', uid),
         'holes', (SELECT holes FROM smoke_card_a))
  FROM (VALUES ('devA',    'pA', 'a0000000-0000-4000-8000-00000000000a'),
               ('devFake', 'pB', 'a0000000-0000-4000-8000-00000000000b')) d(dev, pid, uid);

-- 6) Submit + partner confirmation (as A) ------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE cid uuid := (SELECT v::uuid FROM league_ctx WHERE k='cardA');
        h18 jsonb := (SELECT jsonb_object_agg(h::text, 4) FROM generate_series(1, 18) h);
        r jsonb;
BEGIN
  BEGIN
    PERFORM public.confirm_league_card_by_partner(cid);
    INSERT INTO league_smoke (name, ok, detail) VALUES ('partner confirm before submit refused', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('partner confirm before submit refused', SQLERRM = 'Submit the card first.', SQLERRM);
  END;
  BEGIN
    PERFORM public.submit_league_card(cid, h18 - '18', 68, 36, 20, '2026-10-10');
    INSERT INTO league_smoke (name, ok, detail) VALUES ('submit with 17 holes refused', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('submit with 17 holes refused', SQLSTATE = 'P0001', SQLERRM);
  END;
  BEGIN
    PERFORM public.submit_league_card(cid, h18, 70, 36, 20, '2026-10-10');
    INSERT INTO league_smoke (name, ok, detail) VALUES ('submit with wrong gross refused', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('submit with wrong gross refused', SQLSTATE = 'P0001', SQLERRM);
  END;

  r := public.submit_league_card(cid, h18, 72, 36, 20, '2026-10-10');
  INSERT INTO league_smoke (name, ok, detail) VALUES ('submit app card: announced before first shot',
    r->>'status' = 'submitted' AND (r->>'not_announced')::boolean = false AND r->>'first_shot_at' IS NOT NULL, r::text);

  r := public.confirm_league_card_by_partner(cid);
  INSERT INTO league_smoke (name, ok, detail) VALUES ('a "Javi" card forged by the owner does NOT confirm',
    (r->>'confirmed')::boolean = false AND r->>'reason' = 'no_partner', r::text);
END $$;

-- Javi's real card, written by B (writer_uid = B).
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
INSERT INTO public.scorer_cards (tournament_id, round_id, author_id, card)
SELECT 't_lg_a', 'r0', 'devB', jsonb_build_object(
         'scorer', jsonb_build_object('playerId', 'pB', 'userId', 'a0000000-0000-4000-8000-00000000000b'),
         'holes', (SELECT holes FROM smoke_card_a));
INSERT INTO league_smoke (name, ok, detail)
SELECT 'writer_uid is stamped by the server from auth.uid()',
       string_agg(author_id || '=' || right(writer_uid::text, 1), ',' ORDER BY author_id) = 'devA=a,devB=b,devFake=a',
       string_agg(author_id || '=' || COALESCE(right(writer_uid::text, 1), 'NULL'), ',' ORDER BY author_id)
  FROM public.scorer_cards WHERE tournament_id = 't_lg_a';
-- The client's upsert (INSERT … ON CONFLICT DO UPDATE without writer_uid)
-- keeps the stamp; a no-auth (service role) update keeps it too.
INSERT INTO public.scorer_cards (tournament_id, round_id, author_id, card)
SELECT 't_lg_a', 'r0', 'devB', card FROM public.scorer_cards
 WHERE tournament_id = 't_lg_a' AND author_id = 'devB'
ON CONFLICT (tournament_id, round_id, author_id) DO UPDATE SET card = EXCLUDED.card;
SELECT set_config('request.jwt.claims', '', true);
UPDATE public.scorer_cards SET card = card WHERE tournament_id = 't_lg_a' AND author_id = 'devB';
INSERT INTO league_smoke (name, ok, detail)
SELECT 'upsert and no-auth update keep writer_uid',
       writer_uid = 'a0000000-0000-4000-8000-00000000000b', COALESCE(writer_uid::text, 'NULL')
  FROM public.scorer_cards WHERE tournament_id = 't_lg_a' AND author_id = 'devB';

SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE r jsonb;
BEGIN
  r := public.confirm_league_card_by_partner((SELECT v::uuid FROM league_ctx WHERE k='cardA'));
  INSERT INTO league_smoke (name, ok, detail) VALUES ('partner check passes on Javi''s real card (18/18)',
    (r->>'confirmed')::boolean AND r->>'partner_user_id' = 'a0000000-0000-4000-8000-00000000000b'
      AND r->>'partner_name' = 'Javi Test', r::text);
END $$;

INSERT INTO league_smoke (name, ok, detail)
SELECT 'card A confirmed by partner, frozen snapshot',
       status = 'confirmed' AND confirmation = 'partner' AND gross = 72 AND points = 36
         AND confirmed_by_user = 'a0000000-0000-4000-8000-00000000000b',
       status || '/' || COALESCE(confirmation, '-')
  FROM public.league_cards WHERE id = (SELECT v::uuid FROM league_ctx WHERE k='cardA');

DO $$
BEGIN
  PERFORM public.submit_league_card((SELECT v::uuid FROM league_ctx WHERE k='cardA'),
            (SELECT jsonb_object_agg(h::text, 3) FROM generate_series(1, 18) h), 54, 50, 20, NULL);
  INSERT INTO league_smoke (name, ok, detail) VALUES ('re-submit of a confirmed card refused', false, 'no error');
EXCEPTION WHEN others THEN
  INSERT INTO league_smoke (name, ok, detail) VALUES ('re-submit of a confirmed card refused',
    SQLERRM = 'This card can no longer be changed.', SQLERRM);
END $$;

-- B cannot submit A's card.
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
DO $$
BEGIN
  PERFORM public.confirm_league_card_by_partner((SELECT v::uuid FROM league_ctx WHERE k='cardA'));
  INSERT INTO league_smoke (name, ok, detail) VALUES ('non-owner cannot act on a card', false, 'no error');
EXCEPTION WHEN others THEN
  INSERT INTO league_smoke (name, ok, detail) VALUES ('non-owner cannot act on a card', SQLERRM = 'Card not found.', SQLERRM);
END $$;

-- 7) C: app card that fails the partner check, then QR -------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
DO $$
DECLARE r jsonb;
BEGIN
  r := public.announce_league_card((SELECT v::uuid FROM league_ctx WHERE k='league'), 'app',
         '{"slope":130,"rating":71.4,"name":"El Encín","tee":"White","holes":[{"n":1,"par":5,"si":3}]}'::jsonb,
         '2026-10-11 09:00+02', 't_lg_c', 'r0', 'pC');
  INSERT INTO league_ctx VALUES ('cardC', r->>'id');
END $$;

RESET ROLE;
-- C scores himself on all 18; Javi's device marks C on only 17 holes.
-- startedAt is BEFORE the announcement -> not_announced.
INSERT INTO public.tournaments (id, name) VALUES ('t_lg_c', 'League smoke C');
INSERT INTO public.game_rounds (id, tournament_id, round_index, body)
VALUES ('r0', 't_lg_c', 0, jsonb_build_object('startedAt', to_char((now() - interval '1 hour') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
INSERT INTO public.game_players (tournament_id, player_id, user_id, body)
VALUES ('t_lg_c', 'pC', 'a0000000-0000-4000-8000-00000000000c', '{}'::jsonb),
       ('t_lg_c', 'pB', 'a0000000-0000-4000-8000-00000000000b', '{}'::jsonb);
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
INSERT INTO public.scorer_cards (tournament_id, round_id, author_id, card)
VALUES ('t_lg_c', 'r0', 'devC', jsonb_build_object(
     'scorer', jsonb_build_object('playerId', 'pC', 'userId', 'a0000000-0000-4000-8000-00000000000c'),
     'holes', (SELECT jsonb_object_agg(h::text, jsonb_build_object('v', 1, 'entries', jsonb_build_object('pC', 5)))
                 FROM generate_series(1, 18) h)));
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
INSERT INTO public.scorer_cards (tournament_id, round_id, author_id, card)
VALUES ('t_lg_c', 'r0', 'devB', jsonb_build_object(
     'scorer', jsonb_build_object('playerId', 'pB', 'userId', 'a0000000-0000-4000-8000-00000000000b'),
     'holes', (SELECT jsonb_object_agg(h::text, jsonb_build_object('v', 1, 'entries', jsonb_build_object('pC', 5)))
                 FROM generate_series(1, 17) h)));

SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE cid uuid := (SELECT v::uuid FROM league_ctx WHERE k='cardC');
        h18 jsonb := (SELECT jsonb_object_agg(h::text, 5) FROM generate_series(1, 18) h);
        r jsonb;
BEGIN
  BEGIN
    PERFORM public.create_marker_token(cid);
    INSERT INTO league_smoke (name, ok, detail) VALUES ('marker token before submit refused', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('marker token before submit refused', SQLERRM = 'Submit the card first.', SQLERRM);
  END;

  r := public.submit_league_card(cid, h18, 90, 30, 22, NULL);
  INSERT INTO league_smoke (name, ok, detail) VALUES ('first shot before announce -> not_announced',
    (r->>'not_announced')::boolean, r::text);

  r := public.confirm_league_card_by_partner(cid);
  INSERT INTO league_smoke (name, ok, detail) VALUES ('partner check fails when partner marked 17/18',
    (r->>'confirmed')::boolean = false AND r->>'reason' = 'no_partner' AND (r->>'marked')::int = 17, r::text);

  r := public.create_marker_token(cid);
  INSERT INTO league_ctx VALUES ('tok1', r->>'token');
  INSERT INTO league_smoke (name, ok, detail) VALUES ('marker token: 43-char url-safe, 2 h',
    (r->>'token') ~ '^[A-Za-z0-9_-]{43}$'
      AND (r->>'expires_at')::timestamptz = now() + interval '2 hours', r::text);

  r := public.create_marker_token(cid);
  INSERT INTO league_ctx VALUES ('tok2', r->>'token');
END $$;

-- As anon: read the card, old token dead, garbage token, no other access.
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
DO $$
DECLARE r jsonb;
BEGIN
  r := public.get_marker_card((SELECT v FROM league_ctx WHERE k='tok2'));
  INSERT INTO league_smoke (name, ok, detail) VALUES ('anon get_marker_card returns only the whitelist',
    -- Compared as sets (<@ both ways) so collation order cannot matter.
    (SELECT array_agg(k) FROM jsonb_object_keys(r) k)
      <@ ARRAY['course','date','differential','expires_at','gross','holes','league_name','month','net_differential',
             'player_first_name','playing_handicap','points','rating','slope','tee']
    AND (SELECT array_agg(k) FROM jsonb_object_keys(r) k)
      @> ARRAY['course','date','differential','expires_at','gross','holes','league_name','month','net_differential',
             'player_first_name','playing_handicap','points','rating','slope','tee']
    AND r->>'player_first_name' = 'Pablo' AND jsonb_array_length(r->'holes') = 18
    AND r->>'league_name' = 'Club del Mulligan' AND r->>'month' = '2026-10-01'
    AND r->'holes'->0 = '{"n":1,"par":5,"si":3,"strokes":5}'::jsonb
    AND (SELECT array_agg(k) FROM jsonb_object_keys(r->'holes'->1) k) <@ ARRAY['n','par','si','strokes']
    AND (SELECT count(*) FROM jsonb_object_keys(r->'holes'->1)) = 4,
    r::text);

  BEGIN
    PERFORM public.get_marker_card((SELECT v FROM league_ctx WHERE k='tok1'));
    INSERT INTO league_smoke (name, ok, detail) VALUES ('a new token expires the older one', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('a new token expires the older one', SQLERRM = 'expired', SQLERRM);
  END;
  BEGIN
    PERFORM public.get_marker_card('not-a-token');
    INSERT INTO league_smoke (name, ok, detail) VALUES ('unknown token -> invalid', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('unknown token -> invalid', SQLERRM = 'invalid', SQLERRM);
  END;
  BEGIN
    PERFORM public.announce_league_card((SELECT v::uuid FROM league_ctx WHERE k='league'), 'offapp', '{"slope":130,"rating":71.4,"name":"x"}'::jsonb, now());
    INSERT INTO league_smoke (name, ok, detail) VALUES ('anon cannot call announce_league_card', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('anon cannot call announce_league_card', SQLSTATE = '42501', SQLERRM);
  END;
  BEGIN
    PERFORM 1 FROM public.league_cards;
    INSERT INTO league_smoke (name, ok, detail) VALUES ('anon cannot read league_cards', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('anon cannot read league_cards', SQLSTATE = '42501', SQLERRM);
  END;
END $$;

-- C re-submits a different snapshot (hole 1 = 6): tok2 now reads 'changed'.
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT public.submit_league_card((SELECT v::uuid FROM league_ctx WHERE k='cardC'),
         (SELECT jsonb_object_agg(h::text, CASE WHEN h = 1 THEN 6 ELSE 5 END) FROM generate_series(1, 18) h),
         91, 29, 22, NULL);
INSERT INTO league_ctx SELECT 'tok3', public.create_marker_token((SELECT v::uuid FROM league_ctx WHERE k='cardC'))->>'token';

SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
DO $$
DECLARE r jsonb;
BEGIN
  BEGIN
    PERFORM public.confirm_marker_card((SELECT v FROM league_ctx WHERE k='tok2'), 'Lucía', true, NULL);
    INSERT INTO league_smoke (name, ok, detail) VALUES ('confirm after a snapshot change refused', false, 'no error');
  EXCEPTION WHEN others THEN
    -- tok2 was also expired by tok3; either refusal blocks the confirmation.
    INSERT INTO league_smoke (name, ok, detail) VALUES ('confirm after a snapshot change refused',
      SQLERRM IN ('changed','expired'), SQLERRM);
  END;

  r := public.confirm_marker_card((SELECT v FROM league_ctx WHERE k='tok3'), 'Lucía', false, 'Hole 7 was a 6');
  INSERT INTO league_smoke (name, ok, detail) VALUES ('marker "something is wrong" returns the card', r->>'status' = 'returned', r::text);

  BEGIN
    PERFORM public.confirm_marker_card((SELECT v FROM league_ctx WHERE k='tok3'), 'Lucía', true, NULL);
    INSERT INTO league_smoke (name, ok, detail) VALUES ('a used token is refused', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('a used token is refused', SQLERRM = 'used', SQLERRM);
  END;
END $$;

RESET ROLE;
-- 'changed' on its own: a live, unexpired token whose card changed under it.
DO $$
DECLARE cid uuid := (SELECT v::uuid FROM league_ctx WHERE k='cardC');
BEGIN
  INSERT INTO public.league_marker_tokens (token, card_id, snapshot_hash, expires_at)
  VALUES ('smoke-stale-token', cid, md5('stale'), now() + interval '1 hour');
  PERFORM public.get_marker_card('smoke-stale-token');
  INSERT INTO league_smoke (name, ok, detail) VALUES ('token for an older snapshot -> changed', false, 'no error');
EXCEPTION WHEN others THEN
  INSERT INTO league_smoke (name, ok, detail) VALUES ('token for an older snapshot -> changed', SQLERRM = 'changed', SQLERRM);
END $$;

INSERT INTO league_smoke (name, ok, detail)
SELECT 'returned card stays submitted with the note; owner alone notified',
       c.status = 'submitted' AND c.marker_note = 'Hole 7 was a 6'
         AND (SELECT count(*) FROM public.notifications n WHERE n.type = 'league_marker_issue' AND n.entity_id = c.id) = 1
         AND (SELECT user_id FROM public.notifications n WHERE n.type = 'league_marker_issue' AND n.entity_id = c.id)
             = 'a0000000-0000-4000-8000-00000000000c',
       c.status
  FROM public.league_cards c WHERE c.id = (SELECT v::uuid FROM league_ctx WHERE k='cardC');

SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO league_ctx SELECT 'tokP', public.create_marker_token((SELECT v::uuid FROM league_ctx WHERE k='cardC'))->>'token';
RESET ROLE;
-- Only the points change (holes untouched): the QR must read 'changed'.
UPDATE public.league_cards SET points = points + 5 WHERE id = (SELECT v::uuid FROM league_ctx WHERE k='cardC');
DO $$
BEGIN
  PERFORM public.get_marker_card((SELECT v FROM league_ctx WHERE k='tokP'));
  INSERT INTO league_smoke (name, ok, detail) VALUES ('snapshot hash covers points', false, 'no error');
EXCEPTION WHEN others THEN
  INSERT INTO league_smoke (name, ok, detail) VALUES ('snapshot hash covers points', SQLERRM = 'changed', SQLERRM);
END $$;
UPDATE public.league_cards SET points = points - 5 WHERE id = (SELECT v::uuid FROM league_ctx WHERE k='cardC');
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
-- An identical re-submit still kills every outstanding QR.
SELECT public.submit_league_card((SELECT v::uuid FROM league_ctx WHERE k='cardC'),
         (SELECT jsonb_object_agg(h::text, CASE WHEN h = 1 THEN 6 ELSE 5 END) FROM generate_series(1, 18) h),
         91, 29, 22, NULL);
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
DO $$
BEGIN
  PERFORM public.get_marker_card((SELECT v FROM league_ctx WHERE k='tokP'));
  INSERT INTO league_smoke (name, ok, detail) VALUES ('submit expires every unused token', false, 'no error');
EXCEPTION WHEN others THEN
  INSERT INTO league_smoke (name, ok, detail) VALUES ('submit expires every unused token', SQLERRM = 'expired', SQLERRM);
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO league_ctx SELECT 'tok4', public.create_marker_token((SELECT v::uuid FROM league_ctx WHERE k='cardC'))->>'token';
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
DO $$
DECLARE r jsonb;
BEGIN
  BEGIN
    PERFORM public.confirm_marker_card((SELECT v FROM league_ctx WHERE k='tok4'), '   ', true, NULL);
    INSERT INTO league_smoke (name, ok, detail) VALUES ('marker must type a name', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('marker must type a name', SQLERRM = 'Type your name to sign the card.', SQLERRM);
  END;
  r := public.confirm_marker_card((SELECT v FROM league_ctx WHERE k='tok4'), 'Lucía', true, NULL);
  INSERT INTO league_smoke (name, ok, detail) VALUES ('anon confirm_marker_card confirms', r->>'status' = 'confirmed', r::text);
END $$;

RESET ROLE;
INSERT INTO league_smoke (name, ok, detail)
SELECT 'card C confirmed by QR with the marker name',
       status = 'confirmed' AND confirmation = 'qr' AND confirmed_by_name = 'Lucía' AND not_announced,
       status || '/' || COALESCE(confirmation, '-')
  FROM public.league_cards WHERE id = (SELECT v::uuid FROM league_ctx WHERE k='cardC');

-- 8) Off-app (D): announce, submit, proof photo -------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000d","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE lid uuid := (SELECT v::uuid FROM league_ctx WHERE k='league'); r jsonb; cid uuid;
BEGIN
  -- Tee time now: an off-app card can be posted only once it has passed (20261012000000).
  r := public.announce_league_card(lid, 'offapp', '{"slope":130,"rating":71.4,"name":"Golf Olivar","tee":"Yellow"}'::jsonb, now());
  cid := (r->>'id')::uuid;
  INSERT INTO league_ctx VALUES ('cardD', cid::text);
  INSERT INTO league_smoke (name, ok, detail)
  SELECT 'off-app announce -> status announced', status = 'announced', status FROM public.league_cards WHERE id = cid;
  r := public.submit_league_card(cid, (SELECT jsonb_object_agg(h::text, 6) FROM generate_series(1, 18) h), 108, 25, 30, '2026-10-20');
  INSERT INTO league_smoke (name, ok, detail) VALUES ('off-app submit after announce -> announced',
    (r->>'not_announced')::boolean = false, r::text);
  BEGIN
    PERFORM public.attach_league_proof(cid, lid::text || '/someone-else.jpg', 'photo', 'Marker');
    INSERT INTO league_smoke (name, ok, detail) VALUES ('proof path must be this card', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('proof path must be this card', SQLSTATE = 'P0001', SQLERRM);
  END;
  BEGIN
    PERFORM public.attach_league_proof(cid, lid::text || '/' || cid::text || '.jpg', 'photo', 'Marker');
    INSERT INTO league_smoke (name, ok, detail) VALUES ('proof must exist in storage', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('proof must exist in storage',
      SQLERRM = 'The proof photo has not finished uploading.', SQLERRM);
  END;
  INSERT INTO league_smoke (name, ok, detail) VALUES ('storage policy as owner D: write + read yes, bad path no',
    public.can_write_league_proof(lid::text || '/' || cid::text || '.jpg')
    AND public.can_read_league_proof(lid::text || '/' || cid::text || '.jpg')
    AND NOT public.can_write_league_proof('not-a-uuid/x.jpg'),
    NULL);
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
INSERT INTO league_smoke (name, ok, detail)
SELECT 'storage policy as member B: read yes, write no',
       public.can_read_league_proof(l.v || '/' || c.v || '.jpg') AND NOT public.can_write_league_proof(l.v || '/' || c.v || '.jpg'),
       NULL
  FROM league_ctx l, league_ctx c WHERE l.k = 'league' AND c.k = 'cardD';
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);
INSERT INTO league_smoke (name, ok, detail)
SELECT 'storage policy + is_league_member as outsider E: no',
       NOT public.can_read_league_proof(l.v || '/' || c.v || '.jpg') AND NOT public.is_league_member(l.v::uuid),
       NULL
  FROM league_ctx l, league_ctx c WHERE l.k = 'league' AND c.k = 'cardD';
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000d","role":"authenticated"}', true);
RESET ROLE;
INSERT INTO storage.objects (bucket_id, name, owner)
SELECT 'league-proofs', (SELECT v FROM league_ctx WHERE k='league') || '/' || (SELECT v FROM league_ctx WHERE k='cardD') || '.jpg',
       'a0000000-0000-4000-8000-00000000000d';

SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000d","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT public.attach_league_proof((SELECT v::uuid FROM league_ctx WHERE k='cardD'),
         (SELECT v FROM league_ctx WHERE k='league') || '/' || (SELECT v FROM league_ctx WHERE k='cardD') || '.jpg',
         'photo', 'Club secretary');
INSERT INTO league_smoke (name, ok, detail)
SELECT 'off-app card confirmed by photo', status = 'confirmed' AND confirmation = 'photo' AND proof_path IS NOT NULL,
       status FROM public.league_cards WHERE id = (SELECT v::uuid FROM league_ctx WHERE k='cardD');

-- 9) Unannounced card, Madrid month boundary, void (B) --------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
DO $$
DECLARE lid uuid := (SELECT v::uuid FROM league_ctx WHERE k='league'); r jsonb;
BEGIN
  r := public.add_unannounced_league_card(lid, '{"slope":130,"rating":71.4,"name":"RACE"}'::jsonb, NULL, '2026-11-02',
         (SELECT jsonb_object_agg(h::text, 5) FROM generate_series(1, 18) h), 90, 31, 20);
  INSERT INTO league_ctx VALUES ('cardB', r->>'id');
  INSERT INTO league_smoke (name, ok, detail) VALUES ('unannounced card: November, not_announced, submitted',
    r->>'month' = '2026-11-01' AND (r->>'not_announced')::boolean AND r->>'status' = 'submitted', r::text);
  BEGIN
    -- 23:30 UTC on 31 Oct is 00:30 on 1 Nov in Madrid: a November card.
    PERFORM public.announce_league_card(lid, 'offapp', '{"slope":130,"rating":71.4,"name":"x"}'::jsonb, '2026-10-31 23:30+00');
    INSERT INTO league_smoke (name, ok, detail) VALUES ('month boundary is Europe/Madrid', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('month boundary is Europe/Madrid',
      SQLERRM = 'You already have your November card.', SQLERRM);
  END;
  BEGIN
    PERFORM public.void_league_card((SELECT v::uuid FROM league_ctx WHERE k='cardA'), 'nope');
    INSERT INTO league_smoke (name, ok, detail) VALUES ('member cannot void a card', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('member cannot void a card', SQLSTATE = '42501', SQLERRM);
  END;
END $$;

SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
SELECT public.void_league_card((SELECT v::uuid FROM league_ctx WHERE k='cardB'), 'Duplicate');
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
DO $$
DECLARE r jsonb;
BEGIN
  r := public.announce_league_card((SELECT v::uuid FROM league_ctx WHERE k='league'), 'offapp',
         '{"slope":130,"rating":71.4,"name":"x"}'::jsonb, '2026-10-31 23:30+00');
  INSERT INTO league_smoke (name, ok, detail) VALUES ('after a void the member can announce that month again',
    r->>'month' = '2026-11-01', r::text);
  INSERT INTO league_ctx VALUES ('cardB2', r->>'id');
END $$;

-- A November tee time is still ahead, and an off-app card is posted only once
-- its tee time has passed (20261012000000): move it to just now, keeping the
-- card's month.
RESET ROLE;
UPDATE public.league_cards SET tee_time = now() - interval '5 minutes'
 WHERE id = (SELECT v::uuid FROM league_ctx WHERE k='cardB2');
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE r jsonb := jsonb_build_object('id', (SELECT v FROM league_ctx WHERE k='cardB2'));
BEGIN
  BEGIN
    PERFORM public.submit_league_card((r->>'id')::uuid,
              (SELECT jsonb_object_agg(h::text, 5) FROM generate_series(1, 18) h), 90, 31, 20, '2026-12-01');
    INSERT INTO league_smoke (name, ok, detail) VALUES ('submit refuses a played_on outside the card month', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('submit refuses a played_on outside the card month',
      SQLERRM = 'This is your November card, but the date is in December. Check the date.', SQLERRM);
  END;
  BEGIN
    PERFORM public.add_unannounced_league_card((SELECT v::uuid FROM league_ctx WHERE k='league'),
              '{"slope":130,"rating":71.4,"name":"RACE"}'::jsonb, '2026-12-05 10:00+01', '2026-11-30',
              (SELECT jsonb_object_agg(h::text, 5) FROM generate_series(1, 18) h), 90, 31, 20);
    INSERT INTO league_smoke (name, ok, detail) VALUES ('add-unannounced refuses tee time and date in different months', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('add-unannounced refuses tee time and date in different months',
      SQLERRM = 'The tee time is in December but the date is in November. Check the date.', SQLERRM);
  END;
  -- The same date in the right month is still accepted by submit.
  r := public.submit_league_card((r->>'id')::uuid,
         (SELECT jsonb_object_agg(h::text, 5) FROM generate_series(1, 18) h), 90, 31, 20, '2026-11-01');
  INSERT INTO league_smoke (name, ok, detail) VALUES ('submit accepts a played_on in the card month',
    r->>'status' = 'submitted', r::text);
END $$;

DO $$
DECLARE lid uuid := (SELECT v::uuid FROM league_ctx WHERE k='league'); r jsonb;
BEGIN
  BEGIN
    PERFORM public.announce_league_card(lid, 'offapp', '{"slope":130,"rating":71.4,"name":"x"}'::jsonb, '2026-09-15 10:00+02');
    INSERT INTO league_smoke (name, ok, detail) VALUES ('announce refuses a past month', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('announce refuses a past month',
      SQLERRM = 'That month is over. Announce a card for this month or later.', SQLERRM);
  END;
  BEGIN
    PERFORM public.announce_league_card(lid, 'offapp', '{"slope":130,"rating":71.4,"name":"x"}'::jsonb, '2027-01-10 10:00+01');
    INSERT INTO league_smoke (name, ok, detail) VALUES ('announce refuses a date outside the season', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('announce refuses a date outside the season',
      SQLERRM = 'That date is outside the season (2026-01-01 to 2026-12-31).', SQLERRM);
  END;
  BEGIN
    PERFORM public.add_unannounced_league_card(lid, '{"slope":130,"rating":71.4,"name":"x"}'::jsonb, NULL, '2027-02-01',
              (SELECT jsonb_object_agg(h::text, 5) FROM generate_series(1, 18) h), 90, 31, 20);
    INSERT INTO league_smoke (name, ok, detail) VALUES ('add-unannounced refuses a date outside the season', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('add-unannounced refuses a date outside the season',
      SQLERRM = 'That date is outside the season (2026-01-01 to 2026-12-31).', SQLERRM);
  END;
  -- An off-app tee time already gone can't be announced (20261012000000);
  -- a round already played goes in as an unannounced card instead.
  BEGIN
    PERFORM public.announce_league_card(lid, 'offapp', '{"slope":130,"rating":71.4,"name":"Late"}'::jsonb, now() - interval '1 hour');
    INSERT INTO league_smoke (name, ok, detail) VALUES ('announce refuses an off-app tee time already passed', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('announce refuses an off-app tee time already passed',
      SQLERRM = 'That tee time has passed. If you already played, add it as a card you didn''t announce.', SQLERRM);
  END;
  r := public.announce_league_card(lid, 'offapp', '{"slope":130,"rating":71.4,"name":"Late"}'::jsonb, now());
  INSERT INTO league_ctx VALUES ('cardBO', r->>'id');
  r := public.submit_league_card((r->>'id')::uuid, (SELECT jsonb_object_agg(h::text, 5) FROM generate_series(1, 18) h), 90, 31, 20, NULL);
  INSERT INTO league_smoke (name, ok, detail) VALUES ('off-app teeing off as announced -> announced',
    NOT (r->>'not_announced')::boolean, r::text);
END $$;

-- App card with no tee-off stamp and no round startedAt -> not announced.
-- An app card tees off on Start, so announce always makes it this month's
-- (20261012000000), and A has October already: a November one is a fixture row.
RESET ROLE;
WITH x AS (
  INSERT INTO public.league_cards (league_id, user_id, month, source, status, tournament_id, round_id, player_id,
                                   course, tee_time, played_on, announced_at, league_handicap)
  VALUES ((SELECT v::uuid FROM league_ctx WHERE k='league'), 'a0000000-0000-4000-8000-00000000000a', '2026-11-01',
          'app', 'playing', 't_lg_n', 'r0', 'pA', '{"slope":130,"rating":71.4,"name":"Nowhere"}'::jsonb,
          '2026-11-05 09:00+01', '2026-11-05', now(), 18)
  RETURNING id)
INSERT INTO league_ctx SELECT 'cardAN', id::text FROM x;
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE r jsonb;
BEGIN
  r := public.submit_league_card((SELECT v::uuid FROM league_ctx WHERE k='cardAN'), (SELECT jsonb_object_agg(h::text, 4) FROM generate_series(1, 18) h), 72, 36, 20, NULL);
  INSERT INTO league_smoke (name, ok, detail) VALUES ('app card with no first-shot stamp -> not_announced',
    (r->>'not_announced')::boolean AND r->>'first_shot_at' IS NULL, r::text);
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);

-- 9b) Net differential (20261005000001_league_net_differential.sql) ------------------
-- Worked example: CNG Amarillas, slope 130 / CR 71.4 / par 72, gross 86 with
-- hole 4 (par 5, SI 1) a 9 capped to 8 at playing handicap 16 -> adjusted 85
-- -> differential 11.8; league handicap 14.2 -> net -2.4.
INSERT INTO league_ctx VALUES
  ('cng',  '{"slope":130,"rating":71.4,"name":"Centro Nacional de Golf","tee":"Amarillas","holes":[{"n":1,"par":4,"si":3},{"n":2,"par":4,"si":5},{"n":3,"par":3,"si":7},{"n":4,"par":5,"si":1},{"n":5,"par":4,"si":9},{"n":6,"par":4,"si":11},{"n":7,"par":3,"si":13},{"n":8,"par":4,"si":15},{"n":9,"par":5,"si":17},{"n":10,"par":4,"si":4},{"n":11,"par":3,"si":6},{"n":12,"par":5,"si":2},{"n":13,"par":4,"si":8},{"n":14,"par":4,"si":10},{"n":15,"par":4,"si":12},{"n":16,"par":3,"si":14},{"n":17,"par":5,"si":16},{"n":18,"par":4,"si":18}]}'),
  ('unr',  '{"name":"Pitch and Putt","tee":"Red","holes":[{"n":1,"par":4,"si":3},{"n":2,"par":4,"si":5},{"n":3,"par":3,"si":7},{"n":4,"par":5,"si":1},{"n":5,"par":4,"si":9},{"n":6,"par":4,"si":11},{"n":7,"par":3,"si":13},{"n":8,"par":4,"si":15},{"n":9,"par":5,"si":17},{"n":10,"par":4,"si":4},{"n":11,"par":3,"si":6},{"n":12,"par":5,"si":2},{"n":13,"par":4,"si":8},{"n":14,"par":4,"si":10},{"n":15,"par":4,"si":12},{"n":16,"par":3,"si":14},{"n":17,"par":5,"si":16},{"n":18,"par":4,"si":18}]}'),
  ('hcng', '{"1":5,"2":5,"3":3,"4":9,"5":5,"6":5,"7":3,"8":5,"9":6,"10":5,"11":3,"12":6,"13":5,"14":4,"15":5,"16":3,"17":5,"18":4}'),
  ('hwild','{"1":9,"2":2,"3":7,"4":12,"5":3,"6":8,"7":6,"8":4,"9":11,"10":5,"11":9,"12":3,"13":10,"14":4,"15":7,"16":6,"17":8,"18":5}');

SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE lid uuid := (SELECT v::uuid FROM league_ctx WHERE k='league'); r jsonb;
        cng jsonb := (SELECT v::jsonb FROM league_ctx WHERE k='cng');
        unr jsonb := (SELECT v::jsonb FROM league_ctx WHERE k='unr');
        h   jsonb := (SELECT v::jsonb FROM league_ctx WHERE k='hcng');
        msg constant text := 'This tee has no slope and course rating, so it can''t count for the league.';
BEGIN
  BEGIN
    PERFORM public.add_unannounced_league_card(lid, unr, NULL, '2026-12-03', h, 86, 33, 16);
    INSERT INTO league_smoke (name, ok, detail) VALUES ('add-unannounced refuses an unrated tee', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('add-unannounced refuses an unrated tee',
      SQLSTATE = 'P0001' AND SQLERRM = msg, SQLSTATE || ' ' || SQLERRM);
  END;
  BEGIN
    PERFORM public.add_unannounced_league_card(lid, cng || '{"slope":null}'::jsonb, NULL, '2026-12-03', h, 86, 33, 16);
    INSERT INTO league_smoke (name, ok, detail) VALUES ('add-unannounced refuses a rating without a slope', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('add-unannounced refuses a rating without a slope',
      SQLSTATE = 'P0001' AND SQLERRM = msg, SQLSTATE || ' ' || SQLERRM);
  END;

  r := public.add_unannounced_league_card(lid, cng, NULL, '2026-12-02', h, 86, 33, 16);
  INSERT INTO league_ctx VALUES ('cardCN', r->>'id');

  -- Unrated announced card: announce is allowed, submit is refused and leaves it announced.
  r := public.announce_league_card(lid, 'offapp', unr, '2026-11-20 10:00+01');
  INSERT INTO league_ctx VALUES ('cardCU', r->>'id');
END $$;

-- Posting waits for the tee time (20261012000000): move it to just now,
-- keeping the card's month.
RESET ROLE;
UPDATE public.league_cards SET tee_time = now() - interval '5 minutes'
 WHERE id = (SELECT v::uuid FROM league_ctx WHERE k='cardCU');
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE h   jsonb := (SELECT v::jsonb FROM league_ctx WHERE k='hcng');
        msg constant text := 'This tee has no slope and course rating, so it can''t count for the league.';
BEGIN
  BEGIN
    PERFORM public.submit_league_card((SELECT v::uuid FROM league_ctx WHERE k='cardCU'), h, 86, 33, 16, NULL);
    INSERT INTO league_smoke (name, ok, detail) VALUES ('submit refuses an unrated tee', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('submit refuses an unrated tee',
      SQLSTATE = 'P0001' AND SQLERRM = msg, SQLSTATE || ' ' || SQLERRM);
  END;
END $$;
RESET ROLE;

INSERT INTO league_smoke (name, ok, detail)
SELECT 'worked example: differential 11.8, net -2.4 at league handicap 14.2',
       public.league_card_differential(h.v::jsonb, c.v::jsonb, 16) = 11.8
       AND public.league_net_differential(11.8, 14.2) = -2.4,
       public.league_card_differential(h.v::jsonb, c.v::jsonb, 16)::text
  FROM league_ctx h, league_ctx c WHERE h.k = 'hcng' AND c.k = 'cng';

INSERT INTO league_smoke (name, ok, detail)
SELECT 'add-unannounced stores differential 11.8 and net = round1(11.8 - league handicap)',
       differential = 11.8 AND net_differential = public.league_net_differential(11.8, league_handicap)
       AND net_differential IS NOT NULL AND points = 33,
       differential || ' / ' || net_differential || ' / hcp ' || league_handicap
  FROM public.league_cards WHERE id = (SELECT v::uuid FROM league_ctx WHERE k='cardCN');

INSERT INTO league_smoke (name, ok, detail)
SELECT 'unrated submit left the card announced with no score', status = 'announced' AND holes IS NULL
       AND net_differential IS NULL, status
  FROM public.league_cards WHERE id = (SELECT v::uuid FROM league_ctx WHERE k='cardCU');

INSERT INTO league_smoke (name, ok, detail)
SELECT 'app card from an older build: slope/rating filled from the game round tee at submit',
       course->>'slope' = '125' AND course->>'rating' = '72' AND course->>'name' = 'La Moraleja',
       course::text
  FROM public.league_cards WHERE id = (SELECT v::uuid FROM league_ctx WHERE k='cardA');

INSERT INTO league_smoke (name, ok, detail)
SELECT 'net differential edge cases: no handicap = 0, NULL in -> NULL, half rounds up like JS',
       public.league_net_differential(11.8, NULL) = 11.8
       AND public.league_net_differential(NULL, 14.2) IS NULL
       AND public.league_net_differential(0.0, 0.05) = 0.0      -- Math.round(-0.5) = -0
       AND public.league_net_differential(0.1, 0.05) = 0.1,     -- Math.round(0.5) = 1
       NULL;

INSERT INTO league_smoke (name, ok, detail)
SELECT 'differential is NULL for an unrated snapshot, a missing stroke or no playing handicap',
       public.league_card_differential(h.v::jsonb, u.v::jsonb, 16) IS NULL
       AND public.league_card_differential(h.v::jsonb - '7', c.v::jsonb, 16) IS NULL
       AND public.league_card_differential(h.v::jsonb, c.v::jsonb, NULL) IS NULL
       AND public.league_card_differential(h.v::jsonb, c.v::jsonb || '{"slope":"130","rating":"71.4"}'::jsonb, 16) = 11.8,
       NULL
  FROM league_ctx h, league_ctx c, league_ctx u WHERE h.k = 'hcng' AND c.k = 'cng' AND u.k = 'unr';

-- JS parity: the values below come from src/store/handicapIndex.js
-- (netDoubleBogeyCap + scoreDifferential) for two cards, four tees and
-- playing handicaps covering plus handicaps and more than 18 strokes.
INSERT INTO league_smoke (name, ok, detail)
SELECT 'SQL differential matches the JS maths on every case (plus and >18 handicaps)',
       count(*) FILTER (WHERE got IS DISTINCT FROM want) = 0 AND count(*) = 72,
       string_agg(card || ' ' || slope || '/' || rating || ' ph ' || ph || ': ' || COALESCE(got::text, 'null') || ' <> ' || want,
                  '; ') FILTER (WHERE got IS DISTINCT FROM want)
  FROM (
    SELECT t.card, t.slope, t.rating, t.ph, t.want,
           public.league_card_differential(
             (SELECT v::jsonb FROM league_ctx WHERE k = CASE t.card WHEN 'cng' THEN 'hcng' ELSE 'hwild' END),
             (SELECT v::jsonb FROM league_ctx WHERE k = 'cng')
               || jsonb_build_object('slope', t.slope, 'rating', t.rating),
             t.ph) AS got
      FROM (VALUES
    ('cng', 130, 71.4, -7, 11),
    ('cng', 130, 71.4, -4, 11),
    ('cng', 130, 71.4, 0, 11),
    ('cng', 130, 71.4, 16, 11.8),
    ('cng', 130, 71.4, 18, 11.8),
    ('cng', 130, 71.4, 20, 12.7),
    ('cng', 130, 71.4, 36, 12.7),
    ('cng', 130, 71.4, 40, 12.7),
    ('cng', 130, 71.4, 54, 12.7),
    ('cng', 113, 72, -7, 12),
    ('cng', 113, 72, -4, 12),
    ('cng', 113, 72, 0, 12),
    ('cng', 113, 72, 16, 13),
    ('cng', 113, 72, 18, 13),
    ('cng', 113, 72, 20, 14),
    ('cng', 113, 72, 36, 14),
    ('cng', 113, 72, 40, 14),
    ('cng', 113, 72, 54, 14),
    ('cng', 55, 60.3, -7, 48.7),
    ('cng', 55, 60.3, -4, 48.7),
    ('cng', 55, 60.3, 0, 48.7),
    ('cng', 55, 60.3, 16, 50.7),
    ('cng', 55, 60.3, 18, 50.7),
    ('cng', 55, 60.3, 20, 52.8),
    ('cng', 55, 60.3, 36, 52.8),
    ('cng', 55, 60.3, 40, 52.8),
    ('cng', 55, 60.3, 54, 52.8),
    ('cng', 155, 77.7, -7, 4.6),
    ('cng', 155, 77.7, -4, 4.6),
    ('cng', 155, 77.7, 0, 4.6),
    ('cng', 155, 77.7, 16, 5.3),
    ('cng', 155, 77.7, 18, 5.3),
    ('cng', 155, 77.7, 20, 6.1),
    ('cng', 155, 77.7, 36, 6.1),
    ('cng', 155, 77.7, 40, 6.1),
    ('cng', 155, 77.7, 54, 6.1),
    ('wild', 130, 71.4, -7, 12.7),
    ('wild', 130, 71.4, -4, 15.3),
    ('wild', 130, 71.4, 0, 17),
    ('wild', 130, 71.4, 16, 25.7),
    ('wild', 130, 71.4, 18, 26.6),
    ('wild', 130, 71.4, 20, 27.5),
    ('wild', 130, 71.4, 36, 32.7),
    ('wild', 130, 71.4, 40, 34.4),
    ('wild', 130, 71.4, 54, 37),
    ('wild', 113, 72, -7, 14),
    ('wild', 113, 72, -4, 17),
    ('wild', 113, 72, 0, 19),
    ('wild', 113, 72, 16, 29),
    ('wild', 113, 72, 18, 30),
    ('wild', 113, 72, 20, 31),
    ('wild', 113, 72, 36, 37),
    ('wild', 113, 72, 40, 39),
    ('wild', 113, 72, 54, 42),
    ('wild', 55, 60.3, -7, 52.8),
    ('wild', 55, 60.3, -4, 59),
    ('wild', 55, 60.3, 0, 63.1),
    ('wild', 55, 60.3, 16, 83.6),
    ('wild', 55, 60.3, 18, 85.7),
    ('wild', 55, 60.3, 20, 87.7),
    ('wild', 55, 60.3, 36, 100.1),
    ('wild', 55, 60.3, 40, 104.2),
    ('wild', 55, 60.3, 54, 110.3),
    ('wild', 155, 77.7, -7, 6.1),
    ('wild', 155, 77.7, -4, 8.2),
    ('wild', 155, 77.7, 0, 9.7),
    ('wild', 155, 77.7, 16, 17),
    ('wild', 155, 77.7, 18, 17.7),
    ('wild', 155, 77.7, 20, 18.4),
    ('wild', 155, 77.7, 36, 22.8),
    ('wild', 155, 77.7, 40, 24.3),
    ('wild', 155, 77.7, 54, 26.5)
      ) AS t(card, slope, rating, ph, want)
  ) z;

-- Backfill / write invariant: every card with a score carries exactly the
-- net differential its frozen data gives (on a hosted dry-run this covers the
-- real cards the migration backfilled).
INSERT INTO league_smoke (name, ok, detail)
SELECT 'every scored card stores the net differential its frozen data gives (backfill)',
       count(*) = 0, string_agg(id::text, ',')
  FROM public.league_cards
 WHERE holes IS NOT NULL
   AND net_differential IS DISTINCT FROM public.league_net_differential(
         public.league_card_differential(holes, course, playing_handicap), league_handicap);

SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

-- 10) Handicap votes ---------------------------------------------------------------------
-- 4 active members -> threshold ceil(8/3) = 3.
DO $$
DECLARE lid uuid := (SELECT v::uuid FROM league_ctx WHERE k='league'); vid uuid; r jsonb;
BEGIN
  vid := public.open_handicap_vote(lid, 'a0000000-0000-4000-8000-00000000000c', 15);
  INSERT INTO league_ctx VALUES ('vote1', vid::text);
  BEGIN
    PERFORM public.open_handicap_vote(lid, 'a0000000-0000-4000-8000-00000000000c', 14);
    INSERT INTO league_smoke (name, ok, detail) VALUES ('one open vote per subject', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('one open vote per subject', SQLSTATE = 'P0001', SQLERRM);
  END;
  INSERT INTO league_smoke (name, ok, detail)
  SELECT 'opening a vote casts the opener''s yes ballot',
         count(*) = 1 AND bool_and(yes) AND bool_and(voter = 'a0000000-0000-4000-8000-00000000000b'),
         count(*)::text
    FROM public.league_handicap_ballots WHERE vote_id = vid;
  r := public.cast_handicap_ballot(vid, true);
  INSERT INTO league_smoke (name, ok, detail) VALUES ('1 yes of 3 needed -> still open',
    r->>'status' = 'open' AND (r->>'threshold')::int = 3, r::text);
END $$;

SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
SELECT public.cast_handicap_ballot((SELECT v::uuid FROM league_ctx WHERE k='vote1'), true);
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000d","role":"authenticated"}', true);
DO $$
DECLARE r jsonb;
BEGIN
  r := public.cast_handicap_ballot((SELECT v::uuid FROM league_ctx WHERE k='vote1'), true);
  INSERT INTO league_smoke (name, ok, detail) VALUES ('3rd yes passes the vote', r->>'status' = 'passed', r::text);
  BEGIN
    PERFORM public.cast_handicap_ballot((SELECT v::uuid FROM league_ctx WHERE k='vote1'), false);
    INSERT INTO league_smoke (name, ok, detail) VALUES ('closed vote refuses ballots', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('closed vote refuses ballots', SQLERRM = 'This vote is closed.', SQLERRM);
  END;
  -- A vote that can no longer pass fails at once: 2 no of 4 leaves 2 < 3.
  r := jsonb_build_object('vid', public.open_handicap_vote((SELECT v::uuid FROM league_ctx WHERE k='league'),
                                   'a0000000-0000-4000-8000-00000000000b', 50));
  INSERT INTO league_ctx VALUES ('vote2', r->>'vid');
  PERFORM public.cast_handicap_ballot((r->>'vid')::uuid, false);
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
DO $$
DECLARE r jsonb;
BEGIN
  r := public.cast_handicap_ballot((SELECT v::uuid FROM league_ctx WHERE k='vote2'), false);
  INSERT INTO league_smoke (name, ok, detail) VALUES ('unreachable threshold fails the vote', r->>'status' = 'failed', r::text);
END $$;

RESET ROLE;
INSERT INTO league_smoke (name, ok, detail)
SELECT 'passed vote applied: C 20 -> 15 with a vote event',
       (SELECT league_handicap FROM public.league_members WHERE user_id = 'a0000000-0000-4000-8000-00000000000c') = 15
       AND EXISTS (SELECT 1 FROM public.league_handicap_events
                    WHERE user_id = 'a0000000-0000-4000-8000-00000000000c' AND reason = 'vote' AND old = 20 AND new = 15),
       NULL;
INSERT INTO league_smoke (name, ok, detail)
SELECT 'proposed vote value clamped to the cap (50 -> 30)', proposed = 30, proposed::text
  FROM public.league_handicap_votes WHERE id = (SELECT v::uuid FROM league_ctx WHERE k='vote2');
INSERT INTO league_smoke (name, ok, detail)
SELECT 'vote opened notifies the 3 others', count(*) = 6 AND count(DISTINCT entity_id) = 2, count(*)::text
  FROM public.notifications WHERE type = 'league_vote_opened';
INSERT INTO league_smoke (name, ok, detail)
SELECT 'confirmations notified the league (A, C, D cards x 3 members)', count(*) = 9, count(*)::text
  FROM public.notifications WHERE type = 'league_card_confirmed'
   AND data->>'league_id' = (SELECT v FROM league_ctx WHERE k='league');

-- 11) Rules, final, leave ----------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE lid uuid := (SELECT v::uuid FROM league_ctx WHERE k='league');
BEGIN
  PERFORM public.update_league_rules(lid, NULL, NULL, NULL, NULL, 25, NULL);
  INSERT INTO league_smoke (name, ok, detail)
  SELECT 'lowering the cap clamps D 30 -> 25, fee untouched by NULL',
         (SELECT league_handicap FROM public.league_members WHERE league_id = lid AND user_id = 'a0000000-0000-4000-8000-00000000000d') = 25
         AND (SELECT entry_fee_cents FROM public.leagues WHERE id = lid) = 2000,
         NULL;
  PERFORM public.record_league_final(lid, 't_lg_a', '{"a0000000-0000-4000-8000-00000000000a": 0}'::jsonb);
  BEGIN
    PERFORM public.leave_league(lid);
    INSERT INTO league_smoke (name, ok, detail) VALUES ('the only admin cannot leave', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('the only admin cannot leave',
      SQLERRM = 'You are the only admin. Make someone else admin first, then leave.', SQLERRM);
  END;
END $$;

SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
INSERT INTO league_smoke (name, ok, detail)
SELECT 'members read league_finals', count(*) = 1, count(*)::text FROM public.league_finals;

SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
SELECT public.leave_league((SELECT v::uuid FROM league_ctx WHERE k='league'));
INSERT INTO league_smoke (name, ok, detail)
SELECT 'a member who left no longer reads the league', (SELECT count(*) FROM public.leagues) = 0, NULL;

SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
INSERT INTO league_smoke (name, ok, detail)
SELECT 'get_league_members: names, avatars, roles, left members kept',
       count(*) = 4
       AND bool_or(display_name = 'Pablo Test' AND left_at IS NOT NULL)
       AND bool_or(display_name = 'Marcos Test' AND role = 'admin')
       AND bool_and(display_name IS NOT NULL),
       string_agg(display_name || ':' || role, ',')
  FROM public.get_league_members((SELECT v::uuid FROM league_ctx WHERE k='league'));
INSERT INTO league_smoke (name, ok, detail)
SELECT 'is_league_member answers for the caller only (B: yes)',
       public.is_league_member((SELECT v::uuid FROM league_ctx WHERE k='league')), NULL;
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000e","role":"authenticated"}', true);
DO $$
BEGIN
  PERFORM * FROM public.get_league_members((SELECT v::uuid FROM league_ctx WHERE k='league'));
  INSERT INTO league_smoke (name, ok, detail) VALUES ('outsider cannot list league members', false, 'no error');
EXCEPTION WHEN others THEN
  INSERT INTO league_smoke (name, ok, detail) VALUES ('outsider cannot list league members', SQLSTATE = '42501', SQLERRM);
END $$;

-- 13) Roles and archive ---------------------------------------------------------------------
-- Active now: A (admin), B, D. C left in section 11.
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE lid uuid := (SELECT v::uuid FROM league_ctx WHERE k='league');
BEGIN
  BEGIN
    PERFORM public.set_league_role(lid, 'a0000000-0000-4000-8000-00000000000b', 'admin');
    INSERT INTO league_smoke (name, ok, detail) VALUES ('member cannot set_league_role', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('member cannot set_league_role', SQLSTATE = '42501', SQLERRM);
  END;
  BEGIN
    PERFORM public.archive_league(lid);
    INSERT INTO league_smoke (name, ok, detail) VALUES ('member cannot archive_league', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('member cannot archive_league', SQLSTATE = '42501', SQLERRM);
  END;
  -- A QR issued before the archive, used after it.
  INSERT INTO league_ctx SELECT 'tokB', public.create_marker_token((SELECT v::uuid FROM league_ctx WHERE k='cardB2'))->>'token';
  -- An open vote that will be caught by the archive (B's yes is 1 of 2 needed).
  INSERT INTO league_ctx VALUES ('vote3',
    public.open_handicap_vote(lid, 'a0000000-0000-4000-8000-00000000000d', 20)::text);
END $$;

SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
DO $$
DECLARE lid uuid := (SELECT v::uuid FROM league_ctx WHERE k='league');
BEGIN
  BEGIN
    PERFORM public.set_league_role(lid, 'a0000000-0000-4000-8000-00000000000a', 'member');
    INSERT INTO league_smoke (name, ok, detail) VALUES ('the last admin cannot be demoted', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('the last admin cannot be demoted',
      SQLERRM = 'A league needs at least one admin. Make someone else admin first.', SQLERRM);
  END;
  PERFORM public.set_league_role(lid, 'a0000000-0000-4000-8000-00000000000d', 'admin');
  INSERT INTO league_smoke (name, ok, detail)
  SELECT 'set_league_role promotes D to admin', role = 'admin', role
    FROM public.league_members WHERE league_id = lid AND user_id = 'a0000000-0000-4000-8000-00000000000d';
  -- With a second admin, demoting is allowed again.
  PERFORM public.set_league_role(lid, 'a0000000-0000-4000-8000-00000000000d', 'member');
  PERFORM public.set_league_role(lid, 'a0000000-0000-4000-8000-00000000000d', 'admin');
  PERFORM public.set_league_role(lid, 'a0000000-0000-4000-8000-00000000000a', 'member');
  INSERT INTO league_smoke (name, ok, detail)
  SELECT 'an admin can step down once another admin exists',
         (SELECT role FROM public.league_members WHERE league_id = lid AND user_id = 'a0000000-0000-4000-8000-00000000000a') = 'member',
         NULL;
END $$;

-- D (now the admin) archives the league.
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000d","role":"authenticated"}', true);
SELECT public.archive_league((SELECT v::uuid FROM league_ctx WHERE k='league'));
SELECT public.archive_league((SELECT v::uuid FROM league_ctx WHERE k='league'));   -- idempotent

SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
DO $$
DECLARE lid uuid := (SELECT v::uuid FROM league_ctx WHERE k='league');
        msg constant text := 'This league has been archived. You can still look at it, but not change it.';
BEGIN
  BEGIN
    PERFORM public.announce_league_card(lid, 'offapp', '{"slope":130,"rating":71.4,"name":"x"}'::jsonb, '2026-12-10 10:00+01');
    INSERT INTO league_smoke (name, ok, detail) VALUES ('archived: announce refused', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('archived: announce refused', SQLERRM = msg, SQLERRM);
  END;
  BEGIN
    PERFORM public.submit_league_card((SELECT v::uuid FROM league_ctx WHERE k='cardB2'),
              (SELECT jsonb_object_agg(h::text, 5) FROM generate_series(1, 18) h), 90, 31, 20, NULL);
    INSERT INTO league_smoke (name, ok, detail) VALUES ('archived: submit refused', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('archived: submit refused', SQLERRM = msg, SQLERRM);
  END;
  BEGIN
    PERFORM public.add_unannounced_league_card(lid, '{"slope":130,"rating":71.4,"name":"RACE"}'::jsonb, NULL, '2026-12-02',
              (SELECT jsonb_object_agg(h::text, 5) FROM generate_series(1, 18) h), 90, 31, 20);
    INSERT INTO league_smoke (name, ok, detail) VALUES ('archived: add-unannounced refused', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('archived: add-unannounced refused', SQLERRM = msg, SQLERRM);
  END;
  BEGIN
    PERFORM public.open_handicap_vote(lid, 'a0000000-0000-4000-8000-00000000000a', 10);
    INSERT INTO league_smoke (name, ok, detail) VALUES ('archived: open vote refused', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('archived: open vote refused', SQLERRM = msg, SQLERRM);
  END;
  BEGIN
    PERFORM public.confirm_league_card_by_partner((SELECT v::uuid FROM league_ctx WHERE k='cardB2'));
    INSERT INTO league_smoke (name, ok, detail) VALUES ('archived: partner confirm refused', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('archived: partner confirm refused', SQLERRM = msg, SQLERRM);
  END;
  BEGIN
    PERFORM public.attach_league_proof((SELECT v::uuid FROM league_ctx WHERE k='cardB2'),
              lid::text || '/' || (SELECT v FROM league_ctx WHERE k='cardB2') || '.jpg', 'photo', 'x');
    INSERT INTO league_smoke (name, ok, detail) VALUES ('archived: proof confirm refused', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('archived: proof confirm refused', SQLERRM = msg, SQLERRM);
  END;
  BEGIN
    PERFORM public.create_marker_token((SELECT v::uuid FROM league_ctx WHERE k='cardB2'));
    INSERT INTO league_smoke (name, ok, detail) VALUES ('archived: new marker token refused', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('archived: new marker token refused', SQLERRM = msg, SQLERRM);
  END;
END $$;

SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
DO $$
BEGIN
  PERFORM public.confirm_marker_card((SELECT v FROM league_ctx WHERE k='tokB'), 'Lucía', true, NULL);
  INSERT INTO league_smoke (name, ok, detail) VALUES ('archived: marker confirm refused', false, 'no error');
EXCEPTION WHEN others THEN
  INSERT INTO league_smoke (name, ok, detail) VALUES ('archived: marker confirm refused',
    SQLERRM = 'This league has been archived. You can still look at it, but not change it.', SQLERRM);
END $$;

-- Admin after archive: void + final allowed, every other admin write refused.
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000d","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE lid uuid := (SELECT v::uuid FROM league_ctx WHERE k='league');
        msg constant text := 'This league has been archived. You can still look at it, but not change it.';
        n_ok int := 0;
BEGIN
  BEGIN PERFORM public.set_league_handicap(lid, 'a0000000-0000-4000-8000-00000000000b', 10);
  EXCEPTION WHEN others THEN IF SQLERRM = msg THEN n_ok := n_ok + 1; END IF; END;
  BEGIN PERFORM public.set_league_fee_paid(lid, 'a0000000-0000-4000-8000-00000000000b', false);
  EXCEPTION WHEN others THEN IF SQLERRM = msg THEN n_ok := n_ok + 1; END IF; END;
  BEGIN PERFORM public.update_league_rules(lid, 'Renamed', NULL, NULL, NULL, NULL, NULL);
  EXCEPTION WHEN others THEN IF SQLERRM = msg THEN n_ok := n_ok + 1; END IF; END;
  BEGIN PERFORM public.set_league_role(lid, 'a0000000-0000-4000-8000-00000000000b', 'admin');
  EXCEPTION WHEN others THEN IF SQLERRM = msg THEN n_ok := n_ok + 1; END IF; END;
  INSERT INTO league_smoke (name, ok, detail) VALUES ('archived: handicap/fee/rules/role refused', n_ok = 4, n_ok::text);

  PERFORM public.void_league_card((SELECT v::uuid FROM league_ctx WHERE k='cardBO'), 'cleanup');
  PERFORM public.record_league_final(lid, 't_lg_a', '{}'::jsonb);
  INSERT INTO league_smoke (name, ok, detail)
  SELECT 'archived: void and record_league_final still allowed',
         (SELECT status FROM public.league_cards WHERE id = (SELECT v::uuid FROM league_ctx WHERE k='cardBO')) = 'void',
         NULL;
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
DO $$
BEGIN
  PERFORM public.notify_league_tee_off((SELECT v::uuid FROM league_ctx WHERE k='cardAN'));
  INSERT INTO league_smoke (name, ok, detail) VALUES ('archived: tee-off refused', false, 'no error');
EXCEPTION WHEN others THEN
  INSERT INTO league_smoke (name, ok, detail) VALUES ('archived: tee-off refused',
    SQLERRM = 'This league has been archived. You can still look at it, but not change it.', SQLERRM);
END $$;

SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
DO $$
BEGIN
  PERFORM public.cast_handicap_ballot((SELECT v::uuid FROM league_ctx WHERE k='vote3'), true);
  INSERT INTO league_smoke (name, ok, detail) VALUES ('archived: ballot refused', false, 'no error');
EXCEPTION WHEN others THEN
  INSERT INTO league_smoke (name, ok, detail) VALUES ('archived: ballot refused',
    SQLERRM = 'This league has been archived. You can still look at it, but not change it.', SQLERRM);
END $$;
INSERT INTO league_smoke (name, ok, detail)
SELECT 'archived: members still read the league, cards and votes',
       (SELECT count(*) FROM public.leagues WHERE archived_at IS NOT NULL) = 1
       AND (SELECT count(*) FROM public.league_cards) > 0
       AND (SELECT count(*) FROM public.league_handicap_votes) = 3,
       NULL;

-- 14) Pick your marker (20261013000000_league_marker_request.sql) ----------------------------
-- A second league (the first is archived): A, B, C. D plays the game but is
-- not in this league; E plays but keeps no card. Game t_lg_m: B's card marks
-- A on all 18 holes, D's on holes 1-10, C scored only his own ball.
-- Unbound (QR) tokens go through the redefined get_marker_card /
-- confirm_marker_card anonymously in section 7 (read, flag, used, confirm).
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE r jsonb;
BEGIN
  r := public.create_league('Marker league', '2026-01-01', '2026-12-31', NULL, 30, 0,
         '[{"user_id":"a0000000-0000-4000-8000-00000000000a","handicap":18},
           {"user_id":"a0000000-0000-4000-8000-00000000000b","handicap":18},
           {"user_id":"a0000000-0000-4000-8000-00000000000c","handicap":20}]'::jsonb);
  INSERT INTO league_ctx VALUES ('league2', r->>'id'), ('code2', r->>'invite_code');
END $$;
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
SELECT public.join_league((SELECT v FROM league_ctx WHERE k='code2'), 18);
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
SELECT public.join_league((SELECT v FROM league_ctx WHERE k='code2'), 20);
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
DO $$
DECLARE r jsonb;
BEGIN
  r := public.announce_league_card((SELECT v::uuid FROM league_ctx WHERE k='league2'), 'app',
         '{"slope":130,"rating":71.4,"name":"Marker Links","tee":"Yellow","holes":[{"n":1,"par":4,"si":7}]}'::jsonb,
         now(), 't_lg_m', 'r0', 'pA');
  INSERT INTO league_ctx VALUES ('cardM', r->>'id');
END $$;

RESET ROLE;
INSERT INTO public.tournaments (id, name) VALUES ('t_lg_m', 'League smoke marker');
INSERT INTO public.game_rounds (id, tournament_id, round_index, body)
VALUES ('r0', 't_lg_m', 0, jsonb_build_object('startedAt', to_char((now() + interval '1 hour') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
INSERT INTO public.game_players (tournament_id, player_id, user_id, body)
VALUES ('t_lg_m', 'pA', 'a0000000-0000-4000-8000-00000000000a', '{}'::jsonb),
       ('t_lg_m', 'pB', 'a0000000-0000-4000-8000-00000000000b', '{}'::jsonb),
       ('t_lg_m', 'pC', 'a0000000-0000-4000-8000-00000000000c', '{}'::jsonb),
       ('t_lg_m', 'pD', 'a0000000-0000-4000-8000-00000000000d', '{}'::jsonb),
       ('t_lg_m', 'pE', 'a0000000-0000-4000-8000-00000000000e', '{}'::jsonb);
-- Each card written as its scorer, so writer_uid is theirs.
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
INSERT INTO public.scorer_cards (tournament_id, round_id, author_id, card)
VALUES ('t_lg_m', 'r0', 'devA', jsonb_build_object(
     'scorer', jsonb_build_object('playerId', 'pA', 'userId', 'a0000000-0000-4000-8000-00000000000a'),
     'holes', (SELECT jsonb_object_agg(h::text, jsonb_build_object('v', 1, 'entries', jsonb_build_object('pA', 4)))
                 FROM generate_series(1, 18) h)));
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
INSERT INTO public.scorer_cards (tournament_id, round_id, author_id, card)
VALUES ('t_lg_m', 'r0', 'devB', jsonb_build_object(
     'scorer', jsonb_build_object('playerId', 'pB', 'userId', 'a0000000-0000-4000-8000-00000000000b'),
     'holes', (SELECT jsonb_object_agg(h::text, jsonb_build_object('v', 1, 'entries', jsonb_build_object('pA', 4, 'pB', 5)))
                 FROM generate_series(1, 18) h)));
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
INSERT INTO public.scorer_cards (tournament_id, round_id, author_id, card)
VALUES ('t_lg_m', 'r0', 'devC', jsonb_build_object(
     'scorer', jsonb_build_object('playerId', 'pC', 'userId', 'a0000000-0000-4000-8000-00000000000c'),
     'holes', (SELECT jsonb_object_agg(h::text, jsonb_build_object('v', 1, 'entries', jsonb_build_object('pC', 5)))
                 FROM generate_series(1, 18) h)));
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000d","role":"authenticated"}', true);
INSERT INTO public.scorer_cards (tournament_id, round_id, author_id, card)
VALUES ('t_lg_m', 'r0', 'devD', jsonb_build_object(
     'scorer', jsonb_build_object('playerId', 'pD', 'userId', 'a0000000-0000-4000-8000-00000000000d'),
     'holes', (SELECT jsonb_object_agg(h::text, jsonb_build_object('v', 1, 'entries', jsonb_build_object('pA', 4)))
                 FROM generate_series(1, 10) h)));

SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE cid uuid := (SELECT v::uuid FROM league_ctx WHERE k='cardM');
        r jsonb;
BEGIN
  r := public.get_league_marker_candidates(cid);
  INSERT INTO league_smoke (name, ok, detail) VALUES
    ('marker candidates before submit: B 18, D 10 (not in league), C 0; never the owner or a non-scorer',
     r->'pending' = 'null'::jsonb
     AND (SELECT string_agg(right(e->>'user_id', 1) || ':' || (e->>'marked') || ':' || (e->>'in_league'), ',' ORDER BY o)
            FROM jsonb_array_elements(r->'candidates') WITH ORDINALITY x(e, o)) = 'b:18:true,d:10:false,c:0:true'
     AND r->'candidates'->0->>'name' = 'Javi Test',
     r::text);
  BEGIN
    PERFORM public.request_league_marker(cid, 'a0000000-0000-4000-8000-00000000000b');
    INSERT INTO league_smoke (name, ok, detail) VALUES ('marker request before submit refused', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('marker request before submit refused',
      SQLSTATE = 'P0001' AND SQLERRM = 'Submit the card first.', SQLERRM);
  END;

  PERFORM public.submit_league_card(cid, (SELECT jsonb_object_agg(h::text, 4) FROM generate_series(1, 18) h), 72, 36, 20, NULL);

  BEGIN
    PERFORM public.request_league_marker(cid, 'a0000000-0000-4000-8000-00000000000a');
    INSERT INTO league_smoke (name, ok, detail) VALUES ('owner cannot pick themselves as marker', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('owner cannot pick themselves as marker',
      SQLERRM = 'You can''t mark your own card.', SQLERRM);
  END;
  BEGIN
    PERFORM public.request_league_marker(cid, 'a0000000-0000-4000-8000-00000000000e');
    INSERT INTO league_smoke (name, ok, detail) VALUES ('a player who kept no card cannot be the marker', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('a player who kept no card cannot be the marker',
      SQLERRM = 'Pick a player who kept a card in this game.', SQLERRM);
  END;

  r := public.request_league_marker(cid, 'a0000000-0000-4000-8000-00000000000b');
  INSERT INTO league_smoke (name, ok, detail) VALUES ('request_league_marker: marker, name, 7 days, no token',
    r->>'marker_user_id' = 'a0000000-0000-4000-8000-00000000000b' AND r->>'marker_name' = 'Javi Test'
      AND (r->>'expires_at')::timestamptz = now() + interval '7 days' AND NOT (r ? 'token'),
    r::text);
  r := public.get_league_marker_candidates(cid);
  INSERT INTO league_smoke (name, ok, detail) VALUES ('candidates show the pending request',
    r->'pending'->>'user_id' = 'a0000000-0000-4000-8000-00000000000b' AND r->'pending'->>'name' = 'Javi Test'
      AND (r->'pending'->>'expires_at')::timestamptz = now() + interval '7 days'
      AND r->'pending'->'reminded_at' = 'null'::jsonb,
    r::text);
  BEGIN
    PERFORM public.remind_league_marker(cid);
    INSERT INTO league_smoke (name, ok, detail) VALUES ('remind refused within 20 h of the request', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('remind refused within 20 h of the request',
      SQLERRM = 'You can remind once a day.', SQLERRM);
  END;
END $$;

SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
DO $$
DECLARE cid uuid := (SELECT v::uuid FROM league_ctx WHERE k='cardM');
BEGIN
  BEGIN
    PERFORM public.request_league_marker(cid, 'a0000000-0000-4000-8000-00000000000d');
    INSERT INTO league_smoke (name, ok, detail) VALUES ('non-owner cannot request a marker', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('non-owner cannot request a marker', SQLERRM = 'Card not found.', SQLERRM);
  END;
  BEGIN
    PERFORM public.get_league_marker_candidates(cid);
    INSERT INTO league_smoke (name, ok, detail) VALUES ('non-owner cannot list marker candidates', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('non-owner cannot list marker candidates', SQLERRM = 'Card not found.', SQLERRM);
  END;
  -- The marker reads the token from their own notification (RLS: own rows).
  INSERT INTO league_ctx SELECT 'tokM1', data->>'token' FROM public.notifications
   WHERE type = 'league_marker_request' AND entity_id = cid;
END $$;

RESET ROLE;
INSERT INTO league_smoke (name, ok, detail)
SELECT 'marker request: one notification to B from A with the push data; token bound to B',
       count(*) = 1
       AND bool_and(n.user_id = 'a0000000-0000-4000-8000-00000000000b' AND n.actor_id = 'a0000000-0000-4000-8000-00000000000a'
                    AND n.data->>'card_id' = (SELECT v FROM league_ctx WHERE k='cardM')
                    AND n.data->>'league_id' = (SELECT v FROM league_ctx WHERE k='league2')
                    AND n.data->>'league_name' = 'Marker league' AND n.data->>'course_name' = 'Marker Links'
                    AND n.data->>'month' = '2026-10-01' AND n.data->>'actor_name' = 'Marcos Test'
                    AND (n.data->>'token') ~ '^[A-Za-z0-9_-]{43}$')
       AND (SELECT t.marker_user_id = 'a0000000-0000-4000-8000-00000000000b'
                   AND t.snapshot_hash = public.league_card_hash(c)
              FROM public.league_marker_tokens t JOIN public.league_cards c ON c.id = t.card_id
             WHERE t.token = (SELECT v FROM league_ctx WHERE k='tokM1')),
       count(*)::text
  FROM public.notifications n WHERE n.type = 'league_marker_request' AND n.entity_id = (SELECT v::uuid FROM league_ctx WHERE k='cardM');
INSERT INTO league_smoke (name, ok, detail)
SELECT 'card carries the open request',
       marker_user_id = 'a0000000-0000-4000-8000-00000000000b' AND marker_name = 'Javi Test'
       AND marker_requested_at = now() AND marker_reminded_at IS NULL,
       COALESCE(marker_name, 'NULL')
  FROM public.league_cards WHERE id = (SELECT v::uuid FROM league_ctx WHERE k='cardM');

-- Anyone but the marker: 'invalid', as for an unknown token.
DO $$
DECLARE tok text := (SELECT v FROM league_ctx WHERE k='tokM1');
        who text;
        n_ok int := 0;
BEGIN
  FOREACH who IN ARRAY ARRAY['a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000c'] LOOP
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    BEGIN PERFORM public.get_marker_card(tok);
    EXCEPTION WHEN others THEN IF SQLERRM = 'invalid' THEN n_ok := n_ok + 1; END IF; END;
    BEGIN PERFORM public.confirm_marker_card(tok, 'Me', true, NULL);
    EXCEPTION WHEN others THEN IF SQLERRM = 'invalid' THEN n_ok := n_ok + 1; END IF; END;
  END LOOP;
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SET LOCAL ROLE anon;
  BEGIN PERFORM public.get_marker_card(tok);
  EXCEPTION WHEN others THEN IF SQLERRM = 'invalid' THEN n_ok := n_ok + 1; END IF; END;
  BEGIN PERFORM public.confirm_marker_card(tok, 'Me', true, NULL);
  EXCEPTION WHEN others THEN IF SQLERRM = 'invalid' THEN n_ok := n_ok + 1; END IF; END;
  RESET ROLE;
  INSERT INTO league_smoke (name, ok, detail) VALUES
    ('a bound token is invalid for the owner, another player and anon (get + confirm)', n_ok = 6, n_ok::text);
END $$;

SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE r jsonb;
BEGIN
  r := public.get_marker_card((SELECT v FROM league_ctx WHERE k='tokM1'));
  INSERT INTO league_smoke (name, ok, detail) VALUES ('the marker reads the bound card, signed in as themselves',
    (r->>'bound')::boolean AND r->>'signed_in_name' = 'Javi Test' AND r->>'player_first_name' = 'Marcos'
      AND (r->>'gross')::int = 72 AND jsonb_array_length(r->'holes') = 18
      AND r->>'league_name' = 'Marker league' AND r->>'month' = '2026-10-01',
    r::text);
END $$;

-- Re-request (D, then B again): the old token dies, one notification remains.
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
SELECT public.request_league_marker((SELECT v::uuid FROM league_ctx WHERE k='cardM'), 'a0000000-0000-4000-8000-00000000000d');
RESET ROLE;
INSERT INTO league_smoke (name, ok, detail)
SELECT 're-request replaces the notification (now to D, outside the league)',
       count(*) = 1 AND bool_and(user_id = 'a0000000-0000-4000-8000-00000000000d'), count(*)::text
  FROM public.notifications WHERE type = 'league_marker_request' AND entity_id = (SELECT v::uuid FROM league_ctx WHERE k='cardM');
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT public.request_league_marker((SELECT v::uuid FROM league_ctx WHERE k='cardM'), 'a0000000-0000-4000-8000-00000000000b');
RESET ROLE;
INSERT INTO league_ctx SELECT 'tokM2', data->>'token' FROM public.notifications
 WHERE type = 'league_marker_request' AND entity_id = (SELECT v::uuid FROM league_ctx WHERE k='cardM');
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM public.get_marker_card((SELECT v FROM league_ctx WHERE k='tokM1'));
  INSERT INTO league_smoke (name, ok, detail) VALUES ('re-request expires the old token', false, 'no error');
EXCEPTION WHEN others THEN
  INSERT INTO league_smoke (name, ok, detail) VALUES ('re-request expires the old token', SQLERRM = 'expired', SQLERRM);
END $$;

-- Remind: allowed once 20 h have passed, re-sends the same token, then refused again.
RESET ROLE;
UPDATE public.league_cards SET marker_requested_at = now() - interval '21 hours'
 WHERE id = (SELECT v::uuid FROM league_ctx WHERE k='cardM');
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE cid uuid := (SELECT v::uuid FROM league_ctx WHERE k='cardM'); r jsonb;
BEGIN
  r := public.remind_league_marker(cid);
  INSERT INTO league_smoke (name, ok, detail) VALUES ('remind after 21 h returns reminded_at',
    (r->>'reminded_at')::timestamptz = now(), r::text);
  BEGIN
    PERFORM public.remind_league_marker(cid);
    INSERT INTO league_smoke (name, ok, detail) VALUES ('a second remind the same day refused', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO league_smoke (name, ok, detail) VALUES ('a second remind the same day refused',
      SQLERRM = 'You can remind once a day.', SQLERRM);
  END;
END $$;
RESET ROLE;
INSERT INTO league_smoke (name, ok, detail)
SELECT 'remind re-sends one notification with the same token and stamps the card',
       count(*) = 1 AND bool_and(n.data->>'token' = (SELECT v FROM league_ctx WHERE k='tokM2')
                                 AND n.user_id = 'a0000000-0000-4000-8000-00000000000b')
       AND (SELECT marker_reminded_at = now() FROM public.league_cards WHERE id = (SELECT v::uuid FROM league_ctx WHERE k='cardM')),
       count(*)::text
  FROM public.notifications n WHERE n.type = 'league_marker_request' AND n.entity_id = (SELECT v::uuid FROM league_ctx WHERE k='cardM');

-- Resubmit ends the request and kills the token.
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT public.submit_league_card((SELECT v::uuid FROM league_ctx WHERE k='cardM'),
         (SELECT jsonb_object_agg(h::text, 4) FROM generate_series(1, 18) h), 72, 36, 20, NULL);
INSERT INTO league_smoke (name, ok, detail)
SELECT 'resubmit clears the marker request',
       marker_user_id IS NULL AND marker_name IS NULL AND marker_requested_at IS NULL AND marker_reminded_at IS NULL,
       COALESCE(marker_name, 'NULL')
  FROM public.league_cards WHERE id = (SELECT v::uuid FROM league_ctx WHERE k='cardM');
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
DO $$
BEGIN
  PERFORM public.get_marker_card((SELECT v FROM league_ctx WHERE k='tokM2'));
  INSERT INTO league_smoke (name, ok, detail) VALUES ('resubmit expires the marker''s token', false, 'no error');
EXCEPTION WHEN others THEN
  INSERT INTO league_smoke (name, ok, detail) VALUES ('resubmit expires the marker''s token', SQLERRM = 'expired', SQLERRM);
END $$;

-- Cancel: request again, then withdraw it.
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
SELECT public.request_league_marker((SELECT v::uuid FROM league_ctx WHERE k='cardM'), 'a0000000-0000-4000-8000-00000000000b');
SELECT public.cancel_league_marker_request((SELECT v::uuid FROM league_ctx WHERE k='cardM'));
INSERT INTO league_smoke (name, ok, detail)
SELECT 'cancel clears the request, its notification and pending',
       c.marker_user_id IS NULL AND c.marker_name IS NULL AND c.marker_requested_at IS NULL
       AND public.get_league_marker_candidates(c.id)->'pending' = 'null'::jsonb,
       COALESCE(c.marker_name, 'NULL')
  FROM public.league_cards c WHERE c.id = (SELECT v::uuid FROM league_ctx WHERE k='cardM');
RESET ROLE;
INSERT INTO league_smoke (name, ok, detail)
SELECT 'cancel deletes the notification and expires the bound token',
       NOT EXISTS (SELECT 1 FROM public.notifications WHERE type = 'league_marker_request' AND entity_id = (SELECT v::uuid FROM league_ctx WHERE k='cardM'))
       AND NOT EXISTS (SELECT 1 FROM public.league_marker_tokens
                        WHERE card_id = (SELECT v::uuid FROM league_ctx WHERE k='cardM')
                          AND used_at IS NULL AND expires_at > now()),
       NULL;

-- Showing a QR replaces a pending in-app request.
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT public.request_league_marker((SELECT v::uuid FROM league_ctx WHERE k='cardM'), 'a0000000-0000-4000-8000-00000000000b');
SELECT public.create_marker_token((SELECT v::uuid FROM league_ctx WHERE k='cardM'));
INSERT INTO league_smoke (name, ok, detail)
SELECT 'a QR clears the pending marker request',
       c.marker_user_id IS NULL AND c.marker_name IS NULL
       AND public.get_league_marker_candidates(c.id)->'pending' = 'null'::jsonb,
       COALESCE(c.marker_name, 'NULL')
  FROM public.league_cards c WHERE c.id = (SELECT v::uuid FROM league_ctx WHERE k='cardM');
RESET ROLE;
INSERT INTO league_smoke (name, ok, detail)
SELECT 'a QR deletes the request notification',
       NOT EXISTS (SELECT 1 FROM public.notifications WHERE type = 'league_marker_request' AND entity_id = (SELECT v::uuid FROM league_ctx WHERE k='cardM')),
       NULL;

-- Flag: the marker sends the card back.
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT public.request_league_marker((SELECT v::uuid FROM league_ctx WHERE k='cardM'), 'a0000000-0000-4000-8000-00000000000b');
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
INSERT INTO league_ctx SELECT 'tokM4', data->>'token' FROM public.notifications
 WHERE type = 'league_marker_request' AND entity_id = (SELECT v::uuid FROM league_ctx WHERE k='cardM');
DO $$
DECLARE r jsonb;
BEGIN
  r := public.confirm_marker_card((SELECT v FROM league_ctx WHERE k='tokM4'), 'Somebody Else', false, 'Hole 3 was a 5');
  INSERT INTO league_smoke (name, ok, detail) VALUES ('bound marker flags a hole -> returned', r->>'status' = 'returned', r::text);
END $$;
RESET ROLE;
INSERT INTO league_smoke (name, ok, detail)
SELECT 'flag: card stays submitted with the note and returned_at; request cleared',
       status = 'submitted' AND marker_note = 'Hole 3 was a 5' AND returned_at = now()
       AND marker_user_id IS NULL AND marker_name IS NULL AND marker_requested_at IS NULL,
       status
  FROM public.league_cards WHERE id = (SELECT v::uuid FROM league_ctx WHERE k='cardM');
INSERT INTO league_smoke (name, ok, detail)
SELECT 'flag notifies the owner with the game, signed with the marker''s profile name',
       count(*) = 1
       AND bool_and(user_id = 'a0000000-0000-4000-8000-00000000000a' AND actor_id = 'a0000000-0000-4000-8000-00000000000b'
                    AND data->>'tournament_id' = 't_lg_m' AND data->>'round_id' = 'r0'
                    AND data->>'actor_name' = 'Javi Test' AND data->>'note' = 'Hole 3 was a 5'),
       count(*)::text
  FROM public.notifications
 WHERE type = 'league_marker_issue' AND entity_id = (SELECT v::uuid FROM league_ctx WHERE k='cardM');

-- Confirm: the owner corrects, asks B again, B confirms.
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT public.submit_league_card((SELECT v::uuid FROM league_ctx WHERE k='cardM'),
         (SELECT jsonb_object_agg(h::text, 4) FROM generate_series(1, 18) h), 72, 36, 20, NULL);
SELECT public.request_league_marker((SELECT v::uuid FROM league_ctx WHERE k='cardM'), 'a0000000-0000-4000-8000-00000000000b');
SELECT set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
INSERT INTO league_ctx SELECT 'tokM5', data->>'token' FROM public.notifications
 WHERE type = 'league_marker_request' AND entity_id = (SELECT v::uuid FROM league_ctx WHERE k='cardM');
DO $$
DECLARE r jsonb;
BEGIN
  r := public.confirm_marker_card((SELECT v FROM league_ctx WHERE k='tokM5'), 'Somebody Else', true, NULL);
  INSERT INTO league_smoke (name, ok, detail) VALUES ('bound marker confirms', r->>'status' = 'confirmed', r::text);
END $$;
RESET ROLE;
INSERT INTO league_smoke (name, ok, detail)
SELECT 'card confirmed by the marker: confirmation marker, by B, request cleared',
       status = 'confirmed' AND confirmation = 'marker'
       AND confirmed_by_user = 'a0000000-0000-4000-8000-00000000000b' AND confirmed_by_name = 'Javi Test'
       AND marker_user_id IS NULL AND marker_name IS NULL AND marker_requested_at IS NULL AND marker_reminded_at IS NULL,
       status || '/' || COALESCE(confirmation, '-') || '/' || COALESCE(confirmed_by_name, '-')
  FROM public.league_cards WHERE id = (SELECT v::uuid FROM league_ctx WHERE k='cardM');
INSERT INTO league_smoke (name, ok, detail)
SELECT 'one league_marker_confirmed to the owner from the marker',
       count(*) = 1
       AND bool_and(user_id = 'a0000000-0000-4000-8000-00000000000a' AND actor_id = 'a0000000-0000-4000-8000-00000000000b'
                    AND data->>'card_id' = (SELECT v FROM league_ctx WHERE k='cardM')
                    AND data->>'league_name' = 'Marker league' AND data->>'course_name' = 'Marker Links'
                    AND data->>'month' = '2026-10-01' AND data->>'actor_name' = 'Javi Test'),
       count(*)::text
  FROM public.notifications WHERE type = 'league_marker_confirmed' AND entity_id = (SELECT v::uuid FROM league_ctx WHERE k='cardM');
INSERT INTO league_smoke (name, ok, detail)
SELECT 'the confirmation reaches the league as confirmed by marker',
       count(*) = 2 AND bool_and(data->>'confirmation' = 'marker' AND data->>'confirmed_by' = 'Javi Test'),
       count(*)::text
  FROM public.notifications
 WHERE type = 'league_card_confirmed' AND entity_id = (SELECT v::uuid FROM league_ctx WHERE k='cardM');

-- 12) Grants -------------------------------------------------------------------------------
RESET ROLE;
INSERT INTO league_smoke (name, ok, detail)
SELECT 'anon executes exactly get_marker_card + confirm_marker_card',
       COALESCE(array_agg(p.proname::text ORDER BY p.proname), '{}') = ARRAY['confirm_marker_card','get_marker_card'],
       array_agg(p.proname::text ORDER BY p.proname)::text
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('is_league_member','is_league_admin','can_read_league_proof','can_write_league_proof',
                     'league_is_member','league_is_admin','league_card_hash','get_league_members',
                     'league_new_invite_code','league_user_name','notify_league_members','league_canonical_holes',
                     'league_month_of','league_confirm_card','league_assert_open','league_settle_vote',
                     'set_league_role','archive_league','create_league','get_league_by_code','join_league',
                     'set_league_handicap','set_league_fee_paid','update_league_rules','leave_league',
                     'open_handicap_vote','cast_handicap_ballot','announce_league_card','notify_league_tee_off',
                     'submit_league_card','add_unannounced_league_card','confirm_league_card_by_partner',
                     'attach_league_proof','create_marker_token','get_marker_card','confirm_marker_card',
                     'void_league_card','record_league_final',
                     'league_num','league_course_rated','league_card_differential',
                     'league_net_differential','league_rated_course',
                     'league_marker_eligible','get_league_marker_candidates','request_league_marker',
                     'remind_league_marker','cancel_league_marker_request')
   AND has_function_privilege('anon', p.oid, 'EXECUTE');
INSERT INTO league_smoke (name, ok, detail)
SELECT 'authenticated cannot execute internal helpers',
       NOT bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')),
       string_agg(p.proname, ',') FILTER (WHERE has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('league_new_invite_code','league_user_name','notify_league_members',
                     'league_canonical_holes','league_month_of','league_confirm_card',
                     'league_assert_open','league_settle_vote','league_is_member','league_is_admin',
                     'league_card_hash','league_num','league_course_rated','league_card_differential',
                     'league_net_differential','league_rated_course','league_marker_eligible');
INSERT INTO league_smoke (name, ok, detail)
SELECT 'authenticated executes the four marker-request RPCs',
       count(*) = 4 AND bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE')),
       string_agg(p.proname, ',')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('get_league_marker_candidates','request_league_marker',
                     'remind_league_marker','cancel_league_marker_request');
INSERT INTO league_smoke (name, ok, detail)
SELECT 'anon has no privilege on league tables; authenticated has SELECT only',
       NOT bool_or(has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE'))
       AND NOT bool_or(has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE')),
       NULL
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r'
   AND c.relname IN ('leagues','league_members','league_handicap_events','league_handicap_votes',
                     'league_handicap_ballots','league_cards','league_marker_tokens','league_finals');
INSERT INTO league_smoke (name, ok, detail)
SELECT 'leave_league and set_league_role lock the league row first',
       bool_and(pg_get_functiondef(p.oid) LIKE '%FROM public.leagues WHERE id = p_league FOR UPDATE%'),
       string_agg(p.proname, ',')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN ('leave_league','set_league_role');
INSERT INTO league_smoke (name, ok, detail)
SELECT 'league-proofs bucket is private', NOT public, public::text FROM storage.buckets WHERE id = 'league-proofs';

-- Verdict ------------------------------------------------------------------------------------
DO $$
DECLARE v_failed text;
BEGIN
  SELECT string_agg(name || ' [' || COALESCE(detail, '') || ']', E'\n' ORDER BY seq) INTO v_failed
    FROM league_smoke WHERE ok IS NOT TRUE;
  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION E'leagues smoke failed:\n%', v_failed;
  END IF;
END $$;

SELECT seq, name, ok FROM league_smoke ORDER BY seq;

ROLLBACK;
