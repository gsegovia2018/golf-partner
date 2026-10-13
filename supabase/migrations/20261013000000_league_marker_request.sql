-- ============================================================================
-- League: pick your marker.
-- Builds on 20261004000000_leagues.sql, 20261005000001_league_net_differential.sql
-- and 20261012000000_league_post_deadline.sql. Idempotent; safe to re-run.
-- ============================================================================
--
-- WHY
-- ---
-- An app card is confirmed automatically only when another signed-in player
-- entered the owner's exact 18 strokes (confirm_league_card_by_partner).
-- When nobody did, the owner had to show a QR on the spot. Now the owner picks
-- a marker from the game's players and that player confirms (or flags a hole)
-- in the app, whenever they get to it.
--
-- HOW
-- ---
-- It reuses the marker-token mechanism: a token bound to a user
-- (league_marker_tokens.marker_user_id). The token travels only in the
-- marker's own notification and is never returned to the owner.
-- get_marker_card / confirm_marker_card refuse a bound token to anyone but
-- that user ('invalid', same as an unknown token); unbound tokens (the QR)
-- behave exactly as before. A confirmation through a bound token is
-- confirmation = 'marker', confirmed_by_user = the marker.
--
-- The card carries the open request (marker_user_id / marker_name /
-- marker_requested_at / marker_reminded_at) so members can see who was asked.
-- Every path that ends the request clears all four: submit (it also expires
-- every token), confirmation, void, the marker's flag, and cancel.
--
-- Only a 'submitted' card can have a request, and submit kills it, so none of
-- the post-deadline rules (post_by, the sweep, returned_at) change.
-- ============================================================================

-- 1) Columns ---------------------------------------------------------------------

ALTER TABLE public.league_marker_tokens ADD COLUMN IF NOT EXISTS marker_user_id uuid
  REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.league_cards ADD COLUMN IF NOT EXISTS marker_user_id      uuid;
ALTER TABLE public.league_cards ADD COLUMN IF NOT EXISTS marker_name         text;
ALTER TABLE public.league_cards ADD COLUMN IF NOT EXISTS marker_requested_at timestamptz;
ALTER TABLE public.league_cards ADD COLUMN IF NOT EXISTS marker_reminded_at  timestamptz;

ALTER TABLE public.league_cards DROP CONSTRAINT IF EXISTS league_cards_confirmation_check;
ALTER TABLE public.league_cards ADD CONSTRAINT league_cards_confirmation_check
  CHECK (confirmation IN ('partner','qr','photo','official','marker'));

-- 2) Eligibility (internal) -------------------------------------------------------
-- A marker is another signed-in player of the card's game who kept a card in
-- its round (scorer_cards.writer_uid is stamped by the server).
CREATE OR REPLACE FUNCTION public.league_marker_eligible(p_card public.league_cards, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p_user IS NOT NULL
     AND p_user IS DISTINCT FROM p_card.user_id
     AND EXISTS (SELECT 1 FROM public.game_players gp
                  WHERE gp.tournament_id = p_card.tournament_id
                    AND gp.user_id = p_user AND gp.deleted_at IS NULL)
     AND EXISTS (SELECT 1 FROM public.scorer_cards sc
                  WHERE sc.tournament_id = p_card.tournament_id
                    AND sc.round_id = p_card.round_id
                    AND sc.writer_uid = p_user);
$$;
REVOKE EXECUTE ON FUNCTION public.league_marker_eligible(public.league_cards, uuid)
  FROM PUBLIC, anon, authenticated;

-- 3) New RPCs ----------------------------------------------------------------------

