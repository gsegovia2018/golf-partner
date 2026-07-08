-- Gender on profiles/players + women's tee ratings.
-- Under the WHS every physical tee has two rating/slope pairs (men/women).
-- Previously modeled as duplicate "(Damas)" course_tees rows; now one row
-- per tee with rating_women/slope_women, and player gender picks the pair.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS gender text CHECK (gender IN ('male','female'));
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS gender text CHECK (gender IN ('male','female'));
ALTER TABLE public.course_tees
  ADD COLUMN IF NOT EXISTS rating_women numeric,
  ADD COLUMN IF NOT EXISTS slope_women  integer;

-- One-time backfill. New signups stay NULL until they pick in ProfileScreen.
UPDATE public.profiles SET gender = 'male'   WHERE gender IS NULL;
UPDATE public.profiles SET gender = 'female' WHERE lower(trim(display_name)) = 'escribano.clau';
UPDATE public.players  SET gender = 'male'   WHERE gender IS NULL;
UPDATE public.players  SET gender = 'female' WHERE lower(trim(name)) = 'claudia escribano';

-- Profile → player sync now carries gender (see 20260419120003_players_user_link.sql).
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

  INSERT INTO public.players (user_id, name, handicap, gender)
  VALUES (NEW.user_id, NEW.display_name, COALESCE(NEW.handicap, 0), NEW.gender)
  ON CONFLICT (user_id) WHERE user_id IS NOT NULL
  DO UPDATE SET
    name = EXCLUDED.name,
    handicap = EXCLUDED.handicap,
    gender = COALESCE(EXCLUDED.gender, public.players.gender);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_sync_player ON public.profiles;
CREATE TRIGGER on_profile_sync_player
  AFTER INSERT OR UPDATE OF display_name, handicap, gender ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_player_from_profile();

-- Merge "(Damas)" tee rows into their base tee on the same course:
-- copy rating/slope into the base row's women's columns, then delete the
-- Damas row. A Damas row with no base sibling is left untouched.
WITH damas AS (
  SELECT id AS damas_id, course_id, rating, slope,
         lower(btrim(regexp_replace(label, '\s*\(\s*damas\s*\)\s*$', '', 'i'))) AS base_key
  FROM public.course_tees
  WHERE label ~* '\(\s*damas\s*\)\s*$'
),
paired AS (
  SELECT DISTINCT ON (d.damas_id) d.damas_id, b.id AS base_id, d.rating, d.slope
  FROM damas d
  JOIN public.course_tees b
    ON b.course_id = d.course_id
   AND lower(btrim(b.label)) = d.base_key
   AND b.id <> d.damas_id
  ORDER BY d.damas_id, b.sort_order
)
UPDATE public.course_tees b
   SET rating_women = p.rating, slope_women = p.slope
  FROM paired p
 WHERE b.id = p.base_id;

DELETE FROM public.course_tees d
 WHERE d.label ~* '\(\s*damas\s*\)\s*$'
   AND EXISTS (
     SELECT 1 FROM public.course_tees b
      WHERE b.course_id = d.course_id
        AND b.id <> d.id
        AND lower(btrim(b.label)) =
            lower(btrim(regexp_replace(d.label, '\s*\(\s*damas\s*\)\s*$', '', 'i')))
   );

/* VERIFY
   SELECT count(*) FROM public.course_tees WHERE label ~* '\(\s*damas\s*\)';
   SELECT count(*) FROM public.course_tees WHERE rating_women IS NOT NULL;
   SELECT gender, count(*) FROM public.players GROUP BY gender;
*/
