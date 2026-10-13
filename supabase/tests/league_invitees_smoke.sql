-- ============================================================================
-- Smoke test for 20261014000000_league_invitees.sql — reserved spots for
-- people not in the app: create_league with named entries, the spot list on
-- the invite preview, claiming a spot through join_league, and the admin's
-- list/remove RPCs.
--
-- Same conventions as leagues_smoke.sql: plain SQL, one row per check in the
-- temp table `inv_smoke`, a final DO block RAISEs listing every failure, and
-- the whole run is one transaction ending in ROLLBACK.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/league_invitees_smoke.sql
--
-- Cast: A Marcos Admin (admin, real), G a guest, H a second guest,
-- N a real account "Nora Real", P a real account who proposes a handicap,
-- Q a real account joining without a spot, E an outsider.
-- ============================================================================

BEGIN;

CREATE TEMP TABLE inv_smoke (seq serial, name text, ok boolean, detail text) ON COMMIT DROP;
CREATE TEMP TABLE inv_ctx (k text PRIMARY KEY, v text) ON COMMIT DROP;
GRANT ALL ON inv_smoke, inv_ctx TO authenticated, anon;
GRANT USAGE ON SEQUENCE inv_smoke_seq_seq TO authenticated, anon;

INSERT INTO auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at)
SELECT u.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       u.email, u.anon, now(), now()
  FROM (VALUES ('c0000000-0000-4000-8000-00000000000a', 'inv-smoke-a@example.invalid', false),
               ('c0000000-0000-4000-8000-000000000001', NULL,                          true),
               ('c0000000-0000-4000-8000-000000000002', NULL,                          true),
               ('c0000000-0000-4000-8000-00000000000d', 'inv-smoke-n@example.invalid', false),
               ('c0000000-0000-4000-8000-00000000000b', 'inv-smoke-p@example.invalid', false),
               ('c0000000-0000-4000-8000-00000000000c', 'inv-smoke-q@example.invalid', false),
               ('c0000000-0000-4000-8000-00000000000e', 'inv-smoke-e@example.invalid', false)) u(id, email, anon);

INSERT INTO public.profiles (user_id, display_name)
VALUES ('c0000000-0000-4000-8000-00000000000a', 'Marcos Admin'),
       ('c0000000-0000-4000-8000-000000000001', NULL),
       ('c0000000-0000-4000-8000-000000000002', NULL),
       ('c0000000-0000-4000-8000-00000000000d', 'Nora Real'),
       ('c0000000-0000-4000-8000-00000000000b', 'Pedro Real'),
       ('c0000000-0000-4000-8000-00000000000c', 'Quique Real'),
       ('c0000000-0000-4000-8000-00000000000e', 'Eve Outsider')
ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name;

-- 1) A creates a league (cap 28) with five named spots ------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-00000000000a","role":"authenticated","is_anonymous":false}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE r jsonb;
BEGIN
  r := public.create_league('Invitee Smoke League', '2026-01-01', '2026-12-31', NULL, 28, 0,
         '[{"user_id":"c0000000-0000-4000-8000-00000000000a","handicap":10},
           {"name":"  Pablo Spot ","handicap":18},
           {"name":"Nora Spot","handicap":12},
           {"name":"Pedro Spot","handicap":40},
           {"name":"Remove Me","handicap":9},
           {"name":"Archived Later"}]'::jsonb);
  INSERT INTO inv_ctx VALUES ('code', r->>'invite_code'), ('league', r->>'id');
  r := public.create_league('Other Smoke League', '2026-01-01', '2026-12-31', NULL, 30, 0, '[]'::jsonb);
  INSERT INTO inv_ctx VALUES ('code2', r->>'invite_code'), ('league2', r->>'id');
END $$;

DO $$
BEGIN
  PERFORM public.create_league('Bad', '2026-01-01', '2026-12-31', NULL, 30, 0,
            '[{"name":"   ","handicap":10}]'::jsonb);
  INSERT INTO inv_smoke (name, ok, detail) VALUES ('create_league refuses a blank spot name', false, 'no error');
EXCEPTION WHEN others THEN
  INSERT INTO inv_smoke (name, ok, detail) VALUES ('create_league refuses a blank spot name',
    SQLERRM = 'Each player needs a name.', SQLERRM);
END $$;

