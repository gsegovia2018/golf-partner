-- ============================================================================
-- Feed comments.
-- ============================================================================
--
-- WHAT IT ADDS
-- ------------
--   feed_comments → text comments on feed items (a round or a photo reel),
--   keyed by the stable client-side feed item key (text). The feed is derived
--   client-side (no server feed table), so comments reference the item key
--   rather than a foreign row — exactly like feed_reactions.
--
-- RLS
-- ---
--   - select : any authenticated user may read comments.
--   - insert : a user may only create comments as themselves.
--   - update/delete : a user may only modify/remove their own comments.
--
-- GRACEFUL DEGRADATION
-- --------------------
--   The client (feedStore.js) treats a missing feed_comments table as
--   "no data" and never crashes — so the app keeps working before this
--   migration is applied.
--
-- HOW TO RUN
-- ----------
--   Paste into the Supabase SQL editor and Run. Idempotent — safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.feed_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_key    text NOT NULL,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body        text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 500),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Thread reads filter by item_key and order by created_at — index both.
CREATE INDEX IF NOT EXISTS feed_comments_item_idx
  ON public.feed_comments (item_key, created_at);
CREATE INDEX IF NOT EXISTS feed_comments_user_idx
  ON public.feed_comments (user_id);

ALTER TABLE public.feed_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS feed_comments_select ON public.feed_comments;
DROP POLICY IF EXISTS feed_comments_insert ON public.feed_comments;
DROP POLICY IF EXISTS feed_comments_update ON public.feed_comments;
DROP POLICY IF EXISTS feed_comments_delete ON public.feed_comments;

-- Comments are public to authenticated users: the feed shows a thread and a
-- comment count per item.
CREATE POLICY feed_comments_select ON public.feed_comments
  FOR SELECT TO authenticated
  USING (true);

-- A user may only create/update/delete their own comments.
CREATE POLICY feed_comments_insert ON public.feed_comments
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY feed_comments_update ON public.feed_comments
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY feed_comments_delete ON public.feed_comments
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

/* =========================================================================
   VERIFY
   -------
   SELECT count(*) FROM public.feed_comments;
   SELECT tablename, policyname, cmd FROM pg_policies
     WHERE schemaname='public' AND tablename='feed_comments'
     ORDER BY policyname;
   ========================================================================= */
