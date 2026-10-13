-- ============================================================================
-- League integrity: deadlines from the first shot, notice for off-app cards,
-- withdraw, admins on their own card, marker returns, month close, the card
-- timeline, member admin, several league cards per game.
-- Plan: docs/superpowers/plans/2026-10-13-league-review-followups.md (B2:
-- R6-R13, R15, R15b, R16, R17; R14 was dropped).
-- Builds on every earlier *league* migration, last 20261015000000_league_server_scoring.sql:
-- each function below starts from its newest body there. Idempotent; safe to re-run.
-- ============================================================================
--
-- RULES
-- -----
--   R6   An app card's post_by = first shot + 8 h. announce leaves it NULL;
--        the first shot is the server clock of whichever comes first:
--        notify_league_tee_off (the scorecard's first tap) or the first
--        scorer_cards write carrying the card's player (trigger below). An
--        app card with no first shot 24 h after its announcement is withdrawn
--        by league_sweep_cards (void, void_kind 'auto_withdrawn') and the
--        owner is told. Cards announced before this migration keep the
--        post_by they have.
--   R7   Off-app announce: tee time >= now + 2 h ('short_notice'; a tee time
--        already past stays 'tee_time_passed'). Reschedule: only while the
--        current tee time is >= 2 h away ('reschedule_closed'), to a time
--        >= 2 h away ('short_notice'), same month and season, at most twice
--        per card ('reschedule_limit'). Every reschedule is on the timeline
--        and notifies members (league_card_rescheduled).
--   R8   An announced off-app card can't be posted before tee time + 3 h
--        ('too_early'; before the tee time itself it stays 'before_tee_time').
--   R9   withdraw_league_card: the owner, before the tee time (off-app) or
--        before the first shot (app) ('withdraw_closed'), and never once the
--        server holds a score of the player in the round ('round_started').
--        void with void_kind / voided_reason 'withdrawn'; the month is free
--        again; members are told (league_card_withdrawn). If scores for that
--        player still arrive afterwards, the first-shot trigger makes it
--        'withdrawn_after_play' (the month is taken again), logs it and tells
--        the members (league_card_played_after_withdraw).
--   R10  An admin voids, reopens or approves their own card, or sets their own
--        league handicap, only when no other active admin exists (else 42501,
--        HINT 'own_card' / 'own_handicap'). Every void, reopen, approval and
--        handicap change notifies members (league_card_voided /
--        _reopened / _approved, league_handicap_changed); card actions are on
--        the timeline, handicap changes in league_handicap_events as before.
--   R11  Neither the owner nor anyone signed in as the owner can confirm or
--        return a card through a marker token ('own_card'). After a return
--        the owner may resubmit within 24 h of it, even past post_by; later
--        it is 'post_deadline_passed'. That allowance is once per card:
--        league_cards.returned_resubmits counts resubmissions after a return,
--        and past post_by a second one is 'resubmit_used'.
--        A QR confirmation by a stranger has no account behind it (accepted:
--        the stranger-marker flow depends on it); its timeline entry is
--        how 'qr', no actor_user_id, data.marker_account false.
--   R12  A month closes at the end of the 3rd day of the next month
--        (Europe/Madrid): league_assert_month_open refuses every write to that
--        month's cards ('month_closed') — add, submit, partner/marker/photo
--        confirmation, marker request and QR, approve, reopen, void,
--        withdraw, reschedule.
--   R13  league_card_events: the card's timeline (kinds in the CHECK below).
--        Members SELECT it (RLS) or call get_league_card_events; only the
--        SECURITY DEFINER functions here write it. Existing cards get events
--        backfilled from their timestamps (data.backfill = true).
--   R15  remove_league_member / rotate_league_invite_code /
--        release_league_invitee (admin). Removing or releasing someone ends
--        their marker tokens and requests (on their cards and as a marker)
--        and fails any open handicap vote about them; it is refused only when
--        it would leave the league with no admin ('last_admin'). join_league
--        refuses a spot to an active member ('already_member'), records the
--        spot's handicap as set by the claimer, and tells the admins
--        (league_spot_claimed). set_league_role logs promotions and demotions
--        and tells the members (league_role_changed). Membership changes are
--        logged in league_member_events.
--   R15b An admin void keeps the month taken; a withdrawal (by hand or by the
--        sweep) frees it. league_cards.void_kind says which: 'admin' |
--        'withdrawn' | 'auto_withdrawn' | 'withdrawn_after_play' (NULL on
--        voids from before this migration, which freed the month and still
--        do). "Takes the month" = status <> 'void' OR void_kind IN ('admin',
--        'withdrawn_after_play') (league_takes_month), used by the one-card
--        index and every card_exists check.
--   R16  Each league member in a game announces their own card for it: an app
--        announce is keyed by (league, game, round, player). Once the game
--        exists the player must be the caller's (game_players.user_id,
--        'not_your_player'); announcing the same (round, player) again, or
--        losing the insert race to a second tap, returns the same card
--        (existing = true) instead of 'card_exists'. Submit and tee-off
--        require the card's player to be the caller's in the game, always.
--        get_league_game_status lists the game's league members and their
--        month status, for Setup's league list.
--   R17  Any round of a casual tournament can be a card: the server never
--        assumed a single game (round ids are free text); an official
--        tournament's round is refused ('official_round').
-- ============================================================================

-- 1) Columns, indexes ---------------------------------------------------------------

ALTER TABLE public.league_cards ADD COLUMN IF NOT EXISTS void_kind text;
ALTER TABLE public.league_cards DROP CONSTRAINT IF EXISTS league_cards_void_kind_check;
ALTER TABLE public.league_cards ADD CONSTRAINT league_cards_void_kind_check
  CHECK (void_kind IS NULL OR (status = 'void'
         AND void_kind IN ('admin','withdrawn','auto_withdrawn','withdrawn_after_play')));

-- R11: resubmissions after a marker's return (the post-deadline one is once
-- per card). R7: reschedules (at most 2).
ALTER TABLE public.league_cards ADD COLUMN IF NOT EXISTS returned_resubmits int NOT NULL DEFAULT 0;
ALTER TABLE public.league_cards ADD COLUMN IF NOT EXISTS reschedules int NOT NULL DEFAULT 0;

-- R15b: an admin void still takes the month.
DROP INDEX IF EXISTS public.one_card_per_month;
CREATE UNIQUE INDEX one_card_per_month
  ON public.league_cards (league_id, user_id, month)
  WHERE status <> 'void' OR void_kind IN ('admin','withdrawn_after_play');

-- R16: one card per league per game round and player.
DROP INDEX IF EXISTS public.league_cards_one_per_round_player;
CREATE UNIQUE INDEX league_cards_one_per_round_player
  ON public.league_cards (league_id, tournament_id, round_id, player_id)
  WHERE source = 'app' AND (status <> 'void' OR void_kind IN ('admin','withdrawn_after_play'));

-- The first-shot trigger's lookup: live app cards still waiting for it.
CREATE INDEX IF NOT EXISTS league_cards_waiting_first_shot_idx
  ON public.league_cards (tournament_id, round_id)
  WHERE source = 'app' AND first_shot_at IS NULL AND status IN ('announced','playing');

-- 2) The card timeline (R13) and the membership log (R15) -----------------------------

CREATE TABLE IF NOT EXISTS public.league_card_events (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  card_id        uuid NOT NULL REFERENCES public.league_cards(id) ON DELETE CASCADE,
  league_id      uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN (
                   'announced','rescheduled','first_shot','submitted','added','sent_to_marker',
                   'returned','confirmed','approved','reopened','missed','withdrawn',
                   'auto_withdrawn','played_after_withdraw','voided')),
  actor_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_name     text,      -- a marker without an account has only a name
  how            text,      -- confirmed: partner | qr | photo | official | marker_request
  note           text,
  data           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS league_card_events_card_idx ON public.league_card_events (card_id, created_at, id);
CREATE INDEX IF NOT EXISTS league_card_events_league_idx ON public.league_card_events (league_id);

CREATE TABLE IF NOT EXISTS public.league_member_events (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  league_id      uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('removed','spot_claimed','spot_released','invite_code_rotated',
                                                'promoted','demoted')),
  user_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,   -- the member it is about
  invitee_id     uuid,                                                -- the spot, when there is one
  actor_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  data           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS league_member_events_league_idx ON public.league_member_events (league_id, created_at);

ALTER TABLE public.league_card_events DROP CONSTRAINT IF EXISTS league_card_events_kind_check;
ALTER TABLE public.league_card_events ADD CONSTRAINT league_card_events_kind_check CHECK (kind IN (
  'announced','rescheduled','first_shot','submitted','added','sent_to_marker',
  'returned','confirmed','approved','reopened','missed','withdrawn',
  'auto_withdrawn','played_after_withdraw','voided'));