RESET ROLE;
INSERT INTO inv_smoke (name, ok, detail)
SELECT 'create_league stores spots: trimmed names, handicap clamped to cap, by the creator',
       count(*) = 5
   AND bool_and(created_by = 'c0000000-0000-4000-8000-00000000000a' AND claimed_by IS NULL)
   AND bool_or(name = 'Pablo Spot' AND handicap = 18.0)
   AND bool_or(name = 'Pedro Spot' AND handicap = 28.0)
   AND bool_or(name = 'Archived Later' AND handicap IS NULL),
       string_agg(name || '=' || COALESCE(handicap::text, 'null'), ', ')
  FROM public.league_invitees WHERE league_id = (SELECT v::uuid FROM inv_ctx WHERE k='league');
INSERT INTO inv_smoke (name, ok, detail)
SELECT 'spots add no member rows and no handicap events',
       (SELECT count(*) FROM public.league_members WHERE league_id = (SELECT v::uuid FROM inv_ctx WHERE k='league')) = 1
   AND (SELECT count(*) FROM public.league_handicap_events WHERE league_id = (SELECT v::uuid FROM inv_ctx WHERE k='league')) = 1,
       NULL;
INSERT INTO inv_ctx SELECT 'inv:' || name, id::text FROM public.league_invitees
 WHERE league_id = (SELECT v::uuid FROM inv_ctx WHERE k='league');

-- 2) anon: preview lists unclaimed spots by name; one spot's greeting --------------------
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
DO $$
DECLARE r jsonb; i jsonb;
BEGIN
  r := public.get_league_invite_preview((SELECT v FROM inv_ctx WHERE k='code'));
  INSERT INTO inv_smoke (name, ok, detail) VALUES ('preview: invitees sorted by name, {id,name} only',
    (SELECT array_agg(e->>'name' ORDER BY o) FROM jsonb_array_elements(r->'invitees') WITH ORDINALITY x(e, o))
      = ARRAY['Archived Later','Nora Spot','Pablo Spot','Pedro Spot','Remove Me']
    AND (SELECT bool_and((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(e) k) = ARRAY['id','name'])
           FROM jsonb_array_elements(r->'invitees') e),
    r->>'invitees');
  INSERT INTO inv_smoke (name, ok, detail) VALUES ('preview: no handicap anywhere in the invitees',
    position('handicap' IN (r->'invitees')::text) = 0, NULL);

  i := public.get_league_invitee(lower((SELECT v FROM inv_ctx WHERE k='code')),
                                 (SELECT v::uuid FROM inv_ctx WHERE k='inv:Pablo Spot'));
  INSERT INTO inv_smoke (name, ok, detail) VALUES ('get_league_invitee: {id,name,handicap,claimed}',
    i->>'id' = (SELECT v FROM inv_ctx WHERE k='inv:Pablo Spot') AND i->>'name' = 'Pablo Spot'
      AND (i->>'handicap')::numeric = 18 AND (i->>'claimed')::boolean = false
      AND (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(i) k) = ARRAY['claimed','handicap','id','name'],
    i::text);
  INSERT INTO inv_smoke (name, ok, detail) VALUES ('get_league_invitee: other league''s code / unknown spot / bad code -> NULL',
    public.get_league_invitee((SELECT v FROM inv_ctx WHERE k='code2'), (SELECT v::uuid FROM inv_ctx WHERE k='inv:Pablo Spot')) IS NULL
      AND public.get_league_invitee((SELECT v FROM inv_ctx WHERE k='code'), gen_random_uuid()) IS NULL
      AND public.get_league_invitee('ZZZZZZZZ', (SELECT v::uuid FROM inv_ctx WHERE k='inv:Pablo Spot')) IS NULL,
    NULL);
END $$;

DO $$
BEGIN
  PERFORM * FROM public.get_league_invitees((SELECT v::uuid FROM inv_ctx WHERE k='league'));
  INSERT INTO inv_smoke (name, ok, detail) VALUES ('anon cannot call get_league_invitees', false, 'no error');
EXCEPTION WHEN others THEN
  INSERT INTO inv_smoke (name, ok, detail) VALUES ('anon cannot call get_league_invitees', SQLSTATE = '42501', SQLERRM);
END $$;

DO $$
BEGIN
  PERFORM count(*) FROM public.league_invitees;
  INSERT INTO inv_smoke (name, ok, detail) VALUES ('anon cannot read league_invitees', false, 'no error');
