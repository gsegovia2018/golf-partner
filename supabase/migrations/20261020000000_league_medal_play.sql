-- ============================================================================
-- League medal play: a league is scored by net Stableford (as today), or by
-- medal play, net or gross, ranked against par.
-- Plan: docs/superpowers/plans/2026-10-15-league-medal-play.md (M1).
-- Builds on every earlier *league* migration, last 20261018000000_league_public_name_email.sql:
-- each function below starts from its newest body (named above it). Idempotent;
-- safe to re-run.
-- ============================================================================
--
-- WHAT AND WHY
-- ------------
-- Some groups want to play for strokes, not points. A league now has a
-- format, picked by the admin when it is created:
--
--   stableford    the month ranks by net Stableford points, most first (today)
--   medal_net     the month ranks by net strokes against par, fewest first
--   medal_gross   the month ranks by gross strokes against par, fewest first
--
-- Against par, not total strokes, so a month played on a par-70 and a par-72
-- course is fair; the playing handicap already carries slope and CR - par:
--
--   net to par    = gross - playing handicap - par
--   gross to par  = gross - par
--
-- Season points per place, participation points, ties sharing the summed
-- points and the month-close rules don't change: only the month's ranking
-- value and its direction (leagueStandings.monthResults, client side).
--
-- 1) leagues.format, CHECK in the three values, default 'stableford': every
--    existing league stays Stableford, so there is no backfill.
-- 2) league_cards.to_par: the server's ranking value for a medal league,
--    stored by submit_league_card / add_unannounced_league_card from the
--    league's format when the card is scored. NULL for a Stableford league and
--    for a card not scored yet. `points` is still computed for every card.
-- 3) league_card_score also returns `par` (the sum of the 18 pars it scored
--    against); league_card_to_par(score, format) is the formula above
--    (internal, IMMUTABLE, nobody executes it).
-- 4) create_league takes p_format (default 'stableford'); a value outside the
--    three is refused (HINT 'bad_format'). update_league_rules takes p_format
--    (default NULL = keep). The format is locked once the league has any card
--    that is not void (HINT 'format_locked'): changing the ranking under
--    cards already played would rewrite months. Sending the same format again
--    is allowed. Both are replaced (DROP + CREATE), not overloaded: an extra
--    defaulted argument on a second overload would make every existing call
--    ambiguous. Every existing caller (positional or named) keeps working.
-- 5) get_league_by_code, get_league_invite_preview, get_marker_card (plus the
--    card's to_par) and get_public_league_board return the format. The public
--    board's cards carry to_par; a medal league's cards count when to_par is
--    set (points for Stableford, as before) and are ordered fewest first.
--    For a gross league to_par is gross - par: the ranking value itself, so
--    the board shows it like it shows points.
-- 6) The league_card_confirmed notification carries format and to_par.
-- ============================================================================

-- 1) Columns -------------------------------------------------------------------------

ALTER TABLE public.leagues ADD COLUMN IF NOT EXISTS format text NOT NULL DEFAULT 'stableford';
ALTER TABLE public.leagues DROP CONSTRAINT IF EXISTS leagues_format_check;
ALTER TABLE public.leagues ADD CONSTRAINT leagues_format_check
  CHECK (format IN ('stableford','medal_net','medal_gross'));

-- NULL for Stableford leagues and cards not scored yet.
ALTER TABLE public.league_cards ADD COLUMN IF NOT EXISTS to_par int;

-- 2) Scoring helpers (internal) --------------------------------------------------------

-- Body of 20261015000000 plus `par` in the result: {playing_handicap, points,
-- gross, par} of an 18-hole card from its frozen data, or NULL when any hole
-- 1..18 lacks strokes, a par or a stroke index.
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

  RETURN jsonb_build_object('playing_handicap', v_ph, 'points', v_points, 'gross', v_gross,
                            'par', v_total);
END;
$$;

-- A card's strokes against par for a medal league, from league_card_score's
-- result: medal_net = gross - playing handicap - par, medal_gross = gross -
-- par. NULL for a Stableford league, an unknown format or no score.
CREATE OR REPLACE FUNCTION public.league_card_to_par(p_score jsonb, p_format text)
RETURNS int
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_format
           WHEN 'medal_net'   THEN (p_score ->> 'gross')::int - (p_score ->> 'playing_handicap')::int
                                   - (p_score ->> 'par')::int
           WHEN 'medal_gross' THEN (p_score ->> 'gross')::int - (p_score ->> 'par')::int
         END;
$$;

DO $$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.league_card_score(jsonb, jsonb, numeric)',
    'public.league_card_to_par(jsonb, text)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_sig);
  END LOOP;