ALTER TABLE public.league_member_events DROP CONSTRAINT IF EXISTS league_member_events_kind_check;
ALTER TABLE public.league_member_events ADD CONSTRAINT league_member_events_kind_check CHECK (kind IN (
  'removed','spot_claimed','spot_released','invite_code_rotated','promoted','demoted'));

ALTER TABLE public.league_card_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_member_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS league_card_events_select ON public.league_card_events;
CREATE POLICY league_card_events_select ON public.league_card_events
  FOR SELECT TO authenticated
  USING (public.is_league_member(league_id));

DROP POLICY IF EXISTS league_member_events_select ON public.league_member_events;
CREATE POLICY league_member_events_select ON public.league_member_events
  FOR SELECT TO authenticated
  USING (public.is_league_member(league_id));

REVOKE ALL ON public.league_card_events, public.league_member_events FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.league_card_events, public.league_member_events FROM authenticated;
GRANT SELECT ON public.league_card_events, public.league_member_events TO authenticated;

-- 3) Helpers (internal) -------------------------------------------------------------

-- R15b: does this card use up its month?
CREATE OR REPLACE FUNCTION public.league_takes_month(p_status text, p_void_kind text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p_status IS DISTINCT FROM 'void' OR COALESCE(p_void_kind IN ('admin','withdrawn_after_play'), false);
$$;

-- R9 / R16: does the server already hold a score of this player in this
-- round (settled, or on any phone's scorer card)?
CREATE OR REPLACE FUNCTION public.league_player_has_scores(p_tournament_id text, p_round_id text, p_player_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.game_scores
                  WHERE tournament_id = p_tournament_id AND round_id = p_round_id
                    AND player_id = p_player_id AND strokes IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.scorer_cards sc
                   CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(sc.card -> 'holes') = 'object'
                                                      THEN sc.card -> 'holes' ELSE '{}'::jsonb END) h
                  WHERE sc.tournament_id = p_tournament_id AND sc.round_id = p_round_id
                    AND jsonb_typeof(h.value -> 'entries' -> p_player_id) = 'number');
$$;

-- R16: is this game's player the caller's (game_players.user_id)?
CREATE OR REPLACE FUNCTION public.league_assert_own_player(p_tournament_id text, p_player_id text, p_uid uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.game_players
                  WHERE tournament_id = p_tournament_id AND player_id = p_player_id
                    AND user_id = p_uid AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'This card''s player isn''t yours in the game.'
      USING ERRCODE = 'P0001', HINT = 'not_your_player';
  END IF;
END;
$$;

-- R15: someone leaves through an admin (remove / release): their marker
-- tokens and requests end, on their own cards and where they are the marker,
-- and an open handicap vote about them fails.
CREATE OR REPLACE FUNCTION public.league_member_cleanup(p_league uuid, p_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.league_marker_tokens t
     SET expires_at = LEAST(t.expires_at, now())
    FROM public.league_cards c
   WHERE t.card_id = c.id AND c.league_id = p_league AND t.used_at IS NULL
     AND (c.user_id = p_user OR t.marker_user_id = p_user);
  DELETE FROM public.notifications n
   USING public.league_cards c
   WHERE n.type = 'league_marker_request' AND n.entity_id = c.id AND c.league_id = p_league
     AND (c.user_id = p_user OR c.marker_user_id = p_user OR n.user_id = p_user);
  UPDATE public.league_cards
     SET marker_user_id = NULL, marker_name = NULL,
         marker_requested_at = NULL, marker_reminded_at = NULL, updated_at = now()
   WHERE league_id = p_league AND marker_user_id IS NOT NULL
     AND (user_id = p_user OR marker_user_id = p_user);
  UPDATE public.league_handicap_votes SET status = 'failed'
   WHERE league_id = p_league AND subject_user = p_user AND status = 'open';
END;
$$;

-- R12: the end of the 3rd day of the next month, Europe/Madrid.
CREATE OR REPLACE FUNCTION public.league_month_closes_at(p_month date)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (date_trunc('month', p_month::timestamp) + interval '1 month 3 days') AT TIME ZONE 'Europe/Madrid';
$$;

CREATE OR REPLACE FUNCTION public.league_assert_month_open(p_month date)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF p_month IS NOT NULL AND now() >= public.league_month_closes_at(p_month) THEN
    RAISE EXCEPTION '% is closed: its cards can''t change any more.', to_char(p_month, 'FMMonth')
      USING ERRCODE = 'P0001', HINT = 'month_closed';
  END IF;
END;
$$;

-- R10: another active admin who could act instead.
CREATE OR REPLACE FUNCTION public.league_other_admin(p_league uuid, p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.league_members
                  WHERE league_id = p_league AND user_id IS DISTINCT FROM p_uid AND role = 'admin'
                    AND joined_at IS NOT NULL AND left_at IS NULL);
$$;

-- One timeline entry. actor_name defaults to the actor's profile name.
CREATE OR REPLACE FUNCTION public.league_card_log(
  p_card uuid, p_kind text, p_actor uuid, p_actor_name text DEFAULT NULL,
  p_how text DEFAULT NULL, p_note text DEFAULT NULL, p_data jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.league_card_events (card_id, league_id, kind, actor_user_id, actor_name, how, note, data)
  SELECT c.id, c.league_id, p_kind, p_actor,
         COALESCE(p_actor_name, CASE WHEN p_actor IS NOT NULL THEN public.league_user_name(p_actor) END),
         p_how, p_note, COALESCE(p_data, '{}'::jsonb)
    FROM public.league_cards c WHERE c.id = p_card;
END;
$$;

-- What every card notification carries about the card.
CREATE OR REPLACE FUNCTION public.league_card_notice(c public.league_cards)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'card_id',       c.id,
    'owner_id',      c.user_id,
    'owner_name',    public.league_user_name(c.user_id),
    'month',         c.month,
    'source',        c.source,
    'course_name',   c.course ->> 'name',
    'tee_time',      c.tee_time,
    'tournament_id', c.tournament_id,
    'round_id',      c.round_id);
$$;

DO $$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.league_takes_month(text, text)',
    'public.league_month_closes_at(date)',
    'public.league_assert_month_open(date)',
    'public.league_other_admin(uuid, uuid)',
    'public.league_card_log(uuid, text, uuid, text, text, text, jsonb)',
    'public.league_card_notice(public.league_cards)',
    'public.league_player_has_scores(text, text, text)',
    'public.league_assert_own_player(text, text, uuid)',
    'public.league_member_cleanup(uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_sig);
  END LOOP;
END $$;

-- 4) announce_league_card (R6, R7, R15b, R16, R17) ---------------------------------
-- Body of 20261015000000. Same signature.
CREATE OR REPLACE FUNCTION public.announce_league_card(
  p_league uuid, p_source text, p_course jsonb, p_tee_time timestamptz,
  p_tournament_id text DEFAULT NULL, p_round_id text DEFAULT NULL, p_player_id text DEFAULT NULL,
  p_scoring_mode text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  -- An app card is announced on Start, so its tee time is the server clock.
  v_tee   timestamptz := CASE WHEN p_source = 'app' THEN now() ELSE COALESCE(p_tee_time, now()) END;
  v_month date;
  v_hcp   numeric(4,1);
  v_id    uuid;
  v_s0    date;
  v_s1    date;
  v_post  timestamptz;
  v_mine  public.league_cards%ROWTYPE;
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

  IF p_source = 'app' THEN
    -- R16: announcing the same game round and player again (a retry, a second
    -- tap) gives back the same card. A void one is never handed back: an
    -- admin void ends in card_exists below, a withdrawal lets a new card in.
    SELECT * INTO v_mine FROM public.league_cards
     WHERE league_id = p_league AND source = 'app'
       AND tournament_id = p_tournament_id AND round_id = p_round_id AND player_id = p_player_id
       AND status <> 'void'
     LIMIT 1;
    IF FOUND THEN
      IF v_mine.user_id IS DISTINCT FROM v_uid THEN
        RAISE EXCEPTION 'That player already has a league card for this round.'
          USING ERRCODE = 'P0001', HINT = 'not_your_player';
      END IF;
      RETURN jsonb_build_object('id', v_mine.id, 'month', v_mine.month, 'announced_at', v_mine.announced_at,
                                'league_handicap', v_mine.league_handicap, 'post_by', v_mine.post_by,
                                'status', v_mine.status, 'existing', true);
    END IF;
    -- R16: once the game exists, only my own player of it. (Setup's Start
    -- announces before the game row is written, so a game with no players
    -- yet is the creator's.)
    IF EXISTS (SELECT 1 FROM public.game_players WHERE tournament_id = p_tournament_id)
       AND NOT EXISTS (SELECT 1 FROM public.game_players
                        WHERE tournament_id = p_tournament_id AND player_id = p_player_id
                          AND user_id = v_uid AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'You can only announce your own card, as your own player in this game.'
        USING ERRCODE = 'P0001', HINT = 'not_your_player';
    END IF;
    -- R16: joining a game already under way counts only from before the
    -- player's first shot. A score of theirs anywhere in the round means
    -- it's too late (the first-shot trigger only sees later writes).
    IF public.league_player_has_scores(p_tournament_id, p_round_id, p_player_id) THEN
      RAISE EXCEPTION 'This round has started for you. A league card has to be announced before your first shot.'
        USING ERRCODE = 'P0001', HINT = 'round_started';
    END IF;
    -- R17: a casual game or tournament round, never an official one.
    IF EXISTS (SELECT 1 FROM public.tournaments t
                WHERE t.id = p_tournament_id
                  AND COALESCE(t.props ->> 'kind', to_jsonb(t) ->> 'kind') = 'official') THEN
      RAISE EXCEPTION 'Official tournament rounds can''t be league cards.'
        USING ERRCODE = 'P0001', HINT = 'official_round';
    END IF;
    -- No scramble card: the mode Setup is starting (p_scoring_mode), or the
    -- game round's when it already exists. Submit checks the round again.
    PERFORM public.league_assert_not_scramble(p_scoring_mode);
    PERFORM public.league_assert_not_scramble(
      public.league_round_scoring_mode(p_tournament_id, p_round_id));
  END IF;

  v_month := public.league_month_of(v_tee);
  IF v_month < public.league_month_of(now()) THEN
    RAISE EXCEPTION 'That month is over. Announce a card for this month or later.'
      USING ERRCODE = 'P0001', HINT = 'past_month';
  END IF;
  -- R7: two hours' notice for a round played off the app. A round already
  -- played is an unannounced card (approved by an admin).
  IF p_source = 'offapp' AND v_tee < now() THEN
    RAISE EXCEPTION 'That tee time has passed. If you already played, add it as a card you didn''t announce.'
      USING ERRCODE = 'P0001', HINT = 'tee_time_passed';
  END IF;
  IF p_source = 'offapp' AND v_tee < now() + interval '2 hours' THEN
    RAISE EXCEPTION 'Announce a round at least 2 hours before its tee time.'
      USING ERRCODE = 'P0001', HINT = 'short_notice';
  END IF;
  SELECT season_start, season_end INTO v_s0, v_s1 FROM public.leagues WHERE id = p_league;
  IF (v_tee AT TIME ZONE 'Europe/Madrid')::date NOT BETWEEN v_s0 AND v_s1 THEN
    RAISE EXCEPTION 'That date is outside the season (% to %).', v_s0, v_s1
      USING ERRCODE = 'P0001', HINT = 'outside_season';
  END IF;
  PERFORM public.league_assert_month_open(v_month);
  IF EXISTS (SELECT 1 FROM public.league_cards
              WHERE league_id = p_league AND user_id = v_uid
                AND month = v_month AND public.league_takes_month(status, void_kind)) THEN
    RAISE EXCEPTION 'You already have your % card.', to_char(v_month, 'FMMonth')
      USING ERRCODE = 'P0001', HINT = 'card_exists';
  END IF;

  SELECT league_handicap INTO v_hcp FROM public.league_members
   WHERE league_id = p_league AND user_id = v_uid;

  -- R6: an app card's 8 hours start at its first shot (notify_league_tee_off
  -- or the first scorer card), so it has no deadline yet.
  v_post := CASE WHEN p_source = 'app' THEN NULL ELSE v_tee + public.league_post_window() END;

  BEGIN
    INSERT INTO public.league_cards
      (league_id, user_id, month, source, status, tournament_id, round_id, player_id,
       course, tee_time, played_on, announced_at, league_handicap, post_by)
    VALUES
      (p_league, v_uid, v_month, p_source,
       CASE WHEN p_source = 'app' THEN 'playing' ELSE 'announced' END,
       p_tournament_id, p_round_id, p_player_id,
       p_course, v_tee, (v_tee AT TIME ZONE 'Europe/Madrid')::date, now(), v_hcp, v_post)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- Lost a race: a second tap on the same game round is the same card.
    IF p_source = 'app' THEN
      SELECT * INTO v_mine FROM public.league_cards
       WHERE league_id = p_league AND source = 'app' AND user_id = v_uid
         AND tournament_id = p_tournament_id AND round_id = p_round_id AND player_id = p_player_id
         AND status <> 'void'
       LIMIT 1;
      IF FOUND THEN
        RETURN jsonb_build_object('id', v_mine.id, 'month', v_mine.month, 'announced_at', v_mine.announced_at,
                                  'league_handicap', v_mine.league_handicap, 'post_by', v_mine.post_by,
                                  'status', v_mine.status, 'existing', true);
      END IF;
    END IF;
    -- A second device announcing another card for the same month.
    RAISE EXCEPTION 'You already have your % card.', to_char(v_month, 'FMMonth')
      USING ERRCODE = 'P0001', HINT = 'card_exists';
  END;

  PERFORM public.league_card_log(v_id, 'announced', v_uid, NULL, NULL, NULL,
    jsonb_build_object('source', p_source, 'tee_time', v_tee, 'course_name', p_course ->> 'name'));

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
                            'league_handicap', v_hcp, 'post_by', v_post,
                            'status', CASE WHEN p_source = 'app' THEN 'playing' ELSE 'announced' END,
                            'existing', false);
END;
$$;

-- 5) The first shot (R6) ---------------------------------------------------------------

-- Body of 20261004000000 plus: the first stamp starts an app card's 8 hours
-- (when it has no deadline yet) and goes on the timeline.
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
     OR NOT public.league_is_member(v_c.league_id, v_uid) THEN
    RAISE EXCEPTION 'Card not found.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.league_assert_open(v_c.league_id);
  IF v_c.status NOT IN ('announced','playing') THEN
    RETURN;
  END IF;
  -- R16: only the player's own phone tees off.
  IF v_c.source = 'app' THEN
    PERFORM public.league_assert_own_player(v_c.tournament_id, v_c.player_id, v_uid);
  END IF;
  UPDATE public.league_cards
     SET first_shot_at = now(),
         post_by = CASE WHEN source = 'app' AND post_by IS NULL
                        THEN now() + public.league_post_window() ELSE post_by END,
         updated_at = now()
   WHERE id = p_card AND first_shot_at IS NULL;
  IF FOUND THEN
    PERFORM public.league_card_log(p_card, 'first_shot', v_uid, NULL, NULL, NULL,
      jsonb_build_object('via', 'tee_off'));
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

-- The first scorer card of the round that carries a live app card's player
-- (written by any phone, or by the owner's own phone) is its first shot too:
-- a tee-off tap that never reached the server can't leave the card without a
-- deadline. Never fails the scorer write.
CREATE OR REPLACE FUNCTION public.league_cards_first_shot_from_scorer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r   record;
  v_c public.league_cards%ROWTYPE;
BEGIN
  IF jsonb_typeof(NEW.card -> 'holes') IS DISTINCT FROM 'object' THEN
    RETURN NULL;
  END IF;
  BEGIN
    FOR r IN
      UPDATE public.league_cards c
         SET first_shot_at = now(),
             post_by = COALESCE(c.post_by, now() + public.league_post_window()),
             updated_at = now()
       WHERE c.tournament_id = NEW.tournament_id AND c.round_id = NEW.round_id
         AND c.source = 'app' AND c.first_shot_at IS NULL AND c.status IN ('announced','playing')
         AND (c.user_id = NEW.writer_uid
              OR EXISTS (SELECT 1 FROM jsonb_each(NEW.card -> 'holes') h
                          WHERE jsonb_typeof(h.value -> 'entries') = 'object'
                            AND jsonb_typeof(h.value -> 'entries' -> c.player_id) = 'number'))
      RETURNING c.id
    LOOP
      PERFORM public.league_card_log(r.id, 'first_shot', NEW.writer_uid, NULL, NULL, NULL,
        jsonb_build_object('via', 'scorecard'));
    END LOOP;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'league first-shot stamp skipped: %', SQLERRM;
  END;
  -- R9: a withdrawn card whose player is scored anyway was played: it takes
  -- the month again (when no other card of that month does), and the members
  -- hear about it once.
  BEGIN
    FOR r IN
      SELECT c.id FROM public.league_cards c
       WHERE c.tournament_id = NEW.tournament_id AND c.round_id = NEW.round_id
         AND c.source = 'app' AND c.status = 'void' AND c.void_kind = 'withdrawn'
         AND (c.user_id = NEW.writer_uid
              OR EXISTS (SELECT 1 FROM jsonb_each(NEW.card -> 'holes') h
                          WHERE jsonb_typeof(h.value -> 'entries') = 'object'
                            AND jsonb_typeof(h.value -> 'entries' -> c.player_id) = 'number'))
         AND NOT EXISTS (SELECT 1 FROM public.league_card_events e
                          WHERE e.card_id = c.id AND e.kind = 'played_after_withdraw')
    LOOP
      UPDATE public.league_cards c SET void_kind = 'withdrawn_after_play', updated_at = now()
       WHERE c.id = r.id
         AND NOT EXISTS (SELECT 1 FROM public.league_cards o
                          WHERE o.league_id = c.league_id AND o.user_id = c.user_id AND o.month = c.month
                            AND o.id <> c.id AND public.league_takes_month(o.status, o.void_kind));
      SELECT * INTO v_c FROM public.league_cards WHERE id = r.id;
      PERFORM public.league_card_log(r.id, 'played_after_withdraw', NEW.writer_uid, NULL, NULL, NULL,
        jsonb_build_object('month_taken', v_c.void_kind = 'withdrawn_after_play'));
      PERFORM public.notify_league_members(v_c.league_id, v_c.user_id, 'league_card_played_after_withdraw', r.id,
        public.league_card_notice(v_c));
    END LOOP;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'league played-after-withdraw check skipped: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.league_cards_first_shot_from_scorer() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS league_cards_first_shot ON public.scorer_cards;
CREATE TRIGGER league_cards_first_shot
  AFTER INSERT OR UPDATE OF card ON public.scorer_cards
  FOR EACH ROW EXECUTE FUNCTION public.league_cards_first_shot_from_scorer();

-- 6) submit_league_card (R8, R11, R12) and add_unannounced_league_card (R12, R15b) ------

-- Body of 20261015000000 plus: an announced off-app card waits 3 h after its
-- tee time (R8); a marker's return allows one resubmission within 24 h of it
-- past post_by (R11); a closed month refuses (R12); the timeline.
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
                       'tee_verified', v_verified, 'not_announced', v_not,
                       'resubmit', v_c.status = 'submitted',
                       'after_return', v_c.status = 'submitted' AND v_c.returned_at IS NOT NULL));

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

