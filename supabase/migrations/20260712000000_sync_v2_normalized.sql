-- ============================================================================
-- Sync v2 (normalized schema) — tables, RLS, realtime publication.
-- Spec: docs/superpowers/specs/2026-07-11-sync-v2-normalized-schema-design.md
-- Safe to re-run (every statement idempotent). Apply in the Supabase SQL editor.
-- ============================================================================
--
-- WHAT IT ADDS
-- ------------
--   1. tournaments.props / tournaments.current_round
--                              → new columns on the existing casual-tournament
--                                row, used by the sync-v2 client as the new
--                                home for tournament-level metadata that used
--                                to live only in the JSONB blob.
--   2. game_players, game_rounds, game_scores, game_shot_details,
--      game_round_notes       → normalized per-row storage for casual
--                                tournaments (mirrors what the JSONB blob
--                                held, split into columns for realtime +
--                                fine-grained sync). Named `game_*` (not
--                                `tournament_*`) to avoid colliding with the
--                                pre-existing official-tournament tables
--                                (tournament_roster/rounds/parties/... — see
--                                docs/superpowers/plans/sync-v2-schema-facts.md).
--   3. RLS on all five new tables, delegating to the parent tournament row's
--      own RLS via an invoker-context EXISTS subquery (same pattern as
--      tournament_media's policies): a row here is visible/writable exactly
--      when the caller can already see the matching public.tournaments row.
--   4. Realtime publication for the five new tables plus public.tournaments,
--      so clients get live updates without polling.
--
-- NOTE ON tournaments RLS drift (see schema-facts doc, decision #3): the live
-- `tournaments` table currently carries a stray permissive `allow_all`
-- policy (PERMISSIVE, {public}, USING true), which makes the EXISTS
-- delegation below pass for any row regardless of the named
-- tournaments_select/insert/update/delete policies. That is a pre-existing
-- production gap, out of scope for this migration — once `allow_all` is
-- dropped, these game_* policies start enforcing real ownership/membership
-- automatically, with no further change needed here.
--
-- HOW TO RUN
-- ----------
--   Paste into the Supabase SQL editor and Run. Idempotent — safe to re-run.
-- ============================================================================

-- 1) Tournament-level columns for sync-v2 -----------------------------------
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS props jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS current_round int;

-- 2) Normalized per-tournament tables ----------------------------------------

-- One row per player entered in a tournament. pos preserves the original
-- players[] array order; body carries the whole player object as jsonb.
CREATE TABLE IF NOT EXISTS public.game_players (
  tournament_id text NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  player_id     text NOT NULL,
  user_id       uuid,
  pos           int NOT NULL DEFAULT 0,          -- preserves players[] order
  body          jsonb NOT NULL DEFAULT '{}'::jsonb, -- the whole player object
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, player_id)
);

-- One row per round. body carries the round object minus its
-- scores/shotDetails/notes (those are split into their own tables below).
CREATE TABLE IF NOT EXISTS public.game_rounds (
  id            text PRIMARY KEY,
  tournament_id text NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  round_index   int NOT NULL,
  body          jsonb NOT NULL DEFAULT '{}'::jsonb, -- round minus scores/shotDetails/notes
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS game_rounds_tournament_idx ON public.game_rounds (tournament_id);

-- Per-hole strokes for a player in a round. strokes = NULL is a tombstone
-- (a cleared cell), not a missing row — kept so deletes replicate correctly.
CREATE TABLE IF NOT EXISTS public.game_scores (
  round_id      text NOT NULL REFERENCES public.game_rounds(id) ON DELETE CASCADE,
  tournament_id text NOT NULL,
  player_id     text NOT NULL,
  hole          int  NOT NULL,
  strokes       int,                                -- NULL = cleared (tombstone)
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid,
  PRIMARY KEY (round_id, player_id, hole)
);
CREATE INDEX IF NOT EXISTS game_scores_tournament_idx ON public.game_scores (tournament_id);

-- Per-hole shot detail (club, result, etc.) for a player in a round.
CREATE TABLE IF NOT EXISTS public.game_shot_details (
  round_id      text NOT NULL REFERENCES public.game_rounds(id) ON DELETE CASCADE,
  tournament_id text NOT NULL,
  player_id     text NOT NULL,
  hole          int  NOT NULL,
  detail        jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, player_id, hole)
);
CREATE INDEX IF NOT EXISTS game_shot_details_tournament_idx ON public.game_shot_details (tournament_id);

-- Free-text notes for a round, keyed by 'round' (the whole round) or a hole
-- number '1'..'18'.
CREATE TABLE IF NOT EXISTS public.game_round_notes (
  round_id      text NOT NULL REFERENCES public.game_rounds(id) ON DELETE CASCADE,
  tournament_id text NOT NULL,
  hole_key      text NOT NULL,                      -- 'round' or '1'..'18'
  note          text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, hole_key)
);
CREATE INDEX IF NOT EXISTS game_round_notes_tournament_idx ON public.game_round_notes (tournament_id);

-- 3) Row-level security -------------------------------------------------------
-- Every game_* row belongs to exactly one tournament (directly or via
-- round_id → game_rounds.tournament_id). Rather than re-deriving the owner/
-- member/friend rules here, each policy delegates to the tournaments table's
-- own RLS: the EXISTS subquery below only matches rows the caller can already
-- see under public.tournaments' SELECT policy (invoker-context, same pattern
-- tournament_media uses). No SECURITY DEFINER involved.
ALTER TABLE public.game_players      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_rounds       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_scores       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_shot_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_round_notes  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS game_players_all ON public.game_players;
CREATE POLICY game_players_all ON public.game_players
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id));

DROP POLICY IF EXISTS game_rounds_all ON public.game_rounds;
CREATE POLICY game_rounds_all ON public.game_rounds
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id));

DROP POLICY IF EXISTS game_scores_all ON public.game_scores;
CREATE POLICY game_scores_all ON public.game_scores
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id));

DROP POLICY IF EXISTS game_shot_details_all ON public.game_shot_details;
CREATE POLICY game_shot_details_all ON public.game_shot_details
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id));

DROP POLICY IF EXISTS game_round_notes_all ON public.game_round_notes;
CREATE POLICY game_round_notes_all ON public.game_round_notes
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id));

-- 4) Realtime publication ------------------------------------------------------
-- Idempotent: each ADD TABLE gets its own BEGIN/EXCEPTION sub-block so that
-- one table already being a publication member (duplicate_object) does not
-- abort the rest — a single shared DO block would stop at the first failure.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.game_scores;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.game_shot_details;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.game_round_notes;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.game_rounds;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.game_players;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.tournaments;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

/* ===========================================================================
   VERIFY
   ---------------------------------------------------------------------------
   -- New tournaments columns present:
   SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='tournaments'
      AND column_name IN ('props','current_round');

   -- All five tables exist:
   SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name LIKE 'game_%'
    ORDER BY table_name;

   -- RLS enabled on all five:
   SELECT relname, relrowsecurity FROM pg_class WHERE relname LIKE 'game_%';

   -- Policies present:
   SELECT tablename, policyname, cmd FROM pg_policies
    WHERE schemaname='public' AND tablename LIKE 'game_%'
    ORDER BY tablename, policyname;

   -- Realtime publication membership:
   SELECT schemaname, tablename FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND (tablename LIKE 'game_%' OR tablename = 'tournaments')
    ORDER BY tablename;
   =========================================================================== */
