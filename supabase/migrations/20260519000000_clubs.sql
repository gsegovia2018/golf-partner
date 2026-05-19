-- A golf club groups several course layouts (e.g. La Moraleja → Campo 1-4
-- plus a Pitch & Putt). A course optionally belongs to a club; existing and
-- standalone courses keep club_id null and behave exactly as before.

CREATE TABLE IF NOT EXISTS public.clubs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  city        text,
  province    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.clubs ENABLE ROW LEVEL SECURITY;

-- The course library is shared/collaborative — any signed-in user may read
-- and edit it. Mirrors the course_tees policies
-- (migration 20260518000003_course_tees.sql).
DROP POLICY IF EXISTS "clubs_select" ON public.clubs;
CREATE POLICY "clubs_select"
  ON public.clubs FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "clubs_write" ON public.clubs;
CREATE POLICY "clubs_write"
  ON public.clubs FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

-- A course optionally belongs to a club. ON DELETE SET NULL: deleting a club
-- leaves its courses standalone rather than destroying them.
ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES public.clubs(id) ON DELETE SET NULL;

-- Short layout label shown inside a club's expanded list (e.g. "Campo 1").
ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS layout_name text;

CREATE INDEX IF NOT EXISTS courses_club_id_idx ON public.courses (club_id);
