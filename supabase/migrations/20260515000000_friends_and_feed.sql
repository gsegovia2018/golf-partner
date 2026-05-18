-- ============================================================================
-- Friends + activity feed.
-- ============================================================================
--
-- WHAT IT ADDS
-- ------------
--   1. friendships             → mutual request/accept friendship graph
--   2. tournament_participants → flat index of (tournament_id, user_id) for
--                                every user-linked embedded player. Lets the
--                                feed find tournaments a friend played in
--                                without the current user being a member.
--   3. RLS:
--      - friendships: a user sees / manages only rows they're part of.
--      - tournament_participants: a user sees rows for themselves, their
--        friends, or tournaments they own.
--      - tournaments_select is extended so a user can READ a tournament when
--        they are friends with any of its participants (powers feed drill-in).
--
-- All cross-table checks go through SECURITY DEFINER functions so RLS does
-- not recurse (same technique as 20260419_rls_no_recursion.sql).
--
-- HOW TO RUN
-- ----------
--   Paste into the Supabase SQL editor and Run. Idempotent — safe to re-run.
-- ============================================================================

-- 1) friendships -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.friendships (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  addressee_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  responded_at  timestamptz,
  CONSTRAINT friendships_distinct CHECK (requester_id <> addressee_id),
  CONSTRAINT friendships_pair_uq  UNIQUE (requester_id, addressee_id)
);

CREATE INDEX IF NOT EXISTS friendships_requester_idx ON public.friendships (requester_id);
CREATE INDEX IF NOT EXISTS friendships_addressee_idx ON public.friendships (addressee_id);

ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS friendships_select ON public.friendships;
DROP POLICY IF EXISTS friendships_insert ON public.friendships;
DROP POLICY IF EXISTS friendships_update ON public.friendships;
DROP POLICY IF EXISTS friendships_delete ON public.friendships;

CREATE POLICY friendships_select ON public.friendships
  FOR SELECT TO authenticated
  USING (requester_id = auth.uid() OR addressee_id = auth.uid());

-- Only the requester creates the row, and only as themselves.
CREATE POLICY friendships_insert ON public.friendships
  FOR INSERT TO authenticated
  WITH CHECK (requester_id = auth.uid());

-- Addressee accepts/declines; requester may cancel. Either side can touch it.
CREATE POLICY friendships_update ON public.friendships
  FOR UPDATE TO authenticated
  USING (requester_id = auth.uid() OR addressee_id = auth.uid())
  WITH CHECK (requester_id = auth.uid() OR addressee_id = auth.uid());

CREATE POLICY friendships_delete ON public.friendships
  FOR DELETE TO authenticated
  USING (requester_id = auth.uid() OR addressee_id = auth.uid());

-- Are two users accepted friends? SECURITY DEFINER so policies calling it
-- don't re-enter friendships' own RLS.
CREATE OR REPLACE FUNCTION public.are_friends(a uuid, b uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.friendships f
     WHERE f.status = 'accepted'
       AND ((f.requester_id = a AND f.addressee_id = b)
         OR (f.requester_id = b AND f.addressee_id = a))
  );
$$;
GRANT EXECUTE ON FUNCTION public.are_friends(uuid, uuid) TO anon, authenticated;

-- 2) tournament_participants -------------------------------------------------
-- tournament_id type follows tournaments.id (text in this project).
DO $$
DECLARE
  id_type text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
    INTO id_type
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'tournaments'
     AND a.attname = 'id'
     AND a.attnum > 0;

  IF id_type IS NULL THEN
    RAISE EXCEPTION 'public.tournaments.id not found';
  END IF;

  EXECUTE format($f$
    CREATE TABLE IF NOT EXISTS public.tournament_participants (
      tournament_id %s NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
      user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      created_at    timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tournament_id, user_id)
    )
  $f$, id_type);
END $$;

CREATE INDEX IF NOT EXISTS tournament_participants_user_idx
  ON public.tournament_participants (user_id);

ALTER TABLE public.tournament_participants ENABLE ROW LEVEL SECURITY;

-- Can the current user edit (and therefore index participants for) a
-- tournament? Owner, legacy NULL-owner, or an editor/owner member.
CREATE OR REPLACE FUNCTION public.can_edit_tournament(tid text, uid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tournaments t
     WHERE t.id = tid AND (t.created_by = uid OR t.created_by IS NULL)
  ) OR EXISTS (
    SELECT 1 FROM public.tournament_members m
     WHERE m.tournament_id = tid
       AND m.user_id = uid
       AND m.role IN ('owner', 'editor')
  );
$$;
GRANT EXECUTE ON FUNCTION public.can_edit_tournament(text, uuid) TO anon, authenticated;

DROP POLICY IF EXISTS participants_select ON public.tournament_participants;
DROP POLICY IF EXISTS participants_write  ON public.tournament_participants;

-- A user sees a participant row if it's them, a friend of theirs (so the
-- feed can discover friends' tournaments), or a tournament they can edit.
CREATE POLICY participants_select ON public.tournament_participants
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.are_friends(user_id, auth.uid())
    OR public.can_edit_tournament(tournament_id, auth.uid())
  );

-- Only an editor of the tournament maintains the index.
CREATE POLICY participants_write ON public.tournament_participants
  FOR ALL TO authenticated
  USING (public.can_edit_tournament(tournament_id, auth.uid()))
  WITH CHECK (public.can_edit_tournament(tournament_id, auth.uid()));

-- 3) Extend tournament read access to friends-of-participants ----------------
CREATE OR REPLACE FUNCTION public.can_view_tournament_via_friend(tid text, uid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tournament_participants tp
     WHERE tp.tournament_id = tid
       AND public.are_friends(tp.user_id, uid)
  );
$$;
GRANT EXECUTE ON FUNCTION public.can_view_tournament_via_friend(text, uuid) TO anon, authenticated;

DROP POLICY IF EXISTS tournaments_select ON public.tournaments;
CREATE POLICY tournaments_select ON public.tournaments
  FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR created_by IS NULL
    OR public.is_tournament_member(id, auth.uid())
    OR public.can_view_tournament_via_friend(id, auth.uid())
  );

-- 4) Backfill the participant index from existing tournament blobs -----------
INSERT INTO public.tournament_participants (tournament_id, user_id)
SELECT t.id, (p->>'user_id')::uuid
  FROM public.tournaments t,
       LATERAL jsonb_array_elements(COALESCE(t.data->'players', '[]'::jsonb)) AS p
 WHERE p->>'user_id' IS NOT NULL
   AND p->>'user_id' <> ''
ON CONFLICT DO NOTHING;

/* =========================================================================
   VERIFY
   -------
   SELECT count(*) FROM public.tournament_participants;
   SELECT tablename, policyname, cmd FROM pg_policies
     WHERE schemaname='public'
       AND tablename IN ('friendships','tournament_participants','tournaments')
     ORDER BY tablename, policyname;
   ========================================================================= */
