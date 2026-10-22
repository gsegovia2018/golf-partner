-- ============================================================================
-- Members read the cards held on invitee spots (20261024000000_league_spot_cards.sql),
-- so the board can rank players who haven't joined yet. Temporary: drop this
-- function (and the client's spot rows) to go back to members-only boards.
-- Idempotent; safe to re-run.
-- ============================================================================
--
-- get_league_spot_cards(league) — every member of the league; anyone else gets
-- 'You are not in this league.'. One row per card still held on an UNCLAIMED
-- spot (moved_at NULL), scored on the fly exactly as league_move_spot_cards
-- will store it: league_card_score with the spot's handicap (clamped to the
-- league's cap, as get_league_invitees shows it), differential, to-par. A
-- claimed spot's card is a real league_cards row by then, so it isn't here.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_league_spot_cards(p_league uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.league_is_member(p_league, auth.uid()) THEN
    RAISE EXCEPTION 'You are not in this league.' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id',               s.id,
             'invitee_id',       s.invitee_id,
             'month',            s.month,
             'course',           s.course,
             'played_on',        s.played_on,
             'holes',            s.holes,
             'league_handicap',  x.hcp,
             'playing_handicap', (x.score ->> 'playing_handicap')::int,
             'gross',            (x.score ->> 'gross')::int,
             'points',           (x.score ->> 'points')::int,
             'differential',     x.diff,
             'net_differential', public.league_net_differential(x.diff, x.hcp),
             'to_par',           public.league_card_to_par(x.score, l.format),
             'proof_path',       s.proof_path,
             'added_by',         s.added_by,
             'added_by_name',    public.league_user_name(s.added_by),
             'created_at',       s.created_at) ORDER BY s.month, s.played_on), '[]'::jsonb)
      FROM public.league_spot_cards s
      JOIN public.league_invitees i ON i.id = s.invitee_id AND i.claimed_by IS NULL
      JOIN public.leagues l ON l.id = s.league_id
      CROSS JOIN LATERAL (
        SELECT LEAST(i.handicap, l.handicap_cap) AS hcp,
               public.league_card_score(s.holes, s.course, LEAST(i.handicap, l.handicap_cap)) AS score
      ) y
      CROSS JOIN LATERAL (
        SELECT y.hcp, y.score,
               public.league_card_differential(s.holes, s.course, (y.score ->> 'playing_handicap')::int) AS diff
      ) x
     WHERE s.league_id = p_league AND s.moved_at IS NULL
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_league_spot_cards(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_league_spot_cards(uuid) TO authenticated;