EXCEPTION WHEN others THEN
  INSERT INTO inv_smoke (name, ok, detail) VALUES ('anon cannot read league_invitees', SQLSTATE = '42501', SQLERRM);
END $$;

-- 3) Guest G claims Pablo's spot without typing a name -------------------------------------
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}', true);
SET LOCAL ROLE authenticated;
SELECT public.join_league((SELECT v FROM inv_ctx WHERE k='code'), NULL, NULL,
                          (SELECT v::uuid FROM inv_ctx WHERE k='inv:Pablo Spot'));
-- Re-claiming your own spot is idempotent.
SELECT public.join_league((SELECT v FROM inv_ctx WHERE k='code'), NULL, NULL,
                          (SELECT v::uuid FROM inv_ctx WHERE k='inv:Pablo Spot'));

DO $$
BEGIN
  PERFORM public.join_league((SELECT v FROM inv_ctx WHERE k='code'), NULL, NULL,
                             (SELECT v::uuid FROM inv_ctx WHERE k='inv:Nora Spot'));
  INSERT INTO inv_smoke (name, ok, detail) VALUES ('one user cannot claim a second spot in a league', false, 'no error');
EXCEPTION WHEN others THEN
  -- 20261016000000 (R15): an active member can't take a spot at all.
  INSERT INTO inv_smoke (name, ok, detail) VALUES ('one user cannot claim a second spot in a league',
    SQLERRM = 'You are already in this league, so you can''t take Nora Spot''s spot.', SQLERRM);
END $$;

DO $$
BEGIN
  PERFORM public.join_league((SELECT v FROM inv_ctx WHERE k='code2'), NULL, NULL,
                             (SELECT v::uuid FROM inv_ctx WHERE k='inv:Nora Spot'));
  INSERT INTO inv_smoke (name, ok, detail) VALUES ('a spot from another league is refused', false, 'no error');
EXCEPTION WHEN others THEN
  INSERT INTO inv_smoke (name, ok, detail) VALUES ('a spot from another league is refused',
    SQLERRM = 'That spot is not in this league.', SQLERRM);
END $$;

RESET ROLE;
INSERT INTO inv_smoke (name, ok, detail)
SELECT 'guest claim: joined with the admin handicap, named after the spot, spot claimed',
       m.joined_at IS NOT NULL AND m.league_handicap = 18.0 AND p.display_name = 'Pablo Spot'
   AND i.claimed_by = m.user_id AND i.claimed_at IS NOT NULL,
       concat_ws(' / ', m.league_handicap, p.display_name, i.claimed_by)
  FROM public.league_members m
  JOIN public.profiles p ON p.user_id = m.user_id
  JOIN public.league_invitees i ON i.id = (SELECT v::uuid FROM inv_ctx WHERE k='inv:Pablo Spot')
 WHERE m.league_id = (SELECT v::uuid FROM inv_ctx WHERE k='league')
   AND m.user_id = 'c0000000-0000-4000-8000-000000000001';
INSERT INTO inv_smoke (name, ok, detail)
-- 20261016000000 (R15): the claim is logged as the claimer's.
SELECT 'guest claim: exactly one ''set'' event, by the claimer (re-claim added none)',
       count(*) = 1 AND bool_and(reason = 'set' AND old IS NULL AND new = 18.0
                                 AND by_user = 'c0000000-0000-4000-8000-000000000001'),
       string_agg(reason || ':' || COALESCE(old::text, 'null') || '->' || new, ', ')
  FROM public.league_handicap_events
 WHERE league_id = (SELECT v::uuid FROM inv_ctx WHERE k='league')
   AND user_id = 'c0000000-0000-4000-8000-000000000001';

-- 4) A second guest cannot take the same spot; the spot is gone from the lists -------------
SELECT set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":true}', true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM public.join_league((SELECT v FROM inv_ctx WHERE k='code'), NULL, NULL,
                             (SELECT v::uuid FROM inv_ctx WHERE k='inv:Pablo Spot'));
  INSERT INTO inv_smoke (name, ok, detail) VALUES ('a claimed spot is refused to someone else', false, 'no error');
EXCEPTION WHEN others THEN
  INSERT INTO inv_smoke (name, ok, detail) VALUES ('a claimed spot is refused to someone else',
    SQLERRM = 'Someone already joined as Pablo Spot.' AND SQLSTATE = 'P0001', SQLERRM);
END $$;

