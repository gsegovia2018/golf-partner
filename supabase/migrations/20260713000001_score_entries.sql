-- ============================================================================
-- Sync v2.1 — per-author score entries + resolutions.
-- Spec: docs/superpowers/specs/2026-07-13-score-conflict-sync-v2-design.md
-- Idempotent; safe to re-run. Same conventions as 20260712000000_sync_v2_normalized.sql.
-- ============================================================================

-- 1) Per-author submission layer. One row per (cell, author). strokes NULL = a
-- blank submission (kept so a cleared cell replicates); it never conflicts.
CREATE TABLE IF NOT EXISTS public.game_score_entries (
  tournament_id text NOT NULL,
  round_id      text NOT NULL,
  player_id     text NOT NULL,
  hole          int  NOT NULL,
  author_id     text NOT NULL,               -- entering device's meId / device id
  strokes       int,                          -- NULL = blank submission
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, round_id, player_id, hole, author_id),
  FOREIGN KEY (tournament_id, round_id)
    REFERENCES public.game_rounds (tournament_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS game_score_entries_tournament_idx
  ON public.game_score_entries (tournament_id);

-- 2) Resolution decisions. One row per cell; supersedes derivation while its
-- resolved_at is >= the newest entry for the cell (a later edit re-opens it).
CREATE TABLE IF NOT EXISTS public.game_score_resolutions (
  tournament_id text NOT NULL,
  round_id      text NOT NULL,
  player_id     text NOT NULL,
  hole          int  NOT NULL,
  value         int,                          -- chosen strokes (NULL = "no score")
  resolved_by   text,
  resolved_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, round_id, player_id, hole),
  FOREIGN KEY (tournament_id, round_id)
    REFERENCES public.game_rounds (tournament_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS game_score_resolutions_tournament_idx
  ON public.game_score_resolutions (tournament_id);

-- 3) RLS — delegate to the parent tournament row (same pattern as game_scores).
ALTER TABLE public.game_score_entries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_score_resolutions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS game_score_entries_all ON public.game_score_entries;
CREATE POLICY game_score_entries_all ON public.game_score_entries
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id));

DROP POLICY IF EXISTS game_score_resolutions_all ON public.game_score_resolutions;
CREATE POLICY game_score_resolutions_all ON public.game_score_resolutions
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id));

-- 4) Realtime publication (idempotent per-table sub-blocks).
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.game_score_entries;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.game_score_resolutions;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5) Effective-value recompute helper (shared by submit + resolve). Mirrors
-- store/scoreEntries.js deriveCell: resolution wins while newer than every
-- entry; else 0/1 distinct value = agreed; >=2 = most-recent value.
CREATE OR REPLACE FUNCTION public.recompute_game_score(
  p_tournament_id text, p_round_id text, p_player_id text, p_hole int)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_eff int;
  v_max_ts timestamptz;
  v_res_val int;
  v_res_at timestamptz;
BEGIN
  SELECT max(updated_at) INTO v_max_ts FROM public.game_score_entries
   WHERE tournament_id = p_tournament_id AND round_id = p_round_id
     AND player_id = p_player_id AND hole = p_hole;

  SELECT value, resolved_at INTO v_res_val, v_res_at FROM public.game_score_resolutions
   WHERE tournament_id = p_tournament_id AND round_id = p_round_id
     AND player_id = p_player_id AND hole = p_hole;

  IF v_res_at IS NOT NULL AND v_max_ts IS NOT NULL AND v_res_at >= v_max_ts THEN
    v_eff := v_res_val;
  ELSE
    -- most-recent non-null author value (NULL when every author is blank)
    SELECT strokes INTO v_eff FROM public.game_score_entries
     WHERE tournament_id = p_tournament_id AND round_id = p_round_id
       AND player_id = p_player_id AND hole = p_hole AND strokes IS NOT NULL
     ORDER BY updated_at DESC LIMIT 1;
  END IF;

  INSERT INTO public.game_scores (round_id, tournament_id, player_id, hole, strokes, updated_at)
  VALUES (p_round_id, p_tournament_id, p_player_id, p_hole, v_eff, now())
  ON CONFLICT (tournament_id, round_id, player_id, hole)
  DO UPDATE SET strokes = EXCLUDED.strokes, updated_at = now();
END $$;