-- Who the owner can pick, best match first. Called before submit too, so the
-- client can offer the choice on the card screen. marked = holes 1-18 where
-- that player's own card has the owner's settled strokes (game_scores).
CREATE OR REPLACE FUNCTION public.get_league_marker_candidates(p_card uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_c       public.league_cards%ROWTYPE;
  v_pending jsonb;
  v_list    jsonb;
BEGIN
  SELECT * INTO v_c FROM public.league_cards WHERE id = p_card;
  IF NOT FOUND OR v_c.user_id IS DISTINCT FROM v_uid
     OR NOT public.league_is_member(v_c.league_id, v_uid) THEN
    RAISE EXCEPTION 'Card not found.' USING ERRCODE = 'P0001';
  END IF;
  IF v_c.source <> 'app' OR v_c.tournament_id IS NULL THEN
    RAISE EXCEPTION 'Only cards played in the app can pick a marker.'
      USING ERRCODE = 'P0001', HINT = 'not_app';
  END IF;
  IF v_c.status NOT IN ('announced','playing','submitted') THEN
    RAISE EXCEPTION 'This card can no longer be changed.' USING ERRCODE = 'P0001';
  END IF;

  SELECT jsonb_build_object(
           'user_id',      v_c.marker_user_id,
           'name',         v_c.marker_name,
           'requested_at', v_c.marker_requested_at,
           'reminded_at',  v_c.marker_reminded_at,
           'expires_at',   t.expires_at)
    INTO v_pending
    FROM public.league_marker_tokens t
   WHERE v_c.marker_user_id IS NOT NULL
     AND t.card_id = p_card AND t.marker_user_id = v_c.marker_user_id
     AND t.used_at IS NULL AND t.expires_at > now()
   ORDER BY t.created_at DESC
   LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'user_id',   x.uid,
           'name',      x.name,
           'in_league', x.in_league,
           'marked',    x.marked) ORDER BY x.marked DESC, x.name), '[]'::jsonb)
    INTO v_list
    FROM (
      SELECT u.uid,
             public.league_user_name(u.uid) AS name,
             public.league_is_member(v_c.league_id, u.uid) AS in_league,
             COALESCE((
               SELECT max((
                 SELECT count(*) FROM public.game_scores s
                  WHERE s.tournament_id = v_c.tournament_id AND s.round_id = v_c.round_id
                    AND s.player_id = v_c.player_id AND s.hole BETWEEN 1 AND 18
                    AND s.strokes IS NOT NULL
                    AND CASE WHEN jsonb_typeof(sc.card -> 'holes' -> s.hole::text -> 'entries' -> v_c.player_id) = 'number'
                             THEN (sc.card -> 'holes' -> s.hole::text -> 'entries' ->> v_c.player_id)::numeric = s.strokes
                             ELSE false END))
                 FROM public.scorer_cards sc
                WHERE sc.tournament_id = v_c.tournament_id AND sc.round_id = v_c.round_id
                  AND sc.writer_uid = u.uid), 0)::int AS marked
        FROM (SELECT DISTINCT gp.user_id AS uid FROM public.game_players gp
               WHERE gp.tournament_id = v_c.tournament_id
                 AND gp.user_id IS NOT NULL AND gp.deleted_at IS NULL) u
       WHERE public.league_marker_eligible(v_c, u.uid)
    ) x;

  RETURN jsonb_build_object('pending', v_pending, 'candidates', v_list);
END;
$$;

-- Ask one of the game's players to mark a submitted card. Replaces any open
-- request (and any QR) for the card. The token goes only into the marker's
-- notification.
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

-- Nudge the marker again: the same token in a fresh notification, at most
-- once every 20 hours (a day, give or take when the owner opens the app).
CREATE OR REPLACE FUNCTION public.remind_league_marker(p_card uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_c   public.league_cards%ROWTYPE;
  v_t   public.league_marker_tokens%ROWTYPE;
  v_at  timestamptz := now();
BEGIN
  SELECT * INTO v_c FROM public.league_cards WHERE id = p_card FOR UPDATE;
  IF NOT FOUND OR v_c.user_id IS DISTINCT FROM v_uid
     OR NOT public.league_is_member(v_c.league_id, v_uid) THEN
    RAISE EXCEPTION 'Card not found.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.league_assert_open(v_c.league_id);
  SELECT * INTO v_t FROM public.league_marker_tokens
   WHERE v_c.marker_user_id IS NOT NULL
     AND card_id = p_card AND marker_user_id = v_c.marker_user_id
     AND used_at IS NULL AND expires_at > now()
   ORDER BY created_at DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nobody has been asked to mark this card.'
      USING ERRCODE = 'P0001', HINT = 'no_request';
  END IF;
  IF greatest(v_c.marker_requested_at, v_c.marker_reminded_at) > now() - interval '20 hours' THEN
    RAISE EXCEPTION 'You can remind once a day.' USING ERRCODE = 'P0001', HINT = 'remind_too_soon';
  END IF;

  DELETE FROM public.notifications
   WHERE type = 'league_marker_request' AND entity_id = p_card;
  PERFORM public.create_notification(v_t.marker_user_id, 'league_marker_request', v_uid, p_card,
    jsonb_build_object(
      'token',       v_t.token,
      'card_id',     p_card,
      'league_id',   v_c.league_id,
      'league_name', (SELECT name FROM public.leagues WHERE id = v_c.league_id),
      'course_name', v_c.course ->> 'name',
      'month',       v_c.month,
      'actor_name',  public.league_user_name(v_uid)));

  UPDATE public.league_cards SET marker_reminded_at = v_at, updated_at = now() WHERE id = p_card;
  RETURN jsonb_build_object('reminded_at', v_at);
END;
$$;

-- Withdraw the request. Idempotent; a QR (unbound token) is left alone.
CREATE OR REPLACE FUNCTION public.cancel_league_marker_request(p_card uuid)
RETURNS void
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
  UPDATE public.league_marker_tokens SET expires_at = LEAST(expires_at, now())
   WHERE card_id = p_card AND marker_user_id IS NOT NULL AND used_at IS NULL;
  UPDATE public.league_cards
     SET marker_user_id = NULL, marker_name = NULL,
         marker_requested_at = NULL, marker_reminded_at = NULL, updated_at = now()
   WHERE id = p_card;
  DELETE FROM public.notifications
   WHERE type = 'league_marker_request' AND entity_id = p_card;
END;
$$;

-- Body of 20261004000000 plus: showing a QR replaces a pending in-app request,
-- so the card stops reading "waiting for <marker>" and the marker's push goes.
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

DO $$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.get_league_marker_candidates(uuid)',
    'public.request_league_marker(uuid, uuid)',
    'public.remind_league_marker(uuid)',
    'public.cancel_league_marker_request(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_sig);
  END LOOP;
END $$;

-- 4) Marker RPCs: bound tokens --------------------------------------------------------