-- Body of 20261015000000 plus the closed month (R12), an admin-voided card
-- keeping the month taken (R15b) and the timeline.
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

  PERFORM public.league_card_log(v_id, 'added', v_uid, NULL, NULL, NULL,
    jsonb_build_object('points', (v_score ->> 'points')::int, 'gross', (v_score ->> 'gross')::int,
                       'tee_verified', v_verified, 'not_announced', true));

  RETURN jsonb_build_object('id', v_id, 'month', v_month, 'status', 'submitted',
                            'not_announced', true,
                            'gross', (v_score ->> 'gross')::int,
                            'points', (v_score ->> 'points')::int,
                            'playing_handicap', v_ph,
                            'tee_verified', v_verified);
END;
$$;

-- 7) reschedule (R7) and withdraw (R9) ----------------------------------------------------

-- Body of 20261012000000 plus 2 hours' notice on both ends, the closed
-- month, the timeline and the members' notification.
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
  v_from timestamptz;
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
  PERFORM public.league_assert_month_open(v_c.month);
  IF v_c.tee_time IS NULL OR now() >= v_c.tee_time THEN
    RAISE EXCEPTION 'The tee time has passed, so this card can''t be moved.'
      USING ERRCODE = 'P0001', HINT = 'tee_time_passed';
  END IF;
  IF now() > v_c.tee_time - interval '2 hours' THEN
    RAISE EXCEPTION 'Your tee time is less than 2 hours away, so this card can''t be moved any more.'
      USING ERRCODE = 'P0001', HINT = 'reschedule_closed';
  END IF;
  IF v_c.reschedules >= 2 THEN
    RAISE EXCEPTION 'This card has been moved twice already, so it can''t be moved again.'
      USING ERRCODE = 'P0001', HINT = 'reschedule_limit';
  END IF;
  IF p_tee_time IS NULL OR p_tee_time < now() THEN
    RAISE EXCEPTION 'Pick a tee time that hasn''t passed yet.'
      USING ERRCODE = 'P0001', HINT = 'tee_time_passed';
  END IF;
  IF p_tee_time < now() + interval '2 hours' THEN
    RAISE EXCEPTION 'Pick a tee time at least 2 hours from now.'
      USING ERRCODE = 'P0001', HINT = 'short_notice';
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

  v_from := v_c.tee_time;
  v_post := p_tee_time + public.league_post_window();
  UPDATE public.league_cards
     SET tee_time = p_tee_time, played_on = (p_tee_time AT TIME ZONE 'Europe/Madrid')::date,
         post_by = v_post, reminded_at = NULL, reschedules = reschedules + 1, updated_at = now()
   WHERE id = p_card
  RETURNING * INTO v_c;

  PERFORM public.league_card_log(p_card, 'rescheduled', v_uid, NULL, NULL, NULL,
    jsonb_build_object('from', v_from, 'to', p_tee_time, 'count', v_c.reschedules));
  PERFORM public.notify_league_members(v_c.league_id, v_uid, 'league_card_rescheduled', p_card,
    public.league_card_notice(v_c) || jsonb_build_object('old_tee_time', v_from));

  RETURN jsonb_build_object('id', p_card, 'tee_time', p_tee_time, 'post_by', v_post,
                            'reschedules_left', GREATEST(2 - v_c.reschedules, 0));
