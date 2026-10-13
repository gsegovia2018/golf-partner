-- ============================================================================
-- League: the server scores every card, and months rank by Stableford points.
-- Plan: docs/superpowers/plans/2026-10-13-league-review-followups.md (B1, R1-R5).
-- Builds on 20261004000000_leagues.sql, 20261005000001_league_net_differential.sql,
-- 20261012000000_league_post_deadline.sql, 20261013000000_league_marker_request.sql
-- and 20261014000000_league_invitees.sql. Idempotent; safe to re-run.
-- ============================================================================
--
-- WHY
-- ---
-- submit_league_card / add_unannounced_league_card took the playing handicap
-- and the Stableford points from the phone and stored them as sent:
-- p_playing_handicap = -54 won every month. Now:
--
--   R1  Months rank by net Stableford points (client side, leagueStandings.js).
--       The net differential stays computed and stored (secondary information).
--   R2  leagues.participation_points (default 10, >= 0): every counting card
--       earns at least that many season points. Set in create_league, changed
--       in update_league_rules.
--   R3  The server scores the card: playing handicap, points per hole, gross and
--       the differential, from the frozen league handicap and the frozen tee.
--       p_gross / p_points / p_playing_handicap are still ACCEPTED (installed
--       builds send them) but IGNORED. A card missing strokes, par or SI on any
--       of its 18 holes is refused (HINT 'incomplete_card').
--   R4  The tee comes from the course library when the card's course is a
--       library course (see league_library_course below); the card is marked
--       tee_verified. A custom/unknown course keeps the client's tee and
--       tee_verified = false. A rated tee is still required ('unrated_tee').
--   R5  An app card's 18 holes must equal its player's settled game_scores for
--       the round (HINT 'holes_mismatch').
--
-- THE MATHS (mirrors src/store/scoring.js, 18 holes)
-- ---------
--   par          = sum of the 18 hole pars in the frozen course snapshot
--   playing hcp  = calcPlayingHandicap(index, slope, rating, par):
--                  Math.round(index * (slope / 113) + (rating - par)),
--                  index = league handicap (NULL plays off 0); no slope ->
--                  Math.round(index). Computed in float8 like JS; Math.round is
--                  floor(x + 0.5).
--   extra(hole)  = calcExtraShots(ph, si, 18) (plus handicaps give strokes back
--                  from SI 18 down)
--   points(hole) = calcStablefordPoints = max(0, 2 + par - strokes + extra)
--   gross        = sum of strokes
--   differential = league_card_differential(holes, course, ph)  (unchanged,
--                  but now fed the SERVER playing handicap)
--
-- WHERE A LIBRARY COURSE COMES FROM
-- ---------------------------------
-- The course snapshot never carried a course id before this change. New builds
-- write course_id into it (leagueSetup.leagueCourse / leagueOffApp.courseSnapshot).
-- App cards from older builds get it from the game round (body.courseId), and
-- their tee label from body.playerTees[player_id].label when the snapshot has
-- none. The tee is matched by label (trimmed, case-insensitive, like
-- tees.teeByLabel); a woman (profiles.gender, else players.gender) plays the
-- women's pair, falling back per field (tees.resolveTeeForPlayer). The library
-- course must have 18 holes with par and SI; then its slope, rating, par and
-- holes replace the snapshot's. Anything short of that is "not verified".
-- NOTE: the course library is collaboratively editable by any signed-in user
-- (course_tees_write), so "verified" means "matches the shared library", not
-- "checked by an admin".
--
-- BACKFILL (section 6)
-- --------------------
-- Every non-void card with frozen holes gets playing_handicap, points, gross,
-- differential and net_differential recomputed from its OWN frozen course
-- snapshot and league handicap (the library is not re-applied to old cards:
-- a library edit after the round must not move an old card). tee_verified is
-- set to whether that frozen tee equals what the library resolves today.
-- Cards whose snapshot lacks a par/SI keep their stored values (the NOTICE
-- counts them). The values before the backfill are kept, first run only, in
-- league_cards_scoring_backup (RPC-less, RLS on, no grants) so the change can
-- be audited — see VERIFY — and dropped by hand once it has been checked.
-- A submitted card whose points change gets a new snapshot hash, so an
-- outstanding QR / marker request for it reads 'changed'.
-- ============================================================================

