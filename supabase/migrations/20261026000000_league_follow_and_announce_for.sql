-- ============================================================================
-- League members follow each other's league rounds; a game's creator counts
-- other members' cards.
-- ============================================================================
--
-- 1) Following. A game was readable by its creator, its members and the
--    friends of its participants. A game that carries a live league card is
--    now also readable by every active member of that card's league, friends
--    or not: the board's "Playing now" opens the round. Every game table's
--    SELECT policy reads through `tournaments` (EXISTS on it), so the round,
--    scores, shots and notes follow, and so do get_game_tournament and the
--    realtime channel. Casual games without a league card stay friends-only.
--
--    can_view_tournament_via_league answers only about the caller
--    (auth.uid()), like the other league helpers granted to authenticated:
--    it cannot be asked who is in which league.
--
-- 2) announce_league_card_for. The game's creator announces a card for
--    another member who plays in the game, with that member's own month,
--    season and handicap rules (the same checks announce_league_card runs
--    for the caller). The card belongs to the member: they validate and
--    submit it from their phone as before (league_assert_own_player).
--    Before the game row exists (Setup's Start announces first) the caller
--    is taken to be its creator, as R16 does for the caller's own card.
--
-- Idempotent (CREATE OR REPLACE / DROP IF EXISTS).
-- ============================================================================

-- 1) Following ----------------------------------------------------------------

CREATE INDEX IF NOT EXISTS league_cards_tournament_idx
  ON public.league_cards (tournament_id)
  WHERE tournament_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.can_view_tournament_via_league(tid text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.league_cards c
     WHERE c.tournament_id = tid
       AND c.status <> 'void'
       AND public.league_is_member(c.league_id, auth.uid())
  );
$$;
REVOKE EXECUTE ON FUNCTION public.can_view_tournament_via_league(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_tournament_via_league(text) TO authenticated;

DROP POLICY IF EXISTS tournaments_select ON public.tournaments;
CREATE POLICY tournaments_select ON public.tournaments
  FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR is_tournament_member(id, auth.uid())
    OR can_view_tournament_via_friend(id, auth.uid())
    OR can_view_tournament_via_league(id)
  );

-- 2) announce_league_card_for ---------------------------------------------------