END;
$$;

-- R9: the owner takes a card back before it is played. It becomes void with
-- void_kind 'withdrawn', so the month is free again (R15b).
CREATE OR REPLACE FUNCTION public.withdraw_league_card(p_card uuid)
RETURNS jsonb
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
     OR NOT public.league_is_member(v_c.league_id, v_uid) THEN
    RAISE EXCEPTION 'Card not found.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.league_assert_open(v_c.league_id);
  PERFORM public.league_assert_month_open(v_c.month);
  IF v_c.status NOT IN ('announced','playing')
     OR (v_c.source = 'offapp' AND (v_c.tee_time IS NULL OR now() >= v_c.tee_time))
     OR (v_c.source = 'app' AND v_c.first_shot_at IS NOT NULL) THEN
    RAISE EXCEPTION 'This card has been played, so it can''t be withdrawn. Only an admin can void it now.'
      USING ERRCODE = 'P0001', HINT = 'withdraw_closed';
  END IF;
  -- The server already holds a score of the player in this round: played.
  IF v_c.source = 'app'
     AND public.league_player_has_scores(v_c.tournament_id, v_c.round_id, v_c.player_id) THEN
    RAISE EXCEPTION 'This round has started for you, so the card can''t be withdrawn. Only an admin can void it now.'
      USING ERRCODE = 'P0001', HINT = 'round_started';
  END IF;

  UPDATE public.league_cards
     SET status = 'void', void_kind = 'withdrawn', voided_reason = 'withdrawn',
         marker_user_id = NULL, marker_name = NULL,
         marker_requested_at = NULL, marker_reminded_at = NULL,
         updated_at = now()
   WHERE id = p_card
  RETURNING * INTO v_c;
  UPDATE public.league_marker_tokens SET expires_at = LEAST(expires_at, now())
   WHERE card_id = p_card AND used_at IS NULL;

  PERFORM public.league_card_log(p_card, 'withdrawn', v_uid);
  PERFORM public.notify_league_members(v_c.league_id, v_uid, 'league_card_withdrawn', p_card,
    public.league_card_notice(v_c));

  RETURN jsonb_build_object('id', p_card, 'status', 'void', 'void_kind', 'withdrawn');
END;
$$;

-- 8) Admin card actions (R10, R12, R15b) ----------------------------------------------------

