-- ============================================================================
-- League spot cards: a card held on an invitee spot until the player joins.
-- Builds on 20261014000000_league_invitees.sql and 20261020000000_league_medal_play.sql.
-- Idempotent; safe to re-run.
-- ============================================================================
--
-- WHY
-- ---
-- A league card belongs to an account (league_cards.user_id NOT NULL), but
-- most players of a real league are invitee spots with no account yet. Their
-- cards arrive as photos and the admin has them before the player joins
-- (El Club del Mulligan, October 2026: 10 cards, none from an account).
--
-- 1) league_spot_cards — one row per card held for a spot: the course
--    snapshot (a library tee), the day, the 18 strokes, the proof photo and
--    the admin who added it. RPC-less and RLS-locked (no policies, no table
--    privileges for anon/authenticated): rows are written with the service
--    role, so there is no UI for it. `id` is the future league_cards.id, so
--    the proof can be uploaded to its final path, league-proofs/<league>/<id>.jpg,
--    before the card exists. One card per spot per month.
--
-- 2) league_move_spot_cards(invitee, user) — turns the spot's unmoved cards
--    into the member's league_cards: scored by the server exactly as
--    add_unannounced_league_card scores a card (league_card_score with the
--    member's league handicap, differential, to-par), confirmed by photo,
--    approved by the admin who added it, not announced (it wasn't). A month
--    the member already has a card for is skipped and stays on the spot.
--    The timeline gets 'added', 'confirmed' and 'approved', all by that admin.
--    No notifications: the cards are history by the time the player joins.
--
-- 3) A trigger on league_invitees runs it when a spot is claimed
--    (claimed_by NULL -> user). join_league writes the member and its league
--    handicap before it marks the spot claimed, so the handicap is in place.
-- ============================================================================

-- 1) Table ----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.league_spot_cards (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id   uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  invitee_id  uuid NOT NULL REFERENCES public.league_invitees(id) ON DELETE CASCADE,
  course      jsonb NOT NULL,          -- {course_id, name, tee, slope, rating, holes:[{n,par,si}]}
  played_on   date NOT NULL,
  -- First day of played_on's month (date_trunc on a date isn't immutable).
  month       date GENERATED ALWAYS AS (played_on - (extract(day FROM played_on)::int - 1)) STORED,
  holes       jsonb NOT NULL,          -- {"1":5,…,"18":6}
  proof_path  text NOT NULL,           -- <league_id>/<id>.jpg in league-proofs
  added_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  moved_at    timestamptz,
  moved_to    uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS league_spot_cards_one_per_month
  ON public.league_spot_cards (invitee_id, month);

ALTER TABLE public.league_spot_cards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.league_spot_cards FROM PUBLIC, anon, authenticated;

-- 2) Move a spot's cards to the member who claimed it -------------------------------

CREATE OR REPLACE FUNCTION public.league_move_spot_cards(p_invitee uuid, p_user uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r       public.league_spot_cards%ROWTYPE;
  v_hcp   numeric(4,1);
  v_score jsonb;
  v_ph    int;
  v_diff  numeric;
  v_n     int := 0;
BEGIN
  FOR r IN SELECT * FROM public.league_spot_cards
            WHERE invitee_id = p_invitee AND moved_at IS NULL
            ORDER BY played_on
  LOOP
    IF EXISTS (SELECT 1 FROM public.league_cards
                WHERE league_id = r.league_id AND user_id = p_user AND month = r.month
                  AND public.league_takes_month(status, void_kind)) THEN
      CONTINUE;
    END IF;

    SELECT league_handicap INTO v_hcp FROM public.league_members
     WHERE league_id = r.league_id AND user_id = p_user;
    v_score := public.league_card_score(r.holes, r.course, v_hcp);
    CONTINUE WHEN v_score IS NULL;
    v_ph   := (v_score ->> 'playing_handicap')::int;
    v_diff := public.league_card_differential(r.holes, r.course, v_ph);

    INSERT INTO public.league_cards
      (id, league_id, user_id, month, source, status, course, played_on,
       not_announced, league_handicap, playing_handicap, holes, gross, points,
       differential, net_differential, tee_verified, to_par,
       confirmation, confirmed_by_user, confirmed_by_name, confirmed_at, proof_path,
       approved_at, approved_by)
    VALUES
      (r.id, r.league_id, p_user, r.month, 'offapp', 'confirmed', r.course, r.played_on,
       true, v_hcp, v_ph, r.holes, (v_score ->> 'gross')::int, (v_score ->> 'points')::int,
       v_diff, public.league_net_differential(v_diff, v_hcp), true,
       public.league_card_to_par(v_score, (SELECT format FROM public.leagues WHERE id = r.league_id)),
       'photo', r.added_by, public.league_user_name(r.added_by), now(), r.proof_path,
       now(), r.added_by);

    PERFORM public.league_card_log(r.id, 'added', r.added_by, NULL, NULL, NULL,
      jsonb_build_object('points', (v_score ->> 'points')::int, 'gross', (v_score ->> 'gross')::int,
                         'tee_verified', true, 'not_announced', true, 'for_spot', true));
    PERFORM public.league_card_log(r.id, 'confirmed', r.added_by, NULL, 'photo', NULL,
      jsonb_build_object('proof', true));
    PERFORM public.league_card_log(r.id, 'approved', r.added_by);

    UPDATE public.league_spot_cards SET moved_at = now(), moved_to = p_user WHERE id = r.id;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.league_move_spot_cards(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- 3) On claim -------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.league_invitee_claimed_move_cards()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.league_move_spot_cards(NEW.id, NEW.claimed_by);
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.league_invitee_claimed_move_cards() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS league_invitees_move_cards ON public.league_invitees;
CREATE TRIGGER league_invitees_move_cards
  AFTER UPDATE OF claimed_by ON public.league_invitees
  FOR EACH ROW
  WHEN (OLD.claimed_by IS NULL AND NEW.claimed_by IS NOT NULL)
  EXECUTE FUNCTION public.league_invitee_claimed_move_cards();