-- Body of 20261005000001 plus: league_name and month for every token; a
-- bound token answers only its marker, and tells them it is bound and who
-- they are signed in as.
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
    'differential',      v_c.differential,
    'net_differential',  v_c.net_differential,
    'expires_at',        v_t.expires_at,
    'league_name',       (SELECT name FROM public.leagues WHERE id = v_c.league_id),
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

-- Body of 20261012000000 plus bound tokens: only their marker, signed with
-- their profile name (p_marker_name ignored); ok -> confirmation 'marker'
-- and the owner is told. Either outcome ends the request.
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

-- Same grants as 20261004000000 (CREATE OR REPLACE keeps them; restated so a
-- re-run on its own leaves the anon surface right).
REVOKE EXECUTE ON FUNCTION public.get_marker_card(text)                         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.confirm_marker_card(text, text, boolean, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_marker_card(text)                         TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.confirm_marker_card(text, text, boolean, text) TO anon, authenticated;

-- 5) Every end of a card's review ends the request --------------------------------

-- Body of 20261005000001 plus clearing the marker request.
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

-- Body of 20261004000000 plus clearing the marker request.
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
  IF NOT FOUND OR NOT public.league_is_admin(v_league, auth.uid()) THEN
    RAISE EXCEPTION 'Only the league admin can do that.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.league_cards
     SET status = 'void', voided_reason = NULLIF(left(btrim(COALESCE(p_reason, '')), 500), ''),
         marker_user_id = NULL, marker_name = NULL,
         marker_requested_at = NULL, marker_reminded_at = NULL,
         updated_at = now()
   WHERE id = p_card;
  UPDATE public.league_marker_tokens SET expires_at = LEAST(expires_at, now())
   WHERE card_id = p_card AND used_at IS NULL;
END;
$$;

-- Body of 20261012000000 plus clearing the marker request (submit already
-- expires every token, so a new snapshot needs a new request).
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
         marker_user_id = NULL, marker_name = NULL,
         marker_requested_at = NULL, marker_reminded_at = NULL,
         status = 'submitted', updated_at = now()
   WHERE id = p_card;

  RETURN jsonb_build_object('id', p_card, 'status', 'submitted',
                            'not_announced', v_not, 'first_shot_at', v_first,
                            'differential', v_diff,
                            'net_differential', public.league_net_differential(v_diff, v_c.league_handicap));
END;
$$;

/* ===========================================================================
   VERIFY
   ---------------------------------------------------------------------------
   Smoke test (BEGIN … ROLLBACK): supabase/tests/leagues_smoke.sql, section 14.

   -- The confirmation check allows 'marker':
   SELECT pg_get_constraintdef(oid) FROM pg_constraint
    WHERE conname = 'league_cards_confirmation_check';
   -- Open requests and their live tokens:
   SELECT c.id, c.marker_name, c.marker_requested_at, t.expires_at
     FROM public.league_cards c
     JOIN public.league_marker_tokens t
       ON t.card_id = c.id AND t.marker_user_id = c.marker_user_id
    WHERE t.used_at IS NULL AND t.expires_at > now();
   =========================================================================== */