-- Body of 20261013000000 plus: an admin's own card only with no other admin
-- (R10), a closed month refuses (R12), the month stays taken (R15b), a void
-- card can't be voided again, the timeline and the members' notification.
CREATE OR REPLACE FUNCTION public.void_league_card(p_card uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_c      public.league_cards%ROWTYPE;
  v_reason text := NULLIF(left(btrim(COALESCE(p_reason, '')), 500), '');
BEGIN
  SELECT * INTO v_c FROM public.league_cards WHERE id = p_card FOR UPDATE;
  IF NOT FOUND OR NOT public.league_is_admin(v_c.league_id, v_uid) THEN
    RAISE EXCEPTION 'Only the league admin can do that.' USING ERRCODE = '42501';
  END IF;
  IF v_c.user_id = v_uid AND public.league_other_admin(v_c.league_id, v_uid) THEN
    RAISE EXCEPTION 'Another admin has to void your own card.'
      USING ERRCODE = '42501', HINT = 'own_card';
  END IF;
  PERFORM public.league_assert_month_open(v_c.month);
  IF v_c.status = 'void' THEN
    RAISE EXCEPTION 'This card is already void.' USING ERRCODE = 'P0001', HINT = 'already_void';
  END IF;

  UPDATE public.league_cards
     SET status = 'void', void_kind = 'admin', voided_reason = v_reason,
         marker_user_id = NULL, marker_name = NULL,
         marker_requested_at = NULL, marker_reminded_at = NULL,
         updated_at = now()
   WHERE id = p_card
  RETURNING * INTO v_c;
  UPDATE public.league_marker_tokens SET expires_at = LEAST(expires_at, now())
   WHERE card_id = p_card AND used_at IS NULL;

  PERFORM public.league_card_log(p_card, 'voided', v_uid, NULL, NULL, v_reason);
  PERFORM public.notify_league_members(v_c.league_id, v_uid, 'league_card_voided', p_card,
    public.league_card_notice(v_c) || jsonb_build_object('reason', v_reason));
END;
$$;

-- Body of 20261012000000 plus R10, R12, the timeline and the notification.
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
  IF v_c.user_id = v_uid AND public.league_other_admin(v_c.league_id, v_uid) THEN
    RAISE EXCEPTION 'Another admin has to reopen your own card.'
      USING ERRCODE = '42501', HINT = 'own_card';
  END IF;
  PERFORM public.league_assert_open(v_c.league_id);
  PERFORM public.league_assert_month_open(v_c.month);
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
   WHERE id = p_card
  RETURNING * INTO v_c;

  PERFORM public.league_card_log(p_card, 'reopened', v_uid, NULL, NULL, NULL,
    jsonb_build_object('post_by', v_post));
  PERFORM public.notify_league_members(v_c.league_id, v_uid, 'league_card_reopened', p_card,
    public.league_card_notice(v_c) || jsonb_build_object('post_by', v_post));

  RETURN jsonb_build_object('id', p_card, 'status', v_status, 'post_by', v_post);
END;
$$;

-- Body of 20261015000000 plus R10, R12, the timeline and the notification.
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
  IF v_c.user_id = v_uid AND public.league_other_admin(v_c.league_id, v_uid) THEN
    RAISE EXCEPTION 'Another admin has to approve your own card.'
      USING ERRCODE = '42501', HINT = 'own_card';
  END IF;
  PERFORM public.league_assert_open(v_c.league_id);
  PERFORM public.league_assert_month_open(v_c.month);
  IF NOT (v_c.not_announced OR v_c.tee_verified IS FALSE) OR v_c.approved_at IS NOT NULL
     OR v_c.status NOT IN ('submitted','confirmed') THEN
    RAISE EXCEPTION 'This card doesn''t need approving.'
      USING ERRCODE = 'P0001', HINT = 'not_needed';
  END IF;

  UPDATE public.league_cards
     SET approved_by = v_uid, approved_at = v_at, updated_at = now()
   WHERE id = p_card
  RETURNING * INTO v_c;

  PERFORM public.league_card_log(p_card, 'approved', v_uid, NULL, NULL, NULL,
    jsonb_build_object('not_announced', v_c.not_announced, 'tee_verified', v_c.tee_verified));
  PERFORM public.notify_league_members(v_c.league_id, v_uid, 'league_card_approved', p_card,
    public.league_card_notice(v_c));

  RETURN jsonb_build_object('id', p_card, 'approved_at', v_at);
END;
$$;

-- Body of 20261004000000 plus R10 (own handicap) and the members' notification.
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
  IF NOT public.league_is_admin(p_league, v_uid) THEN
    RAISE EXCEPTION 'Only the league admin can do that.' USING ERRCODE = '42501';
  END IF;
  IF p_user = v_uid AND public.league_other_admin(p_league, v_uid) THEN
    RAISE EXCEPTION 'Another admin has to set your own league handicap.'
      USING ERRCODE = '42501', HINT = 'own_handicap';
  END IF;
  PERFORM public.league_assert_open(p_league);
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
  IF v_new IS DISTINCT FROM v_old THEN
    PERFORM public.notify_league_members(p_league, v_uid, 'league_handicap_changed', p_league,
      jsonb_build_object('subject_id', p_user, 'subject_name', public.league_user_name(p_user),
                         'old', v_old, 'new', v_new));
  END IF;
  RETURN v_new;
END;
$$;

-- 9) Confirmation paths (R11, R12, the timeline) ----------------------------------------

-- Body of 20261013000000 plus the timeline entry.
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

-- Body of 20261004000000 plus the closed month.
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
  v_marked   int := 0;
  v_puid     uuid;
  v_pname    text;
BEGIN
  SELECT * INTO v_c FROM public.league_cards WHERE id = p_card FOR UPDATE;
  IF NOT FOUND OR v_c.user_id IS DISTINCT FROM v_uid
     OR NOT public.league_is_member(v_c.league_id, v_uid) THEN
    RAISE EXCEPTION 'Card not found.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.league_assert_open(v_c.league_id);
  PERFORM public.league_assert_month_open(v_c.month);
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

  SELECT sc.writer_uid,
         (SELECT count(*) FROM generate_series(1, 18) h
           WHERE CASE WHEN jsonb_typeof(sc.card -> 'holes' -> h::text -> 'entries' -> v_c.player_id) = 'number'
                      THEN (sc.card -> 'holes' -> h::text -> 'entries' ->> v_c.player_id)::numeric
                           = (v_c.holes ->> h::text)::numeric
                      ELSE false END)
    INTO v_puid, v_marked
    FROM public.scorer_cards sc
   WHERE sc.tournament_id = v_c.tournament_id AND sc.round_id = v_c.round_id
     AND sc.writer_uid IS NOT NULL
     AND sc.writer_uid <> v_uid
     -- Guarded cast: a non-uuid userId never matches (and never raises).
     AND CASE WHEN (sc.card -> 'scorer' ->> 'userId')
                   ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN (sc.card -> 'scorer' ->> 'userId')::uuid = sc.writer_uid
              ELSE false END
     AND EXISTS (SELECT 1 FROM public.game_players gp
                  WHERE gp.tournament_id = v_c.tournament_id
                    AND gp.user_id = sc.writer_uid AND gp.deleted_at IS NULL)
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

  v_pname := CASE WHEN v_puid IS NOT NULL THEN public.league_user_name(v_puid) END;

  PERFORM public.league_confirm_card(p_card, 'partner', v_puid, v_pname, NULL);
  RETURN jsonb_build_object('confirmed', true, 'settled', 18, 'matches', 18, 'marked', 18,
                            'partner_user_id', v_puid, 'partner_name', v_pname);
END;
$$;

-- Body of 20261004000000 plus the closed month.
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
     OR NOT public.league_is_member(v_c.league_id, v_uid) THEN
    RAISE EXCEPTION 'Card not found.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.league_assert_open(v_c.league_id);
  PERFORM public.league_assert_month_open(v_c.month);
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

-- Body of 20261013000000 plus the closed month.
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
     OR NOT public.league_is_member(v_c.league_id, v_uid) THEN
    RAISE EXCEPTION 'Card not found.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.league_assert_open(v_c.league_id);
  PERFORM public.league_assert_month_open(v_c.month);
  IF v_c.status <> 'submitted' OR v_c.holes IS NULL THEN
    RAISE EXCEPTION 'Submit the card first.' USING ERRCODE = 'P0001';
  END IF;

  -- A new code voids any older unused one for this card.
  UPDATE public.league_marker_tokens SET expires_at = LEAST(expires_at, now())
   WHERE card_id = p_card AND used_at IS NULL;

  IF v_c.marker_user_id IS NOT NULL THEN
    UPDATE public.league_cards
       SET marker_user_id = NULL, marker_name = NULL,
           marker_requested_at = NULL, marker_reminded_at = NULL, updated_at = now()
     WHERE id = p_card;
    DELETE FROM public.notifications
     WHERE type = 'league_marker_request' AND entity_id = p_card;
  END IF;

  -- 32 random bytes, url-safe base64 without padding (43 chars).
  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), E'+/=\n', '-_');
  INSERT INTO public.league_marker_tokens (token, card_id, snapshot_hash, expires_at)
  VALUES (v_token, p_card, public.league_card_hash(v_c), v_exp);

  RETURN jsonb_build_object('token', v_token, 'expires_at', v_exp);
END;
$$;