END $$;

-- 3) create_league / update_league_rules: the format ---------------------------------

DROP FUNCTION IF EXISTS public.create_league(text, date, date, int[], numeric, int, jsonb, int);

-- Body of 20261015000000 plus p_format (NULL -> 'stableford').
CREATE OR REPLACE FUNCTION public.create_league(
  p_name text, p_season_start date, p_season_end date, p_points_table int[],
  p_cap numeric, p_fee_cents int, p_members jsonb, p_participation_points int DEFAULT 10,
  p_format text DEFAULT 'stableford'
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
  IF COALESCE(p_format, 'stableford') NOT IN ('stableford','medal_net','medal_gross') THEN
    RAISE EXCEPTION 'Pick a league format: Stableford, medal play net or medal play gross.'
      USING ERRCODE = 'P0001', HINT = 'bad_format';
  END IF;

  v_code := public.league_new_invite_code();
  INSERT INTO public.leagues (name, season_start, season_end, created_by, points_table,
                              handicap_cap, entry_fee_cents, invite_code, participation_points,
                              format)
  VALUES (btrim(p_name), p_season_start, p_season_end, v_uid,
          COALESCE(p_points_table, '{500,300,190,135,110,90,75,60,45,35,25,15}'::int[]),
          v_cap, GREATEST(COALESCE(p_fee_cents, 0), 0), v_code,
          COALESCE(p_participation_points, 10), COALESCE(p_format, 'stableford'))
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

DROP FUNCTION IF EXISTS public.update_league_rules(uuid, text, date, date, int[], numeric, int, int);

-- Body of 20261015000000 plus p_format. NULL arguments keep the current
-- value. The format can't change once the league has a card that isn't void.
CREATE OR REPLACE FUNCTION public.update_league_rules(
  p_league uuid, p_name text, p_season_start date, p_season_end date,
  p_points_table int[], p_cap numeric, p_fee_cents int, p_participation_points int DEFAULT NULL,
  p_format text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cap numeric(4,1);
  v_format text;
BEGIN
  IF NOT public.league_is_admin(p_league, v_uid) THEN
    RAISE EXCEPTION 'Only the league admin can do that.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.league_assert_open(p_league);
  IF p_participation_points < 0 THEN
    RAISE EXCEPTION 'Points for playing can''t be negative.'
      USING ERRCODE = 'P0001', HINT = 'participation_points';
  END IF;
  IF p_format IS NOT NULL THEN
    IF p_format NOT IN ('stableford','medal_net','medal_gross') THEN
      RAISE EXCEPTION 'Pick a league format: Stableford, medal play net or medal play gross.'
        USING ERRCODE = 'P0001', HINT = 'bad_format';
    END IF;
    -- Locked once the league has a card that isn't void, whatever its status
    -- (announced included); the same format again is a no-op, allowed.
    SELECT format INTO v_format FROM public.leagues WHERE id = p_league;
    IF p_format IS DISTINCT FROM v_format
       AND EXISTS (SELECT 1 FROM public.league_cards
                    WHERE league_id = p_league AND status <> 'void') THEN
      RAISE EXCEPTION 'The format can''t change once the league has a card.'
        USING ERRCODE = 'P0001', HINT = 'format_locked';
    END IF;
  END IF;
  UPDATE public.leagues
     SET name            = COALESCE(NULLIF(btrim(p_name), ''), name),
         season_start    = COALESCE(p_season_start, season_start),
         season_end      = COALESCE(p_season_end, season_end),
         points_table    = COALESCE(p_points_table, points_table),
         handicap_cap    = COALESCE(p_cap, handicap_cap),
         entry_fee_cents = CASE WHEN p_fee_cents IS NULL THEN entry_fee_cents
                                ELSE GREATEST(p_fee_cents, 0) END,
         participation_points = COALESCE(p_participation_points, participation_points),
         format          = COALESCE(p_format, format)
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
    'public.create_league(text, date, date, int[], numeric, int, jsonb, int, text)',
    'public.update_league_rules(uuid, text, date, date, int[], numeric, int, int, text)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_sig);
  END LOOP;
END $$;

-- 4) submit_league_card / add_unannounced_league_card: to_par ---------------------------
-- Same signatures (CREATE OR REPLACE keeps their grants).

-- Body of 20261016000000 plus to_par (stored, logged and returned).
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
  v_to_par   int;
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
  PERFORM public.league_assert_month_open(v_c.month);
  -- R16: an app card is the caller's own player of the game.
  IF v_c.source = 'app' THEN
    PERFORM public.league_assert_own_player(v_c.tournament_id, v_c.player_id, v_uid);
  END IF;
  -- R11: past post_by, the resubmission a marker's return allows is once per card.
  IF v_c.status = 'submitted' AND v_c.returned_at IS NOT NULL AND v_c.returned_resubmits >= 1
     AND v_c.post_by IS NOT NULL AND now() > v_c.post_by THEN
    RAISE EXCEPTION 'You already corrected this card once after a marker sent it back, and the 8 hours to post it are over.'
      USING ERRCODE = 'P0001', HINT = 'resubmit_used';
  END IF;

  IF v_c.source = 'offapp' AND v_c.status = 'announced' AND v_c.tee_time IS NOT NULL THEN
    IF now() < v_c.tee_time THEN
      RAISE EXCEPTION 'You can post this card once your tee time has passed.'
        USING ERRCODE = 'P0001', HINT = 'before_tee_time';
    END IF;
    -- R8: a round takes at least 3 hours.
    IF now() < v_c.tee_time + interval '3 hours' THEN
      RAISE EXCEPTION 'You can post this card from 3 hours after your tee time.'
        USING ERRCODE = 'P0001', HINT = 'too_early';
    END IF;
  END IF;

  IF v_c.status = 'missed'
     OR (v_c.post_by IS NOT NULL AND now() > v_c.post_by
         -- R11: past post_by only the one resubmission a marker's return
         -- allows, within 24 h of the return.
         AND (v_c.status <> 'submitted' OR v_c.returned_at IS NULL
              OR now() > v_c.returned_at + interval '24 hours')) THEN
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

  -- No scramble card, even one announced before this rule.
  IF v_c.source = 'app' THEN
    PERFORM public.league_assert_not_scramble(
      public.league_round_scoring_mode(v_c.tournament_id, v_c.round_id));
  END IF;

  -- R4: the library tee when the course is a library course. An app card from
  -- an older build with no slope/rating gets the game round's tee first.
  v_course := public.league_rated_course(v_c.course, v_c.source, v_c.tournament_id,
                                         v_c.round_id, v_c.player_id);
  v_lib := public.league_library_course(v_course, v_c.source, v_c.tournament_id,
                                        v_c.round_id, v_c.player_id, v_c.user_id);
  IF v_lib ->> 'status' = 'unknown_tee' THEN
    RAISE EXCEPTION 'That tee isn''t one of this course''s tees in the course library. Pick one of its tees.'
      USING ERRCODE = 'P0001', HINT = 'unknown_tee';
  END IF;
  v_verified := v_lib ->> 'status' = 'verified';
  v_course := CASE WHEN v_verified THEN v_lib -> 'course' ELSE v_course END;
  IF v_lib ->> 'status' = 'unrated' OR NOT public.league_course_rated(v_course) THEN
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
  PERFORM public.league_assert_plausible_course(v_course);
  v_ph   := (v_score ->> 'playing_handicap')::int;
  v_diff := public.league_card_differential(v_holes, v_course, v_ph);
  v_net  := public.league_net_differential(v_diff, v_c.league_handicap);
  -- The ranking value of a medal league (NULL for Stableford).
  v_to_par := public.league_card_to_par(v_score,
                (SELECT format FROM public.leagues WHERE id = v_c.league_id));

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
    -- The same 15 minutes of slack announce allowed on the first tee.
    v_not := v_c.announced_at IS NULL OR v_c.tee_time IS NULL
             OR v_c.tee_time < v_c.announced_at - interval '15 minutes';
  END IF;

  UPDATE public.league_marker_tokens SET expires_at = LEAST(expires_at, now())
   WHERE card_id = p_card AND used_at IS NULL;

  UPDATE public.league_cards
     SET holes = v_holes, gross = (v_score ->> 'gross')::int,
         points = (v_score ->> 'points')::int, playing_handicap = v_ph,
         to_par = v_to_par,
         course = v_course, tee_verified = v_verified,
         differential = v_diff, net_differential = v_net,
         -- An announced off-app card was played on its tee day.
         played_on = CASE WHEN v_c.source = 'offapp' AND v_c.tee_time IS NOT NULL
                               AND v_c.announced_at IS NOT NULL
                          THEN (v_c.tee_time AT TIME ZONE 'Europe/Madrid')::date
                          ELSE COALESCE(p_played_on, played_on) END,
         first_shot_at = v_first, not_announced = v_not,
         approved_by = NULL, approved_at = NULL, returned_at = NULL,
         returned_resubmits = returned_resubmits
                              + CASE WHEN v_c.status = 'submitted' AND v_c.returned_at IS NOT NULL THEN 1 ELSE 0 END,
         marker_user_id = NULL, marker_name = NULL,
         marker_requested_at = NULL, marker_reminded_at = NULL,
         status = 'submitted', updated_at = now()
   WHERE id = p_card;

  PERFORM public.league_card_log(p_card, 'submitted', v_uid, NULL, NULL, NULL,
    jsonb_build_object('points', (v_score ->> 'points')::int, 'gross', (v_score ->> 'gross')::int,
                       'to_par', v_to_par,
                       'tee_verified', v_verified, 'not_announced', v_not,
                       'resubmit', v_c.status = 'submitted',
                       'after_return', v_c.status = 'submitted' AND v_c.returned_at IS NOT NULL));

  RETURN jsonb_build_object('id', p_card, 'status', 'submitted',
                            'not_announced', v_not, 'first_shot_at', v_first,
                            'gross', (v_score ->> 'gross')::int,
                            'points', (v_score ->> 'points')::int,
                            'to_par', v_to_par,
                            'playing_handicap', v_ph,
                            'tee_verified', v_verified,
                            'differential', v_diff,
                            'net_differential', v_net);
END;
$$;

-- Body of 20261016000000 plus to_par (stored, logged and returned).
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
  v_to_par   int;
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
  PERFORM public.league_assert_month_open(v_month);

  SELECT season_start, season_end INTO v_s0, v_s1 FROM public.leagues WHERE id = p_league;
  IF COALESCE(p_played_on, (p_tee_time AT TIME ZONE 'Europe/Madrid')::date) NOT BETWEEN v_s0 AND v_s1 THEN
    RAISE EXCEPTION 'That date is outside the season (% to %).', v_s0, v_s1
      USING ERRCODE = 'P0001', HINT = 'outside_season';
  END IF;

  v_holes := public.league_card_holes(p_holes);

  v_lib := public.league_library_course(p_course, 'offapp', NULL, NULL, NULL, v_uid);
  IF v_lib ->> 'status' = 'unknown_tee' THEN
    RAISE EXCEPTION 'That tee isn''t one of this course''s tees in the course library. Pick one of its tees.'
      USING ERRCODE = 'P0001', HINT = 'unknown_tee';
  END IF;
  v_verified := v_lib ->> 'status' = 'verified';
  v_course := CASE WHEN v_verified THEN v_lib -> 'course' ELSE p_course END;
  IF v_lib ->> 'status' = 'unrated' OR NOT public.league_course_rated(v_course) THEN
    RAISE EXCEPTION 'This tee has no slope and course rating, so it can''t count for the league.'
      USING ERRCODE = 'P0001', HINT = 'unrated_tee';
  END IF;

  IF EXISTS (SELECT 1 FROM public.league_cards
              WHERE league_id = p_league AND user_id = v_uid
                AND month = v_month AND public.league_takes_month(status, void_kind)) THEN
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
  PERFORM public.league_assert_plausible_course(v_course);
  v_ph   := (v_score ->> 'playing_handicap')::int;
  v_diff := public.league_card_differential(v_holes, v_course, v_ph);
  -- The ranking value of a medal league (NULL for Stableford).
  v_to_par := public.league_card_to_par(v_score,
                (SELECT format FROM public.leagues WHERE id = p_league));

  BEGIN
    INSERT INTO public.league_cards
      (league_id, user_id, month, source, status, course, tee_time, played_on,
       announced_at, not_announced, league_handicap, playing_handicap,
       holes, gross, points, differential, net_differential, tee_verified, to_par)
    VALUES
      (p_league, v_uid, v_month, 'offapp', 'submitted', v_course, p_tee_time,
       COALESCE(p_played_on, (p_tee_time AT TIME ZONE 'Europe/Madrid')::date),
       NULL, true, v_hcp, v_ph, v_holes, (v_score ->> 'gross')::int, (v_score ->> 'points')::int,
       v_diff, public.league_net_differential(v_diff, v_hcp), v_verified, v_to_par)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'You already have your % card.', to_char(v_month, 'FMMonth')
      USING ERRCODE = 'P0001', HINT = 'card_exists';
  END;

  PERFORM public.league_card_log(v_id, 'added', v_uid, NULL, NULL, NULL,
    jsonb_build_object('points', (v_score ->> 'points')::int, 'gross', (v_score ->> 'gross')::int,
                       'to_par', v_to_par,
                       'tee_verified', v_verified, 'not_announced', true));

  RETURN jsonb_build_object('id', v_id, 'month', v_month, 'status', 'submitted',
                            'not_announced', true,
                            'gross', (v_score ->> 'gross')::int,
                            'points', (v_score ->> 'points')::int,
                            'to_par', v_to_par,
                            'playing_handicap', v_ph,
                            'tee_verified', v_verified);
END;
$$;

-- 5) Readers: the format -------------------------------------------------------------
-- Same signatures (CREATE OR REPLACE keeps their grants).

