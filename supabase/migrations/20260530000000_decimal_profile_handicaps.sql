-- Allow profile handicap indexes to store the WHS one-decimal value.
-- The app already validates 0..54 with one decimal place; this keeps
-- Postgres from rejecting values such as 17.2 during profile saves.

DROP TRIGGER IF EXISTS on_profile_sync_player ON public.profiles;

ALTER TABLE public.profiles
  ALTER COLUMN handicap TYPE numeric(4,1)
  USING CASE
    WHEN handicap IS NULL THEN NULL
    ELSE round(handicap::numeric, 1)
  END;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.profiles'::regclass
       AND conname = 'profiles_handicap_range'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_handicap_range
      CHECK (handicap IS NULL OR (handicap >= 0 AND handicap <= 54));
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.players') IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'players'
          AND column_name = 'handicap'
     ) THEN
    ALTER TABLE public.players
      ALTER COLUMN handicap TYPE numeric(4,1)
      USING CASE
        WHEN handicap IS NULL THEN NULL
        ELSE round(handicap::numeric, 1)
      END;
  END IF;
END $$;

CREATE TRIGGER on_profile_sync_player
  AFTER INSERT OR UPDATE OF display_name, handicap, avatar_url ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_player_from_profile();
