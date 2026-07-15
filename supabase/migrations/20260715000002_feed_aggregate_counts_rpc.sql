-- ============================================================================
-- Feed reaction/comment counts — server-side aggregate RPCs.
-- Spec: fix/audit-tier4, Task 5 — replaces feedStore.js's
-- loadReactions/loadCommentCounts, which did .in('item_key', keys) against
-- feed_reactions/feed_comments and fetched EVERY matching row, aggregating
-- counts in JS. At scale that transfers every reaction/comment row (not just
-- the counts the UI needs) and risks a PostgREST URL-length limit (HTTP 414)
-- once the key list itself grows large.
--
-- This migration adds two SQL/STABLE RPCs that aggregate server-side, so only
-- the counts (and, for reactions, the caller's own-reaction flag) cross the
-- wire — never the underlying rows:
--
--   get_feed_reaction_summary(p_item_keys text[])
--     -> TABLE(item_key text, emoji text, reaction_count bigint, mine boolean)
--     One row per (item_key, emoji) that has at least one reaction among the
--     given keys. `mine` is true iff the CALLING user (auth.uid()) reacted
--     with that emoji — SECURITY INVOKER (the default for a plain `LANGUAGE
--     sql` function with no explicit SECURITY clause), so auth.uid() reflects
--     the caller's own JWT and feed_reactions' existing RLS
--     (`feed_reactions_select ... TO authenticated USING (true)`) applies
--     exactly as it does to a normal PostgREST .from() read.
--
--   get_feed_comment_counts(p_item_keys text[])
--     -> TABLE(item_key text, comment_count bigint)
--     One row per item_key that has at least one comment among the given
--     keys. Same SECURITY INVOKER / RLS story via feed_comments_select.
--
-- feedStore.js reshapes these into the exact same shapes the screen already
-- consumes:
--   loadReactions      -> { [itemKey]: { counts: { emoji: n }, mine: [emoji] } }
--   loadCommentCounts  -> { [itemKey]: n }
-- An item_key with zero matching rows is simply absent from the result set,
-- matching the old full-row JS aggregation (which only ever created a bucket
-- for a key it saw at least one row for).
--
-- Idempotent: CREATE OR REPLACE. Safe to re-run. Apply via the Supabase
-- Management API (see scripts/sync-v2/db.mjs) or paste into the SQL editor.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_feed_reaction_summary(p_item_keys text[])
RETURNS TABLE(item_key text, emoji text, reaction_count bigint, mine boolean)
LANGUAGE sql STABLE AS $$
  SELECT
    item_key,
    emoji,
    count(*)::bigint AS reaction_count,
    bool_or(user_id = auth.uid()) AS mine
  FROM public.feed_reactions
  WHERE item_key = ANY(p_item_keys)
  GROUP BY item_key, emoji;
$$;

CREATE OR REPLACE FUNCTION public.get_feed_comment_counts(p_item_keys text[])
RETURNS TABLE(item_key text, comment_count bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    item_key,
    count(*)::bigint AS comment_count
  FROM public.feed_comments
  WHERE item_key = ANY(p_item_keys)
  GROUP BY item_key;
$$;

-- Both RLS-backed tables restrict SELECT to `TO authenticated`, so an anon
-- caller reads zero rows regardless of function grants — explicit grants
-- below just document that and match this repo's convention for read RPCs
-- (see get_round_activity / is_tournament_member).
GRANT EXECUTE ON FUNCTION public.get_feed_reaction_summary(text[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_feed_comment_counts(text[])   TO anon, authenticated;

/* =========================================================================
   VERIFY
   -------
   SELECT * FROM public.get_feed_reaction_summary(ARRAY['<item-key-1>']);
   SELECT * FROM public.get_feed_comment_counts(ARRAY['<item-key-1>']);
   ========================================================================= */