-- Body of 20261014000000 plus format.
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
    'format',           v_l.format,
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

-- Body of 20261014000000 plus format.
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
    'format',            v_l.format,
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

-- Body of 20261013000000 plus the league's format and the card's to_par.
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
  -- Someone else's request reads like an unknown token.
  IF v_t.marker_user_id IS NOT NULL AND auth.uid() IS DISTINCT FROM v_t.marker_user_id THEN
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
    'to_par',            v_c.to_par,
    'differential',      v_c.differential,
    'net_differential',  v_c.net_differential,
    'expires_at',        v_t.expires_at,
    'league_name',       (SELECT name FROM public.leagues WHERE id = v_c.league_id),
    'format',            (SELECT format FROM public.leagues WHERE id = v_c.league_id),
    'month',             v_c.month,
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
           LIMIT 1) x ON true))
    || CASE WHEN v_t.marker_user_id IS NOT NULL
            THEN jsonb_build_object('bound', true,
                                    'signed_in_name', public.league_user_name(auth.uid()))
            ELSE '{}'::jsonb END;
END;
$$;

-- Body of 20261017000000 (league_public_name as redefined in 20261018000000)
-- plus league.format and each card's to_par; a medal league's cards count
-- when to_par is set and are ordered fewest first. Whitelist only, as before.
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
    SELECT c.user_id, c.month, c.points, c.to_par, c.course ->> 'name' AS course
      FROM public.league_cards c
     WHERE c.league_id = v_l.id
       AND c.status = 'confirmed'
       -- Scored for the league's format: points (Stableford) or to_par (medal).
       AND CASE WHEN v_l.format = 'stableford' THEN c.points IS NOT NULL
                ELSE c.to_par IS NOT NULL END
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
              'to_par', k.to_par,
              'course', k.course)
            -- Most points first (Stableford), fewest strokes first (medal).
            ORDER BY k.month, CASE WHEN v_l.format = 'stableford' THEN -k.points ELSE k.to_par END),
            '[]'::jsonb)
       FROM counting k)
    INTO v_members, v_cards;

  RETURN jsonb_build_object(
    'league', jsonb_build_object(
      'name',                 v_l.name,
      'format',               v_l.format,
      'season_start',         to_char(v_l.season_start, 'YYYY-MM-DD'),
      'season_end',           to_char(v_l.season_end, 'YYYY-MM-DD'),
      'points_table',         to_jsonb(v_l.points_table),
      'participation_points', v_l.participation_points),
    'members', v_members,
    'cards',   v_cards);