-- Body of 20261013000000 plus the closed month and the timeline.
CREATE OR REPLACE FUNCTION public.request_league_marker(p_card uuid, p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_c     public.league_cards%ROWTYPE;
  v_token text;
  v_exp   timestamptz := now() + interval '7 days';
  v_name  text;
BEGIN
  SELECT * INTO v_c FROM public.league_cards WHERE id = p_card FOR UPDATE;
  IF NOT FOUND OR v_c.user_id IS DISTINCT FROM v_uid
     OR NOT public.league_is_member(v_c.league_id, v_uid) THEN
    RAISE EXCEPTION 'Card not found.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.league_assert_open(v_c.league_id);
  PERFORM public.league_assert_month_open(v_c.month);
  IF v_c.source <> 'app' OR v_c.tournament_id IS NULL THEN
    RAISE EXCEPTION 'Only cards played in the app can pick a marker.'
      USING ERRCODE = 'P0001', HINT = 'not_app';
  END IF;
  IF v_c.status <> 'submitted' OR v_c.holes IS NULL THEN
    RAISE EXCEPTION 'Submit the card first.' USING ERRCODE = 'P0001', HINT = 'not_submitted';
  END IF;
  IF p_user IS NOT DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'You can''t mark your own card.' USING ERRCODE = 'P0001', HINT = 'own_card';
  END IF;
  IF NOT public.league_marker_eligible(v_c, p_user) THEN
    RAISE EXCEPTION 'Pick a player who kept a card in this game.'
      USING ERRCODE = 'P0001', HINT = 'not_eligible';
  END IF;

  UPDATE public.league_marker_tokens SET expires_at = LEAST(expires_at, now())
   WHERE card_id = p_card AND used_at IS NULL;
  DELETE FROM public.notifications
   WHERE type = 'league_marker_request' AND entity_id = p_card;

  -- Same token as create_marker_token: 32 random bytes, url-safe base64.
  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), E'+/=\n', '-_');
  INSERT INTO public.league_marker_tokens (token, card_id, snapshot_hash, expires_at, marker_user_id)
  VALUES (v_token, p_card, public.league_card_hash(v_c), v_exp, p_user);

  v_name := public.league_user_name(p_user);
  UPDATE public.league_cards
     SET marker_user_id = p_user, marker_name = v_name,
         marker_requested_at = now(), marker_reminded_at = NULL, updated_at = now()
   WHERE id = p_card;

  PERFORM public.league_card_log(p_card, 'sent_to_marker', v_uid, NULL, 'marker_request', NULL,
    jsonb_build_object('marker_user_id', p_user, 'marker_name', v_name));

  PERFORM public.create_notification(p_user, 'league_marker_request', v_uid, p_card,
    jsonb_build_object(
      'token',       v_token,
      'card_id',     p_card,
      'league_id',   v_c.league_id,
      'league_name', (SELECT name FROM public.leagues WHERE id = v_c.league_id),
      'course_name', v_c.course ->> 'name',
      'month',       v_c.month,
      'actor_name',  public.league_user_name(v_uid)));

  RETURN jsonb_build_object('marker_user_id', p_user, 'marker_name', v_name, 'expires_at', v_exp);
END;
$$;

-- Body of 20261013000000 plus: never the owner's own session (R11), the
-- closed month (R12), the timeline for a return.
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
  IF v_t.marker_user_id IS NOT NULL AND auth.uid() IS DISTINCT FROM v_t.marker_user_id THEN
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
  -- R11: the owner can't sign their own card, from any device.
  IF auth.uid() IS NOT NULL AND auth.uid() = v_c.user_id THEN
    RAISE EXCEPTION 'You can''t confirm or send back your own card. Ask your marker to scan it.'
      USING ERRCODE = 'P0001', HINT = 'own_card';
  END IF;
  PERFORM public.league_assert_month_open(v_c.month);
  IF public.league_card_hash(v_c) <> v_t.snapshot_hash THEN
    RAISE EXCEPTION 'changed' USING ERRCODE = 'P0001';
  END IF;
  IF p_ok IS NULL THEN
    RAISE EXCEPTION 'invalid' USING ERRCODE = 'P0001';
  END IF;
  IF v_t.marker_user_id IS NOT NULL THEN
    v_name := public.league_user_name(v_t.marker_user_id);
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Type your name to sign the card.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.league_marker_tokens SET used_at = now() WHERE token = p_token;
  SELECT name INTO v_league_name FROM public.leagues WHERE id = v_c.league_id;

  IF p_ok THEN
    IF v_t.marker_user_id IS NOT NULL THEN
      PERFORM public.league_confirm_card(v_c.id, 'marker', v_t.marker_user_id, v_name, NULL);
      PERFORM public.create_notification(v_c.user_id, 'league_marker_confirmed', v_t.marker_user_id, v_c.id,
        jsonb_build_object(
          'card_id',     v_c.id,
          'league_id',   v_c.league_id,
          'league_name', v_league_name,
          'course_name', v_c.course ->> 'name',
          'month',       v_c.month,
          'actor_name',  v_name));
    ELSE
      PERFORM public.league_confirm_card(v_c.id, 'qr', NULL, v_name, NULL);
    END IF;
    RETURN jsonb_build_object('status', 'confirmed');
  END IF;

  UPDATE public.league_cards
     SET marker_note = v_note, returned_at = now(),
         marker_user_id = NULL, marker_name = NULL,
         marker_requested_at = NULL, marker_reminded_at = NULL,
         updated_at = now()
   WHERE id = v_c.id;
  PERFORM public.league_card_log(v_c.id, 'returned', v_t.marker_user_id, v_name,
    CASE WHEN v_t.marker_user_id IS NOT NULL THEN 'marker_request' ELSE 'qr' END, v_note,
    jsonb_build_object('resubmit_by', now() + interval '24 hours'));
  PERFORM public.create_notification(v_c.user_id, 'league_marker_issue', v_t.marker_user_id, v_c.id,
    jsonb_build_object(
      'league_id',     v_c.league_id,
      'league_name',   v_league_name,
      'card_id',       v_c.id,
      'course_name',   v_c.course ->> 'name',
      'tournament_id', v_c.tournament_id,
      'round_id',      v_c.round_id,
      'actor_name',    v_name,
      'marker_name',   v_name,
      'note',          v_note));
  RETURN jsonb_build_object('status', 'returned');
END;
$$;

-- 10) The sweep (R6 auto-withdraw, the timeline) --------------------------------------
-- Body of 20261012000000 plus: (3) an app card with no first shot 24 h after
-- its announcement is withdrawn (void, void_kind 'auto_withdrawn': the month
-- is free) and its owner told; missed and auto-withdrawn cards go on the
-- timeline.
CREATE OR REPLACE FUNCTION public.league_sweep_cards()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reminded  int;
  v_missed    int;
  v_withdrawn int;
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
    RETURNING c.id, c.league_id, c.post_by
  ), expired AS (
    UPDATE public.league_marker_tokens t
       SET expires_at = LEAST(t.expires_at, now())
      FROM gone g
     WHERE t.card_id = g.id AND t.used_at IS NULL
    RETURNING 1
  ), logged AS (
    INSERT INTO public.league_card_events (card_id, league_id, kind, data)
    SELECT g.id, g.league_id, 'missed', jsonb_build_object('post_by', g.post_by) FROM gone g
    RETURNING 1
  )
  SELECT count(*) INTO v_missed FROM gone;

  WITH aw AS (
    UPDATE public.league_cards c
       SET status = 'void', void_kind = 'auto_withdrawn', voided_reason = 'auto_withdrawn',
           marker_user_id = NULL, marker_name = NULL,
           marker_requested_at = NULL, marker_reminded_at = NULL,
           updated_at = now()
      FROM public.leagues l
     WHERE l.id = c.league_id AND l.archived_at IS NULL
       AND c.source = 'app' AND c.status IN ('announced','playing')
       AND c.post_by IS NULL AND c.first_shot_at IS NULL
       AND c.announced_at < now() - interval '24 hours'
    RETURNING c.*, l.name AS league_name
  ), logged AS (
    INSERT INTO public.league_card_events (card_id, league_id, kind, data)
    SELECT a.id, a.league_id, 'auto_withdrawn', jsonb_build_object('announced_at', a.announced_at) FROM aw a
    RETURNING 1
  ), told AS (
    INSERT INTO public.notifications (user_id, type, actor_id, entity_id, data)
    SELECT a.user_id, 'league_card_auto_withdrawn', NULL, a.id,
           jsonb_build_object(
             'league_id',     a.league_id,
             'league_name',   a.league_name,
             'card_id',       a.id,
             'month',         a.month,
             'course_name',   a.course ->> 'name',
             'tournament_id', a.tournament_id,
             'round_id',      a.round_id)
      FROM aw a
    RETURNING 1
  )
  SELECT count(*) INTO v_withdrawn FROM aw;

  RETURN jsonb_build_object('reminded', v_reminded, 'missed', v_missed, 'auto_withdrawn', v_withdrawn);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.league_sweep_cards() FROM PUBLIC, anon, authenticated;

-- 11) Reads: the timeline (R13) and a game's league status (R16) ----------------------

-- Any member: a card's events, oldest first.
CREATE OR REPLACE FUNCTION public.get_league_card_events(p_card uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_league uuid;
BEGIN
  SELECT league_id INTO v_league FROM public.league_cards WHERE id = p_card;
  IF NOT FOUND OR NOT public.league_is_member(v_league, auth.uid()) THEN
    RAISE EXCEPTION 'Card not found.' USING ERRCODE = 'P0001';
  END IF;
  RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'id',            e.id,
            'card_id',       e.card_id,
            'kind',          e.kind,
            'actor_user_id', e.actor_user_id,
            'actor_name',    NULLIF(e.actor_name, ''),
            'how',           e.how,
            'note',          e.note,
            'data',          e.data,
            'created_at',    e.created_at) ORDER BY e.created_at, e.id), '[]'::jsonb)
            FROM public.league_card_events e WHERE e.card_id = p_card);
END;
$$;

