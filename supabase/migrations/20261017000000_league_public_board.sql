-- ============================================================================
-- League public board: a read-only standings page anyone with the link can
-- open, signed out (/league-board/<token>), and the link members share to the
-- group chat.
-- Plan: docs/superpowers/plans/2026-10-13-league-review-followups.md (D4 B).
-- Builds on 20261016000000_league_integrity.sql. Idempotent; safe to re-run.
-- ============================================================================
--
-- THE LINK
-- --------
--   leagues.public_board_token    32 url-safe chars from 24 random bytes,
--                                 created the first time a member asks for
--                                 it. It is NOT the invite code: knowing the
--                                 board link never lets anyone join.
--   leagues.public_board_enabled  default true. An admin can switch it off
--                                 (the link stops working; switching it back
--                                 on revives the same link) or make a new one
--                                 (the old link stops working for good).
--
-- RPCs
-- ----
--   get_league_share_link(p_league)            members: the token (created
--                                              lazily), NULL when switched off.
--   set_league_public_board(p_league, p_on)    admins: {enabled, token}.
--   rotate_league_public_board(p_league)       admins: {enabled, token}, a new token.
--   get_public_league_board(p_token)           anon + authenticated. NULL for
--                                              an unknown or switched-off token.
--
-- WHAT THE PUBLIC BOARD RETURNS (nothing else)
-- ---------------------------------------------
--   {
--     "league":  {"name", "season_start", "season_end", "points_table", "participation_points"},
--     "members": [{"key", "name", "active"}],
--     "cards":   [{"month", "member", "status", "points", "course"}]
--   }
--   * members: the active members, plus anyone who left but has a counting
--     card this season (their cards still rank). `name` is the profile's
--     display name as first name + initial of the first surname ("Íñigo
--     Echeverría Ruiz" -> "Íñigo E."), NULL without a display name (the page
--     shows a neutral label). Never the username: it comes from the email.
--     `key` is left(md5(token || ':' || user_id), 16): stable for one link,
--     useless without it, never the user id.
--   * cards: counting cards only — status confirmed, scored (points not
--     null), not waiting for an admin's approval — within the season.
--     `status` is always 'confirmed'; `course` is the course name only.
--   * Never: user ids, emails, photos, handicaps (league, playing or index),
--     holes, gross, differentials, tee data, marker or confirmation data,
--     the invite code, the token itself.
-- ============================================================================

-- 1) Columns ------------------------------------------------------------------
ALTER TABLE public.leagues ADD COLUMN IF NOT EXISTS public_board_token text;
ALTER TABLE public.leagues ADD COLUMN IF NOT EXISTS public_board_enabled boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leagues_public_board_token_key'
                   AND conrelid = 'public.leagues'::regclass) THEN
    ALTER TABLE public.leagues ADD CONSTRAINT leagues_public_board_token_key UNIQUE (public_board_token);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leagues_public_board_token_len'
                   AND conrelid = 'public.leagues'::regclass) THEN
    ALTER TABLE public.leagues ADD CONSTRAINT leagues_public_board_token_len
      CHECK (public_board_token IS NULL OR length(public_board_token) >= 20);
  END IF;
END $$;

-- 2) Internal helpers (nobody executes them) ------------------------------------

-- A fresh board token: 24 random bytes, base64url without padding (32 chars).
CREATE OR REPLACE FUNCTION public.league_new_board_token()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_token text;
BEGIN
  LOOP
    v_token := translate(encode(extensions.gen_random_bytes(24), 'base64'), E'+/=\n', '-_');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.leagues WHERE public_board_token = v_token);
  END LOOP;
  RETURN v_token;
END;
$$;

