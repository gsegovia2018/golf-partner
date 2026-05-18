-- ============================================================================
-- Profile photos: storage bucket + avatar_url on profiles and linked players.
-- ============================================================================

-- 1) Public avatar bucket. Objects are world-readable; writes restricted to
-- the uploader's own folder (/<user_id>/filename.ext).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 3 * 1024 * 1024,
        ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Avatars public read" ON storage.objects;
DROP POLICY IF EXISTS "Users upload own avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users update own avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users delete own avatars" ON storage.objects;

CREATE POLICY "Avatars public read" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'avatars');

CREATE POLICY "Users upload own avatars" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users update own avatars" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users delete own avatars" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 2) Columns
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.players  ADD COLUMN IF NOT EXISTS avatar_url text;

-- 3) Keep player.avatar_url in sync with profile.avatar_url (same trigger
-- that already mirrors display_name / handicap → players).
CREATE OR REPLACE FUNCTION public.sync_player_from_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_player_id uuid;
BEGIN
  IF NEW.display_name IS NULL OR length(trim(NEW.display_name)) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_player_id FROM public.players WHERE user_id = NEW.user_id;
  IF v_player_id IS NOT NULL THEN
    UPDATE public.players
       SET name = NEW.display_name,
           handicap = COALESCE(NEW.handicap, 0),
           avatar_url = NEW.avatar_url
     WHERE id = v_player_id;
    RETURN NEW;
  END IF;

  SELECT id INTO v_player_id
    FROM public.players
   WHERE user_id IS NULL
     AND lower(trim(name)) = lower(trim(NEW.display_name))
   LIMIT 1;
  IF v_player_id IS NOT NULL THEN
    UPDATE public.players
       SET user_id = NEW.user_id,
           handicap = COALESCE(NEW.handicap, handicap),
           avatar_url = NEW.avatar_url
     WHERE id = v_player_id;
  ELSE
    INSERT INTO public.players (user_id, name, handicap, avatar_url)
    VALUES (NEW.user_id, NEW.display_name, COALESCE(NEW.handicap, 0), NEW.avatar_url);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_sync_player ON public.profiles;
CREATE TRIGGER on_profile_sync_player
  AFTER INSERT OR UPDATE OF display_name, handicap, avatar_url ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_player_from_profile();
