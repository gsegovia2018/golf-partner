-- ============================================================================
-- League: post a card within 8 hours of its tee time.
-- Plan: docs/superpowers/plans/2026-10-06-league-post-deadline.md (R1-R8).
-- Builds on 20261004000000_leagues.sql and 20261005000001_league_net_differential.sql.
-- Idempotent; safe to re-run.
-- ============================================================================
--
-- WHY
-- ---
-- Announcing commits a member to a round, but nothing made them post it
-- afterwards: they could play several rounds and post only the good one.
-- Now every announced card carries post_by = tee_time + 8 h.
--
--   announced/playing --(posted by post_by)--> submitted
--   announced/playing --(post_by passes, sweep)--> missed   (still uses the month)
--   missed --(admin reopens, R6)--> announced/playing with post_by = now() + 8 h
--   missed --(app card finished on time, R4)--> submitted
--
-- submit_league_card checks the deadline itself, so the 15-minute sweep only
-- makes the state visible and sends the reminder; it never decides a refusal.
--
-- Unannounced cards (not_announced = true) score nothing until another admin
-- approves them (R7): approved_by / approved_at.
--
-- Existing cards (R8) keep post_by NULL = no deadline, and existing
-- not_announced cards are approved by the backfill below.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 1) Columns, status, index ----------------------------------------------------

-- The backfill runs only in the run that adds approved_at: on a re-run it
-- would silently approve cards that are waiting for an admin.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'league_cards'
                    AND column_name = 'approved_at') THEN
    ALTER TABLE public.league_cards ADD COLUMN approved_at timestamptz;
    UPDATE public.league_cards SET approved_at = now() WHERE not_announced;
  END IF;
END $$;

ALTER TABLE public.league_cards ADD COLUMN IF NOT EXISTS post_by     timestamptz;
ALTER TABLE public.league_cards ADD COLUMN IF NOT EXISTS reminded_at timestamptz;
-- Set when a marker sends the card back, cleared by the next submit: the one
-- correction allowed past post_by (marker_note can be empty, so it can't say).
ALTER TABLE public.league_cards ADD COLUMN IF NOT EXISTS returned_at timestamptz;
ALTER TABLE public.league_cards ADD COLUMN IF NOT EXISTS approved_by uuid
  REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.league_cards DROP CONSTRAINT IF EXISTS league_cards_status_check;
ALTER TABLE public.league_cards ADD CONSTRAINT league_cards_status_check
  CHECK (status IN ('announced','playing','submitted','confirmed','missed','void'));

CREATE INDEX IF NOT EXISTS league_cards_approved_by_idx
  ON public.league_cards (approved_by) WHERE approved_by IS NOT NULL;

-- The sweep's scan: only live cards, and few of them.
CREATE INDEX IF NOT EXISTS league_cards_post_by_idx
  ON public.league_cards (post_by) WHERE status IN ('announced','playing');

-- 2) Helpers -------------------------------------------------------------------

-- The one place the 8 hours live (R1). Not a league setting.
CREATE OR REPLACE FUNCTION public.league_post_window()
RETURNS interval
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT interval '8 hours';
$$;

REVOKE EXECUTE ON FUNCTION public.league_post_window() FROM PUBLIC, anon, authenticated;

-- 3) announce_league_card: same as before, plus post_by -------------------------
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
  -- An app card tees off on Start, so its deadline runs from the server
  -- clock, never from the phone's.
  v_tee   timestamptz := CASE WHEN p_source = 'app' THEN now() ELSE COALESCE(p_tee_time, now()) END;
  v_month date;
  v_hcp   numeric(4,1);
  v_id    uuid;
  v_s0    date;
  v_s1    date;
BEGIN
  IF NOT public.league_is_member(p_league, v_uid) THEN
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
  IF v_month < public.league_month_of(now()) THEN
    RAISE EXCEPTION 'That month is over. Announce a card for this month or later.'
      USING ERRCODE = 'P0001', HINT = 'past_month';
  END IF;
  -- A tee time already gone would be missed on arrival and burn the month.
  -- A round already played is an unannounced card (approved by an admin).
  -- 15 minutes of slack for announcing on the first tee.
  IF p_source = 'offapp' AND v_tee < now() - interval '15 minutes' THEN
    RAISE EXCEPTION 'That tee time has passed. If you already played, add it as a card you didn''t announce.'
      USING ERRCODE = 'P0001', HINT = 'tee_time_passed';
  END IF;
  SELECT season_start, season_end INTO v_s0, v_s1 FROM public.leagues WHERE id = p_league;
  IF (v_tee AT TIME ZONE 'Europe/Madrid')::date NOT BETWEEN v_s0 AND v_s1 THEN
    RAISE EXCEPTION 'That date is outside the season (% to %).', v_s0, v_s1
      USING ERRCODE = 'P0001', HINT = 'outside_season';
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
      (league_id, user_id, month, source, status, tournament_id, round_id, player_id,
       course, tee_time, played_on, announced_at, league_handicap, post_by)
    VALUES
      (p_league, v_uid, v_month, p_source,
       CASE WHEN p_source = 'app' THEN 'playing' ELSE 'announced' END,
       p_tournament_id, p_round_id, p_player_id,
       p_course, v_tee, (v_tee AT TIME ZONE 'Europe/Madrid')::date, now(), v_hcp,
       v_tee + public.league_post_window())
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
                            'league_handicap', v_hcp,
                            'post_by', v_tee + public.league_post_window());
