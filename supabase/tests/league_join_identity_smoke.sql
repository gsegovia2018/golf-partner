-- ============================================================================
-- Smoke test for 20261005000000_league_join_identity.sql — the anon invite
-- preview and the guest name requirement on join_league.
--
-- Same conventions as leagues_smoke.sql: plain SQL, one row per check in the
-- temp table `join_smoke`, a final DO block RAISEs listing every failure, and
-- the whole run is one transaction ending in ROLLBACK.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/league_join_identity_smoke.sql
--
-- Cast: A Marcos Pecker (admin, real account), G a guest (is_anonymous),
-- R a real account with a blank name, N a real account named "Nora Real".
-- ============================================================================

BEGIN;

CREATE TEMP TABLE join_smoke (seq serial, name text, ok boolean, detail text) ON COMMIT DROP;
CREATE TEMP TABLE join_ctx (k text PRIMARY KEY, v text) ON COMMIT DROP;
GRANT ALL ON join_smoke, join_ctx TO authenticated, anon;
GRANT USAGE ON SEQUENCE join_smoke_seq_seq TO authenticated, anon;

INSERT INTO auth.users (id, instance_id, aud, role, email, is_anonymous, created_at, updated_at)
SELECT u.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       u.email, u.anon, now(), now()
  FROM (VALUES ('b0000000-0000-4000-8000-00000000000a', 'join-smoke-a@example.invalid', false),
               ('b0000000-0000-4000-8000-00000000000f', NULL,                           true),
               ('b0000000-0000-4000-8000-00000000000c', 'join-smoke-r@example.invalid', false),
               ('b0000000-0000-4000-8000-00000000000d', 'join-smoke-n@example.invalid', false)) u(id, email, anon);

INSERT INTO public.profiles (user_id, display_name)
VALUES ('b0000000-0000-4000-8000-00000000000a', 'Marcos Pecker'),
       ('b0000000-0000-4000-8000-00000000000f', NULL),
       ('b0000000-0000-4000-8000-00000000000c', NULL),
       ('b0000000-0000-4000-8000-00000000000d', 'Nora Real')
ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name;

-- A creates a league (30 € entry, cap 28) ----------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-00000000000a","role":"authenticated","is_anonymous":false}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE r jsonb;
BEGIN
  r := public.create_league('Join Smoke League', '2026-01-01', '2026-12-31', NULL, 28, 3000, '[]'::jsonb);
  INSERT INTO join_ctx VALUES ('code', r->>'invite_code'), ('league', r->>'id');
END $$;

-- 1) anon preview ----------------------------------------------------------------
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
DO $$
DECLARE r jsonb;
BEGIN
  r := public.get_league_invite_preview(lower((SELECT v FROM join_ctx WHERE k='code')));
  INSERT INTO join_smoke (name, ok, detail) VALUES ('anon preview: league facts, admin first name only',
    r->>'name' = 'Join Smoke League' AND r->>'admin_first_name' = 'Marcos'
      AND (r->>'member_count')::int = 1 AND (r->>'entry_fee_cents')::int = 3000
      AND (r->>'handicap_cap')::numeric = 28 AND (r->>'archived')::boolean = false, r::text);
  INSERT INTO join_smoke (name, ok, detail) VALUES ('anon preview exposes exactly the whitelisted keys',
    (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(r) k)
      = ARRAY['admin_first_name','archived','entry_fee_cents','handicap_cap','member_count','name'], r::text);
  INSERT INTO join_smoke (name, ok, detail) VALUES ('anon preview: unknown code -> NULL',
    public.get_league_invite_preview('ZZZZZZZZ') IS NULL, NULL);
END $$;

DO $$
BEGIN
  PERFORM public.join_league((SELECT v FROM join_ctx WHERE k='code'), 18, 'Sneaky');
  INSERT INTO join_smoke (name, ok, detail) VALUES ('anon (no session) cannot join_league', false, 'no error');
EXCEPTION WHEN others THEN
  INSERT INTO join_smoke (name, ok, detail) VALUES ('anon (no session) cannot join_league', SQLSTATE = '42501', SQLERRM);
END $$;

DO $$
BEGIN
  PERFORM public.get_league_by_code((SELECT v FROM join_ctx WHERE k='code'));
  INSERT INTO join_smoke (name, ok, detail) VALUES ('anon still cannot call get_league_by_code', false, 'no error');
