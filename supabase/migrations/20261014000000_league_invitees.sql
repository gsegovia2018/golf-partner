-- ============================================================================
-- League invitees: reserved spots for people who are not in the app yet.
-- Builds on 20261004000000_leagues.sql and 20261005000000_league_join_identity.sql.
-- Idempotent; safe to re-run.
-- ============================================================================
--
-- WHY
-- ---
-- create_league could only add the creator's app friends. Most of a real
-- league's players are not in the app (yet) when the admin sets it up, so the
-- admin had no way to record "Pablo plays off 18" until Pablo had an account
-- and was a friend. Now the admin adds them by name + league handicap, and the
-- invite link does the rest:
--
-- 1) league_invitees — one row per reserved spot: a name, the admin's
--    handicap, and who claimed it. RPC-only, like league_marker_tokens: RLS
--    on, no policies, no table privileges for anon/authenticated.
--
-- 2) create_league(…, p_members) — an entry is either {"user_id","handicap"}
--    (a friend, as before) or {"name","handicap"} with no user_id (a spot).
--    The spot's handicap is clamped to the cap like a member's.
--
-- 3) The invite screen lists the UNCLAIMED spots by name only:
--    get_league_invite_preview(code).invitees and get_league_by_code(code)
--    .invitees, both [{id, name}] ordered by name. No handicaps there.
--
-- 4) get_league_invitee(code, invitee) — granted to anon: the "Hi Pablo, the
--    admin has you on 18.0" step runs before any session exists. It returns
--    one spot: {id, name, handicap, claimed}, or NULL when that spot is not in
--    the league of that code.
--
--    Exposure: as with the preview, the 8-character invite code (~40 bits)
--    is the secret. Whoever holds it can already list the spot names and, via
--    an anonymous session, join the league and read every member's handicap
--    through get_league_members. This RPC reveals strictly less: one spot's
--    name and admin handicap, and only when asked by (code, spot id) together.
--
-- 5) join_league(code, handicap, display_name, invitee) — with p_invitee the
--    caller takes that spot: the row is locked, a spot already taken by
--    someone else is refused ("Someone already joined as Pablo."), and one
--    user holds at most one spot per league (also a unique index). The
--    member's league handicap becomes the spot's (an admin 'set' event by the
--    spot's creator, exactly what create_league records for a friend); a
--    different proposed handicap then becomes a 'proposed' event as before.
--    A guest with no display name is named after the spot; a real account's
--    name is never overwritten (the spot name is only for matching).
--    Re-claiming your own spot is idempotent and does not re-apply the spot
--    handicap (the admin may have changed it since). Without p_invitee the
--    function behaves exactly as before. The (text, numeric, text) signature
--    is dropped and replaced by one with a fourth defaulted argument, so
--    every existing 1-, 2- and 3-argument caller keeps working.
--
-- 6) get_league_invitees(league) — members see the unclaimed spots with their
--    handicaps; remove_league_invitee(league, invitee) — admin deletes an
--    unclaimed spot (a claimed one is a member now: "That player already
--    joined.").
--
-- Spot handicaps are clamped to the league's CURRENT cap whenever they are
-- read or claimed, so lowering the cap later (update_league_rules) needs no
-- extra pass over this table.
-- ============================================================================

-- 1) Table ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.league_invitees (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id   uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 60),
  handicap    numeric(4,1),
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  claimed_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_at  timestamptz
);
CREATE INDEX IF NOT EXISTS league_invitees_league_idx ON public.league_invitees (league_id);
-- One user claims at most one spot per league.
CREATE UNIQUE INDEX IF NOT EXISTS league_invitees_one_claim
  ON public.league_invitees (league_id, claimed_by) WHERE claimed_by IS NOT NULL;

ALTER TABLE public.league_invitees ENABLE ROW LEVEL SECURITY;   -- no policy: RPC-only
REVOKE ALL ON public.league_invitees FROM anon, authenticated;

-- 2) create_league: friends or named spots -------------------------------------