-- 1) Columns ----------------------------------------------------------------------

ALTER TABLE public.leagues ADD COLUMN IF NOT EXISTS participation_points int NOT NULL DEFAULT 10;
ALTER TABLE public.leagues DROP CONSTRAINT IF EXISTS leagues_participation_points_check;
ALTER TABLE public.leagues ADD CONSTRAINT leagues_participation_points_check
  CHECK (participation_points >= 0);

-- NULL until the card is scored (announced / playing cards).
ALTER TABLE public.league_cards ADD COLUMN IF NOT EXISTS tee_verified boolean;

-- 2) Pure helpers (internal) ----------------------------------------------------------

-- The 18 strokes in canonical form, or the 'incomplete_card' refusal.
CREATE OR REPLACE FUNCTION public.league_card_holes(p_holes jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  RETURN public.league_canonical_holes(p_holes);
EXCEPTION WHEN raise_exception THEN
  RAISE EXCEPTION 'A league card needs a score on every hole, 1 to 18.'
    USING ERRCODE = 'P0001', HINT = 'incomplete_card';
END;
$$;

-- R3: {playing_handicap, points, gross} of an 18-hole card from its frozen
-- data, or NULL when any hole 1..18 lacks strokes, a par or a stroke index.
CREATE OR REPLACE FUNCTION public.league_card_score(
  p_holes jsonb, p_course jsonb, p_league_handicap numeric
) RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_par     int[];
  v_si      int[];
  v_str     int[];
  v_total   int := 0;
  v_gross   int := 0;
  v_points  int := 0;
  v_idx     float8 := COALESCE(p_league_handicap, 0)::float8;
  v_slope   numeric;
  v_rating  numeric;
  v_ph      int;
  v_extra   int;
  r         record;
BEGIN
  IF p_holes IS NULL OR jsonb_typeof(p_holes) <> 'object'
     OR p_course IS NULL OR jsonb_typeof(p_course -> 'holes') IS DISTINCT FROM 'array' THEN
    RETURN NULL;
  END IF;

  FOR r IN
    SELECT g.n,
           public.league_num(x.h -> 'par')::int AS par,
           public.league_num(x.h -> 'si')::int  AS si,
           public.league_num(p_holes -> g.n::text)::int AS strokes
      FROM generate_series(1, 18) AS g(n)
      LEFT JOIN LATERAL (
        SELECT h FROM jsonb_array_elements(p_course -> 'holes') h
         WHERE public.league_num(h -> 'n') = g.n
         LIMIT 1) x ON true
     ORDER BY g.n
  LOOP
    IF r.par IS NULL OR r.si IS NULL OR r.strokes IS NULL OR r.strokes <= 0 THEN
      RETURN NULL;
    END IF;
    v_par := v_par || r.par;
    v_si  := v_si  || r.si;
    v_str := v_str || r.strokes;
    v_total := v_total + r.par;
    v_gross := v_gross + r.strokes;
  END LOOP;

  -- scoring.calcPlayingHandicap(index, slope, rating, par, 18).
  v_slope  := trunc(public.league_num(p_course -> 'slope'));
  v_rating := public.league_num(p_course -> 'rating');
  IF v_slope IS NULL OR v_slope <= 0 THEN
    v_ph := floor(v_idx + 0.5)::int;
  ELSE
    v_ph := floor(v_idx * (v_slope::float8 / 113::float8)
                  + CASE WHEN v_rating IS NOT NULL AND v_total > 0
                         THEN v_rating::float8 - v_total::float8 ELSE 0 END
                  + 0.5)::int;
  END IF;

  FOR i IN 1..18 LOOP
    -- scoring.calcExtraShots(v_ph, si, 18); integer division truncates, which
    -- is floor for the non-negative operands used here.
    IF v_ph < 0 THEN
      v_extra := -((-v_ph) / 18) - CASE WHEN v_si[i] > 18 - ((-v_ph) % 18) THEN 1 ELSE 0 END;
    ELSE
      v_extra := (v_ph / 18) + CASE WHEN v_si[i] <= v_ph % 18 THEN 1 ELSE 0 END;
    END IF;
    v_points := v_points + GREATEST(0, 2 + v_par[i] - v_str[i] + v_extra);
  END LOOP;

  RETURN jsonb_build_object('playing_handicap', v_ph, 'points', v_points, 'gross', v_gross);
END;
$$;

-- tees.resolveTeeForPlayer's gender: profiles first, then the linked player;
-- missing or unknown behaves as male.
CREATE OR REPLACE FUNCTION public.league_user_is_female(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT gender FROM public.profiles WHERE user_id = p_user),
    (SELECT gender FROM public.players WHERE user_id = p_user AND gender IS NOT NULL LIMIT 1)
  ) IS NOT DISTINCT FROM 'female';