END;
$$;

-- 6) The confirmation notification: format and to_par ----------------------------------

-- Body of 20261016000000 plus format and to_par in the notification.
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
         marker_user_id = NULL, marker_name = NULL,
         marker_requested_at = NULL, marker_reminded_at = NULL,
         updated_at = now()
   WHERE id = p_card
  RETURNING * INTO v_c;
  -- Any QR still outstanding for this card is dead now.
  UPDATE public.league_marker_tokens SET expires_at = LEAST(expires_at, now())
   WHERE card_id = p_card AND used_at IS NULL;

  PERFORM public.league_card_log(p_card, 'confirmed', p_by_user, COALESCE(p_by_name, ''),
    CASE WHEN p_how = 'marker' THEN 'marker_request' ELSE p_how END, NULL,
    jsonb_build_object('proof', p_proof IS NOT NULL,
                       -- A QR marker signs with a typed name and no account.
                       'marker_account', CASE WHEN p_how IN ('qr','marker','partner') THEN p_by_user IS NOT NULL END));

  PERFORM public.notify_league_members(v_c.league_id, v_c.user_id, 'league_card_confirmed', p_card,
    jsonb_build_object(
      'card_id',       p_card,
      'course_name',   v_c.course ->> 'name',
      'points',        v_c.points,
      'format',        (SELECT format FROM public.leagues WHERE id = v_c.league_id),
      'to_par',        v_c.to_par,
      'net_differential', v_c.net_differential,
      'gross',         v_c.gross,
      'confirmation',  p_how,
      'confirmed_by',  p_by_name,
      'not_announced', v_c.not_announced,
      'month',         v_c.month));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.league_confirm_card(uuid, text, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
