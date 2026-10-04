-- ============================================================================
-- Leagues ("El Club del Mulligan") — schema, RLS, proof bucket, RPCs.
-- Plan: docs/superpowers/plans/2026-10-04-league.md §3.1–§3.4 (build item P1).
-- Not here: the send-email function (§3.5, P10) and the league-cron jobs
-- (§6, P11). league_finals is created now for P12.
-- Idempotent; safe to re-run.
-- ============================================================================
--
-- SHAPE
-- -----
--   leagues                 one season of one group: rules + points table + invite code
--   league_members          user in a league: league handicap, fee paid, role
--   league_handicap_events  append-only handicap history (set / proposed / vote)
--   league_handicap_votes   + league_handicap_ballots: the group lowering/raising a handicap
--   league_cards            a member's card for one month, its frozen score and confirmation
--   league_marker_tokens    one-time 2 h token letting an outside marker confirm a card
--   league_finals           the December Final's tournament and extra strokes (P12)
--
-- RULES THE SERVER OWNS
-- ---------------------
-- * Every write goes through a SECURITY DEFINER RPC below. There are NO
--   INSERT/UPDATE/DELETE policies on league tables, and authenticated has those
--   table privileges revoked. That is what keeps announced_at a server clock,
--   the one-card-a-month rule, and the frozen snapshot out of the client's hands.
-- * Members (joined, not left) SELECT everything in their league.
-- * Membership states: joined_at NULL = invited by the admin, not joined yet;
--   left_at NOT NULL = left. "Active" = joined_at NOT NULL AND left_at IS NULL.
-- * Only get_marker_card / confirm_marker_card are granted to anon (they are
--   guarded by a 256-bit single-use token, like get_shared_board's token).
--
-- ERRORS the client shows
-- -----------------------
-- User-facing refusals are RAISE EXCEPTION with SQLSTATE P0001 and a message
-- the app can show as-is (e.g. "You already have your October card."). The
-- marker RPCs instead raise a bare code — 'invalid' | 'expired' | 'used' |
-- 'changed' — which MarkerCardScreen maps to its states. Permission failures
-- use SQLSTATE 42501.
--
-- OFF-APP CARD WITH NO ANNOUNCEMENT (plan L7)
-- -------------------------------------------
-- A separate RPC, add_unannounced_league_card, creates the card already
-- submitted with not_announced = true. submit_league_card only ever submits
-- an existing (announced) card, so its "who/what" is never ambiguous.
-- ============================================================================

-- 1) Tables -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.leagues (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL CHECK (length(btrim(name)) > 0),
  season_start     date NOT NULL,
  season_end       date NOT NULL,
  created_by       uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  points_table     int[] NOT NULL DEFAULT '{500,300,190,135,110,90,75,60,45,35,25,15}',
  handicap_cap     numeric(4,1) NOT NULL DEFAULT 30,
  entry_fee_cents  int NOT NULL DEFAULT 0 CHECK (entry_fee_cents >= 0),
  invite_code      text NOT NULL UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz,
  CONSTRAINT leagues_season_order CHECK (season_end >= season_start)
);

CREATE TABLE IF NOT EXISTS public.league_members (
  league_id        uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role             text NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  league_handicap  numeric(4,1),
  fee_paid         boolean NOT NULL DEFAULT false,
  joined_at        timestamptz,            -- NULL = invited, not joined yet
  left_at          timestamptz,
  PRIMARY KEY (league_id, user_id)
);
CREATE INDEX IF NOT EXISTS league_members_user_idx ON public.league_members (user_id);

CREATE TABLE IF NOT EXISTS public.league_handicap_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id  uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  old        numeric(4,1),
  new        numeric(4,1),
  reason     text NOT NULL CHECK (reason IN ('set','proposed','vote')),
  by_user    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS league_handicap_events_league_idx
  ON public.league_handicap_events (league_id, user_id, at);

CREATE TABLE IF NOT EXISTS public.league_handicap_votes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id     uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  subject_user  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  proposed      numeric(4,1) NOT NULL,
  opened_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  opened_at     timestamptz NOT NULL DEFAULT now(),
  closes_at     timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','passed','failed'))
);
-- A subject never has two open votes at once.
CREATE UNIQUE INDEX IF NOT EXISTS league_handicap_votes_one_open
  ON public.league_handicap_votes (league_id, subject_user) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS public.league_handicap_ballots (
  vote_id  uuid NOT NULL REFERENCES public.league_handicap_votes(id) ON DELETE CASCADE,
  voter    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  yes      boolean NOT NULL,
  at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vote_id, voter)
);

