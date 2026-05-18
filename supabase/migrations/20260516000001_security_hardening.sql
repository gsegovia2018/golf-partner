-- ============================================================================
-- Security hardening.
-- ============================================================================
--
-- Fixes the issues found in the 2026-05-16 security review:
--
--   C-2  tournament-media storage bucket allowed anon insert/delete.
--   C-3  tournament_media table had RLS disabled.
--   H-3  Invite codes never expired, had no usage cap, were enumerable.
--   H-5  Invite codes could not be revoked (no UPDATE/DELETE policy).
--   M-1  are_friends / can_view_tournament_via_friend granted to anon.
--   M-2  can_edit_tournament granted to anon.
--   M-3  profiles_select exposed every profile to every authenticated user.
--   M-4  friendships_update let the requester self-accept their own request.
--
-- The H-2 fix (legacy created_by IS NULL tournaments being world-editable)
-- needs a per-tournament owner decision and is left as a documented MANUAL
-- step at the bottom of this file — it is NOT auto-applied so legacy
-- tournaments don't become uneditable.
--
-- HOW TO RUN
-- ----------
--   Paste into the Supabase SQL editor and Run. Idempotent — safe to re-run.
--   Run the VERIFY block at the bottom afterwards.
-- ============================================================================

-- 1) tournament_media — enable RLS + scope to tournament access ---------------
-- C-3. Mirrors the visibility rules already used for `tournaments`.
ALTER TABLE public.tournament_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS media_select ON public.tournament_media;
DROP POLICY IF EXISTS media_insert ON public.tournament_media;
DROP POLICY IF EXISTS media_update ON public.tournament_media;
DROP POLICY IF EXISTS media_delete ON public.tournament_media;

CREATE POLICY media_select ON public.tournament_media
  FOR SELECT TO authenticated
  USING (
    public.is_tournament_member(tournament_id, auth.uid())
    OR public.is_tournament_owner(tournament_id, auth.uid())
    OR public.can_view_tournament_via_friend(tournament_id, auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.tournaments t
       WHERE t.id = tournament_media.tournament_id AND t.created_by IS NULL
    )
  );

CREATE POLICY media_insert ON public.tournament_media
  FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_tournament(tournament_id, auth.uid()));

CREATE POLICY media_update ON public.tournament_media
  FOR UPDATE TO authenticated
  USING (public.can_edit_tournament(tournament_id, auth.uid()))
  WITH CHECK (public.can_edit_tournament(tournament_id, auth.uid()));

CREATE POLICY media_delete ON public.tournament_media
  FOR DELETE TO authenticated
  USING (public.can_edit_tournament(tournament_id, auth.uid()));

-- 2) tournament-media storage bucket — replace permissive anon policies -------
-- C-2. Anyone on the internet could previously upload/delete any file.
DROP POLICY IF EXISTS "tournament-media anon insert" ON storage.objects;
DROP POLICY IF EXISTS "tournament-media anon delete" ON storage.objects;
DROP POLICY IF EXISTS "tournament-media editor insert" ON storage.objects;
DROP POLICY IF EXISTS "tournament-media editor update" ON storage.objects;
DROP POLICY IF EXISTS "tournament-media editor delete" ON storage.objects;

-- Object key is `<tournament_id>/<round_id>/<uuid>.<ext>`, so foldername[1]
-- is the tournament id. Only an editor of that tournament may write/delete.
CREATE POLICY "tournament-media editor insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'tournament-media'
  AND public.can_edit_tournament((storage.foldername(name))[1], auth.uid())
);

CREATE POLICY "tournament-media editor update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'tournament-media'
  AND public.can_edit_tournament((storage.foldername(name))[1], auth.uid())
);

CREATE POLICY "tournament-media editor delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'tournament-media'
  AND public.can_edit_tournament((storage.foldername(name))[1], auth.uid())
);

-- Cap file size (25 MB) and restrict mime types. The bucket stays public-read
-- because the app builds plain public CDN URLs for media; if private media is
-- ever needed, switch to a private bucket + signed URLs in a follow-up.
UPDATE storage.buckets
   SET file_size_limit = 26214400,
       allowed_mime_types = ARRAY[
         'image/jpeg','image/png','image/webp','image/heic','image/heif',
         'video/mp4','video/quicktime'
       ]
 WHERE id = 'tournament-media';

-- 3) Invite codes — expiry, usage cap, revocation, RPC redemption ------------
-- H-3 / H-5. New columns default to "unlimited / not expiring" so existing
-- codes keep working unchanged.
ALTER TABLE public.tournament_invites
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS max_uses   int,
  ADD COLUMN IF NOT EXISTS uses       int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS revoked    boolean NOT NULL DEFAULT false;

-- Redeem a code WITHOUT exposing the invites table to the joining user.
-- SECURITY DEFINER: validates the code, records membership, bumps the use
-- counter, and returns the tournament. Replaces the old client-side flow
-- where joinTournamentByCode read the invites table directly.
CREATE OR REPLACE FUNCTION public.redeem_invite_code(p_code text)
RETURNS TABLE (tournament_id text, role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

-- Lock down the invites table itself. Reading is no longer needed by joiners
-- (they use the RPC above) — only owners/members may read, and only owners
-- may revoke (UPDATE) or delete codes.
DROP POLICY IF EXISTS invites_select        ON public.tournament_invites;
DROP POLICY IF EXISTS invites_update_owner  ON public.tournament_invites;
DROP POLICY IF EXISTS invites_delete_owner  ON public.tournament_invites;

CREATE POLICY invites_select ON public.tournament_invites
  FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR public.is_tournament_owner(tournament_id, auth.uid())
    OR public.is_tournament_member(tournament_id, auth.uid())
  );

