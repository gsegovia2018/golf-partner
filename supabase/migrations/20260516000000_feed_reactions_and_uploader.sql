-- ============================================================================
-- Feed reactions + media uploader attribution.
-- ============================================================================
--
-- WHAT IT ADDS
-- ------------
--   1. feed_reactions          → emoji reactions on feed items, keyed by the
--                                stable client-side feed item key (text). The
--                                feed is derived client-side (no server feed
--                                table), so reactions reference the item key
--                                rather than a foreign row.
--   2. tournament_media.uploader_id
--                              → the uploader's auth user id, so photos can be
--                                attributed by identity instead of a fragile
--                                case-folded display-name string match. The
--                                legacy uploader_label column is kept for media
--                                uploaded before this column existed.
--   3. RLS:
--      - feed_reactions: any authenticated user may read reactions; a user may
--        only insert/update/delete their own reaction rows.
--
-- GRACEFUL DEGRADATION
-- --------------------
--   The client (feedStore.js) treats a missing feed_reactions table / missing
--   uploader_id column as "no data" and never crashes — so the app keeps
--   working before this migration is applied.
--
-- HOW TO RUN
-- ----------
--   Paste into the Supabase SQL editor and Run. Idempotent — safe to re-run.
-- ============================================================================

-- 1) feed_reactions ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.feed_reactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_key    text NOT NULL,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji       text NOT NULL CHECK (char_length(emoji) BETWEEN 1 AND 16),
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- One reaction row per (user, item, emoji): tapping the same emoji twice
  -- toggles it off rather than stacking duplicates.
  CONSTRAINT feed_reactions_uq UNIQUE (item_key, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS feed_reactions_item_idx ON public.feed_reactions (item_key);
CREATE INDEX IF NOT EXISTS feed_reactions_user_idx ON public.feed_reactions (user_id);

ALTER TABLE public.feed_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS feed_reactions_select ON public.feed_reactions;
DROP POLICY IF EXISTS feed_reactions_insert ON public.feed_reactions;
DROP POLICY IF EXISTS feed_reactions_update ON public.feed_reactions;
DROP POLICY IF EXISTS feed_reactions_delete ON public.feed_reactions;

-- Reactions are public to authenticated users: the feed shows aggregate
-- counts and whether the current user has reacted.
CREATE POLICY feed_reactions_select ON public.feed_reactions
  FOR SELECT TO authenticated
  USING (true);

-- A user may only create/update/delete their own reactions.
CREATE POLICY feed_reactions_insert ON public.feed_reactions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY feed_reactions_update ON public.feed_reactions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY feed_reactions_delete ON public.feed_reactions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- 2) tournament_media.uploader_id -------------------------------------------
ALTER TABLE public.tournament_media
  ADD COLUMN IF NOT EXISTS uploader_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS tournament_media_uploader_idx
  ON public.tournament_media (uploader_id);

/* =========================================================================
   VERIFY
   -------
   SELECT count(*) FROM public.feed_reactions;
   SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='tournament_media'
       AND column_name='uploader_id';
   SELECT tablename, policyname, cmd FROM pg_policies
     WHERE schemaname='public' AND tablename='feed_reactions'
     ORDER BY policyname;
   ========================================================================= */
