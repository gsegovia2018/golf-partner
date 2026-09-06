-- ============================================================================
-- get_round_activity: also return each round's hole-publication span.
-- ============================================================================
--
-- WHY
-- ---
-- The feed orders unstamped rounds on activity_ts, i.e. game_scores /
-- game_rounds.updated_at. The cards engine re-projects game_scores on every
-- card write, and the 2026-09-04 cutover backfill re-projected EVERY round at
-- once — so every round abandoned mid-way since May now claims activity on
-- 2026-09-04 23:25 and sits near the top of the feed as LIVE.
--
-- The scorer cards kept the truth: each published hole carries `ts`, the
-- instant the scorer left it, and the backfill stamped legacy holes with
-- their original score-entry time. Returning the earliest and latest of
-- those per round gives the feed (a) a real last-activity instant for
-- unstamped rounds, frozen unless someone actually scores, and (b) the two
-- ends of the round's duration (store/roundDuration.js) without a per-card
-- pull of scorer_cards.
--
-- SHAPE
-- -----
-- Adds first_hole_ts / last_hole_ts (ms epoch, NULL when no card has a
-- published hole). Extra columns are ignored by clients that predate them.
-- The return type changes, so the function is dropped and recreated.
--
-- STABLE, SECURITY INVOKER as before: scorer_cards_select lets anyone who can
-- see the tournament read its cards, matching game_rounds / game_scores.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_round_activity(text[]);

CREATE FUNCTION public.get_round_activity(p_tournament_ids text[])
RETURNS TABLE(
  tournament_id text,
  round_id text,
  activity_ts timestamptz,
  first_hole_ts bigint,
  last_hole_ts bigint
)
LANGUAGE sql STABLE AS $$
  SELECT
    gr.tournament_id,
    gr.id AS round_id,
    GREATEST(
      COALESCE(s.max_updated_at, '-infinity'::timestamptz),
      COALESCE(gr.updated_at, '-infinity'::timestamptz)
    ) AS activity_ts,
    h.first_hole_ts,
    h.last_hole_ts
  FROM public.game_rounds gr
  LEFT JOIN (
    SELECT tournament_id, round_id, max(updated_at) AS max_updated_at
    FROM public.game_scores
    WHERE tournament_id = ANY(p_tournament_ids)
    GROUP BY tournament_id, round_id
  ) s ON s.tournament_id = gr.tournament_id AND s.round_id = gr.id
  LEFT JOIN (
    SELECT c.tournament_id, c.round_id,
           min((hole.value->>'ts')::bigint) AS first_hole_ts,
           max((hole.value->>'ts')::bigint) AS last_hole_ts
    FROM public.scorer_cards c
    CROSS JOIN LATERAL jsonb_each(
      CASE WHEN jsonb_typeof(c.card->'holes') = 'object'
           THEN c.card->'holes' ELSE '{}'::jsonb END) AS hole
    WHERE c.tournament_id = ANY(p_tournament_ids)
      AND jsonb_typeof(hole.value->'ts') = 'number'
      AND (hole.value->>'ts')::bigint > 0
    GROUP BY c.tournament_id, c.round_id
  ) h ON h.tournament_id = gr.tournament_id AND h.round_id = gr.id
  WHERE gr.tournament_id = ANY(p_tournament_ids);
$$;

-- Verify (spot-check against real data):
--   SELECT * FROM public.get_round_activity(ARRAY['<tournament-id>']);
--   -- first_hole_ts/last_hole_ts should bracket the round; NULL for a round
--   -- nobody has scored.
