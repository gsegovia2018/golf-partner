-- ============================================================================
-- Smoke test for 20261019000000_profile_locale.sql: profiles.locale and
-- set_my_locale. A signed-in user sets only their own locale, only to 'es' or
-- 'en'; anon can't call it; the column refuses other values; repeating the
-- same value writes nothing.
--
-- Same shape as league_public_board_smoke.sql: each check is one row in the
-- temp table `pl_smoke`, a final DO block RAISEs listing every failed check,
-- and the whole run is one transaction ending in ROLLBACK.
--
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/profile_locale_smoke.sql
--
-- Cast: A Ana, B Bea.
-- ============================================================================

BEGIN;

CREATE TEMP TABLE pl_smoke (seq serial, name text, ok boolean, detail text) ON COMMIT DROP;
CREATE TEMP TABLE pl_ctx (k text PRIMARY KEY, v text) ON COMMIT DROP;
GRANT ALL ON pl_smoke, pl_ctx TO authenticated, anon;
GRANT USAGE ON SEQUENCE pl_smoke_seq_seq TO authenticated, anon;

-- Helpers ------------------------------------------------------------------------------
-- pl_v(k): a context value. pl_as(user key): sign in as that user ('anon' = signed out).
-- pl_ok(name, ok, detail): record a check. pl_refuses(name, sql, state[, hint]):
-- pass when sql raises with that SQLSTATE (and hint). pl_locale(user key): that
-- user's stored locale, read as superuser.
CREATE FUNCTION pg_temp.pl_v(p_k text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT v FROM pl_ctx WHERE k = p_k $$;
CREATE FUNCTION pg_temp.pl_as(p_k text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    CASE WHEN p_k = 'anon' THEN '{"role":"anon"}'
         ELSE jsonb_build_object('sub', (SELECT v FROM pl_ctx WHERE k = 'u:' || p_k), 'role', 'authenticated')::text END,
    true) $$;
CREATE FUNCTION pg_temp.pl_ok(p_name text, p_ok boolean, p_detail text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $$ INSERT INTO pl_smoke (name, ok, detail) VALUES (p_name, COALESCE(p_ok, false), p_detail) $$;
CREATE FUNCTION pg_temp.pl_refuses(p_name text, p_sql text, p_state text, p_hint text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_state text; v_msg text; v_hint text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_hint = PG_EXCEPTION_HINT;
    INSERT INTO pl_smoke (name, ok, detail)
    VALUES (p_name, v_state = p_state AND (p_hint IS NULL OR v_hint = p_hint),
            v_state || ' ' || v_msg || COALESCE(' hint ' || NULLIF(v_hint, ''), ''));
    RETURN;
  END;
  INSERT INTO pl_smoke (name, ok, detail) VALUES (p_name, false, 'no error');
END $$;
CREATE FUNCTION pg_temp.pl_locale(p_k text) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
  SELECT locale FROM public.profiles WHERE user_id = (SELECT v FROM pl_ctx WHERE k = 'u:' || p_k)::uuid $$;
CREATE FUNCTION pg_temp.pl_xmin(p_k text) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
  SELECT xmin::text || ':' || updated_at::text FROM public.profiles
   WHERE user_id = (SELECT v FROM pl_ctx WHERE k = 'u:' || p_k)::uuid $$;

-- Schema -------------------------------------------------------------------------------
INSERT INTO pl_smoke (name, ok, detail)
SELECT 'profiles.locale is a nullable text column',
       count(*) = 1 AND bool_and(data_type = 'text' AND is_nullable = 'YES'), NULL
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'locale';
INSERT INTO pl_smoke (name, ok, detail)
SELECT 'set_my_locale is SECURITY DEFINER with search_path pinned',
       count(*) = 1 AND bool_and(p.prosecdef AND COALESCE(p.proconfig @> ARRAY['search_path=public'], false)), NULL
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'set_my_locale';
SELECT pg_temp.pl_ok('authenticated can execute set_my_locale',
  has_function_privilege('authenticated', 'public.set_my_locale(text)', 'EXECUTE'));
SELECT pg_temp.pl_ok('anon cannot execute set_my_locale',
  NOT has_function_privilege('anon', 'public.set_my_locale(text)', 'EXECUTE'));

-- Fixture --------------------------------------------------------------------------------
INSERT INTO pl_ctx (k, v) VALUES
  ('u:a', 'e3000000-0000-4000-8000-00000000000a'),
  ('u:b', 'e3000000-0000-4000-8000-00000000000b');
INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
SELECT v::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'profile-locale-' || substr(k, 3) || '@example.invalid', now(), now()
  FROM pl_ctx WHERE k LIKE 'u:%';
INSERT INTO public.profiles (user_id, display_name)
SELECT v::uuid, CASE substr(k, 3) WHEN 'a' THEN 'Ana Locale' ELSE 'Bea Locale' END
  FROM pl_ctx WHERE k LIKE 'u:%'
ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name;

SELECT pg_temp.pl_ok('a new profile has no locale (send-push falls back to English)',
  pg_temp.pl_locale('a') IS NULL AND pg_temp.pl_locale('b') IS NULL);

-- The column itself ------------------------------------------------------------------------
SELECT pg_temp.pl_refuses('the column refuses a locale other than es/en',
  format('UPDATE public.profiles SET locale = %L WHERE user_id = %L', 'fr', pg_temp.pl_v('u:a')), '23514');
SELECT pg_temp.pl_refuses('the column refuses a region tag (es-ES)',
  format('UPDATE public.profiles SET locale = %L WHERE user_id = %L', 'es-ES', pg_temp.pl_v('u:a')), '23514');

-- Signed in ----------------------------------------------------------------------------------
SET LOCAL ROLE authenticated;

SELECT pg_temp.pl_as('a');
SELECT public.set_my_locale('es');
SELECT pg_temp.pl_ok('Ana sets her locale to es', pg_temp.pl_locale('a') = 'es', pg_temp.pl_locale('a'));
SELECT pg_temp.pl_ok('Bea is untouched by Ana''s call', pg_temp.pl_locale('b') IS NULL, pg_temp.pl_locale('b'));

INSERT INTO pl_ctx VALUES ('row:a', pg_temp.pl_xmin('a'));
SELECT public.set_my_locale('es');
SELECT pg_temp.pl_ok('setting the same locale again writes nothing',
  pg_temp.pl_xmin('a') = pg_temp.pl_v('row:a'), pg_temp.pl_xmin('a'));

SELECT public.set_my_locale('en');
SELECT pg_temp.pl_ok('Ana switches to en', pg_temp.pl_locale('a') = 'en', pg_temp.pl_locale('a'));

SELECT pg_temp.pl_refuses('set_my_locale refuses fr', 'SELECT public.set_my_locale(''fr'')', '22023');
SELECT pg_temp.pl_refuses('set_my_locale refuses NULL', 'SELECT public.set_my_locale(NULL)', '22023');
SELECT pg_temp.pl_refuses('set_my_locale refuses ES (case matters)', 'SELECT public.set_my_locale(''ES'')', '22023');
SELECT pg_temp.pl_ok('a refused call leaves the locale as it was', pg_temp.pl_locale('a') = 'en', pg_temp.pl_locale('a'));

SELECT pg_temp.pl_as('b');
SELECT public.set_my_locale('es');
SELECT pg_temp.pl_ok('Bea sets her own locale', pg_temp.pl_locale('b') = 'es', pg_temp.pl_locale('b'));
SELECT pg_temp.pl_ok('Bea''s call leaves Ana''s locale alone', pg_temp.pl_locale('a') = 'en', pg_temp.pl_locale('a'));

-- Signed out ---------------------------------------------------------------------------------
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.pl_as('anon');
SELECT pg_temp.pl_refuses('anon cannot call set_my_locale', 'SELECT public.set_my_locale(''es'')', '42501');
RESET ROLE;

-- An authenticated session with no user id (defensive: auth.uid() NULL).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"role":"authenticated"}', true);
SELECT pg_temp.pl_refuses('a session without a user is refused', 'SELECT public.set_my_locale(''es'')', '42501');
RESET ROLE;

-- Verdict ------------------------------------------------------------------------------------------
DO $$
DECLARE v_failed text;
BEGIN
  SELECT string_agg(name || ' [' || COALESCE(detail, '') || ']', E'\n' ORDER BY seq) INTO v_failed
    FROM pl_smoke WHERE ok IS NOT TRUE;
  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION E'profile locale smoke failed:\n%', v_failed;
  END IF;
END $$;

SELECT seq, name, ok FROM pl_smoke ORDER BY seq;

ROLLBACK;