EXCEPTION WHEN others THEN
  INSERT INTO join_smoke (name, ok, detail) VALUES ('anon still cannot call get_league_by_code', SQLSTATE = '42501', SQLERRM);
END $$;

-- 2) guest (is_anonymous) ----------------------------------------------------------
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-00000000000f","role":"authenticated","is_anonymous":true}', true);
SET LOCAL ROLE authenticated;

DO $$
BEGIN
  PERFORM public.join_league((SELECT v FROM join_ctx WHERE k='code'), 18);
  INSERT INTO join_smoke (name, ok, detail) VALUES ('guest without a name is refused', false, 'no error');
EXCEPTION WHEN others THEN
  INSERT INTO join_smoke (name, ok, detail) VALUES ('guest without a name is refused',
    SQLERRM = 'Add your name to join the league.', SQLERRM);
END $$;

DO $$
BEGIN
  PERFORM public.join_league((SELECT v FROM join_ctx WHERE k='code'), 18, '   ');
  INSERT INTO join_smoke (name, ok, detail) VALUES ('guest with a blank name is refused', false, 'no error');
EXCEPTION WHEN others THEN
  INSERT INTO join_smoke (name, ok, detail) VALUES ('guest with a blank name is refused',
    SQLERRM = 'Add your name to join the league.', SQLERRM);
END $$;

SELECT public.join_league((SELECT v FROM join_ctx WHERE k='code'), 31, '  Lucia Guest ');

-- 3) real accounts -----------------------------------------------------------------
-- R: blank name, no name passed -> still allowed (only guests need one).
SELECT set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-00000000000c","role":"authenticated","is_anonymous":false}', true);
SELECT public.join_league((SELECT v FROM join_ctx WHERE k='code'), 20);
-- N: has a name; a passed name must not overwrite it.
SELECT set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-00000000000d","role":"authenticated","is_anonymous":false}', true);
SELECT public.join_league((SELECT v FROM join_ctx WHERE k='code'), NULL, 'Someone Else');

RESET ROLE;
INSERT INTO join_smoke (name, ok, detail)
SELECT 'guest joined with the trimmed name saved and handicap clamped to the cap',
       p.display_name = 'Lucia Guest' AND m.league_handicap = 28.0 AND m.joined_at IS NOT NULL,
       p.display_name || ' / ' || m.league_handicap
  FROM public.profiles p
  JOIN public.league_members m ON m.user_id = p.user_id
 WHERE p.user_id = 'b0000000-0000-4000-8000-00000000000f';
INSERT INTO join_smoke (name, ok, detail)
SELECT 'real account with a blank name joins without one',
       EXISTS (SELECT 1 FROM public.league_members
                WHERE user_id = 'b0000000-0000-4000-8000-00000000000c' AND joined_at IS NOT NULL), NULL;
INSERT INTO join_smoke (name, ok, detail)
SELECT 'a real account''s existing name is not overwritten',
       display_name = 'Nora Real', display_name
  FROM public.profiles WHERE user_id = 'b0000000-0000-4000-8000-00000000000d';
INSERT INTO join_smoke (name, ok, detail)
SELECT 'join_league has exactly one signature, with the name parameter',
       count(*) = 1 AND bool_and(pg_get_function_identity_arguments(p.oid)
         = 'p_code text, p_proposed_handicap numeric, p_display_name text'),
       string_agg(pg_get_function_identity_arguments(p.oid), ' | ')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'join_league';
INSERT INTO join_smoke (name, ok, detail)
SELECT 'grants: anon previews but cannot join; authenticated can do both',
       has_function_privilege('anon', 'public.get_league_invite_preview(text)', 'EXECUTE')
   AND NOT has_function_privilege('anon', 'public.join_league(text, numeric, text)', 'EXECUTE')
   AND has_function_privilege('authenticated', 'public.join_league(text, numeric, text)', 'EXECUTE')
   AND has_function_privilege('authenticated', 'public.get_league_invite_preview(text)', 'EXECUTE'),
       NULL;

-- Verdict ------------------------------------------------------------------------------------
DO $$
DECLARE v_failed text;
BEGIN
  SELECT string_agg(name || ' [' || COALESCE(detail, '') || ']', E'\n' ORDER BY seq) INTO v_failed
    FROM join_smoke WHERE ok IS NOT TRUE;
  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION E'league join identity smoke failed:\n%', v_failed;
  END IF;
END $$;

SELECT seq, name, ok FROM join_smoke ORDER BY seq;

ROLLBACK;