DO $$
DECLARE r jsonb;
BEGIN
  r := public.get_league_by_code((SELECT v FROM inv_ctx WHERE k='code'));
  INSERT INTO inv_smoke (name, ok, detail) VALUES ('get_league_by_code: invitees = unclaimed spots as {id,name}',
    (SELECT array_agg(e->>'name' ORDER BY o) FROM jsonb_array_elements(r->'invitees') WITH ORDINALITY x(e, o))
      = ARRAY['Archived Later','Nora Spot','Pedro Spot','Remove Me']
    AND (SELECT bool_and((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(e) k) = ARRAY['id','name'])
           FROM jsonb_array_elements(r->'invitees') e),
    r->>'invitees');
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
DO $$
DECLARE r jsonb;
BEGIN
  r := public.get_league_invite_preview((SELECT v FROM inv_ctx WHERE k='code'));
  INSERT INTO inv_smoke (name, ok, detail) VALUES ('preview no longer lists the claimed spot',
    NOT (r->'invitees') @> jsonb_build_array(jsonb_build_object('name', 'Pablo Spot'))
      AND jsonb_array_length(r->'invitees') = 4, r->>'invitees');
  INSERT INTO inv_smoke (name, ok, detail) VALUES ('get_league_invitee reports the spot claimed',
    (public.get_league_invitee((SELECT v FROM inv_ctx WHERE k='code'),
                               (SELECT v::uuid FROM inv_ctx WHERE k='inv:Pablo Spot'))->>'claimed')::boolean, NULL);
END $$;

-- 5) Real accounts ------------------------------------------------------------------------
RESET ROLE;
SET LOCAL ROLE authenticated;
-- N claims Nora Spot passing the spot name: their account name stays.
SELECT set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-00000000000d","role":"authenticated","is_anonymous":false}', true);
SELECT public.join_league((SELECT v FROM inv_ctx WHERE k='code'), NULL, 'Nora Spot',
                          (SELECT v::uuid FROM inv_ctx WHERE k='inv:Nora Spot'));
-- P claims Pedro Spot (28 after the cap) and proposes 20.
SELECT set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-00000000000b","role":"authenticated","is_anonymous":false}', true);
SELECT public.join_league((SELECT v FROM inv_ctx WHERE k='code'), 20, NULL,
                          (SELECT v::uuid FROM inv_ctx WHERE k='inv:Pedro Spot'));
-- Q joins the old way (two positional arguments, no spot).
SELECT set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-00000000000c","role":"authenticated","is_anonymous":false}', true);
SELECT public.join_league((SELECT v FROM inv_ctx WHERE k='code'), 15);

RESET ROLE;
INSERT INTO inv_smoke (name, ok, detail)
SELECT 'real account claims a spot: own name kept, admin handicap taken',
       p.display_name = 'Nora Real' AND m.league_handicap = 12.0 AND i.claimed_by = m.user_id,
       concat_ws(' / ', p.display_name, m.league_handicap)
  FROM public.league_members m
  JOIN public.profiles p ON p.user_id = m.user_id
  JOIN public.league_invitees i ON i.id = (SELECT v::uuid FROM inv_ctx WHERE k='inv:Nora Spot')
 WHERE m.league_id = (SELECT v::uuid FROM inv_ctx WHERE k='league')
   AND m.user_id = 'c0000000-0000-4000-8000-00000000000d';
INSERT INTO inv_smoke (name, ok, detail)
SELECT 'claim + different proposed handicap: admin value kept, set then proposed events',
       (SELECT league_handicap FROM public.league_members
         WHERE league_id = (SELECT v::uuid FROM inv_ctx WHERE k='league')
           AND user_id = 'c0000000-0000-4000-8000-00000000000b') = 28.0
   AND array_agg(reason || ':' || COALESCE(old::text, 'null') || '->' || new || ':' || by_user ORDER BY at, reason DESC)
       = ARRAY['set:null->28.0:c0000000-0000-4000-8000-00000000000b',
               'proposed:28.0->20.0:c0000000-0000-4000-8000-00000000000b'],
       array_agg(reason || ':' || COALESCE(old::text, 'null') || '->' || new ORDER BY at, reason DESC)::text
  FROM public.league_handicap_events
 WHERE league_id = (SELECT v::uuid FROM inv_ctx WHERE k='league')
   AND user_id = 'c0000000-0000-4000-8000-00000000000b';
