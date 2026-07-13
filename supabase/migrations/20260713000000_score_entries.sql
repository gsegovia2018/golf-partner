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