-- p_members: [{"user_id": "<uuid>", "handicap": 18.0}, …] — friends of the
-- creator, added as invited (joined_at NULL) with the proposed handicap — or
-- [{"name": "Pablo", "handicap": 18.0}, …] — people not in the app, added as
-- unclaimed spots in league_invitees.
CREATE OR REPLACE FUNCTION public.create_league(
  p_name text, p_season_start date, p_season_end date, p_points_table int[],
  p_cap numeric, p_fee_cents int, p_members jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_id   uuid;
  v_code text;
  v_cap  numeric(4,1) := COALESCE(p_cap, 30);
  v_m    jsonb;
  v_mu   uuid;
  v_hcp  numeric(4,1);
  v_iname text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Must be signed in' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(COALESCE(p_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A league needs a name.' USING ERRCODE = 'P0001';
  END IF;
  IF p_season_start IS NULL OR p_season_end IS NULL OR p_season_end < p_season_start THEN
    RAISE EXCEPTION 'The season must end after it starts.' USING ERRCODE = 'P0001';
  END IF;

  v_code := public.league_new_invite_code();
  INSERT INTO public.leagues (name, season_start, season_end, created_by, points_table,
                              handicap_cap, entry_fee_cents, invite_code)
  VALUES (btrim(p_name), p_season_start, p_season_end, v_uid,
          COALESCE(p_points_table, '{500,300,190,135,110,90,75,60,45,35,25,15}'::int[]),
          v_cap, GREATEST(COALESCE(p_fee_cents, 0), 0), v_code)
  RETURNING id INTO v_id;

  INSERT INTO public.league_members (league_id, user_id, role, joined_at)
  VALUES (v_id, v_uid, 'admin', now());

  FOR v_m IN SELECT * FROM jsonb_array_elements(COALESCE(p_members, '[]'::jsonb)) LOOP
    v_mu  := (v_m ->> 'user_id')::uuid;
    -- LEAST ignores NULLs, so a missing handicap must stay NULL explicitly.
    v_hcp := CASE WHEN v_m ->> 'handicap' IS NULL THEN NULL
                  ELSE LEAST((v_m ->> 'handicap')::numeric, v_cap) END;
    IF v_mu IS NULL THEN
      -- A reserved spot for someone not in the app (no handicap event: the
      -- event needs a user; it is written when the spot is claimed).
      IF v_m ? 'name' THEN
        v_iname := NULLIF(btrim(COALESCE(v_m ->> 'name', '')), '');
        IF v_iname IS NULL THEN
          RAISE EXCEPTION 'Each player needs a name.' USING ERRCODE = 'P0001';
        END IF;
        IF length(v_iname) > 60 THEN
          RAISE EXCEPTION 'Keep each name under 60 characters.' USING ERRCODE = 'P0001';
        END IF;
        INSERT INTO public.league_invitees (league_id, name, handicap, created_by)
        VALUES (v_id, v_iname, v_hcp, v_uid);
      END IF;
      CONTINUE;
    END IF;
    IF v_mu = v_uid THEN
      -- The creator's own handicap.
      UPDATE public.league_members SET league_handicap = v_hcp
       WHERE league_id = v_id AND user_id = v_uid;
    ELSE
      IF NOT public.are_friends(v_uid, v_mu) THEN
        RAISE EXCEPTION 'You can only add friends to a league.' USING ERRCODE = 'P0001';
      END IF;
      INSERT INTO public.league_members (league_id, user_id, role, league_handicap)
      VALUES (v_id, v_mu, 'member', v_hcp)
      ON CONFLICT (league_id, user_id) DO NOTHING;
      -- Each invited friend hears about it once (a duplicate entry in
      -- p_members is skipped by the ON CONFLICT above, leaving FOUND false).
      IF FOUND THEN
        PERFORM public.create_notification(v_mu, 'league_invite', v_uid, v_id,
          jsonb_build_object(
            'league_id',    v_id,
            'league_name',  btrim(p_name),
            'invite_code',  v_code,
            'inviter_name', public.league_user_name(v_uid),
            'actor_name',   public.league_user_name(v_uid)));
      END IF;
    END IF;
    IF v_hcp IS NOT NULL THEN
      INSERT INTO public.league_handicap_events (league_id, user_id, old, new, reason, by_user)
      VALUES (v_id, v_mu, NULL, v_hcp, 'set', v_uid);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('id', v_id, 'invite_code', v_code);
END;
$$;

-- 3) Unclaimed spots as [{id, name}] (internal) ----------------------------------

CREATE OR REPLACE FUNCTION public.league_open_invitees(p_league uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name)
                            ORDER BY lower(i.name), i.created_at, i.id), '[]'::jsonb)
    FROM public.league_invitees i
   WHERE i.league_id = p_league AND i.claimed_by IS NULL;
$$;
REVOKE EXECUTE ON FUNCTION public.league_open_invitees(uuid) FROM PUBLIC, anon, authenticated;

-- 4) Pre-session invite preview + unclaimed spots --------------------------------

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
    'archived',         v_l.archived_at IS NOT NULL,
    'invitees',         public.league_open_invitees(v_l.id));
END;
$$;

