-- ============================================================================
-- League: rank cards by NET DIFFERENTIAL instead of Stableford points.
-- Plan: docs/superpowers/plans/2026-10-04-league.md (decision 2026-10-05).
-- Builds on 20261004000000_leagues.sql. Idempotent; safe to re-run.
-- ============================================================================
--
-- THE RULE (mirrors src/store/leagueRules.js scoreCard exactly)
-- --------
--   extra(hole)     = strokes received off the card's playing_handicap on the
--                     hole's stroke index, 18-hole allocation, plus handicaps
--                     give strokes back from SI 18 down (scoring.calcExtraShots)
--   adjusted gross  = sum over holes 1..18 of min(strokes, par + 2 + extra)
--   differential    = round1((113 / slope) x (adjusted gross - course rating))
--   net differential= round1(differential - league_handicap)   lower is better
-- round1 is JS Math.round(x * 10) / 10 (half up, toward +inf), computed in
-- float8 like JS, so both sides agree to the last decimal.
--
-- A card needs a RATED tee: a slope (integer part) > 0 and a numeric course
-- rating in its course snapshot. Both submit RPCs refuse an unrated card
-- (P0001, HINT 'unrated_tee'). Stableford points stay stored as secondary
-- information. The SERVER computes the values; the client never sends them,
-- so older app builds keep working unchanged.
--
-- App cards from builds before this change snapshot no slope/rating
-- ({name, tee, par, holes}). league_rated_course fills them from the game
-- round's tee (body.playerTees[player_id], else the round-level
-- slope/courseRating — scoring.resolveRoundTee's order) at submit and in the
-- backfill. New builds snapshot slope/rating at announce (leagueSetup.leagueCourse).
--
-- Columns are plain numeric (already rounded to one decimal by the
-- functions): a typo'd slope such as 1 would overflow numeric(4,1) and turn a
-- submit into a server error.
-- ============================================================================

ALTER TABLE public.league_cards ADD COLUMN IF NOT EXISTS differential     numeric;
ALTER TABLE public.league_cards ADD COLUMN IF NOT EXISTS net_differential numeric;

-- 1) Pure helpers ---------------------------------------------------------------