INSERT INTO inv_smoke (name, ok, detail)
SELECT 'join without a spot is unchanged: own handicap, one proposed event, no spot claimed',
       (SELECT league_handicap FROM public.league_members
         WHERE league_id = (SELECT v::uuid FROM inv_ctx WHERE k='league')
           AND user_id = 'c0000000-0000-4000-8000-00000000000c') = 15.0
   AND (SELECT count(*) FROM public.league_handicap_events
         WHERE league_id = (SELECT v::uuid FROM inv_ctx WHERE k='league')
           AND user_id = 'c0000000-0000-4000-8000-00000000000c'
           AND reason = 'proposed' AND old IS NULL AND new = 15.0) = 1
   AND NOT EXISTS (SELECT 1 FROM public.league_invitees WHERE claimed_by = 'c0000000-0000-4000-8000-00000000000c'),
       NULL;

-- 6) get_league_invitees: members only ------------------------------------------------------
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_names text[]; v_rem numeric;
BEGIN
  SELECT array_agg(name ORDER BY name) INTO v_names
    FROM public.get_league_invitees((SELECT v::uuid FROM inv_ctx WHERE k='league'));
  SELECT handicap INTO v_rem
    FROM public.get_league_invitees((SELECT v::uuid FROM inv_ctx WHERE k='league')) WHERE name = 'Remove Me';
  INSERT INTO inv_smoke (name, ok, detail) VALUES ('member sees the unclaimed spots with handicaps',
    v_names = ARRAY['Archived Later','Remove Me'] AND v_rem = 9.0, v_names::text || ' / ' || v_rem);
END $$;

SELECT set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-00000000000e","role":"authenticated","is_anonymous":false}', true);
DO $$
BEGIN
  PERFORM * FROM public.get_league_invitees((SELECT v::uuid FROM inv_ctx WHERE k='league'));
  INSERT INTO inv_smoke (name, ok, detail) VALUES ('outsider cannot list spots', false, 'no error');
EXCEPTION WHEN others THEN
  INSERT INTO inv_smoke (name, ok, detail) VALUES ('outsider cannot list spots', SQLSTATE = '42501', SQLERRM);
END $$;

DO $$
BEGIN
  PERFORM count(*) FROM public.league_invitees;
  INSERT INTO inv_smoke (name, ok, detail) VALUES ('authenticated cannot read league_invitees directly', false, 'no error');
EXCEPTION WHEN others THEN
  INSERT INTO inv_smoke (name, ok, detail) VALUES ('authenticated cannot read league_invitees directly', SQLSTATE = '42501', SQLERRM);
END $$;

-- 7) remove_league_invitee: admin only, unclaimed only ---------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-00000000000c","role":"authenticated","is_anonymous":false}', true);
DO $$
BEGIN
  PERFORM public.remove_league_invitee((SELECT v::uuid FROM inv_ctx WHERE k='league'),
                                       (SELECT v::uuid FROM inv_ctx WHERE k='inv:Remove Me'));
  INSERT INTO inv_smoke (name, ok, detail) VALUES ('a member cannot remove a spot', false, 'no error');
EXCEPTION WHEN others THEN
  INSERT INTO inv_smoke (name, ok, detail) VALUES ('a member cannot remove a spot', SQLSTATE = '42501', SQLERRM);
END $$;

SELECT set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-00000000000a","role":"authenticated","is_anonymous":false}', true);
DO $$
BEGIN
  PERFORM public.remove_league_invitee((SELECT v::uuid FROM inv_ctx WHERE k='league'),
                                       (SELECT v::uuid FROM inv_ctx WHERE k='inv:Pablo Spot'));
  INSERT INTO inv_smoke (name, ok, detail) VALUES ('admin cannot remove a claimed spot', false, 'no error');
EXCEPTION WHEN others THEN
  INSERT INTO inv_smoke (name, ok, detail) VALUES ('admin cannot remove a claimed spot',
    SQLERRM = 'That player already joined.', SQLERRM);
END $$;

SELECT public.remove_league_invitee((SELECT v::uuid FROM inv_ctx WHERE k='league'),
                                    (SELECT v::uuid FROM inv_ctx WHERE k='inv:Remove Me'));
INSERT INTO inv_smoke (name, ok, detail)
SELECT 'admin removes an unclaimed spot',
       NOT EXISTS (SELECT 1 FROM public.get_league_invitees((SELECT v::uuid FROM inv_ctx WHERE k='league'))
                    WHERE name = 'Remove Me'), NULL;

