-- Delete a league for good (admin only).
--
-- Archive keeps a league read-only; this removes it. Every league table hangs
-- off leagues(id) with ON DELETE CASCADE (members, handicap events, votes and
-- their ballots, cards and their marker tokens, the Final link), so deleting
-- the row is the whole job. The Final's tournament is a normal game and stays.
--
-- Proof photos live in storage under `league-proofs/<league_id>/…`. Postgres
-- must not delete storage objects directly, so the client removes them through
-- the Storage API first; the policy below lets a league admin do that.

CREATE OR REPLACE FUNCTION public.delete_league(p_league uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.league_is_admin(p_league, auth.uid()) THEN
    RAISE EXCEPTION 'Only the league admin can do that.' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.leagues WHERE id = p_league;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_league(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.delete_league(uuid) TO authenticated;

-- Same shape as can_read_league_proof: compare as text so a malformed object
-- name is simply refused instead of failing a uuid cast.
CREATE OR REPLACE FUNCTION public.can_delete_league_proof(p_name text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.league_members m
     WHERE m.league_id::text = split_part(p_name, '/', 1)
       AND m.user_id = auth.uid()
       AND m.role = 'admin'
       AND m.joined_at IS NOT NULL AND m.left_at IS NULL
  );
$$;

REVOKE EXECUTE ON FUNCTION public.can_delete_league_proof(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_delete_league_proof(text) TO authenticated;

DROP POLICY IF EXISTS "league-proofs admin delete" ON storage.objects;
CREATE POLICY "league-proofs admin delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'league-proofs' AND public.can_delete_league_proof(name));
