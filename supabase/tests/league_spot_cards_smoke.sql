-- ============================================================================
-- Smoke test for 20261024000000_league_spot_cards.sql — a card held on an
-- invitee spot moves to the player when they claim the spot.
--
-- Same conventions as leagues_smoke.sql: plain SQL, one row per check in the
-- temp table `spot_smoke`, a final DO block RAISEs listing every failure, and
-- the whole run is one transaction ending in ROLLBACK.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/league_spot_cards_smoke.sql
--
-- Cast: A Marcos Admin (admin), P a real account claiming "Peláez Spot",
-- Q a real account claiming "Busy Spot" after already posting that month,
-- E an outsider.
-- The card is José María Peláez's October 2026 card at Centro Nacional,
-- yellow tees (CR 69.2 / slope 127, par 72), league handicap 18.0:
-- playing handicap 17, 89 gross, 36 points.
-- ============================================================================

BEGIN;

CREATE TEMP TABLE spot_smoke (seq serial, name text, ok boolean, detail text) ON COMMIT DROP;
CREATE TEMP TABLE spot_ctx (k text PRIMARY KEY, v text) ON COMMIT DROP;
GRANT ALL ON spot_smoke, spot_ctx TO authenticated, anon;
GRANT USAGE ON SEQUENCE spot_smoke_seq_seq TO authenticated, anon;

INSERT INTO auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at)
SELECT u.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       u.email, false, now(), now()
  FROM (VALUES ('d0000000-0000-4000-8000-00000000000a', 'spot-smoke-a@example.invalid'),
               ('d0000000-0000-4000-8000-00000000000b', 'spot-smoke-p@example.invalid'),
               ('d0000000-0000-4000-8000-00000000000c', 'spot-smoke-q@example.invalid'),
               ('d0000000-0000-4000-8000-00000000000e', 'spot-smoke-e@example.invalid')) u(id, email);

INSERT INTO public.profiles (user_id, display_name)
VALUES ('d0000000-0000-4000-8000-00000000000a', 'Marcos Admin'),
       ('d0000000-0000-4000-8000-00000000000b', 'Pela Real'),
       ('d0000000-0000-4000-8000-00000000000c', 'Quique Real'),
       ('d0000000-0000-4000-8000-00000000000e', 'Eve Outsider')
ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name;

-- 1) A creates the league with two spots ---------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-00000000000a","role":"authenticated","is_anonymous":false}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE r jsonb;
BEGIN
  r := public.create_league('Spot Smoke League', '2026-10-01', '2027-05-31', NULL, 30, 0,
         '[{"user_id":"d0000000-0000-4000-8000-00000000000a","handicap":14},
           {"name":"Peláez Spot","handicap":18},
           {"name":"Busy Spot","handicap":20}]'::jsonb, 0, 'stableford');
  INSERT INTO spot_ctx VALUES ('code', r->>'invite_code'), ('league', r->>'id');
END $$;
RESET ROLE;

-- 2) The admin's cards are held on the spots (service role, as the load script) -------
DO $$
DECLARE
  v_league uuid := (SELECT v FROM spot_ctx WHERE k='league')::uuid;
  v_course jsonb := jsonb_build_object(
    'course_id', NULL, 'name', 'Centro Nacional de Golf', 'tee', 'Amarillas',
    'slope', 127, 'rating', 69.2,
    'holes', (SELECT jsonb_agg(jsonb_build_object('n', n, 'par', par, 'si', si) ORDER BY n)
                FROM unnest(ARRAY[5,4,3,4,5,4,4,4,3,5,4,4,4,3,4,5,3,4],
                            ARRAY[4,10,18,6,2,12,14,8,16,3,9,5,13,17,11,1,15,7])
                     WITH ORDINALITY AS h(par, si, n)));
  v_holes jsonb := (SELECT jsonb_object_agg(n::text, s)
                      FROM unnest(ARRAY[6,6,3,4,7,6,4,6,4,6,5,5,5,3,5,7,3,4]) WITH ORDINALITY AS x(s, n));
  v_spot uuid;
  v_id uuid;
