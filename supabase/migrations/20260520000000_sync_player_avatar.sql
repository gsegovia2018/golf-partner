-- ============================================================================
-- Restore avatar_url sync from profiles → players.
-- ============================================================================
--
-- Background: migration 20260419120001_avatar_photos installed the trigger to
-- propagate profiles.avatar_url → players.avatar_url. The follow-up migration
-- 20260419120003_players_user_link (and then 20260419120005_username_and_relink)
-- redefined sync_player_from_profile WITHOUT the avatar_url column, and the
-- trigger was recreated with `UPDATE OF display_name, handicap` only — so
-- avatar uploads have not propagated to the players library since.
--
-- This migration:
--   1. Restores avatar_url to all three sync branches (linked update,
--      name-match relink, fresh insert).
--   2. Recreates the trigger so it fires on avatar_url updates too.
--   3. Backfills players.avatar_url from profiles for already-linked rows
--      whose avatar drifted during the regression window.

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

  -- Already linked to a library player? Sync name + handicap + avatar.
  SELECT id INTO v_player_id FROM public.players WHERE user_id = NEW.user_id;
  IF v_player_id IS NOT NULL THEN
    UPDATE public.players
       SET name = NEW.display_name,
           handicap = COALESCE(NEW.handicap, 0),
           avatar_url = NEW.avatar_url
     WHERE id = v_player_id;
    RETURN NEW;
  END IF;

  -- Prefer an unclaimed player with a matching name — likely the same person
  -- added to the library before they had an account.
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

-- Trigger must include avatar_url in its column list, otherwise avatar-only
-- profile updates won't fire the sync.
DROP TRIGGER IF EXISTS on_profile_sync_player ON public.profiles;
CREATE TRIGGER on_profile_sync_player
  AFTER INSERT OR UPDATE OF display_name, handicap, avatar_url ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_player_from_profile();

-- Repair rows that drifted while the trigger was missing avatar_url.
UPDATE public.players p
   SET avatar_url = pr.avatar_url
  FROM public.profiles pr
 WHERE p.user_id = pr.user_id
   AND p.avatar_url IS DISTINCT FROM pr.avatar_url;

/* VERIFY
   SELECT pr.display_name, pr.avatar_url AS profile_avatar,
          p.name, p.avatar_url AS player_avatar
     FROM public.profiles pr
     LEFT JOIN public.players p ON p.user_id = pr.user_id
    ORDER BY pr.display_name;
*/
