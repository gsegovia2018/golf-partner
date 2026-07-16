-- Friend search broke with 20260516000001_security_hardening: profiles_select
-- was scoped to self / accepted friends / shared-tournament members, so a
-- username search for a stranger returns zero rows — no new friend can ever
-- be found. Same gap hides an incoming request's sender (listPendingRequests
-- drops rows whose profile can't load), so requests can't be accepted either.
--
-- Fix, without reopening the M-3 leak:
--   1) search_profiles(): SECURITY DEFINER username-prefix search returning
--      only the public card fields (no email-derived data), authenticated
--      only, capped at 20 rows.
--   2) profiles_select also matches a *pending* friendship between the pair,
--      so both sides of a request can render each other.

-- 1) Username search RPC ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_profiles(p_query text)
RETURNS TABLE (
  user_id      uuid,
  username     text,
  display_name text,
  handicap     numeric,
  avatar_url   text,
  avatar_color text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT p.user_id, p.username, p.display_name, p.handicap,
         p.avatar_url, p.avatar_color
    FROM public.profiles p
   WHERE length(trim(p_query)) >= 2
     AND p.username IS NOT NULL
     AND p.user_id <> auth.uid()
     -- escape ILIKE wildcards so 'a%' can't scan the whole table
     AND p.username ILIKE
         replace(replace(replace(trim(p_query),
           '\', '\\'), '%', '\%'), '_', '\_') || '%'
   ORDER BY p.username
   LIMIT 20;
$$;

REVOKE EXECUTE ON FUNCTION public.search_profiles(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.search_profiles(text) TO authenticated;

-- 2) Profile visibility for pending requests ---------------------------------
-- Any friendship row between the pair (pending or accepted) exposes the
-- profile; declined requests are deleted, so no lingering visibility.
CREATE OR REPLACE FUNCTION public.has_friendship(a uuid, b uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.friendships f
     WHERE (f.requester_id = a AND f.addressee_id = b)
        OR (f.requester_id = b AND f.addressee_id = a)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.has_friendship(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.has_friendship(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_friendship(user_id, auth.uid())
    OR public.shares_tournament(user_id, auth.uid())
  );
