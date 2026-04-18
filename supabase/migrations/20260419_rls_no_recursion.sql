-- ============================================================================
-- Break RLS cross-reference recursion between tournaments / tournament_members.
-- ============================================================================
--
-- Problem
-- -------
-- `tournaments_select.USING` checks membership via EXISTS on
-- tournament_members; `members_select.USING` checks ownership via EXISTS on
-- tournaments. Each subquery re-enters the other table's RLS and Postgres
-- errors out with `42P17: infinite recursion detected in policy`.
--
-- Trigger: any DELETE on tournaments cascades to tournament_members, whose
-- policy then reads tournaments under RLS, and so on. INSERTs succeed (no
-- USING clause) but the immediate follow-up SELECT / refresh blows up and
-- the UI sees the error, not the newly-created row.
--
-- Fix
-- ---
-- Move the cross-table checks into SECURITY DEFINER functions. The function
-- body bypasses the caller's RLS, so the cycle is cut: `tournaments_select`
-- no longer re-enters `tournament_members` policies (and vice versa).

CREATE OR REPLACE FUNCTION public.is_tournament_member(tid text, uid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tournament_members
     WHERE tournament_id = tid AND user_id = uid
  );
$$;

CREATE OR REPLACE FUNCTION public.is_tournament_owner(tid text, uid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tournaments
     WHERE id = tid AND created_by = uid
  );
$$;

-- Execute permission for both anon and authenticated (policies call these
-- as the current role, but the body runs as owner because of SECURITY DEFINER).
GRANT EXECUTE ON FUNCTION public.is_tournament_member(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_tournament_owner(text, uuid)  TO anon, authenticated;

-- Rewrite the two policies with non-recursive bodies.

DROP POLICY IF EXISTS tournaments_select   ON public.tournaments;
DROP POLICY IF EXISTS members_select       ON public.tournament_members;
DROP POLICY IF EXISTS members_delete_self  ON public.tournament_members;

CREATE POLICY tournaments_select ON public.tournaments
  FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR created_by IS NULL
    OR public.is_tournament_member(id, auth.uid())
  );

CREATE POLICY members_select ON public.tournament_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_tournament_owner(tournament_id, auth.uid())
  );

CREATE POLICY members_delete_self ON public.tournament_members
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_tournament_owner(tournament_id, auth.uid())
  );

/* VERIFY
   -- Should now succeed (was the failing case before the fix):
   DO $$
   DECLARE v_uid uuid := '<some auth.users.id>';
   BEGIN
     PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
     SET LOCAL ROLE authenticated;
     INSERT INTO public.tournaments (id, name, created_at, data, created_by)
       VALUES ('rls_test_001', 'test', now(), '{}'::jsonb, v_uid);
     DELETE FROM public.tournaments WHERE id = 'rls_test_001';
   END $$;
*/
