-- ============================================================================
-- Friendship uniqueness: prevent duplicate/mirror rows from a concurrent
-- "Add friend" race (Task 9, audit-tier3).
-- ============================================================================
--
-- PROBLEM
-- -------
--   friendStore.sendRequest does a check-then-insert with no DB-level
--   guarantee. friendships_pair_uq (requester_id, addressee_id) — added in
--   20260515000000_friends_and_feed.sql — only blocks an exact repeat of the
--   SAME ordered pair. It does NOT stop the mirror case: user A requests B
--   (row: requester=A, addressee=B) while B concurrently requests A (row:
--   requester=B, addressee=A). Those are two different ordered pairs, both
--   allowed today, leaving two rows for one relationship — listFriends /
--   listPendingRequests then show duplicates, or a request stuck "pending"
--   forever on one side while the other side shows accepted-adjacent state.
--
-- FIX
-- ---
--   1. Dedupe any existing mirror/duplicate rows for the same unordered pair
--      FIRST, so the unique index created below can't fail against data
--      that already violates it. For each unordered pair with more than one
--      row, keep exactly one: prefer an 'accepted' row over a 'pending' one
--      (never downgrade an already-mutual friendship), then the earliest
--      created_at, then the lowest id as a final tiebreak.
--   2. Add a UNIQUE index on the canonical unordered pair
--      (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id))
--      so the database itself rejects any further duplicate/mirror insert.
--
-- Idempotent — safe to re-run: the dedupe is a no-op once no unordered-pair
-- duplicates remain, and the index uses IF NOT EXISTS.
--
-- VERIFIED AGAINST LIVE DB (2026-07-15) before applying: friendships had 7
-- rows total, 0 ordered-pair duplicates, 0 unordered-pair duplicates — the
-- dedupe step is a no-op on the current data; included anyway per the task's
-- safety requirement (a live DB that already had mirror rows must not fail
-- to migrate).
-- ============================================================================

-- 1) Dedupe -------------------------------------------------------------------
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id)
      ORDER BY (status = 'accepted') DESC, created_at ASC, id ASC
    ) AS rn
  FROM public.friendships
)
DELETE FROM public.friendships f
USING ranked
WHERE f.id = ranked.id
  AND ranked.rn > 1;

-- 2) Canonical unordered-pair unique index -------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS friendships_unordered_pair_uq
  ON public.friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));

/* ===========================================================================
   HOW TO RUN
   ---------------------------------------------------------------------------
   Paste into the Supabase SQL editor and Run. Idempotent — safe to re-run.

   VERIFY
   ---------------------------------------------------------------------------
   -- No more unordered-pair duplicates:
   SELECT LEAST(requester_id,addressee_id), GREATEST(requester_id,addressee_id), count(*)
     FROM public.friendships GROUP BY 1,2 HAVING count(*) > 1;
   -- (expect 0 rows)

   -- Index present:
   SELECT indexname FROM pg_indexes
    WHERE schemaname='public' AND tablename='friendships'
      AND indexname='friendships_unordered_pair_uq';
   =========================================================================== */
