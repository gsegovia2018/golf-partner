-- ============================================================================
-- get_round_activity — server-side per-round "last touched" aggregation.
-- Spec: fix/finish-and-feed-order — replaces feedStore.js's two unpaginated
-- .from('game_scores') / .from('game_rounds') queries.
-- Safe to re-run (CREATE OR REPLACE). Apply in the Supabase SQL editor.
-- ============================================================================
--
-- WHY
-- ---
-- feedStore.fetchRoundActivityTimestamps used to do:
--   supabase.from('game_scores').select('tournament_id, round_id, updated_at')
--     .in('tournament_id', tournamentIds)
-- with no pagination. PostgREST caps unpaginated responses at 1000 rows
-- (returning HTTP 206 Partial Content past that). With ~1398 game_scores rows
-- in prod, the response silently truncates and whichever tournaments' score
-- rows fall outside the first (unordered) 1000 get no activity timestamp —
-- their feed cards then fall back to roundActivityTs's non-recency
-- (createdAt + roundIndex) ordering, which sorts them wrong. This only gets
-- worse as game_scores grows (one row per hole per player per round).
--
-- This RPC aggregates server-side instead: one row PER ROUND (not per score
-- cell), so the result is bounded by round count — a few dozen rows even for
-- a caller with hundreds of tournaments — regardless of how many game_scores
-- rows exist. No pagination needed, ever.
--
-- SHAPE
-- -----
-- Per round in the given tournaments, returns the same GREATEST the client
-- used to compute itself:
--   GREATEST(COALESCE(max(game_scores.updated_at), '-infinity'),
--            COALESCE(game_rounds.updated_at, '-infinity'))
-- i.e. whichever is more recent of "this round's last-scored hole" or "this
-- round's row last touched" (set_game_score only writes game_scores, never
-- bumping game_rounds.updated_at — see feedStore.js's comment on
-- roundActivityTs for why both sources are needed).
--
-- STABLE, SECURITY INVOKER (the default, same as get_game_tournament): the
-- LEFT JOIN below only ever touches rows the caller's own game_rounds/
-- game_scores RLS policies already let them see — no privilege escalation.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_round_activity(p_tournament_ids text[])
RETURNS TABLE(tournament_id text, round_id text, activity_ts timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT
    gr.tournament_id,
    gr.id AS round_id,
    GREATEST(
      COALESCE(s.max_updated_at, '-infinity'::timestamptz),
      COALESCE(gr.updated_at, '-infinity'::timestamptz)
    ) AS activity_ts
  FROM public.game_rounds gr
  LEFT JOIN (
    SELECT tournament_id, round_id, max(updated_at) AS max_updated_at
    FROM public.game_scores
    WHERE tournament_id = ANY(p_tournament_ids)
    GROUP BY tournament_id, round_id
  ) s ON s.tournament_id = gr.tournament_id AND s.round_id = gr.id
  WHERE gr.tournament_id = ANY(p_tournament_ids);
$$;

-- Verify (paste id(s) to spot-check against real data):
--   SELECT * FROM public.get_round_activity(ARRAY['<tournament-id-1>', '<tournament-id-2>']);