-- For Setup's league list (D5): every player of the game who is an active
-- member of the league, with their card this month (the one that takes it,
-- R15b) and whether that card is this round's. The caller must be in the
-- league and a player of the game (else 42501 / an empty list).
CREATE OR REPLACE FUNCTION public.get_league_game_status(p_league uuid, p_tournament text, p_round text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_month date := public.league_month_of(now());
BEGIN
  IF NOT public.league_is_member(p_league, v_uid) THEN
    RAISE EXCEPTION 'You are not in this league.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.game_players
                  WHERE tournament_id = p_tournament AND user_id = v_uid AND deleted_at IS NULL) THEN
    RETURN '[]'::jsonb;
  END IF;
  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'player_id',       gp.player_id,
             'user_id',         gp.user_id,
             'name',            public.league_user_name(gp.user_id),
             'is_me',           gp.user_id = v_uid,
             'league_handicap', m.league_handicap,
             'month',           v_month,
             'has_card',        c.id IS NOT NULL,
             'card_id',         c.id,
             'card_status',     c.status,
             'card_source',     c.source,
             'this_round',      c.id IS NOT NULL AND c.tournament_id = p_tournament
                                AND c.round_id = p_round AND c.player_id = gp.player_id)
             ORDER BY gp.pos, gp.player_id), '[]'::jsonb)
      FROM public.game_players gp
      JOIN public.league_members m
        ON m.league_id = p_league AND m.user_id = gp.user_id
       AND m.joined_at IS NOT NULL AND m.left_at IS NULL
      LEFT JOIN LATERAL (
        SELECT * FROM public.league_cards lc
         WHERE lc.league_id = p_league AND lc.user_id = gp.user_id AND lc.month = v_month
           AND public.league_takes_month(lc.status, lc.void_kind)
         ORDER BY (lc.tournament_id = p_tournament AND lc.round_id = p_round) DESC NULLS LAST, lc.created_at DESC
         LIMIT 1) c ON true
     WHERE gp.tournament_id = p_tournament AND gp.deleted_at IS NULL AND gp.user_id IS NOT NULL);
END;
$$;

-- 12) Membership (R15) ----------------------------------------------------------------------