-- The public name rule, on a display name: first name + the initial of the
-- first surname, i.e. the second word ("Íñigo Echeverría Ruiz" -> "Íñigo E.",
-- "Miguel Ángel Domínguez" -> "Miguel Á."); one word stays; blank -> NULL.
-- The initial is the first character (code point), so an emoji stays whole.
-- Words split on the same whitespace set as JavaScript's \s, so the result
-- is identical to the client's leagueShare.publicNameRule.
CREATE OR REPLACE FUNCTION public.league_public_name_rule(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
           WHEN cardinality(w) = 0 THEN NULL
           WHEN cardinality(w) = 1 THEN w[1]
           ELSE w[1] || ' ' || upper(left(w[2], 1)) || '.'
         END
    FROM (SELECT array_remove(regexp_split_to_array(COALESCE(p_name, ''),
            E'[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+'), '') AS w) x;
$$;

-- A member's public name: the display name only, never the username.
CREATE OR REPLACE FUNCTION public.league_public_name(p_user uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT public.league_public_name_rule((SELECT display_name FROM public.profiles WHERE user_id = p_user));
$$;

REVOKE EXECUTE ON FUNCTION public.league_new_board_token() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.league_public_name(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.league_public_name_rule(text) FROM PUBLIC, anon, authenticated;

-- 3) Member and admin RPCs --------------------------------------------------------

-- Members: the board link's token, created the first time anyone asks.
-- NULL while an admin has the public board switched off.
CREATE OR REPLACE FUNCTION public.get_league_share_link(p_league uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_enabled boolean;
  v_token   text;
BEGIN
  IF NOT public.league_is_member(p_league, auth.uid()) THEN
    RAISE EXCEPTION 'Only league members can share the board.' USING ERRCODE = '42501';
  END IF;
  SELECT public_board_enabled, public_board_token INTO v_enabled, v_token
    FROM public.leagues WHERE id = p_league FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This league no longer exists.' USING ERRCODE = 'P0001', HINT = 'not_found';
  END IF;
  IF NOT v_enabled THEN
    RETURN NULL;
  END IF;
  IF v_token IS NULL THEN
    v_token := public.league_new_board_token();
    UPDATE public.leagues SET public_board_token = v_token WHERE id = p_league;
  END IF;
  RETURN v_token;
END;
$$;

-- Admins: switch the public board on or off. Off: the link stops working.
-- On: the same link works again (a token is created if there was none).
-- Returns {enabled, token}; token is NULL while switched off.
CREATE OR REPLACE FUNCTION public.set_league_public_board(p_league uuid, p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_token text;
BEGIN
  IF NOT public.league_is_admin(p_league, auth.uid()) THEN
    RAISE EXCEPTION 'Only a league admin can change the public board.' USING ERRCODE = '42501';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'Say whether the public board is on or off.' USING ERRCODE = 'P0001', HINT = 'invalid';
  END IF;
  SELECT public_board_token INTO v_token FROM public.leagues WHERE id = p_league FOR UPDATE;
  IF p_enabled AND v_token IS NULL THEN
    v_token := public.league_new_board_token();
  END IF;
  UPDATE public.leagues
     SET public_board_enabled = p_enabled, public_board_token = v_token
   WHERE id = p_league;
  RETURN jsonb_build_object('enabled', p_enabled, 'token', CASE WHEN p_enabled THEN v_token END);
END;
$$;

-- Admins: a new link; the old one stops working for good. Keeps on/off as it
-- is. Returns {enabled, token}; token is NULL while switched off.
CREATE OR REPLACE FUNCTION public.rotate_league_public_board(p_league uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_enabled boolean;
  v_token   text := public.league_new_board_token();
BEGIN
  IF NOT public.league_is_admin(p_league, auth.uid()) THEN
    RAISE EXCEPTION 'Only a league admin can make a new board link.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.leagues SET public_board_token = v_token
   WHERE id = p_league
  RETURNING public_board_enabled INTO v_enabled;
  RETURN jsonb_build_object('enabled', v_enabled, 'token', CASE WHEN v_enabled THEN v_token END);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_league_share_link(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_league_public_board(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rotate_league_public_board(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_league_share_link(uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.set_league_public_board(uuid, boolean) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.rotate_league_public_board(uuid) TO authenticated;

-- 4) The public board ---------------------------------------------------------------
-- Whitelist only (see the header): every field is named here, nothing is
-- passed through from a row.
CREATE OR REPLACE FUNCTION public.get_public_league_board(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_l       public.leagues%ROWTYPE;
  v_from    date;
  v_members jsonb;
  v_cards   jsonb;
BEGIN
  IF p_token IS NULL OR length(p_token) < 20 THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_l FROM public.leagues
   WHERE public_board_token = p_token AND public_board_enabled;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_from := date_trunc('month', v_l.season_start)::date;

  WITH counting AS (
    SELECT c.user_id, c.month, c.points, c.course ->> 'name' AS course
      FROM public.league_cards c
     WHERE c.league_id = v_l.id
       AND c.status = 'confirmed'
       AND c.points IS NOT NULL
       AND NOT ((c.not_announced OR c.tee_verified IS FALSE) AND c.approved_at IS NULL)
       AND c.month >= v_from AND c.month <= v_l.season_end
  ), people AS (
    SELECT m.user_id, (m.left_at IS NULL) AS active
      FROM public.league_members m
     WHERE m.league_id = v_l.id AND m.joined_at IS NOT NULL
       AND (m.left_at IS NULL OR EXISTS (SELECT 1 FROM counting k WHERE k.user_id = m.user_id))
  )
  SELECT
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'key',    left(md5(p_token || ':' || p.user_id::text), 16),
              'name',   public.league_public_name(p.user_id),
              'active', p.active)
            ORDER BY public.league_public_name(p.user_id) NULLS LAST, left(md5(p_token || ':' || p.user_id::text), 16)), '[]'::jsonb)
       FROM people p),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'month',  to_char(k.month, 'YYYY-MM-DD'),
              'member', left(md5(p_token || ':' || k.user_id::text), 16),
              'status', 'confirmed',
              'points', k.points,
              'course', k.course)
            ORDER BY k.month, k.points DESC), '[]'::jsonb)
       FROM counting k)
    INTO v_members, v_cards;

  RETURN jsonb_build_object(
    'league', jsonb_build_object(
      'name',                 v_l.name,
      'season_start',         to_char(v_l.season_start, 'YYYY-MM-DD'),
      'season_end',           to_char(v_l.season_end, 'YYYY-MM-DD'),
      'points_table',         to_jsonb(v_l.points_table),
      'participation_points', v_l.participation_points),
    'members', v_members,
    'cards',   v_cards);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_public_league_board(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_public_league_board(text) TO anon, authenticated;