BEGIN
  SELECT id INTO v_spot FROM public.league_invitees WHERE league_id = v_league AND name = 'Peláez Spot';
  INSERT INTO spot_ctx VALUES ('spot', v_spot::text);
  INSERT INTO public.league_spot_cards (league_id, invitee_id, course, played_on, holes, proof_path, added_by)
  VALUES (v_league, v_spot, v_course, '2026-10-02', v_holes, 'x', 'd0000000-0000-4000-8000-00000000000a')
  RETURNING id INTO v_id;
  UPDATE public.league_spot_cards SET proof_path = v_league || '/' || v_id || '.jpg' WHERE id = v_id;
  INSERT INTO spot_ctx VALUES ('card', v_id::text), ('course', v_course::text), ('holes', v_holes::text);

  SELECT id INTO v_spot FROM public.league_invitees WHERE league_id = v_league AND name = 'Busy Spot';
  INSERT INTO public.league_spot_cards (league_id, invitee_id, course, played_on, holes, proof_path, added_by)
  VALUES (v_league, v_spot, v_course, '2026-10-12', v_holes, v_league || '/busy.jpg', 'd0000000-0000-4000-8000-00000000000a')
  RETURNING id INTO v_id;
  INSERT INTO spot_ctx VALUES ('busy', v_id::text);

  BEGIN
    INSERT INTO public.league_spot_cards (league_id, invitee_id, course, played_on, holes, proof_path, added_by)
    VALUES (v_league, v_spot, v_course, '2026-10-20', v_holes, 'y', NULL);
    INSERT INTO spot_smoke (name, ok) VALUES ('second card for a spot in a month refused', false);
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO spot_smoke (name, ok) VALUES ('second card for a spot in a month refused', true);
  END;
END $$;

-- 3) Nobody but the service role reads the held cards ---------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-00000000000a","role":"authenticated","is_anonymous":false}', true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM 1 FROM public.league_spot_cards;
  INSERT INTO spot_smoke (name, ok) VALUES ('admin cannot read league_spot_cards', false);
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO spot_smoke (name, ok) VALUES ('admin cannot read league_spot_cards', true);
END $$;
DO $$
BEGIN
  PERFORM public.league_move_spot_cards(gen_random_uuid(), 'd0000000-0000-4000-8000-00000000000a');
  INSERT INTO spot_smoke (name, ok) VALUES ('league_move_spot_cards not callable', false);
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO spot_smoke (name, ok) VALUES ('league_move_spot_cards not callable', true);
END $$;
RESET ROLE;

-- 4) Before anyone joins, the league has no cards --------------------------------------
INSERT INTO spot_smoke (name, ok, detail)
SELECT 'no league card before the claim', count(*) = 0, count(*)::text
  FROM public.league_cards WHERE league_id = (SELECT v FROM spot_ctx WHERE k='league')::uuid;

-- 5) Q already has an October card when claiming "Busy Spot" -----------------------------
-- (Q joins plainly first, posts a card the service way, then claims the spot.)
SELECT set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-00000000000c","role":"authenticated","is_anonymous":false}', true);
SET LOCAL ROLE authenticated;
SELECT public.join_league((SELECT v FROM spot_ctx WHERE k='code'), NULL, NULL, NULL::uuid);
RESET ROLE;
INSERT INTO public.league_cards (league_id, user_id, month, source, status, played_on, not_announced, holes, points)
VALUES ((SELECT v FROM spot_ctx WHERE k='league')::uuid, 'd0000000-0000-4000-8000-00000000000c', '2026-10-01',
        'offapp', 'confirmed', '2026-10-05', true, '{}'::jsonb, 30);
UPDATE public.league_invitees SET claimed_by = 'd0000000-0000-4000-8000-00000000000c', claimed_at = now()
 WHERE league_id = (SELECT v FROM spot_ctx WHERE k='league')::uuid AND name = 'Busy Spot';
INSERT INTO spot_smoke (name, ok, detail)
SELECT 'a month the member already has stays on the spot',
       count(*) = 1 AND bool_and(points = 30)
       AND (SELECT moved_at IS NULL FROM public.league_spot_cards WHERE id = (SELECT v FROM spot_ctx WHERE k='busy')::uuid),
       count(*)::text
  FROM public.league_cards
 WHERE league_id = (SELECT v FROM spot_ctx WHERE k='league')::uuid AND user_id = 'd0000000-0000-4000-8000-00000000000c';

