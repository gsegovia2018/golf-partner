-- ============================================================================
-- League invites: who is joining. A pre-session preview of the invite, and a
-- name requirement for guest (anonymous) members.
-- Builds on 20261004000000_leagues.sql. Idempotent; safe to re-run.
-- ============================================================================
--
-- WHY
-- ---
-- Opening /league/CODE signed out used to offer "Continue without an
-- account", and an anonymous session could then join_league with no name at
-- all: a nameless row on every board. The invite screen now asks a new
-- person for name + email + handicap, and the server backs it up:
--
-- 1) get_league_invite_preview(code) — granted to anon. The signed-out invite
--    screen shows who invited you, the league name, member count, entry fee
--    and handicap cap before any session exists. It returns ONLY those
--    league-level facts: no member names, no emails, no user ids, no league
--    id, no per-member handicaps. The admin appears by first name only.
--
--    Exposure: the 8-character invite code (31-symbol alphabet, ~40 bits,
--    from gen_random_bytes) is the secret, exactly as it already is for
--    get_league_by_code. Anonymous sign-in is open, so anyone could already
--    get an `authenticated` (anonymous) session and call get_league_by_code,
--    which returns MORE (full admin name, league id, points table, season).
--    This preview therefore adds no new reach; it is strictly a subset.
--
-- 2) join_league(code, handicap, display_name) — an anonymous caller
--    (JWT claim is_anonymous = true) must have a non-empty display name,
--    either passed here or already on their profile, or the join is refused
--    with "Add your name to join the league.". A passed name is written to
--    profiles.display_name for a guest, or for anyone whose name is blank;
--    a real account's existing name is never overwritten. The old
--    (text, numeric) signature is dropped and replaced by one with defaults,
--    so existing two-argument callers keep working unchanged.
-- ============================================================================

-- 1) Pre-session invite preview ------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_league_invite_preview(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_l public.leagues%ROWTYPE;
BEGIN
  SELECT * INTO v_l FROM public.leagues
   WHERE invite_code = upper(btrim(COALESCE(p_code, '')));
  IF NOT FOUND THEN RETURN NULL; END IF;

  RETURN jsonb_build_object(
    'name',             v_l.name,
    'admin_first_name', split_part(btrim(public.league_user_name(v_l.created_by)), ' ', 1),
    'member_count',     (SELECT count(*) FROM public.league_members
                          WHERE league_id = v_l.id
                            AND joined_at IS NOT NULL AND left_at IS NULL),
    'entry_fee_cents',  v_l.entry_fee_cents,
    'handicap_cap',     v_l.handicap_cap,
    'archived',         v_l.archived_at IS NOT NULL);
END;
$$;

-- 2) join_league with a name requirement for guests ----------------------------

DROP FUNCTION IF EXISTS public.join_league(text, numeric);

-- Adds or re-activates the membership. A handicap different from the admin's
-- is recorded as a 'proposed' event (the admin decides); with no admin value
-- yet, the member's own figure is used until the admin sets one.
CREATE OR REPLACE FUNCTION public.join_league(
  p_code text, p_proposed_handicap numeric DEFAULT NULL, p_display_name text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_anon  boolean := COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false);
  v_name  text := NULLIF(btrim(COALESCE(p_display_name, '')), '');
  v_l     public.leagues%ROWTYPE;
  v_old   numeric(4,1);
  v_new   numeric(4,1);
  v_found boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Must be signed in' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_l FROM public.leagues
   WHERE invite_code = upper(btrim(COALESCE(p_code, '')));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That invite code is not valid.' USING ERRCODE = 'P0001';
  END IF;
  IF v_l.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This league has been archived.' USING ERRCODE = 'P0001';
  END IF;

  IF v_name IS NOT NULL THEN
    IF length(v_name) > 60 THEN
      RAISE EXCEPTION 'Keep your name under 60 characters.' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.profiles AS p (user_id, display_name)
    VALUES (v_uid, v_name)
    ON CONFLICT (user_id) DO UPDATE
       SET display_name = EXCLUDED.display_name, updated_at = now()
     WHERE v_anon OR NULLIF(btrim(COALESCE(p.display_name, '')), '') IS NULL;
  END IF;

  IF v_anon AND NOT EXISTS (
       SELECT 1 FROM public.profiles
        WHERE user_id = v_uid AND NULLIF(btrim(COALESCE(display_name, '')), '') IS NOT NULL) THEN
    RAISE EXCEPTION 'Add your name to join the league.' USING ERRCODE = 'P0001';
  END IF;

  v_new := CASE WHEN p_proposed_handicap IS NULL THEN NULL
                ELSE LEAST(p_proposed_handicap, v_l.handicap_cap) END;

  SELECT league_handicap, true INTO v_old, v_found
    FROM public.league_members WHERE league_id = v_l.id AND user_id = v_uid
     FOR UPDATE;

  IF v_found THEN
    UPDATE public.league_members
       SET joined_at = CASE WHEN joined_at IS NULL OR left_at IS NOT NULL THEN now() ELSE joined_at END,
           left_at = NULL,
           league_handicap = COALESCE(league_handicap, v_new)
     WHERE league_id = v_l.id AND user_id = v_uid;
  ELSE
    INSERT INTO public.league_members (league_id, user_id, role, league_handicap, joined_at)
    VALUES (v_l.id, v_uid, 'member', v_new, now());
  END IF;

  IF v_new IS NOT NULL AND v_new IS DISTINCT FROM v_old THEN
    INSERT INTO public.league_handicap_events (league_id, user_id, old, new, reason, by_user)
    VALUES (v_l.id, v_uid, v_old, v_new, 'proposed', v_uid);
  END IF;

  RETURN jsonb_build_object('league_id', v_l.id);
END;
$$;

-- 3) Grants ----------------------------------------------------------------------
-- Supabase's default privileges grant EXECUTE on new public functions to anon.

REVOKE EXECUTE ON FUNCTION public.join_league(text, numeric, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.join_league(text, numeric, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_league_invite_preview(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_league_invite_preview(text) TO anon, authenticated;

/* ===========================================================================
   VERIFY
   ---------------------------------------------------------------------------
   Smoke test (BEGIN … ROLLBACK, never persists):
     supabase/tests/league_join_identity_smoke.sql

   -- One join_league, with the name parameter:
   SELECT pg_get_function_identity_arguments(p.oid) FROM pg_proc p
    WHERE p.proname = 'join_league';
   -- p_code text, p_proposed_handicap numeric, p_display_name text

   -- anon can preview but not join:
   SELECT has_function_privilege('anon', 'public.get_league_invite_preview(text)', 'EXECUTE'),
          has_function_privilege('anon', 'public.join_league(text, numeric, text)', 'EXECUTE');
   -- t, f
   =========================================================================== */