-- submit_game_score: upsert one author's submission, recompute the effective
-- value, return the derived state for the caller's optimistic UI.
CREATE OR REPLACE FUNCTION public.submit_game_score(
  p_tournament_id text, p_round_id text, p_player_id text, p_hole int,
  p_author_id text, p_strokes int)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_distinct int;
  v_status text;
  v_eff int;
  v_candidates jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_tournament_id || ':' || p_round_id || ':' || p_player_id || ':' || p_hole::text, 0));

  INSERT INTO public.game_score_entries
    (tournament_id, round_id, player_id, hole, author_id, strokes, updated_at)
  VALUES (p_tournament_id, p_round_id, p_player_id, p_hole, p_author_id, p_strokes, now())
  ON CONFLICT (tournament_id, round_id, player_id, hole, author_id)
  DO UPDATE SET strokes = EXCLUDED.strokes, updated_at = now();

  PERFORM public.recompute_game_score(p_tournament_id, p_round_id, p_player_id, p_hole);

  SELECT count(DISTINCT strokes) INTO v_distinct FROM public.game_score_entries
   WHERE tournament_id = p_tournament_id AND round_id = p_round_id
     AND player_id = p_player_id AND hole = p_hole AND strokes IS NOT NULL;
  SELECT strokes INTO v_eff FROM public.game_scores
   WHERE tournament_id = p_tournament_id AND round_id = p_round_id
     AND player_id = p_player_id AND hole = p_hole;

  v_status := CASE WHEN v_distinct >= 2 THEN 'conflict'
                   WHEN v_distinct = 1 THEN 'agreed' ELSE 'empty' END;

  SELECT COALESCE(jsonb_agg(q.c ORDER BY (q.c->>'ts')::bigint), '[]'::jsonb)
    INTO v_candidates
    FROM (
      SELECT DISTINCT ON (strokes) jsonb_build_object(
               'value', strokes, 'authorId', author_id,
               'ts', (extract(epoch from updated_at) * 1000)::bigint) AS c
        FROM public.game_score_entries
       WHERE tournament_id = p_tournament_id AND round_id = p_round_id
         AND player_id = p_player_id AND hole = p_hole AND strokes IS NOT NULL
       ORDER BY strokes, updated_at DESC
    ) q;

  RETURN jsonb_build_object('status', v_status, 'effective', v_eff, 'candidates', v_candidates);
END $$;

-- resolve_game_score: pin the chosen value; recompute clamps game_scores to it.
CREATE OR REPLACE FUNCTION public.resolve_game_score(
  p_tournament_id text, p_round_id text, p_player_id text, p_hole int,
  p_value int, p_resolver text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_tournament_id || ':' || p_round_id || ':' || p_player_id || ':' || p_hole::text, 0));

  INSERT INTO public.game_score_resolutions
    (tournament_id, round_id, player_id, hole, value, resolved_by, resolved_at)
  VALUES (p_tournament_id, p_round_id, p_player_id, p_hole, p_value, p_resolver, now())
  ON CONFLICT (tournament_id, round_id, player_id, hole)
  DO UPDATE SET value = EXCLUDED.value, resolved_by = EXCLUDED.resolved_by, resolved_at = now();

  PERFORM public.recompute_game_score(p_tournament_id, p_round_id, p_player_id, p_hole);
END $$;

-- 6) Backfill: seed a single 'legacy' author entry from every existing
-- game_scores cell, so historical rounds derive as 'agreed' (no false
-- conflicts). Seed-only-missing + re-run-safe: only inserts for cells with
-- no game_score_entries row yet, so a straggler re-run after real authors
-- have submitted never overwrites or fabricates entries (ON CONFLICT DO NOTHING).
CREATE OR REPLACE FUNCTION public.backfill_game_score_entries(p_id text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.game_score_entries
    (tournament_id, round_id, player_id, hole, author_id, strokes, updated_at)
  SELECT s.tournament_id, s.round_id, s.player_id, s.hole, 'legacy', s.strokes, s.updated_at
    FROM public.game_scores s
   WHERE s.tournament_id = p_id
     AND NOT EXISTS (
       SELECT 1 FROM public.game_score_entries e
        WHERE e.tournament_id = s.tournament_id AND e.round_id = s.round_id
          AND e.player_id = s.player_id AND e.hole = s.hole)
  ON CONFLICT (tournament_id, round_id, player_id, hole, author_id) DO NOTHING;
END $$;
