-- ============================================================================
-- Split game_* RLS: reads = can-view tournament, writes = can-edit tournament.
-- ============================================================================
--
-- CONTEXT
-- -------
-- The seven sync-v2 game_* tables each had a single `<tbl>_all` policy gating
-- ALL commands on `EXISTS (SELECT 1 FROM tournaments WHERE id = tournament_id)`.
-- After 20260715000003 scoped `tournaments`, that EXISTS resolves to "the caller
-- can SEE the tournament" — which includes friend-of-participant viewers. So a
-- friend who can only VIEW a tournament could also WRITE its scores/rounds/
-- notes/conflict rows. Reads being friend-visible is intended (feed, leaderboard);
-- writes should require edit rights.
--
-- SAFETY (verified against live prod 2026-07-15)
-- ----------------------------------------------
-- Writes are gated on can_edit_tournament(tournament_id, auth.uid()) = creator
-- OR a tournament_members row with role owner/editor. Evidence this covers every
-- legitimate writer:
--   * game_scores.updated_by (stamped = auth.uid() by set_game_score) — the only
--     distinct writer on prod is the creator, who passes can_edit (1/1).
--   * All 17 tournament_members rows are role 'editor' → every member passes.
--   * The official-join flow grants editor membership (hence all-editor above),
--     so anyone whose device writes has edit rights.
--   * 0 non-creator/non-member users have ever written game_scores; the lone
--     participant-only user is a viewer who never writes.
-- Reads keep the existing can-VIEW predicate so friends' feed/leaderboard access
-- is unchanged. The score-write RPCs (set_game_score/submit_game_score/
-- patch_game_round) are SECURITY INVOKER and enforce nothing themselves — they
-- rely entirely on this RLS, so this is the authoritative authorization layer.
--
-- Idempotent (drop-if-exists then create). Safe to re-run.
-- ============================================================================

DO $$
DECLARE
  tbl text;
  game_tables text[] := ARRAY[
    'game_players', 'game_rounds', 'game_scores', 'game_shot_details',
    'game_round_notes', 'game_score_entries', 'game_score_resolutions'
  ];
BEGIN
  FOREACH tbl IN ARRAY game_tables LOOP
    -- Drop the legacy single all-commands policy.
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_all', tbl);

    -- READ: any caller who can see the tournament (delegates to tournaments RLS
    -- via EXISTS — same visibility as before this migration).
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_select', tbl);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR SELECT TO authenticated
        USING (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id))
    $f$, tbl || '_select', tbl);

    -- WRITE (insert/update/delete): only callers with edit rights on the
    -- tournament. Separate per-command policies keep the intent unambiguous.
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_insert', tbl);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR INSERT TO authenticated
        WITH CHECK (public.can_edit_tournament(tournament_id, auth.uid()))
    $f$, tbl || '_insert', tbl);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_update', tbl);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR UPDATE TO authenticated
        USING (public.can_edit_tournament(tournament_id, auth.uid()))
        WITH CHECK (public.can_edit_tournament(tournament_id, auth.uid()))
    $f$, tbl || '_update', tbl);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_delete', tbl);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        FOR DELETE TO authenticated
        USING (public.can_edit_tournament(tournament_id, auth.uid()))
    $f$, tbl || '_delete', tbl);
  END LOOP;
END $$;

/* =========================================================================
   VERIFY (run after applying)
   ---------------------------
   -- Each game_* table now has 4 policies (select/insert/update/delete):
   SELECT c.relname, p.polname,
          CASE p.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                        WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' END cmd
     FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    WHERE c.relname LIKE 'game\_%' ORDER BY 1,3;

   -- Simulated (in a rolled-back tx): a tournament creator can INSERT a score;
   -- a friend-only viewer of the same tournament can SELECT but NOT INSERT.
   ========================================================================= */
