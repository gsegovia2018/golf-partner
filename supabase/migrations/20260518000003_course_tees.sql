-- Per-tee course rating + slope. A course owns an ordered list of tees;
-- each tee (a colour, a number, or a name) has its own rating and slope.
-- Par and stroke index stay on course_holes, shared across tees.
-- yardages is an optional jsonb map { holeNumber: yards }; cosmetic.

CREATE TABLE IF NOT EXISTS public.course_tees (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   uuid        NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  label       text        NOT NULL,
  rating      numeric,
  slope       integer,
  sort_order  integer     NOT NULL DEFAULT 0,
  yardages    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS course_tees_course_id_idx
  ON public.course_tees (course_id);

ALTER TABLE public.course_tees ENABLE ROW LEVEL SECURITY;

-- The course library is shared/collaborative — any signed-in user may read
-- and edit courses (mirrors how courses / course_holes are used by
-- libraryStore.upsertCourse and saveCourseHoles). If course_holes carries a
-- stricter policy in the live database, mirror that here instead.
DROP POLICY IF EXISTS "course_tees_select" ON public.course_tees;
CREATE POLICY "course_tees_select"
  ON public.course_tees FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "course_tees_write" ON public.course_tees;
CREATE POLICY "course_tees_write"
  ON public.course_tees FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

-- Backfill: every existing course gets one "Default" tee carrying its current
-- course-level slope/rating, so existing courses keep a usable tee.
INSERT INTO public.course_tees (course_id, label, rating, slope, sort_order)
SELECT c.id, 'Default', c.rating, c.slope, 0
FROM public.courses c
WHERE NOT EXISTS (
  SELECT 1 FROM public.course_tees t WHERE t.course_id = c.id
);