-- 6) P claims "Peláez Spot" through join_league ------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-00000000000b","role":"authenticated","is_anonymous":false}', true);
SET LOCAL ROLE authenticated;
SELECT public.join_league((SELECT v FROM spot_ctx WHERE k='code'), NULL, NULL,
  (SELECT v FROM spot_ctx WHERE k='spot')::uuid);
RESET ROLE;

INSERT INTO spot_smoke (name, ok, detail)
SELECT 'claimed card moved, scored and confirmed',
       c.user_id = 'd0000000-0000-4000-8000-00000000000b'
       AND c.month = '2026-10-01' AND c.played_on = '2026-10-02'
       AND c.status = 'confirmed' AND c.confirmation = 'photo' AND c.source = 'offapp'
       AND c.league_handicap = 18.0 AND c.playing_handicap = 17
       AND c.gross = 89 AND c.points = 36
       AND c.approved_at IS NOT NULL AND c.approved_by = 'd0000000-0000-4000-8000-00000000000a'
       AND c.confirmed_by_user = 'd0000000-0000-4000-8000-00000000000a'
       AND c.not_announced AND c.tee_verified
       AND c.proof_path = c.league_id || '/' || c.id || '.jpg'
       AND c.differential IS NOT NULL,
       format('hcp %s ph %s gross %s pts %s status %s', c.league_handicap, c.playing_handicap, c.gross, c.points, c.status)
  FROM public.league_cards c WHERE c.id = (SELECT v FROM spot_ctx WHERE k='card')::uuid;

INSERT INTO spot_smoke (name, ok, detail)
SELECT 'timeline: added, confirmed, approved by the admin',
       array_agg(kind ORDER BY kind) = ARRAY['added','approved','confirmed']
       AND bool_and(actor_user_id = 'd0000000-0000-4000-8000-00000000000a'),
       array_agg(kind ORDER BY kind)::text
  FROM public.league_card_events WHERE card_id = (SELECT v FROM spot_ctx WHERE k='card')::uuid;

INSERT INTO spot_smoke (name, ok)
SELECT 'held card marked moved', moved_at IS NOT NULL AND moved_to = 'd0000000-0000-4000-8000-00000000000b'
  FROM public.league_spot_cards WHERE id = (SELECT v FROM spot_ctx WHERE k='card')::uuid;

INSERT INTO spot_smoke (name, ok, detail)
SELECT 'server score matches league_card_score', c.points = (s ->> 'points')::int, s::text
  FROM public.league_cards c,
       LATERAL (SELECT public.league_card_score(c.holes, c.course, 18.0) AS s) x
 WHERE c.id = (SELECT v FROM spot_ctx WHERE k='card')::uuid;

-- 7) A member reads the moved card; an outsider doesn't --------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-00000000000a","role":"authenticated","is_anonymous":false}', true);
SET LOCAL ROLE authenticated;
INSERT INTO spot_smoke (name, ok)
SELECT 'admin sees the moved card', count(*) = 1
  FROM public.league_cards WHERE id = (SELECT v FROM spot_ctx WHERE k='card')::uuid;
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-00000000000e","role":"authenticated","is_anonymous":false}', true);
SET LOCAL ROLE authenticated;
INSERT INTO spot_smoke (name, ok)
SELECT 'outsider does not see it', count(*) = 0
  FROM public.league_cards WHERE id = (SELECT v FROM spot_ctx WHERE k='card')::uuid;
RESET ROLE;

-- 8) Running the move again changes nothing ---------------------------------------------
INSERT INTO spot_smoke (name, ok)
SELECT 'second move is a no-op',
       public.league_move_spot_cards(id, 'd0000000-0000-4000-8000-00000000000b') = 0
  FROM public.league_invitees
 WHERE league_id = (SELECT v FROM spot_ctx WHERE k='league')::uuid AND name = 'Peláez Spot';

DO $$
DECLARE v_fail text;
BEGIN
  SELECT string_agg(format('%s (%s)', name, COALESCE(detail, '')), '; ') INTO v_fail FROM spot_smoke WHERE NOT ok;
  IF v_fail IS NOT NULL THEN RAISE EXCEPTION 'league_spot_cards smoke failed: %', v_fail; END IF;
END $$;

SELECT seq, name, ok FROM spot_smoke ORDER BY seq;

ROLLBACK;