END;
$$;

-- 4) submit_league_card: the deadline ------------------------------------------
-- Body of 20261005000001 plus the post_by check. Past post_by (or once
-- 'missed') only an app card whose round was finished on or before post_by
-- is accepted (R4: no signal on the course). finishedAt is the client's
-- stamp, first write wins on the server. Off-app cards go by the server
-- clock, and can't be posted before their tee time (else one announcement
-- would cover any round of the month). R4 is bounded: the stamp can't
-- precede the round's start, and the excuse expires 24 h after post_by.
-- Past post_by a 'submitted' card can be resubmitted only once per marker
-- return (returned_at); otherwise a placeholder posted in time could
-- be swapped for a later round. A resubmission clears an admin's approval.
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
  v_fin    timestamptz;
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
    -- The same 15 minutes of slack announce allows on the first tee.
    v_not := v_c.announced_at IS NULL OR v_c.tee_time IS NULL
             OR v_c.tee_time < v_c.announced_at - interval '15 minutes';
  END IF;

  UPDATE public.league_marker_tokens SET expires_at = LEAST(expires_at, now())
   WHERE card_id = p_card AND used_at IS NULL;

  UPDATE public.league_cards
     SET holes = v_holes, gross = p_gross, points = p_points,
         playing_handicap = p_playing_handicap,
         course = v_course, differential = v_diff,
         net_differential = public.league_net_differential(v_diff, v_c.league_handicap),
         -- An announced off-app card was played on its tee day.
         played_on = CASE WHEN v_c.source = 'offapp' AND v_c.tee_time IS NOT NULL
                               AND v_c.announced_at IS NOT NULL
                          THEN (v_c.tee_time AT TIME ZONE 'Europe/Madrid')::date
                          ELSE COALESCE(p_played_on, played_on) END,
         first_shot_at = v_first, not_announced = v_not,
         approved_by = NULL, approved_at = NULL, returned_at = NULL,
         status = 'submitted', updated_at = now()
   WHERE id = p_card;

  RETURN jsonb_build_object('id', p_card, 'status', 'submitted',
                            'not_announced', v_not, 'first_shot_at', v_first,
                            'differential', v_diff,
                            'net_differential', public.league_net_differential(v_diff, v_c.league_handicap));
END;
$$;

-- 5) New RPCs --------------------------------------------------------------------

