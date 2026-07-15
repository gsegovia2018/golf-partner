-- ============================================================================
-- Audit follow-ups: scope feed social tables + close the null-owner tournament
-- latent hole. Both verified safe against live prod data 2026-07-15.
-- ============================================================================
--
-- CONTEXT
-- -------
-- Follows 20260715000003 (dropped the legacy allow-all policies). Two residual
-- findings from the same security audit:
--
-- (A) feed_reactions / feed_comments were `SELECT ... USING (true)` for any
--     authenticated user and INSERT only checked `user_id = auth.uid()`, with
--     NO tournament/friendship scoping — so any signed-in user could read and
--     post reactions/comments against ANY round in the system, bypassing the
--     friend/membership scoping enforced everywhere else.
--
-- (B) tournaments_select / tournaments_insert carried a `created_by IS NULL`
--     branch (a legacy allowance for pre-ownership rows). It let anyone INSERT a
--     null-owner tournament that was then world-visible/editable, and exposed
--     any such row to everyone. Live prod has 0 null-owner tournaments (all 33
--     are owned), and the app always stamps created_by = auth.uid() on create
--     (tournamentRepo.js:271), so this branch matches no legitimate row.
--
-- FEED KEY SHAPE: every item_key is `<type>:<tournamentId>:<roundId>`
-- (round:/photos:/story:), so `split_part(item_key, ':', 2)` is the tournament
-- id. Scoping reuses the tournaments RLS via an EXISTS subquery: a feed row is
-- visible/insertable only if the caller can see its tournament under the
-- (already-correct) tournaments_select policy. Verified live: all feed keys map
-- to segment-2 tournament ids.
--
-- Idempotent (drop-if-exists then create). Safe to re-run.
-- ============================================================================

-- (A) Scope feed_reactions / feed_comments to tournament visibility ----------
-- Reads: only rows whose tournament the caller can see (delegates to
-- tournaments_select RLS via EXISTS). Writes: own row AND a visible tournament.
-- Update/Delete stay own-row (user_id = auth.uid()) — unchanged.

DROP POLICY IF EXISTS feed_reactions_select ON public.feed_reactions;
CREATE POLICY feed_reactions_select ON public.feed_reactions
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tournaments t
     WHERE t.id = split_part(item_key, ':', 2)
  ));

DROP POLICY IF EXISTS feed_reactions_insert ON public.feed_reactions;
CREATE POLICY feed_reactions_insert ON public.feed_reactions
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tournaments t
       WHERE t.id = split_part(item_key, ':', 2)
    )
  );

DROP POLICY IF EXISTS feed_comments_select ON public.feed_comments;
CREATE POLICY feed_comments_select ON public.feed_comments
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tournaments t
     WHERE t.id = split_part(item_key, ':', 2)
  ));

DROP POLICY IF EXISTS feed_comments_insert ON public.feed_comments;
CREATE POLICY feed_comments_insert ON public.feed_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tournaments t
       WHERE t.id = split_part(item_key, ':', 2)
    )
  );

-- (B) Remove the null-owner branch from the tournaments policies -------------
-- Keeps every other visibility/edit path identical; only drops `created_by IS
-- NULL`. Safe: 0 null-owner rows live, app always stamps created_by.

DROP POLICY IF EXISTS tournaments_select ON public.tournaments;
CREATE POLICY tournaments_select ON public.tournaments
  FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR is_tournament_member(id, auth.uid())
    OR can_view_tournament_via_friend(id, auth.uid())
  );

DROP POLICY IF EXISTS tournaments_insert ON public.tournaments;
CREATE POLICY tournaments_insert ON public.tournaments
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

/* =========================================================================
   VERIFY (run after applying)
   ---------------------------
   -- Feed policies now carry the EXISTS-tournament predicate:
   SELECT c.relname, p.polname,
          pg_get_expr(p.polqual, p.polrelid)      AS using_expr,
          pg_get_expr(p.polwithcheck, p.polrelid) AS check_expr
     FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    WHERE c.relname IN ('feed_reactions','feed_comments') ORDER BY 1,2;

   -- tournaments no longer references created_by IS NULL:
   SELECT p.polname, pg_get_expr(p.polqual, p.polrelid),
          pg_get_expr(p.polwithcheck, p.polrelid)
     FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    WHERE c.relname='tournaments' ORDER BY 1;

   -- Simulated: an owner sees their tournament's reactions; an unrelated user
   -- sees none. (Run with set local role authenticated + request.jwt.claims.)
   ========================================================================= */
