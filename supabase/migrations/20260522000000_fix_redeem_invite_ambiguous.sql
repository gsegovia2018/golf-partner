-- ============================================================================
-- Fix: redeem_invite_code — "column reference \"tournament_id\" is ambiguous".
-- ============================================================================
--
-- HOW TO RUN
-- ----------
--   Paste into the Supabase SQL editor and Run. Idempotent — safe to re-run.
--   Supersedes the redeem_invite_code body from
--   20260516000001_security_hardening.sql.
--
-- WHAT IT FIXES
-- -------------
--   redeem_invite_code is declared `RETURNS TABLE (tournament_id text,
--   role text)`. In a PL/pgSQL function the columns of a RETURNS TABLE clause
--   become output VARIABLES in the function namespace. With PostgreSQL's
--   default `plpgsql.variable_conflict = error`, the body's
--
--       INSERT INTO public.tournament_members (tournament_id, user_id, role)
--       ... ON CONFLICT (tournament_id, user_id) ...
--
--   references the bare name `tournament_id`, which now collides with the
--   output variable of the same name — so every redemption raised
--   `column reference "tournament_id" is ambiguous` and the join failed.
--
--   The `#variable_conflict use_column` pragma resolves any ambiguous name to
--   the table column. Safe here: every reference that needs a variable is
--   already qualified (v_invite.tournament_id, v_uid, v_invite.id), and the
--   output columns are only ever written positionally by RETURN QUERY. The
--   function's result shape is unchanged, so no client change is required.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.redeem_invite_code(p_code text)
RETURNS TABLE (tournament_id text, role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid    uuid := auth.uid();
  v_invite public.tournament_invites%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Must be signed in to join';
  END IF;

  SELECT * INTO v_invite
    FROM public.tournament_invites
   WHERE code = upper(btrim(p_code))
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid code';
  END IF;
  IF v_invite.revoked THEN
    RAISE EXCEPTION 'This invite code has been revoked';
  END IF;
  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at < now() THEN
    RAISE EXCEPTION 'This invite code has expired';
  END IF;
  IF v_invite.max_uses IS NOT NULL AND v_invite.uses >= v_invite.max_uses THEN
    RAISE EXCEPTION 'This invite code has reached its usage limit';
  END IF;

  INSERT INTO public.tournament_members (tournament_id, user_id, role)
  VALUES (v_invite.tournament_id, v_uid, COALESCE(v_invite.role, 'editor'))
  ON CONFLICT (tournament_id, user_id)
    DO UPDATE SET role = EXCLUDED.role;

  UPDATE public.tournament_invites
     SET uses = uses + 1
   WHERE id = v_invite.id;

  RETURN QUERY SELECT v_invite.tournament_id::text,
                      COALESCE(v_invite.role, 'editor')::text;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.redeem_invite_code(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.redeem_invite_code(text) TO authenticated;

/* ===========================================================================
   VERIFY
   ---------------------------------------------------------------------------
   -- Pragma is present in the function body (returns 1 row):
   SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'redeem_invite_code'
      AND pg_get_functiondef(p.oid) ILIKE '%variable_conflict use_column%';

   -- Still authenticated-only:
   SELECT has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_ok,
          has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_ok
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'redeem_invite_code';

   -- End-to-end: signed in as a normal user, redeeming a valid code now
   -- returns (tournament_id, role) instead of raising the ambiguous error.
   =========================================================================== */