CREATE TABLE IF NOT EXISTS public.league_cards (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id          uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month              date NOT NULL,          -- first day of the month, Europe/Madrid
  source             text NOT NULL CHECK (source IN ('app','offapp')),
  status             text NOT NULL CHECK (status IN ('announced','playing','submitted','confirmed','void')),
  -- App cards. No FK: the card is announced BEFORE the game row exists
  -- (Setup's Start announces first), so the game is linked from this side.
  tournament_id      text,
  round_id           text,
  player_id          text,
  course             jsonb,                  -- {name, tee, holes:[{n,par,si}]}
  tee_time           timestamptz,
  played_on          date,
  announced_at       timestamptz,
  first_shot_at      timestamptz,
  not_announced      boolean NOT NULL DEFAULT false,
  league_handicap    numeric(4,1),
  playing_handicap   int,
  holes              jsonb,                  -- {"1":5,…,"18":6} frozen at submit
  gross              int,
  points             int,
  confirmation       text CHECK (confirmation IN ('partner','qr','photo','official')),
  confirmed_by_user  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_by_name  text,
  confirmed_at       timestamptz,
  proof_path         text,
  marker_note        text,
  voided_reason      text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT league_cards_app_ref CHECK (
    source <> 'app' OR (tournament_id IS NOT NULL AND round_id IS NOT NULL AND player_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_card_per_month
  ON public.league_cards (league_id, user_id, month) WHERE status <> 'void';
CREATE INDEX IF NOT EXISTS league_cards_league_month_idx
  ON public.league_cards (league_id, month);

CREATE TABLE IF NOT EXISTS public.league_marker_tokens (
  token          text PRIMARY KEY,
  card_id        uuid NOT NULL REFERENCES public.league_cards(id) ON DELETE CASCADE,
  snapshot_hash  text NOT NULL,
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS league_marker_tokens_card_idx
  ON public.league_marker_tokens (card_id);

CREATE TABLE IF NOT EXISTS public.league_finals (
  league_id      uuid PRIMARY KEY REFERENCES public.leagues(id) ON DELETE CASCADE,
  tournament_id  text NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  strokes        jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {"<user_id>": extra strokes}
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- 2) Helpers ------------------------------------------------------------------
-- SECURITY DEFINER STABLE, like is_tournament_member: the bodies bypass RLS so
-- the policies below never re-enter each other.

CREATE OR REPLACE FUNCTION public.is_league_member(lid uuid, uid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.league_members
     WHERE league_id = lid AND user_id = uid
       AND joined_at IS NOT NULL AND left_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.is_league_admin(lid uuid, uid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.league_members
     WHERE league_id = lid AND user_id = uid AND role = 'admin'
       AND joined_at IS NOT NULL AND left_at IS NULL
  );
$$;

-- Storage helpers take the object NAME (text) so a malformed path can never
-- raise inside a policy on a failed ::uuid cast — it simply matches nothing.
-- Object key: `<league_id>/<card_id>.<ext>`.
CREATE OR REPLACE FUNCTION public.can_read_league_proof(p_name text, uid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.league_members m
     WHERE m.league_id::text = split_part(p_name, '/', 1)
       AND m.user_id = uid
       AND m.joined_at IS NOT NULL AND m.left_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.can_write_league_proof(p_name text, uid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.league_cards c
     WHERE c.league_id::text = split_part(p_name, '/', 1)
       AND c.id::text = split_part(split_part(p_name, '/', 2), '.', 1)
       AND split_part(p_name, '/', 3) = ''
       AND c.user_id = uid
       AND c.status IN ('announced','playing','submitted')
       AND public.is_league_member(c.league_id, uid)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_league_member(uuid, uuid)        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_league_admin(uuid, uuid)         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_read_league_proof(text, uuid)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_write_league_proof(text, uuid)  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_league_member(uuid, uuid)        TO authenticated;
GRANT  EXECUTE ON FUNCTION public.is_league_admin(uuid, uuid)         TO authenticated;
GRANT  EXECUTE ON FUNCTION public.can_read_league_proof(text, uuid)   TO authenticated;
GRANT  EXECUTE ON FUNCTION public.can_write_league_proof(text, uuid)  TO authenticated;

-- Internal helpers (called only from the RPCs below; nobody may call them).

-- 8 chars from an alphabet without 0/O/1/I/L.
CREATE OR REPLACE FUNCTION public.league_new_invite_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_alpha constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_code  text;
BEGIN
  LOOP
    v_bytes := extensions.gen_random_bytes(8);
    v_code := '';
    FOR i IN 0..7 LOOP
      v_code := v_code || substr(v_alpha, (get_byte(v_bytes, i) % length(v_alpha)) + 1, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.leagues WHERE invite_code = v_code);
  END LOOP;
  RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.league_user_name(p_user uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT COALESCE(NULLIF(btrim(display_name), ''), username)
       FROM public.profiles WHERE user_id = p_user),
    'A golfer');
$$;

-- Fan out one notification to every OTHER active member of the league.
-- data always carries league_id, league_name and actor_name.
CREATE OR REPLACE FUNCTION public.notify_league_members(
  p_league uuid, p_actor uuid, p_type text, p_entity uuid, p_data jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_data jsonb;
BEGIN
  SELECT COALESCE(p_data, '{}'::jsonb) || jsonb_build_object(
           'league_id',   l.id,
           'league_name', l.name,
           'actor_name',  public.league_user_name(p_actor))
    INTO v_data
    FROM public.leagues l WHERE l.id = p_league;

  INSERT INTO public.notifications (user_id, type, actor_id, entity_id, data)
  SELECT m.user_id, p_type, p_actor, p_entity, v_data
    FROM public.league_members m
   WHERE m.league_id = p_league
     AND m.joined_at IS NOT NULL AND m.left_at IS NULL
     AND m.user_id IS DISTINCT FROM p_actor;
END;
$$;

-- Validate a strokes snapshot and return it in canonical form
-- ({"1":n,…,"18":n}, integers 1..30, nothing else) so md5(holes::text) is stable.
CREATE OR REPLACE FUNCTION public.league_canonical_holes(p_holes jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_ok int;
BEGIN
  IF p_holes IS NULL OR jsonb_typeof(p_holes) <> 'object'
     OR (SELECT count(*) FROM jsonb_object_keys(p_holes)) <> 18 THEN
    RAISE EXCEPTION 'A league card needs a score on every hole, 1 to 18.' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_ok
    FROM generate_series(1, 18) n
   WHERE CASE WHEN jsonb_typeof(p_holes -> n::text) = 'number'
              THEN (p_holes ->> n::text)::numeric = trunc((p_holes ->> n::text)::numeric)
                   AND (p_holes ->> n::text)::numeric BETWEEN 1 AND 30
              ELSE false END;
  IF v_ok <> 18 THEN
    RAISE EXCEPTION 'A league card needs a score on every hole, 1 to 18.' USING ERRCODE = 'P0001';
  END IF;
  RETURN (SELECT jsonb_object_agg(n::text, (p_holes ->> n::text)::int)
            FROM generate_series(1, 18) n);
END;
$$;

CREATE OR REPLACE FUNCTION public.league_month_of(p_ts timestamptz)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT date_trunc('month', p_ts AT TIME ZONE 'Europe/Madrid')::date;
$$;

-- An archived league stays readable but refuses every write that would
-- change the season (announce, submit, add-unannounced, votes).
CREATE OR REPLACE FUNCTION public.league_assert_open(p_league uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.leagues WHERE id = p_league AND archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'This league has been archived. You can still look at it, but not change it.'
      USING ERRCODE = 'P0001', HINT = 'league_archived';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.league_assert_open(uuid)                          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.league_new_invite_code()                          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.league_user_name(uuid)                            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_league_members(uuid, uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.league_canonical_holes(jsonb)                     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.league_month_of(timestamptz)                      FROM PUBLIC, anon, authenticated;

-- 3) RLS ----------------------------------------------------------------------
-- SELECT for members only; no write policies at all.

ALTER TABLE public.leagues                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_members          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_handicap_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_handicap_votes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_handicap_ballots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_cards            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_marker_tokens    ENABLE ROW LEVEL SECURITY;  -- no policy: RPC-only
ALTER TABLE public.league_finals           ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leagues_select ON public.leagues;
CREATE POLICY leagues_select ON public.leagues
  FOR SELECT TO authenticated
  USING (public.is_league_member(id, auth.uid()));

DROP POLICY IF EXISTS league_members_select ON public.league_members;
CREATE POLICY league_members_select ON public.league_members
  FOR SELECT TO authenticated
  USING (public.is_league_member(league_id, auth.uid()));

DROP POLICY IF EXISTS league_handicap_events_select ON public.league_handicap_events;
CREATE POLICY league_handicap_events_select ON public.league_handicap_events
  FOR SELECT TO authenticated
  USING (public.is_league_member(league_id, auth.uid()));

DROP POLICY IF EXISTS league_handicap_votes_select ON public.league_handicap_votes;
CREATE POLICY league_handicap_votes_select ON public.league_handicap_votes
  FOR SELECT TO authenticated
  USING (public.is_league_member(league_id, auth.uid()));

DROP POLICY IF EXISTS league_handicap_ballots_select ON public.league_handicap_ballots;
CREATE POLICY league_handicap_ballots_select ON public.league_handicap_ballots
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.league_handicap_votes v
     WHERE v.id = league_handicap_ballots.vote_id
       AND public.is_league_member(v.league_id, auth.uid())));

DROP POLICY IF EXISTS league_cards_select ON public.league_cards;
CREATE POLICY league_cards_select ON public.league_cards
  FOR SELECT TO authenticated
  USING (public.is_league_member(league_id, auth.uid()));

DROP POLICY IF EXISTS league_finals_select ON public.league_finals;
CREATE POLICY league_finals_select ON public.league_finals
  FOR SELECT TO authenticated
  USING (public.is_league_member(league_id, auth.uid()));

-- Belt and braces on top of "no policy": anon gets nothing, authenticated
-- can only read.
REVOKE ALL ON public.leagues, public.league_members, public.league_handicap_events,
              public.league_handicap_votes, public.league_handicap_ballots,
              public.league_cards, public.league_marker_tokens, public.league_finals
  FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.leagues, public.league_members, public.league_handicap_events,
     public.league_handicap_votes, public.league_handicap_ballots,
     public.league_cards, public.league_marker_tokens, public.league_finals
  FROM authenticated;
REVOKE ALL ON public.league_marker_tokens FROM authenticated;

-- 4) Proof bucket -------------------------------------------------------------
-- PRIVATE: read through signed URLs by league members; the card owner writes
-- `<league_id>/<card_id>.<ext>` while the card is not yet confirmed.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('league-proofs', 'league-proofs', false, 10 * 1024 * 1024,
        ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif'])
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "league-proofs member read"  ON storage.objects;
DROP POLICY IF EXISTS "league-proofs owner insert" ON storage.objects;
DROP POLICY IF EXISTS "league-proofs owner update" ON storage.objects;

CREATE POLICY "league-proofs member read"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'league-proofs' AND public.can_read_league_proof(name, auth.uid()));

CREATE POLICY "league-proofs owner insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'league-proofs' AND public.can_write_league_proof(name, auth.uid()));

-- Re-taking the photo overwrites the same key (upsert).
CREATE POLICY "league-proofs owner update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'league-proofs' AND public.can_write_league_proof(name, auth.uid()))
WITH CHECK (bucket_id = 'league-proofs' AND public.can_write_league_proof(name, auth.uid()));

-- 5) RPCs: leagues and membership ----------------------------------------------

-- p_members: [{"user_id": "<uuid>", "handicap": 18.0}, …] — friends of the
-- creator, added as invited (joined_at NULL) with the proposed handicap.
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
    IF v_mu IS NULL THEN CONTINUE; END IF;
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

-- Join-screen summary. NULL for an unknown code (like get_shared_board).
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
    'is_member',         (v_me.joined_at IS NOT NULL AND v_me.left_at IS NULL));
END;
$$;

-- Adds or re-activates the membership. A handicap different from the admin's
-- is recorded as a 'proposed' event (the admin decides); with no admin value
-- yet, the member's own figure is used until the admin sets one.
CREATE OR REPLACE FUNCTION public.join_league(p_code text, p_proposed_handicap numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_l   public.leagues%ROWTYPE;
  v_old numeric(4,1);
  v_new numeric(4,1);
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

CREATE OR REPLACE FUNCTION public.set_league_handicap(p_league uuid, p_user uuid, p_value numeric)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_old numeric(4,1);
  v_new numeric(4,1);
BEGIN
  IF NOT public.is_league_admin(p_league, v_uid) THEN
    RAISE EXCEPTION 'Only the league admin can do that.' USING ERRCODE = '42501';
  END IF;
  IF p_value IS NULL THEN
    RAISE EXCEPTION 'A handicap is required.' USING ERRCODE = 'P0001';
  END IF;
  SELECT LEAST(p_value, handicap_cap) INTO v_new FROM public.leagues WHERE id = p_league;
  SELECT league_handicap INTO v_old FROM public.league_members
   WHERE league_id = p_league AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That player is not in this league.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.league_members SET league_handicap = v_new
   WHERE league_id = p_league AND user_id = p_user;
  INSERT INTO public.league_handicap_events (league_id, user_id, old, new, reason, by_user)
  VALUES (p_league, p_user, v_old, v_new, 'set', v_uid);
  RETURN v_new;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_league_fee_paid(p_league uuid, p_user uuid, p_paid boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_league_admin(p_league, auth.uid()) THEN
    RAISE EXCEPTION 'Only the league admin can do that.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.league_members SET fee_paid = COALESCE(p_paid, false)
   WHERE league_id = p_league AND user_id = p_user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That player is not in this league.' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- NULL arguments keep the current value. Lowering the cap clamps every member
-- above it, with a 'set' event each (plan §5: every write is clamped).
CREATE OR REPLACE FUNCTION public.update_league_rules(
  p_league uuid, p_name text, p_season_start date, p_season_end date,
  p_points_table int[], p_cap numeric, p_fee_cents int
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cap numeric(4,1);
BEGIN
  IF NOT public.is_league_admin(p_league, v_uid) THEN
    RAISE EXCEPTION 'Only the league admin can do that.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.leagues
     SET name            = COALESCE(NULLIF(btrim(p_name), ''), name),
         season_start    = COALESCE(p_season_start, season_start),
         season_end      = COALESCE(p_season_end, season_end),
         points_table    = COALESCE(p_points_table, points_table),
         handicap_cap    = COALESCE(p_cap, handicap_cap),
         entry_fee_cents = CASE WHEN p_fee_cents IS NULL THEN entry_fee_cents
                                ELSE GREATEST(p_fee_cents, 0) END
   WHERE id = p_league
  RETURNING handicap_cap INTO v_cap;

  WITH clamped AS (
    UPDATE public.league_members m
       SET league_handicap = v_cap
      FROM (SELECT user_id, league_handicap AS old
              FROM public.league_members
             WHERE league_id = p_league AND league_handicap > v_cap) o
     WHERE m.league_id = p_league AND m.user_id = o.user_id
    RETURNING m.user_id, o.old
  )
  INSERT INTO public.league_handicap_events (league_id, user_id, old, new, reason, by_user)
  SELECT p_league, user_id, old, v_cap, 'set', v_uid FROM clamped;
END;
$$;

-- The last admin cannot leave while others remain: nobody could administer it.
CREATE OR REPLACE FUNCTION public.leave_league(p_league uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF NOT public.is_league_member(p_league, v_uid) THEN
    RAISE EXCEPTION 'You are not in this league.' USING ERRCODE = 'P0001';
  END IF;
  IF public.is_league_admin(p_league, v_uid)
     AND NOT EXISTS (SELECT 1 FROM public.league_members
                      WHERE league_id = p_league AND user_id <> v_uid AND role = 'admin'
                        AND joined_at IS NOT NULL AND left_at IS NULL)
     AND EXISTS (SELECT 1 FROM public.league_members
                  WHERE league_id = p_league AND user_id <> v_uid
                    AND joined_at IS NOT NULL AND left_at IS NULL) THEN
    RAISE EXCEPTION 'You are the only admin. Make someone else admin first, then leave.'
      USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.league_members SET left_at = now()
   WHERE league_id = p_league AND user_id = v_uid;
END;
$$;

-- Promote or demote an active member. The last active admin can never be
-- demoted (by themselves or anyone), so a league always has an admin.
CREATE OR REPLACE FUNCTION public.set_league_role(p_league uuid, p_user uuid, p_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cur text;
BEGIN
  IF NOT public.is_league_admin(p_league, auth.uid()) THEN
    RAISE EXCEPTION 'Only the league admin can do that.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_role, '') NOT IN ('admin','member') THEN
    RAISE EXCEPTION 'A role is admin or member.' USING ERRCODE = 'P0001';
  END IF;
  SELECT role INTO v_cur FROM public.league_members
   WHERE league_id = p_league AND user_id = p_user
     AND joined_at IS NOT NULL AND left_at IS NULL
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That player is not in this league.' USING ERRCODE = 'P0001';
  END IF;
  IF v_cur = 'admin' AND p_role = 'member'
     AND NOT EXISTS (SELECT 1 FROM public.league_members
                      WHERE league_id = p_league AND user_id <> p_user AND role = 'admin'
                        AND joined_at IS NOT NULL AND left_at IS NULL) THEN
    RAISE EXCEPTION 'A league needs at least one admin. Make someone else admin first.'
      USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.league_members SET role = p_role
   WHERE league_id = p_league AND user_id = p_user;
END;
$$;

-- Ends the league for writes; everything stays readable. Idempotent.
CREATE OR REPLACE FUNCTION public.archive_league(p_league uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_league_admin(p_league, auth.uid()) THEN
    RAISE EXCEPTION 'Only the league admin can do that.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.leagues SET archived_at = COALESCE(archived_at, now()) WHERE id = p_league;
END;
$$;

-- 6) RPCs: handicap votes -----------------------------------------------------
-- Threshold = ceil(2/3 × active members) yes votes; closes after 7 days
-- (plan D2). Passing applies the change at once, clamped to the cap. A vote
-- that can no longer reach the threshold fails at once. Expiry of untouched
-- votes is the league-cron's job (P11); until then, a stale open vote is
-- failed lazily by the next open_/cast_ on it. Opening a vote casts the
-- opener's yes ballot.

-- Count the ballots of a locked, open vote and pass/fail it. Internal.
CREATE OR REPLACE FUNCTION public.league_settle_vote(p_vote uuid, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vote      public.league_handicap_votes%ROWTYPE;
  v_active    int;
  v_threshold int;
  v_yes       int;
  v_no        int;
  v_old       numeric(4,1);
  v_new       numeric(4,1);
BEGIN
  SELECT * INTO v_vote FROM public.league_handicap_votes WHERE id = p_vote;
  SELECT count(*) INTO v_active FROM public.league_members
   WHERE league_id = v_vote.league_id AND joined_at IS NOT NULL AND left_at IS NULL;
  v_threshold := ceil(v_active * 2 / 3.0)::int;
  -- Only ballots of members who are still active count.
  SELECT count(*) FILTER (WHERE b.yes), count(*) FILTER (WHERE NOT b.yes)
    INTO v_yes, v_no
    FROM public.league_handicap_ballots b
   WHERE b.vote_id = p_vote AND public.is_league_member(v_vote.league_id, b.voter);

  IF v_yes >= v_threshold THEN
    SELECT league_handicap INTO v_old FROM public.league_members
     WHERE league_id = v_vote.league_id AND user_id = v_vote.subject_user FOR UPDATE;
    SELECT LEAST(v_vote.proposed, handicap_cap) INTO v_new
      FROM public.leagues WHERE id = v_vote.league_id;
    UPDATE public.league_members SET league_handicap = v_new
     WHERE league_id = v_vote.league_id AND user_id = v_vote.subject_user;
    INSERT INTO public.league_handicap_events (league_id, user_id, old, new, reason, by_user)
    VALUES (v_vote.league_id, v_vote.subject_user, v_old, v_new, 'vote', p_actor);
    UPDATE public.league_handicap_votes SET status = 'passed' WHERE id = p_vote;
    v_vote.status := 'passed';
  ELSIF v_active - v_no < v_threshold THEN
    UPDATE public.league_handicap_votes SET status = 'failed' WHERE id = p_vote;
    v_vote.status := 'failed';
  END IF;

  RETURN jsonb_build_object('status', v_vote.status, 'yes', v_yes, 'no', v_no,
                            'threshold', v_threshold);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.league_settle_vote(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.open_handicap_vote(p_league uuid, p_subject uuid, p_proposed numeric)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_id   uuid;
  v_cap  numeric(4,1);
  v_old  numeric(4,1);
  v_new  numeric(4,1);
BEGIN
  IF NOT public.is_league_member(p_league, v_uid) THEN
    RAISE EXCEPTION 'You are not in this league.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.is_league_member(p_league, p_subject) THEN
    RAISE EXCEPTION 'That player is not in this league.' USING ERRCODE = 'P0001';
  END IF;
  IF p_proposed IS NULL THEN
    RAISE EXCEPTION 'A handicap is required.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.league_assert_open(p_league);

  UPDATE public.league_handicap_votes SET status = 'failed'
   WHERE league_id = p_league AND subject_user = p_subject
     AND status = 'open' AND closes_at < now();

  IF EXISTS (SELECT 1 FROM public.league_handicap_votes
              WHERE league_id = p_league AND subject_user = p_subject AND status = 'open') THEN
    RAISE EXCEPTION 'There is already an open vote on this player''s handicap.' USING ERRCODE = 'P0001';
  END IF;

  SELECT handicap_cap INTO v_cap FROM public.leagues WHERE id = p_league;
  SELECT league_handicap INTO v_old FROM public.league_members
   WHERE league_id = p_league AND user_id = p_subject;
  v_new := LEAST(p_proposed, v_cap);

  BEGIN
    INSERT INTO public.league_handicap_votes
      (league_id, subject_user, proposed, opened_by, opened_at, closes_at)
    VALUES (p_league, p_subject, v_new, v_uid, now(), now() + interval '7 days')
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'There is already an open vote on this player''s handicap.' USING ERRCODE = 'P0001';
  END;

  -- The opener is for it.
  INSERT INTO public.league_handicap_ballots (vote_id, voter, yes, at)
  VALUES (v_id, v_uid, true, now());

  PERFORM public.notify_league_members(p_league, v_uid, 'league_vote_opened', v_id,
    jsonb_build_object(
      'vote_id',      v_id,
      'subject_id',   p_subject,
      'subject_name', public.league_user_name(p_subject),
      'old',          v_old,
      'proposed',     v_new,
      'closes_at',    now() + interval '7 days'));
  -- In a tiny league the opener's yes alone can reach the threshold.
  PERFORM public.league_settle_vote(v_id, v_uid);
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cast_handicap_ballot(p_vote uuid, p_yes boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_vote      public.league_handicap_votes%ROWTYPE;
BEGIN
  SELECT * INTO v_vote FROM public.league_handicap_votes WHERE id = p_vote FOR UPDATE;
  IF NOT FOUND OR NOT public.is_league_member(v_vote.league_id, v_uid) THEN
    RAISE EXCEPTION 'Vote not found.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.league_assert_open(v_vote.league_id);
  IF v_vote.status = 'open' AND v_vote.closes_at < now() THEN
    UPDATE public.league_handicap_votes SET status = 'failed' WHERE id = p_vote;
    v_vote.status := 'failed';
  END IF;
  IF v_vote.status <> 'open' THEN
    RAISE EXCEPTION 'This vote is closed.' USING ERRCODE = 'P0001';
  END IF;
  IF p_yes IS NULL THEN
    RAISE EXCEPTION 'Vote yes or no.' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.league_handicap_ballots (vote_id, voter, yes, at)
  VALUES (p_vote, v_uid, p_yes, now())
  ON CONFLICT (vote_id, voter) DO UPDATE SET yes = EXCLUDED.yes, at = EXCLUDED.at;

  RETURN public.league_settle_vote(p_vote, v_uid);
END;
$$;

-- 7) RPCs: cards ----------------------------------------------------------------

-- One non-void card per (league, user, month), month = the tee time's month
-- in Europe/Madrid. announced_at is the server clock. App cards start
-- 'playing' (Setup's Start), off-app cards 'announced'.
CREATE OR REPLACE FUNCTION public.announce_league_card(
  p_league uuid, p_source text, p_course jsonb, p_tee_time timestamptz,
  p_tournament_id text DEFAULT NULL, p_round_id text DEFAULT NULL, p_player_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_tee   timestamptz := COALESCE(p_tee_time, now());
  v_month date;
  v_hcp   numeric(4,1);
  v_id    uuid;
BEGIN
  IF NOT public.is_league_member(p_league, v_uid) THEN
    RAISE EXCEPTION 'You are not in this league.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.league_assert_open(p_league);
  IF COALESCE(p_source, '') NOT IN ('app','offapp') THEN
    RAISE EXCEPTION 'Unknown card source %', p_source USING ERRCODE = 'P0001';
  END IF;
  IF p_source = 'app' AND (p_tournament_id IS NULL OR p_round_id IS NULL OR p_player_id IS NULL) THEN
    RAISE EXCEPTION 'An app card needs its game, round and player.' USING ERRCODE = 'P0001';
  END IF;
  IF p_course IS NULL OR jsonb_typeof(p_course) <> 'object'
     OR NULLIF(btrim(COALESCE(p_course ->> 'name', '')), '') IS NULL THEN
    RAISE EXCEPTION 'Pick the course you are playing.' USING ERRCODE = 'P0001';
  END IF;

  v_month := public.league_month_of(v_tee);
  IF EXISTS (SELECT 1 FROM public.league_cards
              WHERE league_id = p_league AND user_id = v_uid
                AND month = v_month AND status <> 'void') THEN
    RAISE EXCEPTION 'You already have your % card.', to_char(v_month, 'FMMonth')
      USING ERRCODE = 'P0001', HINT = 'card_exists';
  END IF;

  SELECT league_handicap INTO v_hcp FROM public.league_members
   WHERE league_id = p_league AND user_id = v_uid;

  BEGIN
    INSERT INTO public.league_cards
      (league_id, user_id, month, source, status, tournament_id, round_id, player_id,
       course, tee_time, played_on, announced_at, league_handicap)
    VALUES
      (p_league, v_uid, v_month, p_source,
       CASE WHEN p_source = 'app' THEN 'playing' ELSE 'announced' END,
       p_tournament_id, p_round_id, p_player_id,
       p_course, v_tee, (v_tee AT TIME ZONE 'Europe/Madrid')::date, now(), v_hcp)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- Lost a race with a second device announcing the same month.
    RAISE EXCEPTION 'You already have your % card.', to_char(v_month, 'FMMonth')
      USING ERRCODE = 'P0001', HINT = 'card_exists';
  END;

  PERFORM public.notify_league_members(p_league, v_uid, 'league_card_announced', v_id,
    jsonb_build_object(
      'card_id',     v_id,
      'source',      p_source,
      'course_name', p_course ->> 'name',
      'tee',         p_course ->> 'tee',
      'tee_time',    v_tee,
      'month',       v_month,
      'tournament_id', p_tournament_id,
      'round_id',      p_round_id));

  RETURN jsonb_build_object('id', v_id, 'month', v_month, 'announced_at', now(),
                            'league_handicap', v_hcp);
END;
$$;

-- The scorecard's first score tap on a league round. Idempotent.
CREATE OR REPLACE FUNCTION public.notify_league_tee_off(p_card uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_c   public.league_cards%ROWTYPE;
BEGIN
  SELECT * INTO v_c FROM public.league_cards WHERE id = p_card;
  IF NOT FOUND OR v_c.user_id IS DISTINCT FROM v_uid
     OR NOT public.is_league_member(v_c.league_id, v_uid) THEN
    RAISE EXCEPTION 'Card not found.' USING ERRCODE = 'P0001';
  END IF;
  IF v_c.status NOT IN ('announced','playing') THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.notifications
              WHERE actor_id = v_uid AND type = 'league_tee_off' AND entity_id = p_card) THEN
    RETURN;
  END IF;
  PERFORM public.notify_league_members(v_c.league_id, v_uid, 'league_tee_off', p_card,
    jsonb_build_object(
      'card_id',       p_card,
      'course_name',   v_c.course ->> 'name',
      'tee',           v_c.course ->> 'tee',
      'tournament_id', v_c.tournament_id,
      'round_id',      v_c.round_id));
END;
$$;

-- Freezes the snapshot. Allowed while the card is announced/playing, and
-- again while 'submitted' (e.g. after a marker reported a problem) — never
-- once confirmed or void (fixing those is void + a new card, plan §5).
-- App cards copy first_shot_at from the round's body.startedAt.
CREATE OR REPLACE FUNCTION public.submit_league_card(
  p_card uuid, p_holes jsonb, p_gross int, p_points int, p_playing_handicap int,
  p_played_on date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_c      public.league_cards%ROWTYPE;
  v_holes  jsonb;
  v_first  timestamptz;
  v_raw    jsonb;
  v_not    boolean;
BEGIN
  SELECT * INTO v_c FROM public.league_cards WHERE id = p_card FOR UPDATE;
  IF NOT FOUND OR v_c.user_id IS DISTINCT FROM v_uid
     OR NOT public.is_league_member(v_c.league_id, v_uid) THEN
    RAISE EXCEPTION 'Card not found.' USING ERRCODE = 'P0001';
  END IF;
  IF v_c.status NOT IN ('announced','playing','submitted') THEN
    RAISE EXCEPTION 'This card can no longer be changed.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.league_assert_open(v_c.league_id);
  IF p_played_on IS NOT NULL AND date_trunc('month', p_played_on)::date <> v_c.month THEN
    RAISE EXCEPTION 'This is your % card, but the date is in %. Check the date.',
      to_char(v_c.month, 'FMMonth'), to_char(p_played_on, 'FMMonth')
      USING ERRCODE = 'P0001', HINT = 'month_mismatch';
  END IF;

  v_holes := public.league_canonical_holes(p_holes);
  IF p_gross IS DISTINCT FROM (SELECT sum(value::int) FROM jsonb_each_text(v_holes)) THEN
    RAISE EXCEPTION 'The total does not match the holes.' USING ERRCODE = 'P0001';
  END IF;
  IF p_points IS NULL OR p_points < 0 OR p_playing_handicap IS NULL THEN
    RAISE EXCEPTION 'Points and playing handicap are required.' USING ERRCODE = 'P0001';
  END IF;

  v_first := v_c.first_shot_at;
  IF v_c.source = 'app' THEN
    SELECT body -> 'startedAt' INTO v_raw FROM public.game_rounds
     WHERE tournament_id = v_c.tournament_id AND id = v_c.round_id;
    v_first := CASE jsonb_typeof(v_raw)
                 WHEN 'string' THEN (v_raw #>> '{}')::timestamptz
                 WHEN 'number' THEN to_timestamp((v_raw #>> '{}')::double precision / 1000)
                 ELSE NULL END;
  END IF;
  v_not := v_c.announced_at IS NULL OR COALESCE(v_first < v_c.announced_at, false);

  UPDATE public.league_cards
     SET holes = v_holes, gross = p_gross, points = p_points,
         playing_handicap = p_playing_handicap,
         played_on = COALESCE(p_played_on, played_on),
         first_shot_at = v_first, not_announced = v_not,
         status = 'submitted', updated_at = now()
   WHERE id = p_card;

  RETURN jsonb_build_object('id', p_card, 'status', 'submitted',
                            'not_announced', v_not, 'first_shot_at', v_first);
END;
$$;

-- Plan L7: an off-app card added without an announcement in the app. Created
-- already submitted and labelled not_announced; the one-card rule still holds.
CREATE OR REPLACE FUNCTION public.add_unannounced_league_card(
  p_league uuid, p_course jsonb, p_tee_time timestamptz, p_played_on date,
  p_holes jsonb, p_gross int, p_points int, p_playing_handicap int
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_month date;
  v_holes jsonb;
  v_hcp   numeric(4,1);
  v_id    uuid;
BEGIN
  IF NOT public.is_league_member(p_league, v_uid) THEN
    RAISE EXCEPTION 'You are not in this league.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.league_assert_open(p_league);
  IF p_course IS NULL OR jsonb_typeof(p_course) <> 'object'
     OR NULLIF(btrim(COALESCE(p_course ->> 'name', '')), '') IS NULL THEN
    RAISE EXCEPTION 'Pick the course you played.' USING ERRCODE = 'P0001';
  END IF;
  IF p_tee_time IS NULL AND p_played_on IS NULL THEN
    RAISE EXCEPTION 'When did you play?' USING ERRCODE = 'P0001';
  END IF;
  v_month := CASE WHEN p_tee_time IS NOT NULL THEN public.league_month_of(p_tee_time)
                  ELSE date_trunc('month', p_played_on)::date END;
  IF p_played_on IS NOT NULL AND date_trunc('month', p_played_on)::date <> v_month THEN
    RAISE EXCEPTION 'The tee time is in % but the date is in %. Check the date.',
      to_char(v_month, 'FMMonth'), to_char(p_played_on, 'FMMonth')
      USING ERRCODE = 'P0001', HINT = 'month_mismatch';
  END IF;

  v_holes := public.league_canonical_holes(p_holes);
  IF p_gross IS DISTINCT FROM (SELECT sum(value::int) FROM jsonb_each_text(v_holes)) THEN
    RAISE EXCEPTION 'The total does not match the holes.' USING ERRCODE = 'P0001';
  END IF;
  IF p_points IS NULL OR p_points < 0 OR p_playing_handicap IS NULL THEN
    RAISE EXCEPTION 'Points and playing handicap are required.' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM public.league_cards
              WHERE league_id = p_league AND user_id = v_uid
                AND month = v_month AND status <> 'void') THEN
    RAISE EXCEPTION 'You already have your % card.', to_char(v_month, 'FMMonth')
      USING ERRCODE = 'P0001', HINT = 'card_exists';
  END IF;

  SELECT league_handicap INTO v_hcp FROM public.league_members
   WHERE league_id = p_league AND user_id = v_uid;

  BEGIN
    INSERT INTO public.league_cards
      (league_id, user_id, month, source, status, course, tee_time, played_on,
       announced_at, not_announced, league_handicap, playing_handicap,
       holes, gross, points)
    VALUES
      (p_league, v_uid, v_month, 'offapp', 'submitted', p_course, p_tee_time,
       COALESCE(p_played_on, (p_tee_time AT TIME ZONE 'Europe/Madrid')::date),
       NULL, true, v_hcp, p_playing_handicap, v_holes, p_gross, p_points)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'You already have your % card.', to_char(v_month, 'FMMonth')
      USING ERRCODE = 'P0001', HINT = 'card_exists';
  END;

  RETURN jsonb_build_object('id', v_id, 'month', v_month, 'status', 'submitted',
                            'not_announced', true);
END;
$$;

-- Shared tail of every confirmation path.
CREATE OR REPLACE FUNCTION public.league_confirm_card(
  p_card uuid, p_how text, p_by_user uuid, p_by_name text, p_proof text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_c public.league_cards%ROWTYPE;
BEGIN
  UPDATE public.league_cards
     SET status = 'confirmed', confirmation = p_how,
         confirmed_by_user = p_by_user, confirmed_by_name = p_by_name,
         confirmed_at = now(), proof_path = COALESCE(p_proof, proof_path),
         updated_at = now()
   WHERE id = p_card
  RETURNING * INTO v_c;
  -- Any QR still outstanding for this card is dead now.
  UPDATE public.league_marker_tokens SET expires_at = LEAST(expires_at, now())
   WHERE card_id = p_card AND used_at IS NULL;

  PERFORM public.notify_league_members(v_c.league_id, v_c.user_id, 'league_card_confirmed', p_card,
    jsonb_build_object(
      'card_id',       p_card,
      'course_name',   v_c.course ->> 'name',
      'points',        v_c.points,
      'gross',         v_c.gross,
      'confirmation',  p_how,
      'confirmed_by',  p_by_name,
      'not_announced', v_c.not_announced,
      'month',         v_c.month));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.league_confirm_card(uuid, text, uuid, text, text)
  FROM PUBLIC, anon, authenticated;

-- In-app partner confirmation (plan L4). The server decides:
--   * the card's player belongs to the owner (game_players.user_id),
--   * every hole 1..18 of that player is settled non-null in game_scores and
--     equals the submitted snapshot,
--   * one scorer_cards row whose scorer.userId is a signed-in user OTHER than
--     the owner marks that player on all 18 holes.
-- A check that fails is not an error: it returns confirmed=false with the
-- counts, so Validate can fall back to the QR.
CREATE OR REPLACE FUNCTION public.confirm_league_card_by_partner(p_card uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_c        public.league_cards%ROWTYPE;
  v_settled  int;
  v_match    int;
  v_partner  text;
  v_marked   int := 0;
  v_puid     uuid;
  v_pname    text;
BEGIN
  SELECT * INTO v_c FROM public.league_cards WHERE id = p_card FOR UPDATE;
  IF NOT FOUND OR v_c.user_id IS DISTINCT FROM v_uid
     OR NOT public.is_league_member(v_c.league_id, v_uid) THEN
    RAISE EXCEPTION 'Card not found.' USING ERRCODE = 'P0001';
  END IF;
  IF v_c.source <> 'app' THEN
    RAISE EXCEPTION 'Only cards played in the app can be confirmed by a partner.' USING ERRCODE = 'P0001';
  END IF;
  IF v_c.status <> 'submitted' THEN
    RAISE EXCEPTION 'Submit the card first.' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.game_players
                  WHERE tournament_id = v_c.tournament_id AND player_id = v_c.player_id
                    AND user_id = v_uid AND deleted_at IS NULL) THEN
    RETURN jsonb_build_object('confirmed', false, 'reason', 'not_your_player',
                              'settled', 0, 'marked', 0);
  END IF;

  SELECT count(*) FILTER (WHERE s.strokes IS NOT NULL),
         count(*) FILTER (WHERE s.strokes IS NOT NULL
                            AND s.strokes = (v_c.holes ->> s.hole::text)::int)
    INTO v_settled, v_match
    FROM public.game_scores s
   WHERE s.tournament_id = v_c.tournament_id AND s.round_id = v_c.round_id
     AND s.player_id = v_c.player_id AND s.hole BETWEEN 1 AND 18;

  SELECT sc.card -> 'scorer' ->> 'userId',
         (SELECT count(*) FROM generate_series(1, 18) h
           WHERE jsonb_typeof(sc.card -> 'holes' -> h::text -> 'entries' -> v_c.player_id) = 'number')
    INTO v_partner, v_marked
    FROM public.scorer_cards sc
   WHERE sc.tournament_id = v_c.tournament_id AND sc.round_id = v_c.round_id
     AND NULLIF(sc.card -> 'scorer' ->> 'userId', '') IS NOT NULL
     AND sc.card -> 'scorer' ->> 'userId' <> v_uid::text
   ORDER BY 2 DESC
   LIMIT 1;
  v_marked := COALESCE(v_marked, 0);

  IF v_settled < 18 OR v_match < 18 OR v_marked < 18 THEN
    RETURN jsonb_build_object(
      'confirmed', false,
      'reason', CASE WHEN v_settled < 18 THEN 'not_settled'
                     WHEN v_match < 18   THEN 'snapshot_mismatch'
                     ELSE 'no_partner' END,
      'settled', v_settled, 'matches', v_match, 'marked', v_marked);
  END IF;

  BEGIN
    v_puid := v_partner::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_puid := NULL;
  END;
  v_pname := CASE WHEN v_puid IS NOT NULL THEN public.league_user_name(v_puid) END;

  PERFORM public.league_confirm_card(p_card, 'partner', v_puid, v_pname, NULL);
  RETURN jsonb_build_object('confirmed', true, 'settled', 18, 'matches', 18, 'marked', 18,
                            'partner_user_id', v_puid, 'partner_name', v_pname);
END;
$$;

-- Signed paper card or official result. p_path is the object the owner just
-- uploaded to league-proofs under <league_id>/<card_id>.
CREATE OR REPLACE FUNCTION public.attach_league_proof(
  p_card uuid, p_path text, p_kind text, p_marker_name text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_c   public.league_cards%ROWTYPE;
BEGIN
  SELECT * INTO v_c FROM public.league_cards WHERE id = p_card FOR UPDATE;
  IF NOT FOUND OR v_c.user_id IS DISTINCT FROM v_uid
     OR NOT public.is_league_member(v_c.league_id, v_uid) THEN
    RAISE EXCEPTION 'Card not found.' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(p_kind, '') NOT IN ('photo','official') THEN
    RAISE EXCEPTION 'Unknown proof kind %', p_kind USING ERRCODE = 'P0001';
  END IF;
  IF v_c.status <> 'submitted' THEN
    RAISE EXCEPTION 'Submit the card first.' USING ERRCODE = 'P0001';
  END IF;
  IF p_path IS NULL
     OR split_part(p_path, '/', 1) <> v_c.league_id::text
     OR split_part(split_part(p_path, '/', 2), '.', 1) <> v_c.id::text
     OR split_part(p_path, '/', 3) <> '' THEN
    RAISE EXCEPTION 'The proof must be uploaded for this card.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects
                  WHERE bucket_id = 'league-proofs' AND name = p_path) THEN
    RAISE EXCEPTION 'The proof photo has not finished uploading.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.league_confirm_card(p_card, p_kind, NULL,
    NULLIF(left(btrim(COALESCE(p_marker_name, '')), 80), ''), p_path);
END;
$$;

-- 8) RPCs: marker QR ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_marker_token(p_card uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_c     public.league_cards%ROWTYPE;
  v_token text;
  v_exp   timestamptz := now() + interval '2 hours';
BEGIN
  SELECT * INTO v_c FROM public.league_cards WHERE id = p_card FOR UPDATE;
  IF NOT FOUND OR v_c.user_id IS DISTINCT FROM v_uid
     OR NOT public.is_league_member(v_c.league_id, v_uid) THEN
    RAISE EXCEPTION 'Card not found.' USING ERRCODE = 'P0001';
  END IF;
  IF v_c.status <> 'submitted' OR v_c.holes IS NULL THEN
    RAISE EXCEPTION 'Submit the card first.' USING ERRCODE = 'P0001';
  END IF;

  -- A new code voids any older unused one for this card.
  UPDATE public.league_marker_tokens SET expires_at = LEAST(expires_at, now())
   WHERE card_id = p_card AND used_at IS NULL;

  -- 32 random bytes, url-safe base64 without padding (43 chars).
  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), E'+/=\n', '-_');
  INSERT INTO public.league_marker_tokens (token, card_id, snapshot_hash, expires_at)
  VALUES (v_token, p_card, md5(v_c.holes::text), v_exp);

  RETURN jsonb_build_object('token', v_token, 'expires_at', v_exp);
END;
$$;

-- ANON. Whitelisted fields only — no ids, no user ids, no league data.
CREATE OR REPLACE FUNCTION public.get_marker_card(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_t public.league_marker_tokens%ROWTYPE;
  v_c public.league_cards%ROWTYPE;
BEGIN
  IF NULLIF(btrim(COALESCE(p_token, '')), '') IS NULL THEN
    RAISE EXCEPTION 'invalid' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_t FROM public.league_marker_tokens WHERE token = p_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid' USING ERRCODE = 'P0001';
  END IF;
  IF v_t.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'used' USING ERRCODE = 'P0001';
  END IF;
  IF v_t.expires_at <= now() THEN
    RAISE EXCEPTION 'expired' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_c FROM public.league_cards WHERE id = v_t.card_id;
  IF v_c.status <> 'submitted' OR v_c.holes IS NULL THEN
    RAISE EXCEPTION 'invalid' USING ERRCODE = 'P0001';
  END IF;
  IF md5(v_c.holes::text) <> v_t.snapshot_hash THEN
    RAISE EXCEPTION 'changed' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'player_first_name', split_part(public.league_user_name(v_c.user_id), ' ', 1),
    'course',            v_c.course ->> 'name',
    'tee',               v_c.course ->> 'tee',
    'date',              v_c.played_on,
    'playing_handicap',  v_c.playing_handicap,
    'gross',             v_c.gross,
    'points',            v_c.points,
    'expires_at',        v_t.expires_at,
    'holes', (
      SELECT jsonb_agg(jsonb_build_object(
               'n',       n,
               'par',     (ch ->> 'par')::int,
               'si',      (ch ->> 'si')::int,
               'strokes', (v_c.holes ->> n::text)::int) ORDER BY n)
        FROM generate_series(1, 18) n
        LEFT JOIN LATERAL (
          SELECT h AS ch FROM jsonb_array_elements(
                   CASE WHEN jsonb_typeof(v_c.course -> 'holes') = 'array'
                        THEN v_c.course -> 'holes' ELSE '[]'::jsonb END) h
           WHERE (h ->> 'n') = n::text
           LIMIT 1) x ON true));
END;
$$;

-- ANON. Single use. ok -> confirmed by 'qr'; not ok -> stays 'submitted' with
-- the marker's note, and the owner is notified.
CREATE OR REPLACE FUNCTION public.confirm_marker_card(
  p_token text, p_marker_name text, p_ok boolean, p_note text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_t    public.league_marker_tokens%ROWTYPE;
  v_c    public.league_cards%ROWTYPE;
  v_name text := NULLIF(left(btrim(COALESCE(p_marker_name, '')), 80), '');
  v_note text := NULLIF(left(btrim(COALESCE(p_note, '')), 500), '');
  v_league_name text;
BEGIN
  IF NULLIF(btrim(COALESCE(p_token, '')), '') IS NULL THEN
    RAISE EXCEPTION 'invalid' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_t FROM public.league_marker_tokens WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid' USING ERRCODE = 'P0001';
  END IF;
  IF v_t.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'used' USING ERRCODE = 'P0001';
  END IF;
  IF v_t.expires_at <= now() THEN
    RAISE EXCEPTION 'expired' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_c FROM public.league_cards WHERE id = v_t.card_id FOR UPDATE;
  IF v_c.status <> 'submitted' OR v_c.holes IS NULL THEN
    RAISE EXCEPTION 'invalid' USING ERRCODE = 'P0001';
  END IF;
  IF md5(v_c.holes::text) <> v_t.snapshot_hash THEN
    RAISE EXCEPTION 'changed' USING ERRCODE = 'P0001';
  END IF;
  IF p_ok IS NULL THEN
    RAISE EXCEPTION 'invalid' USING ERRCODE = 'P0001';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Type your name to sign the card.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.league_marker_tokens SET used_at = now() WHERE token = p_token;

  IF p_ok THEN
    PERFORM public.league_confirm_card(v_c.id, 'qr', NULL, v_name, NULL);
    RETURN jsonb_build_object('status', 'confirmed');
  END IF;

  UPDATE public.league_cards SET marker_note = v_note, updated_at = now()
   WHERE id = v_c.id;
  SELECT name INTO v_league_name FROM public.leagues WHERE id = v_c.league_id;
  PERFORM public.create_notification(v_c.user_id, 'league_marker_issue', NULL, v_c.id,
    jsonb_build_object(
      'league_id',   v_c.league_id,
      'league_name', v_league_name,
      'card_id',     v_c.id,
      'course_name', v_c.course ->> 'name',
      'actor_name',  v_name,
      'marker_name', v_name,
      'note',        v_note));
  RETURN jsonb_build_object('status', 'returned');
END;
$$;

-- 9) RPCs: admin ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.void_league_card(p_card uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_league uuid;
BEGIN
  SELECT league_id INTO v_league FROM public.league_cards WHERE id = p_card FOR UPDATE;
  IF NOT FOUND OR NOT public.is_league_admin(v_league, auth.uid()) THEN
    RAISE EXCEPTION 'Only the league admin can do that.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.league_cards
     SET status = 'void', voided_reason = NULLIF(left(btrim(COALESCE(p_reason, '')), 500), ''),
         updated_at = now()
   WHERE id = p_card;
  UPDATE public.league_marker_tokens SET expires_at = LEAST(expires_at, now())
   WHERE card_id = p_card AND used_at IS NULL;
END;
$$;

-- P12: the December Final. p_strokes = {"<user_id>": extra strokes}.
CREATE OR REPLACE FUNCTION public.record_league_final(p_league uuid, p_tournament_id text, p_strokes jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_league_admin(p_league, auth.uid()) THEN
    RAISE EXCEPTION 'Only the league admin can do that.' USING ERRCODE = '42501';
  END IF;
  IF p_strokes IS NOT NULL AND jsonb_typeof(p_strokes) <> 'object' THEN
    RAISE EXCEPTION 'Extra strokes must be an object keyed by player.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.league_finals (league_id, tournament_id, strokes)
  VALUES (p_league, p_tournament_id, COALESCE(p_strokes, '{}'::jsonb))
  ON CONFLICT (league_id) DO UPDATE
    SET tournament_id = EXCLUDED.tournament_id, strokes = EXCLUDED.strokes, created_at = now();
END;
$$;

-- 10) Grants --------------------------------------------------------------------
-- Supabase's default privileges grant EXECUTE on new public functions to anon;
-- take it back from every RPC, then grant authenticated (and anon for the two
-- marker RPCs only).

DO $$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.create_league(text, date, date, int[], numeric, int, jsonb)',
    'public.get_league_by_code(text)',
    'public.join_league(text, numeric)',
    'public.set_league_handicap(uuid, uuid, numeric)',
    'public.set_league_fee_paid(uuid, uuid, boolean)',
    'public.update_league_rules(uuid, text, date, date, int[], numeric, int)',
    'public.leave_league(uuid)',
    'public.set_league_role(uuid, uuid, text)',
    'public.archive_league(uuid)',
    'public.open_handicap_vote(uuid, uuid, numeric)',
    'public.cast_handicap_ballot(uuid, boolean)',
    'public.announce_league_card(uuid, text, jsonb, timestamptz, text, text, text)',
    'public.notify_league_tee_off(uuid)',
    'public.submit_league_card(uuid, jsonb, int, int, int, date)',
    'public.add_unannounced_league_card(uuid, jsonb, timestamptz, date, jsonb, int, int, int)',
    'public.confirm_league_card_by_partner(uuid)',
    'public.attach_league_proof(uuid, text, text, text)',
    'public.create_marker_token(uuid)',
    'public.void_league_card(uuid, text)',
    'public.record_league_final(uuid, text, jsonb)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_sig);
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION public.get_marker_card(text)                         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.confirm_marker_card(text, text, boolean, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_marker_card(text)                         TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.confirm_marker_card(text, text, boolean, text) TO anon, authenticated;

/* ===========================================================================
   VERIFY
   ---------------------------------------------------------------------------
   Smoke test (BEGIN … ROLLBACK, never persists): supabase/tests/leagues_smoke.sql

   -- anon can execute exactly the two marker RPCs among league functions:
   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname LIKE '%league%' OR p.proname LIKE '%marker%' OR p.proname LIKE '%handicap_%')
      AND has_function_privilege('anon', p.oid, 'EXECUTE');
   =========================================================================== */