CREATE POLICY invites_update_owner ON public.tournament_invites
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR public.is_tournament_owner(tournament_id, auth.uid()))
  WITH CHECK (created_by = auth.uid() OR public.is_tournament_owner(tournament_id, auth.uid()));

CREATE POLICY invites_delete_owner ON public.tournament_invites
  FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR public.is_tournament_owner(tournament_id, auth.uid()));

-- 4) profiles_select — scope to self / friends / shared tournaments ----------
-- M-3. `USING (true)` leaked every user's profile (and email-derived name).
CREATE OR REPLACE FUNCTION public.shares_tournament(a uuid, b uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    WITH conn AS (
      SELECT id AS tid, created_by AS uid
        FROM public.tournaments WHERE created_by IS NOT NULL
      UNION
      SELECT tournament_id AS tid, user_id AS uid
        FROM public.tournament_members
    )
    SELECT 1 FROM conn c1 JOIN conn c2 ON c1.tid = c2.tid
     WHERE c1.uid = a AND c2.uid = b
  );
$$;
REVOKE EXECUTE ON FUNCTION public.shares_tournament(uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.shares_tournament(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.are_friends(user_id, auth.uid())
    OR public.shares_tournament(user_id, auth.uid())
  );

-- 5) friendships_update — only the addressee may accept --------------------
-- M-4. The old policy let the requester flip their own request to 'accepted'.
-- The requester cancels a pending request via DELETE instead (policy unchanged).
DROP POLICY IF EXISTS friendships_update ON public.friendships;
CREATE POLICY friendships_update ON public.friendships
  FOR UPDATE TO authenticated
  USING (addressee_id = auth.uid())
  WITH CHECK (addressee_id = auth.uid());

-- 6) Revoke anon EXECUTE on the cross-table helper functions -----------------
-- M-1 / M-2. These are only called from RLS policies (which run as the
-- authenticated role); anon never needs them and could otherwise probe the
-- social / membership graph over the RPC endpoint.
REVOKE EXECUTE ON FUNCTION public.are_friends(uuid, uuid)                   FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_view_tournament_via_friend(text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_edit_tournament(text, uuid)           FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_tournament_member(text, uuid)          FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_tournament_owner(text, uuid)           FROM anon;

/* ===========================================================================
   MANUAL STEP — H-2: legacy NULL-owner tournaments are world-editable
   ---------------------------------------------------------------------------
   Any authenticated user can currently UPDATE/overwrite a tournament whose
   created_by IS NULL (and the same gap is inherited by can_edit_tournament,
   media policies, etc.). It cannot be auto-fixed here because the migration
   does not know who owns each legacy row — tightening blindly would make
   those tournaments uneditable.

   To close it, back-fill ownership, then tighten the write policies:

     -- 1. Assign each legacy tournament to its real owner:
     -- UPDATE public.tournaments SET created_by = '<owner-uuid>'
     --  WHERE id = '<tournament-id>';

     -- 2. Once NO rows have created_by IS NULL, drop the NULL allowance:
     -- DROP POLICY IF EXISTS tournaments_update ON public.tournaments;
     -- CREATE POLICY tournaments_update ON public.tournaments
     --   FOR UPDATE TO authenticated
     --   USING (created_by = auth.uid())
     --   WITH CHECK (created_by = auth.uid());
     --
     -- CREATE OR REPLACE FUNCTION public.can_edit_tournament(tid text, uid uuid)
     -- RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
     -- SET search_path = public AS $fn$
     --   SELECT EXISTS (SELECT 1 FROM public.tournaments t
     --                   WHERE t.id = tid AND t.created_by = uid)
     --       OR EXISTS (SELECT 1 FROM public.tournament_members m
     --                   WHERE m.tournament_id = tid AND m.user_id = uid
     --                     AND m.role IN ('owner','editor'));
     -- $fn$;

   Check for remaining legacy rows first:
     SELECT count(*) FROM public.tournaments WHERE created_by IS NULL;
   =========================================================================== */

/* ===========================================================================
   VERIFY
   ---------------------------------------------------------------------------
   -- RLS enabled on tournament_media:
   SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'tournament_media';

   -- Policies present:
   SELECT tablename, policyname, cmd FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('tournament_media','tournament_invites','profiles','friendships')
    ORDER BY tablename, policyname;

   -- Storage policies on the bucket:
   SELECT policyname, cmd FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname LIKE 'tournament-media%';

   -- anon no longer has EXECUTE on the helpers (should return 0 rows):
   SELECT p.proname FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('are_friends','can_edit_tournament','is_tournament_member',
                        'is_tournament_owner','can_view_tournament_via_friend',
                        'shares_tournament')
      AND has_function_privilege('anon', p.oid, 'EXECUTE');
   =========================================================================== */
