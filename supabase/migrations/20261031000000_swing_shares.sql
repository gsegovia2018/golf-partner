-- ============================================================================
-- Swing sharing: a golfer shares one analysed swing as a link (/s/<token>) that
-- anyone can open signed out, with a way to create an account from there.
-- Plan: docs/superpowers/plans/2026-10-31-swing-share.md. Idempotent; safe to re-run.
-- ============================================================================
--
-- THE LINK
-- --------
--   swing_shares.token   32 url-safe chars from 24 random bytes. One per
--                        (owner, swing_id): sharing the same swing again
--                        re-uses its link and replaces its files.
--   swing_id             the phone's local swing id (swingStore); swings
--                        themselves never live in the database.
--   status               'uploading' until the owner's files are all up,
--                        then 'ready'. Only a ready link shows anything.
--
-- FILES (bucket swing-shares, public read by exact path, no listing)
-- -----
--   <token>/video.mp4         the clip as recorded
--   <token>/share.json        { v, analysis, pose (checkpoint frames only), frames }
--   <token>/frames/<i>.jpg    one still per checkpoint frame
--   Only the link's owner can write, list or delete under <token>/. Stopping
--   a share deletes the files (client, while the row still grants it) and
--   then the row.
--
-- RPCs
-- ----
--   start_swing_share(p_swing_id, p_title, p_club, p_recorded_at)  -> token
--   finish_swing_share(p_token)                                    -> boolean
--   end_swing_share(p_token)                                       -> boolean
--   get_public_swing(p_token)   anon + authenticated. NULL unless ready:
--     {"sharer", "title", "club", "recorded_at", "shared_at"}
--     sharer = league_public_name(owner) ("Íñigo E."), NULL without a display
--     name. Never the user id, email, username, handicap or other swings.
-- ============================================================================

-- 1) Table ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.swing_shares (
  token        text PRIMARY KEY CHECK (length(token) >= 20),
  owner        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  swing_id     text NOT NULL CHECK (length(swing_id) BETWEEN 1 AND 64),
  title        text CHECK (title IS NULL OR length(title) <= 80),
  club         text CHECK (club IS NULL OR length(club) <= 20),
  recorded_at  timestamptz,
  status       text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'ready')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  shared_at    timestamptz,
  UNIQUE (owner, swing_id)
);

-- RPCs only: no direct table access for anyone.
ALTER TABLE public.swing_shares ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.swing_shares FROM PUBLIC, anon, authenticated;

-- 2) RPCs ------------------------------------------------------------------------

-- Opens (or re-opens) the link for one of my swings. Returns the token.
CREATE OR REPLACE FUNCTION public.start_swing_share(
  p_swing_id text, p_title text, p_club text, p_recorded_at timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me    uuid := auth.uid();
  v_token text;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '28000'; END IF;
  IF p_swing_id IS NULL OR length(p_swing_id) NOT BETWEEN 1 AND 64 THEN
    RAISE EXCEPTION 'bad swing id' USING ERRCODE = '22023';
  END IF;

  SELECT token INTO v_token FROM public.swing_shares WHERE owner = v_me AND swing_id = p_swing_id;
  IF v_token IS NOT NULL THEN
    UPDATE public.swing_shares
       SET title = left(p_title, 80), club = left(p_club, 20), recorded_at = p_recorded_at, status = 'uploading'
     WHERE token = v_token;
    RETURN v_token;
  END IF;

  LOOP
    v_token := translate(encode(extensions.gen_random_bytes(24), 'base64'), E'+/=\n', '-_');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.swing_shares WHERE token = v_token);
  END LOOP;
  INSERT INTO public.swing_shares (token, owner, swing_id, title, club, recorded_at)
  VALUES (v_token, v_me, p_swing_id, left(p_title, 80), left(p_club, 20), p_recorded_at);
  RETURN v_token;
END;
$$;

-- Every file is up: the link starts showing the swing.
CREATE OR REPLACE FUNCTION public.finish_swing_share(p_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.swing_shares SET status = 'ready', shared_at = now()
   WHERE token = p_token AND owner = auth.uid();
  RETURN FOUND;
END;
$$;

-- Stop sharing: the row goes (the client has removed the files first).
CREATE OR REPLACE FUNCTION public.end_swing_share(p_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.swing_shares WHERE token = p_token AND owner = auth.uid();
  RETURN FOUND;
END;
$$;

-- The public page's facts about a ready link. NULL for anything else.
CREATE OR REPLACE FUNCTION public.get_public_swing(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.swing_shares%ROWTYPE;
BEGIN
  IF p_token IS NULL OR length(p_token) < 20 THEN RETURN NULL; END IF;
  SELECT * INTO r FROM public.swing_shares WHERE token = p_token AND status = 'ready';
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'sharer', public.league_public_name(r.owner),
    'title', r.title,
    'club', r.club,
    'recorded_at', r.recorded_at,
    'shared_at', r.shared_at
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.start_swing_share(text, text, text, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.finish_swing_share(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.end_swing_share(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_public_swing(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.start_swing_share(text, text, text, timestamptz) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.finish_swing_share(text) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.end_swing_share(text) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.get_public_swing(text) TO anon, authenticated;

-- 3) Storage ---------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('swing-shares', 'swing-shares', true, 104857600,
        ARRAY['video/mp4', 'image/jpeg', 'application/json'])
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- The owner of <token>/… (by the share row): write, overwrite, list, delete.
CREATE OR REPLACE FUNCTION public.owns_swing_share_path(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.swing_shares
     WHERE token = split_part(p_name, '/', 1) AND owner = auth.uid()
  );
$$;
REVOKE EXECUTE ON FUNCTION public.owns_swing_share_path(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.owns_swing_share_path(text) TO authenticated;

DROP POLICY IF EXISTS "swing shares: owner inserts" ON storage.objects;
CREATE POLICY "swing shares: owner inserts" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'swing-shares' AND public.owns_swing_share_path(name));

DROP POLICY IF EXISTS "swing shares: owner updates" ON storage.objects;
CREATE POLICY "swing shares: owner updates" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'swing-shares' AND public.owns_swing_share_path(name))
  WITH CHECK (bucket_id = 'swing-shares' AND public.owns_swing_share_path(name));

DROP POLICY IF EXISTS "swing shares: owner reads" ON storage.objects;
CREATE POLICY "swing shares: owner reads" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'swing-shares' AND public.owns_swing_share_path(name));

DROP POLICY IF EXISTS "swing shares: owner deletes" ON storage.objects;
CREATE POLICY "swing shares: owner deletes" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'swing-shares' AND public.owns_swing_share_path(name));