-- R5: the owner moves an off-app card's tee time while the original one is
-- still ahead. Same month (the month is the card's identity) and season.
-- post_by moves with it and the reminder re-arms.
CREATE OR REPLACE FUNCTION public.reschedule_league_card(p_card uuid, p_tee_time timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_c    public.league_cards%ROWTYPE;
  v_s0   date;
  v_s1   date;
  v_post timestamptz;
BEGIN
  SELECT * INTO v_c FROM public.league_cards WHERE id = p_card FOR UPDATE;
  IF NOT FOUND OR v_c.user_id IS DISTINCT FROM v_uid
     OR NOT public.league_is_member(v_c.league_id, v_uid) THEN
    RAISE EXCEPTION 'Card not found.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.league_assert_open(v_c.league_id);
  IF v_c.source <> 'offapp' THEN
    RAISE EXCEPTION 'Only a card played off the app can be rescheduled.'
      USING ERRCODE = 'P0001', HINT = 'not_offapp';
  END IF;
  IF v_c.status <> 'announced' THEN
    RAISE EXCEPTION 'This card can no longer be rescheduled.'
      USING ERRCODE = 'P0001', HINT = 'not_open';
  END IF;
  IF v_c.tee_time IS NULL OR now() >= v_c.tee_time THEN
    RAISE EXCEPTION 'The tee time has passed, so this card can''t be moved.'
      USING ERRCODE = 'P0001', HINT = 'tee_time_passed';
  END IF;
  IF p_tee_time IS NULL OR p_tee_time < now() THEN
    RAISE EXCEPTION 'Pick a tee time that hasn''t passed yet.'
      USING ERRCODE = 'P0001', HINT = 'tee_time_passed';
  END IF;
  IF public.league_month_of(p_tee_time) <> v_c.month THEN
    RAISE EXCEPTION 'This is your % card. The new tee time has to stay in %.',
      to_char(v_c.month, 'FMMonth'), to_char(v_c.month, 'FMMonth')
      USING ERRCODE = 'P0001', HINT = 'month_change';
  END IF;
  SELECT season_start, season_end INTO v_s0, v_s1 FROM public.leagues WHERE id = v_c.league_id;
  IF (p_tee_time AT TIME ZONE 'Europe/Madrid')::date NOT BETWEEN v_s0 AND v_s1 THEN
    RAISE EXCEPTION 'That date is outside the season (% to %).', v_s0, v_s1
      USING ERRCODE = 'P0001', HINT = 'outside_season';
  END IF;

  v_post := p_tee_time + public.league_post_window();
  UPDATE public.league_cards
     SET tee_time = p_tee_time, played_on = (p_tee_time AT TIME ZONE 'Europe/Madrid')::date,
         post_by = v_post, reminded_at = NULL, updated_at = now()
   WHERE id = p_card;

  RETURN jsonb_build_object('id', p_card, 'tee_time', p_tee_time, 'post_by', v_post);
END;
$$;

-- R4c: a marker's return is what allows one correction past post_by.
-- Body of 20261004000000 plus returned_at.
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
  PERFORM public.league_assert_open(v_c.league_id);
  IF v_c.status <> 'submitted' OR v_c.holes IS NULL THEN
    RAISE EXCEPTION 'invalid' USING ERRCODE = 'P0001';
  END IF;
  IF public.league_card_hash(v_c) <> v_t.snapshot_hash THEN
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

  UPDATE public.league_cards SET marker_note = v_note, returned_at = now(), updated_at = now()
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

-- R6: an admin gives a missed card another 8 hours from now. Never their own:
-- the deadline would mean nothing if an admin could lift it for themselves.
CREATE OR REPLACE FUNCTION public.reopen_league_card(p_card uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_c      public.league_cards%ROWTYPE;
  v_status text;
  v_post   timestamptz := now() + public.league_post_window();
BEGIN
  SELECT * INTO v_c FROM public.league_cards WHERE id = p_card FOR UPDATE;
  IF NOT FOUND OR NOT public.league_is_admin(v_c.league_id, v_uid) THEN
    RAISE EXCEPTION 'Only the league admin can do that.' USING ERRCODE = '42501';
  END IF;
  IF v_c.user_id = v_uid THEN
    RAISE EXCEPTION 'Another admin has to reopen your own card.'
      USING ERRCODE = '42501', HINT = 'own_card';
  END IF;
  PERFORM public.league_assert_open(v_c.league_id);
  -- A live card past post_by is missed already; the sweep just hasn't run.
  IF NOT (v_c.status = 'missed'
          OR (v_c.status IN ('announced','playing') AND v_c.post_by < now())) THEN
    RAISE EXCEPTION 'Only a card that wasn''t posted in time can be reopened.'
      USING ERRCODE = 'P0001', HINT = 'not_missed';
  END IF;
  -- A closed month's standings stay settled.
  IF v_c.month < public.league_month_of(now()) THEN
    RAISE EXCEPTION 'That month is over, so this card can''t be reopened.'
      USING ERRCODE = 'P0001', HINT = 'past_month';
  END IF;

  v_status := CASE WHEN v_c.source = 'app' THEN 'playing' ELSE 'announced' END;
  UPDATE public.league_cards
     SET status = v_status, post_by = v_post, reminded_at = NULL, updated_at = now()
   WHERE id = p_card;

  RETURN jsonb_build_object('id', p_card, 'status', v_status, 'post_by', v_post);
END;
$$;

-- R7: an unannounced card scores only once another admin approves it.
CREATE OR REPLACE FUNCTION public.approve_league_card(p_card uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_c   public.league_cards%ROWTYPE;
  v_at  timestamptz := now();
BEGIN
  SELECT * INTO v_c FROM public.league_cards WHERE id = p_card FOR UPDATE;
  IF NOT FOUND OR NOT public.league_is_admin(v_c.league_id, v_uid) THEN
    RAISE EXCEPTION 'Only the league admin can do that.' USING ERRCODE = '42501';
  END IF;
  IF v_c.user_id = v_uid THEN
    RAISE EXCEPTION 'Another admin has to approve your own card.'
      USING ERRCODE = '42501', HINT = 'own_card';
  END IF;
  PERFORM public.league_assert_open(v_c.league_id);
  IF NOT v_c.not_announced OR v_c.approved_at IS NOT NULL
     OR v_c.status NOT IN ('submitted','confirmed') THEN
    RAISE EXCEPTION 'This card doesn''t need approving.'
      USING ERRCODE = 'P0001', HINT = 'not_needed';
  END IF;

  UPDATE public.league_cards
     SET approved_by = v_uid, approved_at = v_at, updated_at = now()
   WHERE id = p_card;

  RETURN jsonb_build_object('id', p_card, 'approved_at', v_at);
END;
$$;

DO $$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.reschedule_league_card(uuid, timestamptz)',
    'public.reopen_league_card(uuid)',
    'public.approve_league_card(uuid)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_sig);
  END LOOP;
END $$;

-- 6) The sweep (pg_cron, every 15 minutes) ---------------------------------------
-- (1) R3: one reminder to the owner 2 h before post_by. Each step is a single
--     UPDATE ... RETURNING: a second concurrent run blocks on the same rows,
--     re-checks reminded_at / status, and skips them, so nothing is sent twice.
-- (2) R2: cards past post_by become 'missed' and their unused QR tokens die.
-- Archived leagues are frozen, so the sweep leaves them alone.
-- Returns the counts, for a manual run.
CREATE OR REPLACE FUNCTION public.league_sweep_cards()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reminded int;
  v_missed   int;
BEGIN
  WITH due AS (
    UPDATE public.league_cards c
       SET reminded_at = now()
      FROM public.leagues l
     WHERE l.id = c.league_id AND l.archived_at IS NULL
       AND c.status IN ('announced','playing') AND c.post_by IS NOT NULL
       AND c.reminded_at IS NULL
       AND now() >= c.post_by - interval '2 hours' AND now() < c.post_by
       AND public.league_is_member(c.league_id, c.user_id)
    RETURNING c.id, c.user_id, c.league_id, l.name AS league_name, c.post_by,
              c.course, c.source, c.tournament_id, c.round_id
  ), sent AS (
    INSERT INTO public.notifications (user_id, type, actor_id, entity_id, data)
    SELECT d.user_id, 'league_post_reminder', NULL, d.id,
           jsonb_build_object(
             'league_id',     d.league_id,
             'league_name',   d.league_name,
             'card_id',       d.id,
             'post_by',       d.post_by,
             'course_name',   d.course ->> 'name',
             'source',        d.source,
             'tournament_id', d.tournament_id,
             'round_id',      d.round_id)
      FROM due d
    RETURNING 1
  )
  SELECT count(*) INTO v_reminded FROM sent;

  WITH gone AS (
    UPDATE public.league_cards c
       SET status = 'missed', updated_at = now()
      FROM public.leagues l
     WHERE l.id = c.league_id AND l.archived_at IS NULL
       AND c.status IN ('announced','playing') AND c.post_by IS NOT NULL
       AND c.post_by < now()
    RETURNING c.id
  ), expired AS (
    UPDATE public.league_marker_tokens t
       SET expires_at = LEAST(t.expires_at, now())
      FROM gone g
     WHERE t.card_id = g.id AND t.used_at IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_missed FROM gone;

  RETURN jsonb_build_object('reminded', v_reminded, 'missed', v_missed);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.league_sweep_cards() FROM PUBLIC, anon, authenticated;

-- cron.schedule upserts by name on pg_cron >= 1.3; unscheduling first keeps a
-- re-run clean on any version.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'league-sweep') THEN
    PERFORM cron.unschedule('league-sweep');
  END IF;
END $$;
SELECT cron.schedule('league-sweep', '*/15 * * * *', $$SELECT public.league_sweep_cards()$$);

-- can_write_league_proof lists announced/playing/submitted, so a missed card
-- already refuses new proof photos; it needs no change.

/* ===========================================================================
   VERIFY
   ---------------------------------------------------------------------------
   -- The job is there:
   SELECT jobname, schedule, command, active FROM cron.job WHERE jobname = 'league-sweep';
   -- Its recent runs:
   SELECT status, return_message, start_time FROM cron.job_run_details
    WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'league-sweep')
    ORDER BY start_time DESC LIMIT 5;
   -- Live cards past their deadline (expect none older than 15 minutes):
   SELECT id, post_by FROM public.league_cards
    WHERE status IN ('announced','playing') AND post_by < now() - interval '15 minutes';
   =========================================================================== */
