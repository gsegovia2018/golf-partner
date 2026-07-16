-- Pre-save username availability check. A direct profiles select can't do
-- this: profiles_select RLS hides strangers, so a taken username owned by an
-- invisible profile would look available. SECURITY DEFINER sidesteps RLS and
-- returns only a boolean — no profile data leaks. The unique index
-- profiles_username_uq remains the race-proof source of truth; this is the
-- friendly check before the write.
CREATE OR REPLACE FUNCTION public.username_available(p_username text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE lower(username) = lower(trim(p_username))
       AND user_id <> auth.uid()
  );
$$;

REVOKE EXECUTE ON FUNCTION public.username_available(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.username_available(text) TO authenticated;