-- 8) Archived league ----------------------------------------------------------------------
SELECT public.archive_league((SELECT v::uuid FROM inv_ctx WHERE k='league'));
DO $$
BEGIN
  PERFORM public.remove_league_invitee((SELECT v::uuid FROM inv_ctx WHERE k='league'),
                                       (SELECT v::uuid FROM inv_ctx WHERE k='inv:Archived Later'));
  INSERT INTO inv_smoke (name, ok, detail) VALUES ('archived league refuses removing a spot', false, 'no error');
EXCEPTION WHEN others THEN
  INSERT INTO inv_smoke (name, ok, detail) VALUES ('archived league refuses removing a spot',
    SQLERRM LIKE 'This league has been archived.%', SQLERRM);
END $$;

SELECT set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":true}', true);
DO $$
BEGIN
  PERFORM public.join_league((SELECT v FROM inv_ctx WHERE k='code'), NULL, NULL,
                             (SELECT v::uuid FROM inv_ctx WHERE k='inv:Archived Later'));
  INSERT INTO inv_smoke (name, ok, detail) VALUES ('archived league refuses claiming a spot', false, 'no error');
EXCEPTION WHEN others THEN
  INSERT INTO inv_smoke (name, ok, detail) VALUES ('archived league refuses claiming a spot',
    SQLERRM = 'This league has been archived.', SQLERRM);
END $$;

-- 9) Shape and grants -----------------------------------------------------------------------
RESET ROLE;
INSERT INTO inv_smoke (name, ok, detail)
SELECT 'join_league has exactly one signature, with the invitee parameter',
       count(*) = 1 AND bool_and(pg_get_function_identity_arguments(p.oid)
         = 'p_code text, p_proposed_handicap numeric, p_display_name text, p_invitee uuid'),
       string_agg(pg_get_function_identity_arguments(p.oid), ' | ')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'join_league';
INSERT INTO inv_smoke (name, ok, detail)
SELECT 'grants: anon previews and greets only; authenticated runs the rest',
       has_function_privilege('anon', 'public.get_league_invite_preview(text)', 'EXECUTE')
   AND has_function_privilege('anon', 'public.get_league_invitee(text, uuid)', 'EXECUTE')
   AND NOT has_function_privilege('anon', 'public.join_league(text, numeric, text, uuid)', 'EXECUTE')
   AND NOT has_function_privilege('anon', 'public.get_league_invitees(uuid)', 'EXECUTE')
   AND NOT has_function_privilege('anon', 'public.remove_league_invitee(uuid, uuid)', 'EXECUTE')
   AND NOT has_function_privilege('anon', 'public.create_league(text, date, date, int[], numeric, int, jsonb, int)', 'EXECUTE')
   AND NOT has_function_privilege('anon', 'public.get_league_by_code(text)', 'EXECUTE')
   AND NOT has_function_privilege('anon', 'public.league_open_invitees(uuid)', 'EXECUTE')
   AND NOT has_function_privilege('authenticated', 'public.league_open_invitees(uuid)', 'EXECUTE')
   AND has_function_privilege('authenticated', 'public.join_league(text, numeric, text, uuid)', 'EXECUTE')
   AND has_function_privilege('authenticated', 'public.get_league_invitees(uuid)', 'EXECUTE')
   AND has_function_privilege('authenticated', 'public.remove_league_invitee(uuid, uuid)', 'EXECUTE')
   AND has_function_privilege('authenticated', 'public.get_league_invitee(text, uuid)', 'EXECUTE'),
       NULL;
INSERT INTO inv_smoke (name, ok, detail)
SELECT 'league_invitees: RLS on, no table privileges for anon/authenticated',
       c.relrowsecurity
   AND NOT has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
   AND NOT has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE'),
       NULL
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relname = 'league_invitees';

-- Verdict ------------------------------------------------------------------------------------
DO $$
DECLARE v_failed text;
BEGIN
  SELECT string_agg(name || ' [' || COALESCE(detail, '') || ']', E'\n' ORDER BY seq) INTO v_failed
    FROM inv_smoke WHERE ok IS NOT TRUE;
  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION E'league invitees smoke failed:\n%', v_failed;
  END IF;
END $$;

SELECT seq, name, ok FROM inv_smoke ORDER BY seq;

ROLLBACK;