-- Admin: the member leaves, like leave_league (their cards stay). Not
-- yourself (leave instead), and not the only other admin.
CREATE OR REPLACE FUNCTION public.remove_league_member(p_league uuid, p_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_role text;
  v_name text;
BEGIN
  PERFORM 1 FROM public.leagues WHERE id = p_league FOR UPDATE;   -- see leave_league
  IF NOT public.league_is_admin(p_league, v_uid) THEN
    RAISE EXCEPTION 'Only the league admin can do that.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.league_assert_open(p_league);
  IF p_user IS NOT DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'You can''t remove yourself. Leave the league instead.'
      USING ERRCODE = 'P0001', HINT = 'use_leave';
  END IF;
  SELECT role INTO v_role FROM public.league_members
   WHERE league_id = p_league AND user_id = p_user
     AND joined_at IS NOT NULL AND left_at IS NULL
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That player is not in this league.' USING ERRCODE = 'P0001', HINT = 'not_member';
  END IF;
  v_name := public.league_user_name(p_user);
  -- Never a league without an admin (the caller is one, so today this holds
  -- whenever they remain; kept for any future non-admin path).
  IF v_role = 'admin' AND NOT EXISTS (
       SELECT 1 FROM public.league_members
        WHERE league_id = p_league AND user_id <> p_user AND role = 'admin'
          AND joined_at IS NOT NULL AND left_at IS NULL) THEN
    RAISE EXCEPTION '% is the league''s only admin. Make someone else admin first.', v_name
      USING ERRCODE = 'P0001', HINT = 'last_admin';
  END IF;

  -- Coming back with the invite code makes them a member, not an admin.
  UPDATE public.league_members SET left_at = now(), role = 'member'
   WHERE league_id = p_league AND user_id = p_user;
  PERFORM public.league_member_cleanup(p_league, p_user);

  INSERT INTO public.league_member_events (league_id, kind, user_id, actor_user_id, data)
  VALUES (p_league, 'removed', p_user, v_uid, jsonb_build_object('name', v_name, 'role', v_role));

  PERFORM public.create_notification(p_user, 'league_member_removed', v_uid, p_league,
    jsonb_build_object('league_id', p_league,
                       'league_name', (SELECT name FROM public.leagues WHERE id = p_league),
                       'actor_name', public.league_user_name(v_uid),
                       'subject_id', p_user, 'subject_name', v_name, 'you', true));
  PERFORM public.notify_league_members(p_league, v_uid, 'league_member_removed', p_league,
    jsonb_build_object('subject_id', p_user, 'subject_name', v_name));
END;
$$;

-- Admin: a new invite code; the old one (and every link with it) stops working.
CREATE OR REPLACE FUNCTION public.rotate_league_invite_code(p_league uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_code text;
BEGIN
  IF NOT public.league_is_admin(p_league, v_uid) THEN
    RAISE EXCEPTION 'Only the league admin can do that.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.league_assert_open(p_league);
  v_code := public.league_new_invite_code();
  UPDATE public.leagues SET invite_code = v_code WHERE id = p_league;
  INSERT INTO public.league_member_events (league_id, kind, actor_user_id)
  VALUES (p_league, 'invite_code_rotated', v_uid);
  RETURN jsonb_build_object('invite_code', v_code);
END;
$$;

-- Admin: undo a claim. The account that claimed the spot leaves the league
-- (its cards stay) and the spot is open again with its name and handicap.
CREATE OR REPLACE FUNCTION public.release_league_invitee(p_league uuid, p_invitee uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_i    public.league_invitees%ROWTYPE;
  v_role text;
  v_name text;
BEGIN
  PERFORM 1 FROM public.leagues WHERE id = p_league FOR UPDATE;   -- see leave_league
  IF NOT public.league_is_admin(p_league, v_uid) THEN
    RAISE EXCEPTION 'Only the league admin can do that.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.league_assert_open(p_league);
  SELECT * INTO v_i FROM public.league_invitees
   WHERE id = p_invitee AND league_id = p_league
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That spot is not in this league.' USING ERRCODE = 'P0001';
  END IF;
  IF v_i.claimed_by IS NULL THEN
    RAISE EXCEPTION 'Nobody has claimed that spot.' USING ERRCODE = 'P0001', HINT = 'not_claimed';
  END IF;
  IF v_i.claimed_by = v_uid THEN
    RAISE EXCEPTION 'That spot is yours. Leave the league instead.'
      USING ERRCODE = 'P0001', HINT = 'use_leave';
  END IF;
  SELECT role INTO v_role FROM public.league_members
   WHERE league_id = p_league AND user_id = v_i.claimed_by
     AND joined_at IS NOT NULL AND left_at IS NULL
     FOR UPDATE;
  v_name := public.league_user_name(v_i.claimed_by);
  -- Never a league without an admin (see remove_league_member).
  IF v_role = 'admin' AND NOT EXISTS (
       SELECT 1 FROM public.league_members
        WHERE league_id = p_league AND user_id <> v_i.claimed_by AND role = 'admin'
          AND joined_at IS NOT NULL AND left_at IS NULL) THEN
    RAISE EXCEPTION '% is the league''s only admin. Make someone else admin first.', v_name
      USING ERRCODE = 'P0001', HINT = 'last_admin';
  END IF;

  UPDATE public.league_members SET left_at = now(), role = 'member'
   WHERE league_id = p_league AND user_id = v_i.claimed_by
     AND joined_at IS NOT NULL AND left_at IS NULL;
  PERFORM public.league_member_cleanup(p_league, v_i.claimed_by);
  UPDATE public.league_invitees SET claimed_by = NULL, claimed_at = NULL WHERE id = p_invitee;

  INSERT INTO public.league_member_events (league_id, kind, user_id, invitee_id, actor_user_id, data)
  VALUES (p_league, 'spot_released', v_i.claimed_by, p_invitee, v_uid,
          jsonb_build_object('spot_name', v_i.name, 'name', v_name));

  PERFORM public.create_notification(v_i.claimed_by, 'league_spot_released', v_uid, p_league,
    jsonb_build_object('league_id', p_league,
                       'league_name', (SELECT name FROM public.leagues WHERE id = p_league),
                       'actor_name', public.league_user_name(v_uid),
                       'subject_id', v_i.claimed_by, 'subject_name', v_name,
                       'spot_name', v_i.name, 'you', true));
  PERFORM public.notify_league_members(p_league, v_uid, 'league_spot_released', p_league,
    jsonb_build_object('subject_id', v_i.claimed_by, 'subject_name', v_name, 'spot_name', v_i.name));
END;
$$;

-- Body of 20261004000000 plus: a promotion or demotion is logged and the
-- members are told (league_role_changed). Setting the role a member already
-- has changes nothing and says nothing.
CREATE OR REPLACE FUNCTION public.set_league_role(p_league uuid, p_user uuid, p_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cur text;
BEGIN
  PERFORM 1 FROM public.leagues WHERE id = p_league FOR UPDATE;   -- see leave_league
  IF NOT public.league_is_admin(p_league, v_uid) THEN
    RAISE EXCEPTION 'Only the league admin can do that.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.league_assert_open(p_league);
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
  IF v_cur = p_role THEN
    RETURN;
  END IF;
  UPDATE public.league_members SET role = p_role
   WHERE league_id = p_league AND user_id = p_user;

  INSERT INTO public.league_member_events (league_id, kind, user_id, actor_user_id, data)
  VALUES (p_league, CASE WHEN p_role = 'admin' THEN 'promoted' ELSE 'demoted' END, p_user, v_uid,
          jsonb_build_object('name', public.league_user_name(p_user), 'role', p_role));
  PERFORM public.notify_league_members(p_league, v_uid, 'league_role_changed', p_league,
    jsonb_build_object('subject_id', p_user, 'subject_name', public.league_user_name(p_user), 'role', p_role));
END;
$$;

-- Body of 20261014000000 plus: an active member can't take a spot
-- ('already_member'); the spot's handicap event is the claimer's; the admins
-- hear about the claim (league_spot_claimed) and it is logged.
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
      -- R15: a spot is for someone not in the league yet.
      IF public.league_is_member(v_l.id, v_uid) THEN
        RAISE EXCEPTION 'You are already in this league, so you can''t take %''s spot.', v_i.name
          USING ERRCODE = 'P0001', HINT = 'already_member';
      END IF;
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

  -- The spot's handicap (the admin's value), recorded as set by the claimer:
  -- they are the one who took the spot.
  IF v_claim AND v_spot IS NOT NULL AND v_spot IS DISTINCT FROM v_old THEN
    UPDATE public.league_members SET league_handicap = v_spot
     WHERE league_id = v_l.id AND user_id = v_uid;
    INSERT INTO public.league_handicap_events (league_id, user_id, old, new, reason, by_user)
    VALUES (v_l.id, v_uid, v_old, v_spot, 'set', v_uid);
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
    INSERT INTO public.league_member_events (league_id, kind, user_id, invitee_id, actor_user_id, data)
    VALUES (v_l.id, 'spot_claimed', v_uid, v_i.id, v_uid,
            jsonb_build_object('spot_name', v_i.name, 'name', public.league_user_name(v_uid),
                               'handicap', v_spot));
    INSERT INTO public.notifications (user_id, type, actor_id, entity_id, data)
    SELECT m.user_id, 'league_spot_claimed', v_uid, v_l.id,
           jsonb_build_object('league_id', v_l.id, 'league_name', v_l.name,
                              'actor_name', public.league_user_name(v_uid),
                              'spot_name', v_i.name, 'invitee_id', v_i.id)
      FROM public.league_members m
     WHERE m.league_id = v_l.id AND m.role = 'admin'
       AND m.joined_at IS NOT NULL AND m.left_at IS NULL AND m.user_id <> v_uid;
  END IF;

  RETURN jsonb_build_object('league_id', v_l.id);
END;
$$;

-- 13) Grants ---------------------------------------------------------------------------------

DO $$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.announce_league_card(uuid, text, jsonb, timestamptz, text, text, text, text)',
    'public.notify_league_tee_off(uuid)',
    'public.submit_league_card(uuid, jsonb, int, int, int, date)',
    'public.add_unannounced_league_card(uuid, jsonb, timestamptz, date, jsonb, int, int, int)',
    'public.reschedule_league_card(uuid, timestamptz)',
    'public.withdraw_league_card(uuid)',
    'public.void_league_card(uuid, text)',
    'public.reopen_league_card(uuid)',
    'public.approve_league_card(uuid)',
    'public.set_league_handicap(uuid, uuid, numeric)',
    'public.confirm_league_card_by_partner(uuid)',
    'public.attach_league_proof(uuid, text, text, text)',
    'public.create_marker_token(uuid)',
    'public.request_league_marker(uuid, uuid)',
    'public.get_league_card_events(uuid)',
    'public.get_league_game_status(uuid, text, text)',
    'public.remove_league_member(uuid, uuid)',
    'public.rotate_league_invite_code(uuid)',
    'public.release_league_invitee(uuid, uuid)',
    'public.set_league_role(uuid, uuid, text)',
    'public.join_league(text, numeric, text, uuid)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_sig);
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION public.confirm_marker_card(text, text, boolean, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.confirm_marker_card(text, text, boolean, text) TO anon, authenticated;

-- 14) Backfill the timeline (R13) -----------------------------------------------------------
-- Only cards with no event yet, so a re-run adds nothing. data.backfill marks
-- them; a submitted time is approximate (no column kept it).
DO $$
DECLARE
  v_cards int;
BEGIN
  WITH todo AS (
    SELECT c.* FROM public.league_cards c
     WHERE NOT EXISTS (SELECT 1 FROM public.league_card_events e WHERE e.card_id = c.id)
  ), ev AS (
    SELECT id AS card_id, league_id, 'announced' AS kind, user_id AS actor, NULL::text AS actor_name,
           NULL::text AS how, NULL::text AS note, announced_at AS at,
           jsonb_build_object('source', source, 'tee_time', tee_time) AS data
      FROM todo WHERE announced_at IS NOT NULL
    UNION ALL
    SELECT id, league_id, 'added', user_id, NULL, NULL, NULL, created_at,
           jsonb_build_object('not_announced', true)
      FROM todo WHERE announced_at IS NULL
    UNION ALL
    SELECT id, league_id, 'first_shot', user_id, NULL, NULL, NULL, first_shot_at, '{}'::jsonb
      FROM todo WHERE first_shot_at IS NOT NULL AND source = 'app'
    UNION ALL
    SELECT id, league_id, 'submitted', user_id, NULL, NULL, NULL,
           LEAST(updated_at, COALESCE(confirmed_at, updated_at), COALESCE(marker_requested_at, updated_at),
                 COALESCE(approved_at, updated_at), COALESCE(returned_at, updated_at)),
           jsonb_build_object('points', points, 'gross', gross, 'approximate', true)
      FROM todo WHERE holes IS NOT NULL AND announced_at IS NOT NULL
    UNION ALL
    SELECT id, league_id, 'returned', NULL, NULL, NULL, marker_note, returned_at, '{}'::jsonb
      FROM todo WHERE returned_at IS NOT NULL
    UNION ALL
    SELECT id, league_id, 'missed', NULL, NULL, NULL, NULL, COALESCE(post_by, updated_at), '{}'::jsonb
      FROM todo WHERE status = 'missed'
    UNION ALL
    SELECT id, league_id, 'confirmed', confirmed_by_user, COALESCE(confirmed_by_name, ''),
           CASE WHEN confirmation = 'marker' THEN 'marker_request' ELSE confirmation END,
           NULL, confirmed_at, jsonb_build_object('proof', proof_path IS NOT NULL)
      FROM todo WHERE confirmed_at IS NOT NULL
    UNION ALL
    SELECT id, league_id, 'approved', approved_by, NULL, NULL, NULL, approved_at, '{}'::jsonb
      FROM todo WHERE approved_at IS NOT NULL AND approved_by IS NOT NULL
    UNION ALL
    SELECT id, league_id, 'voided', NULL, NULL, NULL, voided_reason, updated_at, '{}'::jsonb
      FROM todo WHERE status = 'void'
  )
  INSERT INTO public.league_card_events (card_id, league_id, kind, actor_user_id, actor_name, how, note, data, created_at)
  SELECT card_id, league_id, kind, actor,
         COALESCE(actor_name, CASE WHEN actor IS NOT NULL THEN public.league_user_name(actor) END),
         how, note, data || jsonb_build_object('backfill', true), at
    FROM ev
   ORDER BY at, card_id;
  GET DIAGNOSTICS v_cards = ROW_COUNT;
  RAISE NOTICE 'league_integrity backfill: % timeline events', v_cards;
END $$;

/* ===========================================================================
   VERIFY
   ---------------------------------------------------------------------------
   Smoke test (BEGIN … ROLLBACK): supabase/tests/league_integrity_smoke.sql
   (and leagues_smoke.sql, league_invitees_smoke.sql,
   league_join_identity_smoke.sql, league_server_scoring_smoke.sql still pass).

   -- The one-card index takes admin voids into account:
   SELECT pg_get_indexdef('public.one_card_per_month'::regclass);
   -- Live app cards still waiting for a first shot, and when the sweep withdraws them:
   SELECT id, announced_at, announced_at + interval '24 hours' AS withdraws_at
     FROM public.league_cards
    WHERE source = 'app' AND status IN ('announced','playing') AND post_by IS NULL AND first_shot_at IS NULL;
   -- Every card has a timeline:
   SELECT count(*) FROM public.league_cards c
    WHERE NOT EXISTS (SELECT 1 FROM public.league_card_events e WHERE e.card_id = c.id);
   =========================================================================== */