-- 5) Join-screen summary + unclaimed spots ---------------------------------------

CREATE OR REPLACE FUNCTION public.get_league_by_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_l   public.leagues%ROWTYPE;
  v_me  public.league_members%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Must be signed in' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_l FROM public.leagues
   WHERE invite_code = upper(btrim(COALESCE(p_code, '')));
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_me FROM public.league_members
   WHERE league_id = v_l.id AND user_id = v_uid;

  RETURN jsonb_build_object(
    'id',                v_l.id,
    'name',              v_l.name,
    'season_start',      v_l.season_start,
    'season_end',        v_l.season_end,
    'points_table',      to_jsonb(v_l.points_table),
    'handicap_cap',      v_l.handicap_cap,
    'entry_fee_cents',   v_l.entry_fee_cents,
    'archived',          v_l.archived_at IS NOT NULL,
    'admin_name',        public.league_user_name(v_l.created_by),
    'member_count',      (SELECT count(*) FROM public.league_members
                           WHERE league_id = v_l.id
                             AND joined_at IS NOT NULL AND left_at IS NULL),
    'proposed_handicap', v_me.league_handicap,
    'is_member',         (v_me.joined_at IS NOT NULL AND v_me.left_at IS NULL),
    'invitees',          public.league_open_invitees(v_l.id));
END;
$$;

-- 6) One spot, for the "is this you?" greeting (anon) -----------------------------

CREATE OR REPLACE FUNCTION public.get_league_invitee(p_code text, p_invitee uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_l public.leagues%ROWTYPE;
  v_i public.league_invitees%ROWTYPE;
BEGIN
  SELECT * INTO v_l FROM public.leagues
   WHERE invite_code = upper(btrim(COALESCE(p_code, '')));
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_i FROM public.league_invitees
   WHERE id = p_invitee AND league_id = v_l.id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  RETURN jsonb_build_object(
    'id',       v_i.id,
    'name',     v_i.name,
    'handicap', LEAST(v_i.handicap, v_l.handicap_cap),
    'claimed',  v_i.claimed_by IS NOT NULL);
END;
$$;

-- 7) join_league with an optional spot -------------------------------------------

DROP FUNCTION IF EXISTS public.join_league(text, numeric, text);

-- Adds or re-activates the membership. A handicap different from the admin's
-- is recorded as a 'proposed' event (the admin decides); with no admin value
-- yet, the member's own figure is used until the admin sets one. With
-- p_invitee, the admin's value is the spot's handicap.
CREATE OR REPLACE FUNCTION public.join_league(
  p_code text, p_proposed_handicap numeric DEFAULT NULL, p_display_name text DEFAULT NULL,
  p_invitee uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_anon   boolean := COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false);
  v_name   text := NULLIF(btrim(COALESCE(p_display_name, '')), '');
  v_l      public.leagues%ROWTYPE;
  v_i      public.league_invitees%ROWTYPE;
  v_other  text;
  v_claim  boolean := false;   -- a spot newly claimed by this call
  v_spot   numeric(4,1);
  v_old    numeric(4,1);
  v_new    numeric(4,1);
  v_found  boolean;
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

  IF p_invitee IS NOT NULL THEN
    SELECT * INTO v_i FROM public.league_invitees
     WHERE id = p_invitee AND league_id = v_l.id
       FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That spot is not in this league.' USING ERRCODE = 'P0001';
    END IF;
    IF v_i.claimed_by IS NOT NULL AND v_i.claimed_by <> v_uid THEN
      RAISE EXCEPTION 'Someone already joined as %.', v_i.name USING ERRCODE = 'P0001';
    END IF;
    IF v_i.claimed_by IS NULL THEN
      SELECT name INTO v_other FROM public.league_invitees
       WHERE league_id = v_l.id AND claimed_by = v_uid AND id <> v_i.id;
      IF FOUND THEN
        RAISE EXCEPTION 'You already joined this league as %.', v_other USING ERRCODE = 'P0001';
      END IF;
      v_claim := true;
      v_spot  := LEAST(v_i.handicap, v_l.handicap_cap);
    END IF;
    -- A guest is named after the spot unless they typed a name.
    IF v_anon AND v_name IS NULL THEN
      v_name := v_i.name;
    END IF;
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
           left_at = NULL
     WHERE league_id = v_l.id AND user_id = v_uid;
  ELSE
    INSERT INTO public.league_members (league_id, user_id, role, league_handicap, joined_at)
    VALUES (v_l.id, v_uid, 'member', NULL, now());
    v_old := NULL;
  END IF;

  -- The spot's handicap is the admin's value: the same 'set' event
  -- create_league writes for an invited friend, by the spot's creator.
  IF v_claim AND v_spot IS NOT NULL AND v_spot IS DISTINCT FROM v_old THEN
    UPDATE public.league_members SET league_handicap = v_spot
     WHERE league_id = v_l.id AND user_id = v_uid;
    INSERT INTO public.league_handicap_events (league_id, user_id, old, new, reason, by_user)
    VALUES (v_l.id, v_uid, v_old, v_spot, 'set', v_i.created_by);
    v_old := v_spot;
  END IF;

  -- With no admin value yet, the member's own figure is used.
  IF v_old IS NULL AND v_new IS NOT NULL THEN
    UPDATE public.league_members SET league_handicap = v_new
     WHERE league_id = v_l.id AND user_id = v_uid;
  END IF;

  IF v_new IS NOT NULL AND v_new IS DISTINCT FROM v_old THEN
    INSERT INTO public.league_handicap_events (league_id, user_id, old, new, reason, by_user)
    VALUES (v_l.id, v_uid, v_old, v_new, 'proposed', v_uid);
  END IF;

  IF v_claim THEN
    UPDATE public.league_invitees SET claimed_by = v_uid, claimed_at = now()
     WHERE id = v_i.id;
  END IF;

  RETURN jsonb_build_object('league_id', v_l.id);
