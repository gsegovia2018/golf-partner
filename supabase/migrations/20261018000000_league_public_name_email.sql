-- ============================================================================
-- League public names: never an email prefix.
-- Follow-up to 20261017000000_league_public_board.sql (live). A live check
-- found profiles whose display_name is exactly their email's local part (or
-- their username, which is derived from it); the public board and the shared
-- messages would show that prefix. Idempotent; safe to re-run.
-- ============================================================================
--
-- 1) league_public_name(user) returns NULL (the page and the messages show
--    "Golfer" / "Jugador") when btrim(display_name) equals, ignoring case,
--    the username or split_part(auth.users.email, '@', 1). Otherwise the
--    same rule as before (league_public_name_rule, unchanged). It is now
--    SECURITY DEFINER so it can read auth.users; nobody may execute it.
-- 2) get_league_members gains a `public_name` column (that same server-made
--    name). Existing columns are unchanged, so older clients are unaffected;
--    the app builds every shared message from public_name. Changing a
--    RETURNS TABLE needs DROP + CREATE: the body is the newest one
--    (20261004000000_leagues.sql) plus the new column, with its grants.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.league_public_name(p_user uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
           WHEN lower(btrim(p.display_name)) = lower(btrim(p.username))
             OR lower(btrim(p.display_name)) = lower(split_part(u.email, '@', 1))
           THEN NULL
           ELSE public.league_public_name_rule(p.display_name)
         END
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.user_id
   WHERE p.user_id = p_user;
$$;

REVOKE EXECUTE ON FUNCTION public.league_public_name(uuid) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.get_league_members(uuid);
CREATE FUNCTION public.get_league_members(p_league uuid)
RETURNS TABLE (
  user_id uuid, display_name text, username text, avatar_url text, role text,
  league_handicap numeric, fee_paid boolean, joined_at timestamptz, left_at timestamptz,
  public_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.league_is_member(p_league, auth.uid()) THEN
    RAISE EXCEPTION 'You are not in this league.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT m.user_id,
         COALESCE(NULLIF(btrim(p.display_name), ''), p.username),
         p.username, p.avatar_url, m.role, m.league_handicap::numeric,
         m.fee_paid, m.joined_at, m.left_at,
         public.league_public_name(m.user_id)
    FROM public.league_members m
    LEFT JOIN public.profiles p ON p.user_id = m.user_id
   WHERE m.league_id = p_league
   ORDER BY m.joined_at NULLS LAST, m.user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_league_members(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_league_members(uuid) TO authenticated;
