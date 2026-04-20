-- Per-user favorite courses. Floats chosen courses to the top of the picker
-- and the library list. Personal preference, so RLS is strictly own-row.

CREATE TABLE IF NOT EXISTS public.favorite_courses (
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id  uuid        NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_id)
);

ALTER TABLE public.favorite_courses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "favorite_courses_select_own" ON public.favorite_courses;
CREATE POLICY "favorite_courses_select_own"
  ON public.favorite_courses FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "favorite_courses_insert_own" ON public.favorite_courses;
CREATE POLICY "favorite_courses_insert_own"
  ON public.favorite_courses FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "favorite_courses_delete_own" ON public.favorite_courses;
CREATE POLICY "favorite_courses_delete_own"
  ON public.favorite_courses FOR DELETE
  USING (user_id = auth.uid());