-- A jsonb number, or a string holding a plain decimal, as numeric; else NULL.
CREATE OR REPLACE FUNCTION public.league_num(p jsonb)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE jsonb_typeof(p)
           WHEN 'number' THEN (p #>> '{}')::numeric
           WHEN 'string' THEN CASE WHEN btrim(p #>> '{}') ~ '^[-+]?[0-9]+(\.[0-9]+)?$'
                                   THEN btrim(p #>> '{}')::numeric END
         END;
$$;

-- handicapIndex.isRatedTee: parseInt(slope) > 0 and a numeric rating.
CREATE OR REPLACE FUNCTION public.league_course_rated(p_course jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(trunc(public.league_num(p_course -> 'slope')) > 0
                  AND public.league_num(p_course -> 'rating') IS NOT NULL, false);
$$;

-- WHS differential of an 18-hole card from its frozen data, or NULL when the
-- snapshot is unrated, a hole lacks par/SI, a stroke is missing, or there is
-- no playing handicap. holes = {"1":n,...,"18":n}; course = {slope, rating,
-- holes:[{n,par,si}]}.
CREATE OR REPLACE FUNCTION public.league_card_differential(
  p_holes jsonb, p_course jsonb, p_playing_handicap int
) RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_slope  numeric;
  v_rating numeric;
  v_ph     int := p_playing_handicap;
  v_ags    int := 0;
  v_extra  int;
  r        record;
BEGIN
  IF p_holes IS NULL OR jsonb_typeof(p_holes) <> 'object' OR v_ph IS NULL
     OR NOT public.league_course_rated(p_course)
     OR jsonb_typeof(p_course -> 'holes') IS DISTINCT FROM 'array' THEN
    RETURN NULL;
  END IF;
  v_slope  := trunc(public.league_num(p_course -> 'slope'));
  v_rating := public.league_num(p_course -> 'rating');

  FOR r IN
    SELECT g.n,
           public.league_num(x.h -> 'par')::int  AS par,
           public.league_num(x.h -> 'si')::int   AS si,
           public.league_num(p_holes -> g.n::text)::int AS strokes
      FROM generate_series(1, 18) AS g(n)
      LEFT JOIN LATERAL (
        SELECT h FROM jsonb_array_elements(p_course -> 'holes') h
         WHERE public.league_num(h -> 'n') = g.n
         LIMIT 1) x ON true
  LOOP
    IF r.par IS NULL OR r.si IS NULL OR r.strokes IS NULL OR r.strokes <= 0 THEN
      RETURN NULL;
    END IF;
    -- scoring.calcExtraShots(v_ph, si, 18). Integer division truncates, which
    -- is floor for the non-negative operands used here.
    IF v_ph < 0 THEN
      v_extra := -((-v_ph) / 18) - CASE WHEN r.si > 18 - ((-v_ph) % 18) THEN 1 ELSE 0 END;
    ELSE
      v_extra := (v_ph / 18) + CASE WHEN r.si <= v_ph % 18 THEN 1 ELSE 0 END;
    END IF;
    v_ags := v_ags + LEAST(r.strokes, r.par + 2 + v_extra);
  END LOOP;

  -- JS: Math.round((113 / slope) * (ags - rating) * 10) / 10, in float8.
  RETURN round((floor((113::float8 / v_slope::float8) * (v_ags::float8 - v_rating::float8) * 10 + 0.5)
                / 10)::numeric, 1);
END;
$$;

-- round1(differential - league handicap); a card with no league handicap
-- plays off 0 (scoreCard does the same). NULL differential -> NULL.
CREATE OR REPLACE FUNCTION public.league_net_differential(p_differential numeric, p_league_handicap numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE WHEN p_differential IS NULL THEN NULL
              ELSE round((floor((p_differential::float8 - COALESCE(p_league_handicap, 0)::float8) * 10 + 0.5)
                          / 10)::numeric, 1) END;
$$;

-- The course snapshot with slope/rating filled in for an app card whose
-- snapshot has none (older builds), from the game round's tee. Anything
-- else comes back unchanged.
CREATE OR REPLACE FUNCTION public.league_rated_course(
  p_course jsonb, p_source text, p_tournament_id text, p_round_id text, p_player_id text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_body jsonb;
  v_tee  jsonb;
BEGIN
  IF p_source IS DISTINCT FROM 'app' OR public.league_course_rated(p_course)
     OR p_course IS NULL OR jsonb_typeof(p_course) <> 'object' THEN
    RETURN p_course;
  END IF;
  SELECT body INTO v_body FROM public.game_rounds
   WHERE tournament_id = p_tournament_id AND id = p_round_id;
  v_tee := v_body -> 'playerTees' -> p_player_id;
  IF v_tee IS NULL OR jsonb_typeof(v_tee) <> 'object' THEN
    v_tee := jsonb_build_object('slope', v_body -> 'slope', 'rating', v_body -> 'courseRating');
  END IF;
  IF NOT public.league_course_rated(v_tee) THEN
    RETURN p_course;
  END IF;
  RETURN p_course || jsonb_build_object('slope', v_tee -> 'slope', 'rating', v_tee -> 'rating');
END;
$$;

DO $$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.league_num(jsonb)',
    'public.league_course_rated(jsonb)',
    'public.league_card_differential(jsonb, jsonb, int)',
    'public.league_net_differential(numeric, numeric)',
    'public.league_rated_course(jsonb, text, text, text, text)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_sig);
  END LOOP;
END $$;

-- 2) Submit RPCs: same signatures and behaviour, plus the rated-tee rule and
--    the stored differentials ---------------------------------------------------

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
  v_course jsonb;
  v_diff   numeric;
BEGIN
  SELECT * INTO v_c FROM public.league_cards WHERE id = p_card FOR UPDATE;
  IF NOT FOUND OR v_c.user_id IS DISTINCT FROM v_uid
     OR NOT public.league_is_member(v_c.league_id, v_uid) THEN
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

  -- The league ranks by net differential: the tee must be rated. An app card
  -- from an older build has no slope/rating in its snapshot; take them from
  -- the game round's tee before refusing.
  v_course := public.league_rated_course(v_c.course, v_c.source, v_c.tournament_id,
                                         v_c.round_id, v_c.player_id);
  IF NOT public.league_course_rated(v_course) THEN
    RAISE EXCEPTION 'This tee has no slope and course rating, so it can''t count for the league.'
      USING ERRCODE = 'P0001', HINT = 'unrated_tee';
  END IF;
  v_diff := public.league_card_differential(v_holes, v_course, p_playing_handicap);

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
    v_not := v_c.announced_at IS NULL OR v_c.tee_time IS NULL OR v_c.tee_time < v_c.announced_at;
  END IF;

  UPDATE public.league_marker_tokens SET expires_at = LEAST(expires_at, now())
   WHERE card_id = p_card AND used_at IS NULL;

  UPDATE public.league_cards
     SET holes = v_holes, gross = p_gross, points = p_points,
         playing_handicap = p_playing_handicap,
         course = v_course, differential = v_diff,
         net_differential = public.league_net_differential(v_diff, v_c.league_handicap),
         played_on = COALESCE(p_played_on, played_on),
         first_shot_at = v_first, not_announced = v_not,
         status = 'submitted', updated_at = now()
   WHERE id = p_card;

  RETURN jsonb_build_object('id', p_card, 'status', 'submitted',
                            'not_announced', v_not, 'first_shot_at', v_first,
                            'differential', v_diff,
                            'net_differential', public.league_net_differential(v_diff, v_c.league_handicap));
END;
$$;

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
  v_s0    date;
  v_s1    date;
  v_diff  numeric;
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

  v_holes := public.league_canonical_holes(p_holes);
  IF p_gross IS DISTINCT FROM (SELECT sum(value::int) FROM jsonb_each_text(v_holes)) THEN
    RAISE EXCEPTION 'The total does not match the holes.' USING ERRCODE = 'P0001';
  END IF;
  IF p_points IS NULL OR p_points < 0 OR p_playing_handicap IS NULL THEN
    RAISE EXCEPTION 'Points and playing handicap are required.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.league_course_rated(p_course) THEN
    RAISE EXCEPTION 'This tee has no slope and course rating, so it can''t count for the league.'
      USING ERRCODE = 'P0001', HINT = 'unrated_tee';
  END IF;
  v_diff := public.league_card_differential(v_holes, p_course, p_playing_handicap);

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
       holes, gross, points, differential, net_differential)
    VALUES
      (p_league, v_uid, v_month, 'offapp', 'submitted', p_course, p_tee_time,
       COALESCE(p_played_on, (p_tee_time AT TIME ZONE 'Europe/Madrid')::date),
       NULL, true, v_hcp, p_playing_handicap, v_holes, p_gross, p_points,
       v_diff, public.league_net_differential(v_diff, v_hcp))
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'You already have your % card.', to_char(v_month, 'FMMonth')
      USING ERRCODE = 'P0001', HINT = 'card_exists';
  END;

  RETURN jsonb_build_object('id', v_id, 'month', v_month, 'status', 'submitted',
                            'not_announced', true);
END;
$$;

-- 3) Card rows returned to clients carry the net differential -----------------

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
      'net_differential', v_c.net_differential,
      'gross',         v_c.gross,
      'confirmation',  p_how,
      'confirmed_by',  p_by_name,
      'not_announced', v_c.not_announced,
      'month',         v_c.month));
END;
$$;

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
  IF public.league_card_hash(v_c) <> v_t.snapshot_hash THEN
    RAISE EXCEPTION 'changed' USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'player_first_name', split_part(public.league_user_name(v_c.user_id), ' ', 1),
    'course',            v_c.course ->> 'name',
    'tee',               v_c.course ->> 'tee',
    'slope',             public.league_num(v_c.course -> 'slope'),
    'rating',            public.league_num(v_c.course -> 'rating'),
    'date',              v_c.played_on,
    'playing_handicap',  v_c.playing_handicap,
    'gross',             v_c.gross,
    'points',            v_c.points,
    'differential',      v_c.differential,
    'net_differential',  v_c.net_differential,
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

-- 4) Backfill -------------------------------------------------------------------
-- Every card with a frozen score. App cards from older builds get their
-- snapshot's slope/rating from the game round first; cards whose tee is
-- still unrated stay NULL (shown as "not ranked").
WITH x AS (
  SELECT c.id, c.holes, c.playing_handicap, c.league_handicap,
         public.league_rated_course(c.course, c.source, c.tournament_id, c.round_id, c.player_id) AS course
    FROM public.league_cards c
   WHERE c.holes IS NOT NULL
), y AS (
  SELECT x.*, public.league_card_differential(x.holes, x.course, x.playing_handicap) AS diff FROM x
)
UPDATE public.league_cards c
   SET course           = y.course,
       differential     = y.diff,
       net_differential = public.league_net_differential(y.diff, y.league_handicap)
  FROM y
 WHERE c.id = y.id
   AND (c.course IS DISTINCT FROM y.course
        OR c.differential IS DISTINCT FROM y.diff
        OR c.net_differential IS DISTINCT FROM public.league_net_differential(y.diff, y.league_handicap));

/* ===========================================================================
   VERIFY
   ---------------------------------------------------------------------------
   Smoke test (BEGIN … ROLLBACK): supabase/tests/leagues_smoke.sql, section 9b.

   -- Worked example (CNG Amarillas 130 / 71.4, adjusted 85, league hcp 14.2):
   SELECT public.league_net_differential(11.8, 14.2);   -- -2.4

   -- Rated cards with a score but no net differential (expect none):
   SELECT id FROM public.league_cards
    WHERE holes IS NOT NULL AND net_differential IS NULL
      AND public.league_course_rated(course);
   =========================================================================== */
