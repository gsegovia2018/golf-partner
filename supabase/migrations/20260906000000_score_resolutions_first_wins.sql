-- ============================================================================
-- score_resolutions: the FIRST valid agreement on a cell wins.
-- Plan: docs/superpowers/plans/2026-09-04-scorecard-cards-engine.md (§3.3, §5)
-- Idempotent; safe to re-run. Follows 20260905000000_scorer_cards.sql.
-- ============================================================================
--
-- PROBLEM
-- -------
-- `score_resolutions` is keyed (tournament_id, round_id, player_id, hole) and
-- the client wrote it with a plain PostgREST upsert. Two phones looking at the
-- SAME discrepancy — the same cell, the same card versions, so the same
-- `basis` — can each tap a different chip within a second of each other:
--
--   Marcos agrees Alex/hole 3 = 5      basis {devM:1, devG:1}
--   Guille agrees Alex/hole 3 = 4      basis {devM:1, devG:1}
--
-- Both upserts succeed, the later one overwrites the earlier, and each phone
-- goes on showing the tick it wrote until something makes it re-read the row.
-- The agreement — the one thing in this design that is supposed to be shared
-- and final — was the only value decided by a network race.
--
-- FIX
-- ---
-- One rule, enforced server-side: an agreement recorded against a given basis
-- is FINAL for that basis. A second agreement carrying the SAME basis is
-- ignored, whatever value it names and whoever sent it — the first one is as
-- good as the second and being first is the only tiebreak that needs no clock
-- (phones on a course disagree by minutes; see plan §10).
--
-- An agreement carrying a DIFFERENT basis is not a competitor, it is a
-- SUCCESSOR: a different basis means the cards moved — someone re-published
-- the hole, or a scorer marked the cell for the first time — which is exactly
-- the condition under which the stored row has already lapsed client-side
-- (isResolutionValid, src/engine/cards.js). A lapsed row must give way, so a
-- different basis replaces.
--
-- Writes go through put_score_resolution() instead of an upsert, and the
-- function RETURNS THE ROW THAT NOW STANDS. That return is what lets the
-- losing phone stop insisting: src/engine/store/replicator.js stores the
-- returned row in place of its own pending one, so both phones settle on the
-- same value in the same round trip, with no extra read and no realtime event
-- needed.
--
-- WHAT THIS DOES NOT CHANGE
-- -------------------------
-- Table shape, RLS, triggers, the projection, and realtime are all untouched.
-- SECURITY INVOKER (the default) is deliberate: the function's INSERT and
-- UPDATE are checked against the very score_resolutions policies a direct
-- upsert would have hit (can_edit_tournament for writes), so there is no
-- privilege to escalate and no predicate to re-check by hand. Direct upserts
-- also still work — an older bundle replaying a queued agreement is accepted,
-- it simply does not get the first-wins guarantee for that one write.
--
-- HOW TO RUN
-- ----------
--   Paste into the Supabase SQL editor and Run. Idempotent — safe to re-run.
-- ============================================================================

-- put_score_resolution(): record an agreement and return the standing row.
--
--   * no row yet                  -> insert, return the new row
--   * same basis as the stored row-> ignore, return the STORED row (first wins)
--   * different basis             -> replace, return the new row
--
-- `basis` is compared as jsonb, so key order and whitespace are irrelevant —
-- {"devM":1,"devG":1} and {"devG":1,"devM":1} are the same basis, which they
-- must be: the two phones build that object by iterating their own card maps.
--
-- The DO UPDATE ... WHERE makes "ignore" a genuine no-op at the row level: no
-- write, so resolved_at is not bumped, score_resolutions_touch does not fire,
-- the projection trigger does not fire, and no realtime event is emitted for a
-- row that did not change. The IF NOT FOUND branch then reads back the row
-- that kept its place, which is what the caller is told to adopt.
CREATE OR REPLACE FUNCTION public.put_score_resolution(
  p_tournament_id text,
  p_round_id      text,
  p_player_id     text,
  p_hole          int,
  p_value         int,
  p_resolved_by   text,
  p_basis         jsonb
)
RETURNS public.score_resolutions
LANGUAGE plpgsql
AS $$
DECLARE
  v_row public.score_resolutions;
BEGIN
  INSERT INTO public.score_resolutions AS r
    (tournament_id, round_id, player_id, hole, value, resolved_by, basis)
  VALUES
    (p_tournament_id, p_round_id, p_player_id, p_hole, p_value, p_resolved_by,
     COALESCE(p_basis, '{}'::jsonb))
  ON CONFLICT (tournament_id, round_id, player_id, hole) DO UPDATE
     SET value       = EXCLUDED.value,
         resolved_by = EXCLUDED.resolved_by,
         basis       = EXCLUDED.basis
   WHERE r.basis IS DISTINCT FROM EXCLUDED.basis
  RETURNING r.* INTO v_row;

  -- Nothing written: an agreement on this basis was already standing.
  IF NOT FOUND THEN
    SELECT s.* INTO v_row
      FROM public.score_resolutions s
     WHERE s.tournament_id = p_tournament_id
       AND s.round_id      = p_round_id
       AND s.player_id     = p_player_id
       AND s.hole          = p_hole;
  END IF;

  RETURN v_row;
END $$;

GRANT EXECUTE ON FUNCTION
  public.put_score_resolution(text, text, text, int, int, text, jsonb)
  TO authenticated;

COMMENT ON FUNCTION
  public.put_score_resolution(text, text, text, int, int, text, jsonb) IS
  'Record a score agreement. The first agreement made against a given basis '
  'wins; a later one with the same basis is ignored, one with a different '
  'basis (the stored row has lapsed) replaces it. Returns the row that now '
  'stands so the caller can adopt it.';
