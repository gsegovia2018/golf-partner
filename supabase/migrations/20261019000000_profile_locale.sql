-- ============================================================================
-- Push notifications in the recipient's language (docs/i18n.md, "Push
-- notifications"). Idempotent; safe to re-run.
-- ============================================================================
--
--   profiles.locale    'es' | 'en' | NULL. The language the app last ran in
--                      for this account (the Settings override, else the
--                      device language). NULL = the app has not reported yet
--                      (an older build, or not opened since this shipped);
--                      send-push then writes English, as it always did.
--
--   set_my_locale(p_locale text)   authenticated: sets the caller's own
--                      locale. Unsupported values are refused (22023);
--                      setting the same value again is a no-op (no row
--                      write). It touches no other column, so
--                      no profile trigger fires and updated_at is unchanged.
--
-- Read by: supabase/functions/send-push (service role). Written only through
-- set_my_locale by the app (src/lib/profileLocale.js); profiles_update would
-- also let an owner write it directly, which is harmless.
-- ============================================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS locale text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.profiles'::regclass AND conname = 'profiles_locale_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_locale_check CHECK (locale IN ('es', 'en'));
  END IF;
END $$;

COMMENT ON COLUMN public.profiles.locale IS
  'es | en | NULL: the language the app last ran in; send-push renders in it (NULL -> English).';

CREATE OR REPLACE FUNCTION public.set_my_locale(p_locale text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501';
  END IF;
  IF p_locale IS NULL OR p_locale NOT IN ('es', 'en') THEN
    RAISE EXCEPTION 'Unsupported locale.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.profiles
     SET locale = p_locale
   WHERE user_id = v_uid
     AND locale IS DISTINCT FROM p_locale;
END $$;

REVOKE ALL ON FUNCTION public.set_my_locale(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_locale(text) TO authenticated;