END;
$$;

-- 8) Members see the unclaimed spots; the admin removes one ------------------------

CREATE OR REPLACE FUNCTION public.get_league_invitees(p_league uuid)
RETURNS TABLE (id uuid, name text, handicap numeric, created_at timestamptz)
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
  SELECT i.id, i.name, LEAST(i.handicap, l.handicap_cap)::numeric, i.created_at
    FROM public.league_invitees i
    JOIN public.leagues l ON l.id = i.league_id
   WHERE i.league_id = p_league AND i.claimed_by IS NULL
   ORDER BY lower(i.name), i.created_at, i.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_league_invitee(p_league uuid, p_invitee uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claimed uuid;
BEGIN
  IF NOT public.league_is_admin(p_league, auth.uid()) THEN
    RAISE EXCEPTION 'Only the league admin can do that.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.league_assert_open(p_league);
  SELECT claimed_by INTO v_claimed FROM public.league_invitees
   WHERE id = p_invitee AND league_id = p_league
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That spot is not in this league.' USING ERRCODE = 'P0001';
  END IF;
  IF v_claimed IS NOT NULL THEN
    RAISE EXCEPTION 'That player already joined.' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.league_invitees WHERE id = p_invitee;
END;
$$;

-- 9) Grants ------------------------------------------------------------------------
-- Supabase's default privileges grant EXECUTE on new public functions to anon.

REVOKE EXECUTE ON FUNCTION public.create_league(text, date, date, int[], numeric, int, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_league(text, date, date, int[], numeric, int, jsonb) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_league_by_code(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_league_by_code(text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.join_league(text, numeric, text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.join_league(text, numeric, text, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_league_invitees(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_league_invitees(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.remove_league_invitee(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.remove_league_invitee(uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_league_invite_preview(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_league_invite_preview(text) TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.get_league_invitee(text, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_league_invitee(text, uuid) TO anon, authenticated;

/* ===========================================================================
   VERIFY
   ---------------------------------------------------------------------------
   Smoke test (BEGIN … ROLLBACK, never persists):
     supabase/tests/league_invitees_smoke.sql

   -- One join_league, with the invitee parameter:
   SELECT pg_get_function_identity_arguments(p.oid) FROM pg_proc p
    WHERE p.proname = 'join_league';
   -- p_code text, p_proposed_handicap numeric, p_display_name text, p_invitee uuid

   -- anon can preview and greet a spot, but not join or list/remove spots:
   SELECT has_function_privilege('anon', 'public.get_league_invite_preview(text)', 'EXECUTE'),
          has_function_privilege('anon', 'public.get_league_invitee(text, uuid)', 'EXECUTE'),
          has_function_privilege('anon', 'public.join_league(text, numeric, text, uuid)', 'EXECUTE'),
          has_function_privilege('anon', 'public.get_league_invitees(uuid)', 'EXECUTE'),
          has_function_privilege('anon', 'public.remove_league_invitee(uuid, uuid)', 'EXECUTE');
   -- t, t, f, f, f

   -- The table is RPC-only:
   SELECT has_table_privilege('anon', 'public.league_invitees', 'SELECT'),
          has_table_privilege('authenticated', 'public.league_invitees', 'SELECT');
   -- f, f
   =========================================================================== */