CREATE OR REPLACE FUNCTION public.announce_league_card_for(
  p_league uuid, p_user uuid, p_course jsonb,
  p_tournament_id text, p_round_id text, p_player_id text,
  p_scoring_mode text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_tee    timestamptz := now();
  v_month  date;
  v_hcp    numeric(4,1);
  v_id     uuid;
  v_s0     date;
  v_s1     date;
  v_card   public.league_cards%ROWTYPE;
BEGIN
  IF NOT public.league_is_member(p_league, v_caller) THEN
    RAISE EXCEPTION 'You are not in this league.' USING ERRCODE = '42501';
  END IF;
  IF p_user IS NULL OR p_user = v_caller THEN
    RAISE EXCEPTION 'Use announce_league_card for your own card.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.league_is_member(p_league, p_user) THEN
    RAISE EXCEPTION 'That player is not in this league.' USING ERRCODE = 'P0001', HINT = 'not_member';
  END IF;
  PERFORM public.league_assert_open(p_league);
  IF p_tournament_id IS NULL OR p_round_id IS NULL OR p_player_id IS NULL THEN
    RAISE EXCEPTION 'An app card needs its game, round and player.' USING ERRCODE = 'P0001';
  END IF;
  IF p_course IS NULL OR jsonb_typeof(p_course) <> 'object'
     OR NULLIF(btrim(COALESCE(p_course ->> 'name', '')), '') IS NULL THEN
    RAISE EXCEPTION 'Pick the course you are playing.' USING ERRCODE = 'P0001';
  END IF;

  -- The same game round and player again gives back the same card.
  SELECT * INTO v_card FROM public.league_cards
   WHERE league_id = p_league AND source = 'app'
     AND tournament_id = p_tournament_id AND round_id = p_round_id AND player_id = p_player_id
     AND status <> 'void'
   LIMIT 1;
  IF FOUND THEN
    IF v_card.user_id IS DISTINCT FROM p_user THEN
      RAISE EXCEPTION 'That player already has a league card for this round.'
        USING ERRCODE = 'P0001', HINT = 'not_your_player';
    END IF;
    RETURN jsonb_build_object('id', v_card.id, 'month', v_card.month, 'announced_at', v_card.announced_at,
                              'league_handicap', v_card.league_handicap, 'post_by', v_card.post_by,
                              'status', v_card.status, 'existing', true);
  END IF;

  -- Only the game's creator, and only for the member's own player in it.
  IF EXISTS (SELECT 1 FROM public.tournaments WHERE id = p_tournament_id)
     AND NOT EXISTS (SELECT 1 FROM public.tournaments
                      WHERE id = p_tournament_id AND created_by = v_caller) THEN
    RAISE EXCEPTION 'Only the game''s creator can count another player''s card.'
      USING ERRCODE = 'P0001', HINT = 'not_creator';
  END IF;
  IF EXISTS (SELECT 1 FROM public.game_players
              WHERE tournament_id = p_tournament_id AND player_id = p_player_id AND deleted_at IS NULL
                AND user_id IS DISTINCT FROM p_user) THEN
    RAISE EXCEPTION 'That player in the game is someone else.'
      USING ERRCODE = 'P0001', HINT = 'not_your_player';
  END IF;
  IF public.league_player_has_scores(p_tournament_id, p_round_id, p_player_id) THEN
    RAISE EXCEPTION 'This round has started for that player. A league card has to be announced before their first shot.'
      USING ERRCODE = 'P0001', HINT = 'round_started';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tournaments t
              WHERE t.id = p_tournament_id
                AND COALESCE(t.props ->> 'kind', to_jsonb(t) ->> 'kind') = 'official') THEN
    RAISE EXCEPTION 'Official tournament rounds can''t be league cards.'
      USING ERRCODE = 'P0001', HINT = 'official_round';
  END IF;
  PERFORM public.league_assert_not_scramble(p_scoring_mode);
  PERFORM public.league_assert_not_scramble(
    public.league_round_scoring_mode(p_tournament_id, p_round_id));

  v_month := public.league_month_of(v_tee);
  SELECT season_start, season_end INTO v_s0, v_s1 FROM public.leagues WHERE id = p_league;
  IF (v_tee AT TIME ZONE 'Europe/Madrid')::date NOT BETWEEN v_s0 AND v_s1 THEN
    RAISE EXCEPTION 'That date is outside the season (% to %).', v_s0, v_s1
      USING ERRCODE = 'P0001', HINT = 'outside_season';
  END IF;
  PERFORM public.league_assert_month_open(v_month);
  IF EXISTS (SELECT 1 FROM public.league_cards
              WHERE league_id = p_league AND user_id = p_user
                AND month = v_month AND public.league_takes_month(status, void_kind)) THEN
    RAISE EXCEPTION 'That player already has their % card.', to_char(v_month, 'FMMonth')
      USING ERRCODE = 'P0001', HINT = 'card_exists';
  END IF;

  SELECT league_handicap INTO v_hcp FROM public.league_members
   WHERE league_id = p_league AND user_id = p_user;

  BEGIN
    INSERT INTO public.league_cards
      (league_id, user_id, month, source, status, tournament_id, round_id, player_id,
       course, tee_time, played_on, announced_at, league_handicap, post_by)
    VALUES
      (p_league, p_user, v_month, 'app', 'playing',
       p_tournament_id, p_round_id, p_player_id,
       p_course, v_tee, (v_tee AT TIME ZONE 'Europe/Madrid')::date, now(), v_hcp, NULL)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'That player already has their % card.', to_char(v_month, 'FMMonth')
      USING ERRCODE = 'P0001', HINT = 'card_exists';
  END;

  PERFORM public.league_card_log(v_id, 'announced', v_caller, NULL, NULL, NULL,
    jsonb_build_object('source', 'app', 'tee_time', v_tee, 'course_name', p_course ->> 'name',
                       'for_user', p_user));

  -- Every member but the caller hears of it like any card, the card's owner
  -- included: someone else switched their card on.
  PERFORM public.notify_league_members(p_league, v_caller, 'league_card_announced', v_id,
    jsonb_build_object(
      'card_id',       v_id,
      'source',        'app',
      'course_name',   p_course ->> 'name',
      'tee',           p_course ->> 'tee',
      'tee_time',      v_tee,
      'month',         v_month,
      'tournament_id', p_tournament_id,
      'round_id',      p_round_id));

  RETURN jsonb_build_object('id', v_id, 'month', v_month, 'announced_at', now(),
                            'league_handicap', v_hcp, 'post_by', NULL,
                            'status', 'playing', 'existing', false);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.announce_league_card_for(uuid, uuid, jsonb, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.announce_league_card_for(uuid, uuid, jsonb, text, text, text, text) TO authenticated;