$$;

-- R4: the course snapshot rebuilt from the course library (course_id, tee
-- label, slope/rating for the player's gender, par, holes), or NULL when the
-- card's course can't be resolved there. See the header for the rules.
CREATE OR REPLACE FUNCTION public.league_library_course(
  p_course jsonb, p_source text, p_tournament_id text, p_round_id text, p_player_id text,
  p_user uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_id_text text;
  v_id      uuid;
  v_label   text;
  v_body    jsonb;
  v_female  boolean;
  v_tee     public.course_tees%ROWTYPE;
  v_slope   numeric;
  v_rating  numeric;
  v_holes   jsonb;
  v_par     int;
  v_n       int;
BEGIN
  IF p_course IS NULL OR jsonb_typeof(p_course) <> 'object' THEN
    RETURN NULL;
  END IF;
  v_id_text := NULLIF(btrim(COALESCE(p_course ->> 'course_id', p_course ->> 'courseId', '')), '');
  v_label   := NULLIF(btrim(COALESCE(p_course ->> 'tee', '')), '');
  IF p_source = 'app' AND (v_id_text IS NULL OR v_label IS NULL) THEN
    SELECT body INTO v_body FROM public.game_rounds
     WHERE tournament_id = p_tournament_id AND id = p_round_id;
    v_id_text := COALESCE(v_id_text, NULLIF(btrim(COALESCE(v_body ->> 'courseId', '')), ''));
    v_label   := COALESCE(v_label,
                   NULLIF(btrim(COALESCE(v_body -> 'playerTees' -> p_player_id ->> 'label', '')), ''));
  END IF;
  IF v_id_text IS NULL OR v_label IS NULL
     OR v_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  v_id := v_id_text::uuid;

  SELECT * INTO v_tee FROM public.course_tees
   WHERE course_id = v_id AND lower(btrim(label)) = lower(v_label)
   ORDER BY sort_order, created_at
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_female := public.league_user_is_female(p_user);
  v_slope  := CASE WHEN v_female THEN COALESCE(v_tee.slope_women, v_tee.slope) ELSE v_tee.slope END;
  v_rating := CASE WHEN v_female THEN COALESCE(v_tee.rating_women, v_tee.rating) ELSE v_tee.rating END;
  IF v_slope IS NULL OR v_slope <= 0 OR v_rating IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT count(*), sum(h.par),
         jsonb_agg(jsonb_build_object('n', h.number, 'par', h.par, 'si', h.stroke_index) ORDER BY h.number)
    INTO v_n, v_par, v_holes
    FROM public.course_holes h
   WHERE h.course_id = v_id;
  IF v_n IS DISTINCT FROM 18
     OR (SELECT count(DISTINCT h.number) FROM public.course_holes h
          WHERE h.course_id = v_id AND h.number BETWEEN 1 AND 18
            AND h.par IS NOT NULL AND h.stroke_index IS NOT NULL) <> 18 THEN
    RETURN NULL;
  END IF;

  RETURN p_course || jsonb_build_object(
    'course_id', v_id,
    'tee',       v_tee.label,
    'slope',     v_slope,
    'rating',    v_rating,
    'par',       v_par,
    'holes',     v_holes);
END;
$$;

DO $$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.league_card_holes(jsonb)',
    'public.league_card_score(jsonb, jsonb, numeric)',
    'public.league_user_is_female(uuid)',
    'public.league_library_course(jsonb, text, text, text, text, uuid)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_sig);
  END LOOP;
END $$;

-- 3) create_league / update_league_rules: participation points (R2) ---------------
-- Replaced, not overloaded: an eighth argument with a default on a second
-- overload would make every 7-argument call ambiguous. Every existing 7-argument
-- caller (positional or named) keeps working against the new signature.

DROP FUNCTION IF EXISTS public.create_league(text, date, date, int[], numeric, int, jsonb);

-- Body of 20261014000000 plus p_participation_points (NULL -> 10).
CREATE OR REPLACE FUNCTION public.create_league(
  p_name text, p_season_start date, p_season_end date, p_points_table int[],
  p_cap numeric, p_fee_cents int, p_members jsonb, p_participation_points int DEFAULT 10
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
  IF p_participation_points < 0 THEN
    RAISE EXCEPTION 'Points for playing can''t be negative.'
      USING ERRCODE = 'P0001', HINT = 'participation_points';
  END IF;

  v_code := public.league_new_invite_code();
  INSERT INTO public.leagues (name, season_start, season_end, created_by, points_table,
                              handicap_cap, entry_fee_cents, invite_code, participation_points)
  VALUES (btrim(p_name), p_season_start, p_season_end, v_uid,
          COALESCE(p_points_table, '{500,300,190,135,110,90,75,60,45,35,25,15}'::int[]),
          v_cap, GREATEST(COALESCE(p_fee_cents, 0), 0), v_code,
          COALESCE(p_participation_points, 10))
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

DROP FUNCTION IF EXISTS public.update_league_rules(uuid, text, date, date, int[], numeric, int);

-- Body of 20261004000000 plus p_participation_points. NULL arguments keep the
-- current value. Lowering the cap clamps every member above it, with a 'set'
-- event each (plan §5: every write is clamped).
CREATE OR REPLACE FUNCTION public.update_league_rules(
  p_league uuid, p_name text, p_season_start date, p_season_end date,
  p_points_table int[], p_cap numeric, p_fee_cents int, p_participation_points int DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cap numeric(4,1);
BEGIN
  IF NOT public.league_is_admin(p_league, v_uid) THEN
    RAISE EXCEPTION 'Only the league admin can do that.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.league_assert_open(p_league);
  IF p_participation_points < 0 THEN
    RAISE EXCEPTION 'Points for playing can''t be negative.'
      USING ERRCODE = 'P0001', HINT = 'participation_points';
  END IF;
  UPDATE public.leagues
     SET name            = COALESCE(NULLIF(btrim(p_name), ''), name),
         season_start    = COALESCE(p_season_start, season_start),
         season_end      = COALESCE(p_season_end, season_end),
         points_table    = COALESCE(p_points_table, points_table),
         handicap_cap    = COALESCE(p_cap, handicap_cap),
         entry_fee_cents = CASE WHEN p_fee_cents IS NULL THEN entry_fee_cents
                                ELSE GREATEST(p_fee_cents, 0) END,
         participation_points = COALESCE(p_participation_points, participation_points)
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

DO $$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.create_league(text, date, date, int[], numeric, int, jsonb, int)',
    'public.update_league_rules(uuid, text, date, date, int[], numeric, int, int)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_sig);
  END LOOP;
END $$;

-- 4) submit_league_card: scored by the server (R3-R5) ------------------------------
-- Body of 20261013000000 with the score computed here. Same signature:
-- p_gross, p_points and p_playing_handicap are ignored (older builds send them).
CREATE OR REPLACE FUNCTION public.submit_league_card(
  p_card uuid, p_holes jsonb, p_gross int, p_points int, p_playing_handicap int,
  p_played_on date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_c        public.league_cards%ROWTYPE;
  v_holes    jsonb;
  v_first    timestamptz;
  v_fin      timestamptz;
  v_raw      jsonb;
  v_not      boolean;
  v_course   jsonb;
  v_lib      jsonb;
  v_verified boolean;
  v_bad      int[];
  v_score    jsonb;
  v_ph       int;
  v_diff     numeric;
  v_net      numeric;
BEGIN
  SELECT * INTO v_c FROM public.league_cards WHERE id = p_card FOR UPDATE;
  IF NOT FOUND OR v_c.user_id IS DISTINCT FROM v_uid
     OR NOT public.league_is_member(v_c.league_id, v_uid) THEN
    RAISE EXCEPTION 'Card not found.' USING ERRCODE = 'P0001';
  END IF;
  IF v_c.status NOT IN ('announced','playing','submitted','missed') THEN
    RAISE EXCEPTION 'This card can no longer be changed.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.league_assert_open(v_c.league_id);

  IF v_c.source = 'offapp' AND v_c.status = 'announced'
     AND v_c.tee_time IS NOT NULL AND now() < v_c.tee_time THEN
    RAISE EXCEPTION 'You can post this card once your tee time has passed.'
      USING ERRCODE = 'P0001', HINT = 'before_tee_time';
  END IF;

  IF v_c.status = 'missed'
     OR (v_c.post_by IS NOT NULL AND now() > v_c.post_by
         AND (v_c.status <> 'submitted' OR v_c.returned_at IS NULL)) THEN
    IF v_c.source = 'app' AND v_c.status <> 'submitted'
       AND now() <= v_c.post_by + interval '24 hours' THEN
      SELECT body -> 'finishedAt' INTO v_raw FROM public.game_rounds
       WHERE tournament_id = v_c.tournament_id AND id = v_c.round_id;
      v_fin := CASE jsonb_typeof(v_raw)
                 WHEN 'string' THEN (v_raw #>> '{}')::timestamptz
                 WHEN 'number' THEN to_timestamp((v_raw #>> '{}')::double precision / 1000)
                 ELSE NULL END;
    END IF;
    IF v_fin IS NULL OR v_c.post_by IS NULL OR v_fin > v_c.post_by
       OR v_fin < COALESCE(v_c.first_shot_at, v_c.announced_at) THEN
      RAISE EXCEPTION 'The 8 hours to post this card are over.'
        USING ERRCODE = 'P0001', HINT = 'post_deadline_passed';
    END IF;
  END IF;

  IF p_played_on IS NOT NULL AND date_trunc('month', p_played_on)::date <> v_c.month THEN
    RAISE EXCEPTION 'This is your % card, but the date is in %. Check the date.',
      to_char(v_c.month, 'FMMonth'), to_char(p_played_on, 'FMMonth')
      USING ERRCODE = 'P0001', HINT = 'month_mismatch';
  END IF;

  v_holes := public.league_card_holes(p_holes);

  -- R4: the library tee when the course is a library course. An app card from
  -- an older build with no slope/rating gets the game round's tee first.
  v_course := public.league_rated_course(v_c.course, v_c.source, v_c.tournament_id,
                                         v_c.round_id, v_c.player_id);
  v_lib := public.league_library_course(v_course, v_c.source, v_c.tournament_id,
                                        v_c.round_id, v_c.player_id, v_c.user_id);
  v_verified := v_lib IS NOT NULL;
  v_course := COALESCE(v_lib, v_course);
  IF NOT public.league_course_rated(v_course) THEN
    RAISE EXCEPTION 'This tee has no slope and course rating, so it can''t count for the league.'
      USING ERRCODE = 'P0001', HINT = 'unrated_tee';
  END IF;

  -- R5: an app card is the game's card.
  IF v_c.source = 'app' THEN
    SELECT array_agg(g.n ORDER BY g.n) INTO v_bad
      FROM generate_series(1, 18) AS g(n)
      LEFT JOIN public.game_scores s
        ON s.tournament_id = v_c.tournament_id AND s.round_id = v_c.round_id
       AND s.player_id = v_c.player_id AND s.hole = g.n
     WHERE s.strokes IS DISTINCT FROM (v_holes ->> g.n::text)::int;
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'This card doesn''t match your scores in the game on hole%: %. Wait for every hole to sync, or fix it in the scorecard.',
        CASE WHEN cardinality(v_bad) = 1 THEN '' ELSE 's' END, array_to_string(v_bad, ', ')
        USING ERRCODE = 'P0001', HINT = 'holes_mismatch';
    END IF;
  END IF;

  -- R3: the server's score; the client's p_gross / p_points / p_playing_handicap are ignored.
  v_score := public.league_card_score(v_holes, v_course, v_c.league_handicap);
  IF v_score IS NULL THEN
    RAISE EXCEPTION 'Every hole of a league card needs a score, a par and a stroke index.'
      USING ERRCODE = 'P0001', HINT = 'incomplete_card';
  END IF;
  v_ph   := (v_score ->> 'playing_handicap')::int;
  v_diff := public.league_card_differential(v_holes, v_course, v_ph);
  v_net  := public.league_net_differential(v_diff, v_c.league_handicap);

  v_first := v_c.first_shot_at;
  IF v_c.source = 'app' THEN
    IF v_first IS NULL THEN
      SELECT body -> 'startedAt' INTO v_raw FROM public.game_rounds
       WHERE tournament_id = v_c.tournament_id AND id = v_c.round_id;
      v_first := CASE jsonb_typeof(v_raw)
                   WHEN 'string' THEN (v_raw #>> '{}')::timestamptz
                   WHEN 'number' THEN to_timestamp((v_raw #>> '{}')::double precision / 1000)
                   ELSE NULL END;
    END IF;
    v_not := v_c.announced_at IS NULL OR v_first IS NULL OR v_first < v_c.announced_at;
  ELSE
    -- The same 15 minutes of slack announce allows on the first tee.
    v_not := v_c.announced_at IS NULL OR v_c.tee_time IS NULL
             OR v_c.tee_time < v_c.announced_at - interval '15 minutes';
  END IF;

  UPDATE public.league_marker_tokens SET expires_at = LEAST(expires_at, now())
   WHERE card_id = p_card AND used_at IS NULL;

  UPDATE public.league_cards
     SET holes = v_holes, gross = (v_score ->> 'gross')::int,
         points = (v_score ->> 'points')::int, playing_handicap = v_ph,
         course = v_course, tee_verified = v_verified,
         differential = v_diff, net_differential = v_net,
         -- An announced off-app card was played on its tee day.
         played_on = CASE WHEN v_c.source = 'offapp' AND v_c.tee_time IS NOT NULL
                               AND v_c.announced_at IS NOT NULL
                          THEN (v_c.tee_time AT TIME ZONE 'Europe/Madrid')::date
                          ELSE COALESCE(p_played_on, played_on) END,
         first_shot_at = v_first, not_announced = v_not,
         approved_by = NULL, approved_at = NULL, returned_at = NULL,
         marker_user_id = NULL, marker_name = NULL,
         marker_requested_at = NULL, marker_reminded_at = NULL,
         status = 'submitted', updated_at = now()
   WHERE id = p_card;

  RETURN jsonb_build_object('id', p_card, 'status', 'submitted',
                            'not_announced', v_not, 'first_shot_at', v_first,
                            'gross', (v_score ->> 'gross')::int,
                            'points', (v_score ->> 'points')::int,
                            'playing_handicap', v_ph,
                            'tee_verified', v_verified,
                            'differential', v_diff,
                            'net_differential', v_net);
END;
$$;

-- 5) add_unannounced_league_card: scored by the server (R3, R4) --------------------
-- Body of 20261005000001 with the score computed here. Same signature:
-- p_gross, p_points and p_playing_handicap are ignored.
CREATE OR REPLACE FUNCTION public.add_unannounced_league_card(
  p_league uuid, p_course jsonb, p_tee_time timestamptz, p_played_on date,
  p_holes jsonb, p_gross int, p_points int, p_playing_handicap int
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_month    date;
  v_holes    jsonb;
  v_hcp      numeric(4,1);
  v_id       uuid;
  v_s0       date;
  v_s1       date;
  v_course   jsonb;
  v_lib      jsonb;
  v_verified boolean;
  v_score    jsonb;
  v_ph       int;
  v_diff     numeric;
BEGIN
  IF NOT public.league_is_member(p_league, v_uid) THEN
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

  SELECT season_start, season_end INTO v_s0, v_s1 FROM public.leagues WHERE id = p_league;
  IF COALESCE(p_played_on, (p_tee_time AT TIME ZONE 'Europe/Madrid')::date) NOT BETWEEN v_s0 AND v_s1 THEN
    RAISE EXCEPTION 'That date is outside the season (% to %).', v_s0, v_s1
      USING ERRCODE = 'P0001', HINT = 'outside_season';
  END IF;

  v_holes := public.league_card_holes(p_holes);

  v_lib := public.league_library_course(p_course, 'offapp', NULL, NULL, NULL, v_uid);
  v_verified := v_lib IS NOT NULL;
  v_course := COALESCE(v_lib, p_course);
  IF NOT public.league_course_rated(v_course) THEN
    RAISE EXCEPTION 'This tee has no slope and course rating, so it can''t count for the league.'
      USING ERRCODE = 'P0001', HINT = 'unrated_tee';
  END IF;

  IF EXISTS (SELECT 1 FROM public.league_cards
              WHERE league_id = p_league AND user_id = v_uid
                AND month = v_month AND status <> 'void') THEN
    RAISE EXCEPTION 'You already have your % card.', to_char(v_month, 'FMMonth')
      USING ERRCODE = 'P0001', HINT = 'card_exists';
  END IF;

  SELECT league_handicap INTO v_hcp FROM public.league_members
   WHERE league_id = p_league AND user_id = v_uid;

  v_score := public.league_card_score(v_holes, v_course, v_hcp);
  IF v_score IS NULL THEN
    RAISE EXCEPTION 'Every hole of a league card needs a score, a par and a stroke index.'
      USING ERRCODE = 'P0001', HINT = 'incomplete_card';
  END IF;
  v_ph   := (v_score ->> 'playing_handicap')::int;
  v_diff := public.league_card_differential(v_holes, v_course, v_ph);

  BEGIN
    INSERT INTO public.league_cards
      (league_id, user_id, month, source, status, course, tee_time, played_on,
       announced_at, not_announced, league_handicap, playing_handicap,
       holes, gross, points, differential, net_differential, tee_verified)
    VALUES
      (p_league, v_uid, v_month, 'offapp', 'submitted', v_course, p_tee_time,
       COALESCE(p_played_on, (p_tee_time AT TIME ZONE 'Europe/Madrid')::date),
       NULL, true, v_hcp, v_ph, v_holes, (v_score ->> 'gross')::int, (v_score ->> 'points')::int,
       v_diff, public.league_net_differential(v_diff, v_hcp), v_verified)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'You already have your % card.', to_char(v_month, 'FMMonth')
      USING ERRCODE = 'P0001', HINT = 'card_exists';
  END;

  RETURN jsonb_build_object('id', v_id, 'month', v_month, 'status', 'submitted',
                            'not_announced', true,
                            'gross', (v_score ->> 'gross')::int,
                            'points', (v_score ->> 'points')::int,
                            'playing_handicap', v_ph,
                            'tee_verified', v_verified);
END;
$$;

-- The two submit RPCs keep their signatures; restate the grants so a re-run
-- on its own leaves them right.
DO $$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.submit_league_card(uuid, jsonb, int, int, int, date)',
    'public.add_unannounced_league_card(uuid, jsonb, timestamptz, date, jsonb, int, int, int)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_sig);
  END LOOP;
END $$;

-- 6) Backfill ------------------------------------------------------------------------
-- See the header. The backup keeps the values from before the FIRST run only.
CREATE TABLE IF NOT EXISTS public.league_cards_scoring_backup AS
SELECT id, playing_handicap, points, gross, differential, net_differential, now() AS backed_up_at
  FROM public.league_cards
 WHERE status <> 'void' AND holes IS NOT NULL;
ALTER TABLE public.league_cards_scoring_backup ENABLE ROW LEVEL SECURITY;  -- no policy
REVOKE ALL ON public.league_cards_scoring_backup FROM anon, authenticated;

DO $$
DECLARE
  v_changed int;
  v_skipped int;
BEGIN
  WITH x AS (
    SELECT c.id, c.holes, c.course, c.league_handicap,
           public.league_card_score(c.holes, c.course, c.league_handicap) AS sc,
           public.league_library_course(c.course, c.source, c.tournament_id, c.round_id,
                                        c.player_id, c.user_id) AS lib
      FROM public.league_cards c
     WHERE c.status <> 'void' AND c.holes IS NOT NULL
  ), y AS (
    SELECT x.*, (x.sc ->> 'playing_handicap')::int AS ph,
           public.league_card_differential(x.holes, x.course, (x.sc ->> 'playing_handicap')::int) AS diff,
           x.lib IS NOT NULL
             AND public.league_num(x.lib -> 'slope')  IS NOT DISTINCT FROM public.league_num(x.course -> 'slope')
             AND public.league_num(x.lib -> 'rating') IS NOT DISTINCT FROM public.league_num(x.course -> 'rating')
             AS verified
      FROM x
     WHERE x.sc IS NOT NULL
  ), upd AS (
    UPDATE public.league_cards c
       SET playing_handicap = y.ph,
           points           = (y.sc ->> 'points')::int,
           gross            = (y.sc ->> 'gross')::int,
           differential     = y.diff,
           net_differential = public.league_net_differential(y.diff, y.league_handicap),
           tee_verified     = y.verified
      FROM y
     WHERE c.id = y.id
       AND (c.playing_handicap IS DISTINCT FROM y.ph
            OR c.points IS DISTINCT FROM (y.sc ->> 'points')::int
            OR c.gross IS DISTINCT FROM (y.sc ->> 'gross')::int
            OR c.differential IS DISTINCT FROM y.diff
            OR c.net_differential IS DISTINCT FROM public.league_net_differential(y.diff, y.league_handicap)
            OR c.tee_verified IS DISTINCT FROM y.verified)
    RETURNING 1
  )
  SELECT count(*) INTO v_changed FROM upd;

  SELECT count(*) INTO v_skipped
    FROM public.league_cards c
   WHERE c.status <> 'void' AND c.holes IS NOT NULL
     AND public.league_card_score(c.holes, c.course, c.league_handicap) IS NULL;

  RAISE NOTICE 'league_server_scoring backfill: % card rows updated, % cards left as stored (no par/SI on every hole)',
    v_changed, v_skipped;
END $$;

/* ===========================================================================
   VERIFY
   ---------------------------------------------------------------------------
   Smoke test (BEGIN … ROLLBACK): supabase/tests/league_server_scoring_smoke.sql
   (and leagues_smoke.sql, league_invitees_smoke.sql still pass).

   -- Cards whose points (or playing handicap) the backfill changed:
   SELECT c.id, c.league_id, c.user_id, c.month, c.status,
          b.points AS old_points, c.points AS new_points,
          b.playing_handicap AS old_ph, c.playing_handicap AS new_ph,
          c.league_handicap, c.course ->> 'name' AS course, c.tee_verified
     FROM public.league_cards_scoring_backup b
     JOIN public.league_cards c ON c.id = b.id
    WHERE b.points IS DISTINCT FROM c.points
       OR b.playing_handicap IS DISTINCT FROM c.playing_handicap
    ORDER BY c.month, c.league_id, c.points DESC;

   -- Invariant (expect none): a scored card whose stored points differ from
   -- what its frozen data gives.
   SELECT id FROM public.league_cards
    WHERE status <> 'void' AND holes IS NOT NULL
      AND public.league_card_score(holes, course, league_handicap) IS NOT NULL
      AND points IS DISTINCT FROM (public.league_card_score(holes, course, league_handicap) ->> 'points')::int;

   -- Once checked: DROP TABLE public.league_cards_scoring_backup;
   =========================================================================== */
