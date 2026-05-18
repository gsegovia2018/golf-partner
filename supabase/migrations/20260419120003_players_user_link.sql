-- ============================================================================
-- Link players library rows to auth users so every signed-up user appears
-- in the players picker with their profile name / handicap.
-- ============================================================================
--
-- Flow after this migration:
--   * sign up → profiles row auto-created (existing trigger)
--   *          → players row auto-upserted via trigger below,
--                linked by user_id, carrying display_name + handicap.
--   * edit profile → players row stays in sync automatically.
--   * delete user → players.user_id = NULL (player history preserved).

-- 1) Add user_id + unique constraint so there's at most one player per user.
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

DROP INDEX IF EXISTS players_user_id_uq;
CREATE UNIQUE INDEX players_user_id_uq ON public.players (user_id) WHERE user_id IS NOT NULL;

-- 2) Backfill: link each existing profile to an existing player-by-name if
--    possible (case-insensitive, trimmed). No match → create a new player row.
DO $$
DECLARE
  p record;
  matched uuid;
BEGIN
  FOR p IN SELECT user_id, display_name, handicap FROM public.profiles LOOP
    IF p.display_name IS NULL OR length(trim(p.display_name)) = 0 THEN CONTINUE; END IF;

    -- Prefer an existing unclaimed player with the same display_name.
    SELECT id INTO matched
      FROM public.players
     WHERE user_id IS NULL
       AND lower(trim(name)) = lower(trim(p.display_name))
     LIMIT 1;

    IF matched IS NOT NULL THEN
      UPDATE public.players
         SET user_id = p.user_id,
             handicap = COALESCE(p.handicap, handicap)
       WHERE id = matched;
    ELSIF NOT EXISTS (SELECT 1 FROM public.players WHERE user_id = p.user_id) THEN
      INSERT INTO public.players (user_id, name, handicap)
      VALUES (p.user_id, p.display_name, COALESCE(p.handicap, 0));
    END IF;
  END LOOP;
END $$;

-- 3) Keep players in sync with profiles going forward.
CREATE OR REPLACE FUNCTION public.sync_player_from_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.display_name IS NULL OR length(trim(NEW.display_name)) = 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.players (user_id, name, handicap)
  VALUES (NEW.user_id, NEW.display_name, COALESCE(NEW.handicap, 0))
  ON CONFLICT (user_id) WHERE user_id IS NOT NULL
  DO UPDATE SET
    name = EXCLUDED.name,
    handicap = EXCLUDED.handicap;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_sync_player ON public.profiles;
CREATE TRIGGER on_profile_sync_player
  AFTER INSERT OR UPDATE OF display_name, handicap ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_player_from_profile();

/* VERIFY
   SELECT p.display_name, pl.id AS player_id, pl.name, pl.handicap, pl.user_id
     FROM public.profiles p
     LEFT JOIN public.players pl ON pl.user_id = p.user_id;
*/
