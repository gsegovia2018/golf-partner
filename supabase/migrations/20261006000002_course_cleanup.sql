-- Course library clean-up.
--
-- 1. Stroke index: Aloha, Guadalmina Sur and Río Real carried an older
--    stroke index than the Real Federación Española de Golf publishes
--    (rfegolf.es/club/<club>, men's tees). Pars already matched, so only
--    stroke_index changes, and only while the pars still match. Rounds and
--    league cards snapshot their holes, so history is unchanged.
-- 2. Junk rows: "Oliva" (an all-par-4 placeholder), "QA Test Course" and
--    "QA Verify Links" (test data). Holes, tees and favourites cascade; the
--    one QA round on "QA Verify Links" keeps its own copy of the holes.
-- 3. "Bandama Golf" and "Real Club de Golf Las Palmas" are the same course
--    (identical holes and tee, one RFEG club) and neither is referenced; the
--    Bandama row goes.
-- 4. Two schools filed under the Madrid federation school's club move to
--    their own clubs (see the end of this file).

-- Aloha Golf Club
UPDATE public.course_holes h SET stroke_index = v.si
  FROM (VALUES (1, 5, 2), (2, 4, 12), (3, 4, 16), (4, 3, 8), (5, 5, 6), (6, 4, 10), (7, 4, 14), (8, 3, 18), (9, 4, 4), (10, 5, 5), (11, 4, 7), (12, 4, 1), (13, 3, 13), (14, 4, 17), (15, 4, 9), (16, 5, 11), (17, 3, 15), (18, 4, 3)) AS v(number, par, si)
 WHERE h.course_id = 'f408cb94-8b48-48d2-8f6e-3543014ab023' AND h.number = v.number AND h.par = v.par
   AND (SELECT string_agg(par::text, '' ORDER BY number) FROM public.course_holes WHERE course_id = 'f408cb94-8b48-48d2-8f6e-3543014ab023') = '544354434544344534';

-- Guadalmina Sur
UPDATE public.course_holes h SET stroke_index = v.si
  FROM (VALUES (1, 4, 13), (2, 3, 11), (3, 4, 15), (4, 4, 3), (5, 4, 7), (6, 5, 1), (7, 5, 17), (8, 4, 5), (9, 3, 9), (10, 4, 4), (11, 3, 12), (12, 4, 10), (13, 4, 6), (14, 3, 16), (15, 4, 14), (16, 5, 2), (17, 5, 18), (18, 4, 8)) AS v(number, par, si)
 WHERE h.course_id = '1dbe2a7b-ce3f-407e-b9e4-b17a474abc9e' AND h.number = v.number AND h.par = v.par
   AND (SELECT string_agg(par::text, '' ORDER BY number) FROM public.course_holes WHERE course_id = '1dbe2a7b-ce3f-407e-b9e4-b17a474abc9e') = '434445543434434554';

-- Río Real Golf
UPDATE public.course_holes h SET stroke_index = v.si
  FROM (VALUES (1, 4, 15), (2, 4, 11), (3, 3, 17), (4, 4, 5), (5, 4, 1), (6, 3, 13), (7, 5, 3), (8, 4, 7), (9, 5, 9), (10, 4, 8), (11, 4, 16), (12, 3, 14), (13, 5, 4), (14, 3, 12), (15, 4, 2), (16, 5, 6), (17, 4, 18), (18, 4, 10)) AS v(number, par, si)
 WHERE h.course_id = '64876d6b-8e27-4979-aac4-e34e4e935c9e' AND h.number = v.number AND h.par = v.par
   AND (SELECT string_agg(par::text, '' ORDER BY number) FROM public.course_holes WHERE course_id = '64876d6b-8e27-4979-aac4-e34e4e935c9e') = '443443545443534544';

DELETE FROM public.courses
 WHERE id IN ('30da3c17-9e2e-4fc7-9806-28748adb9612',  -- Oliva
              '4c249618-f59a-4309-840b-cccae75cb6c4',  -- QA Test Course
              'e2ed350f-db13-409d-b10c-ffc0ad4786c9',  -- QA Verify Links
              '12284f0d-0206-4d1a-8605-453fc5665b43')  -- Bandama Golf
   AND NOT EXISTS (SELECT 1 FROM public.league_cards l WHERE l.course->>'id' = courses.id::text);

-- 4. The first import (20261006000001) filed two schools' courses under the
--    Madrid federation school's club: a sibling layout had matched it on the
--    word "Escuela". Each moves to a club of its own (the ids the generator
--    derives for these federation clubs, so later passes join them).
INSERT INTO public.clubs (id, name, city, province) VALUES
  ('cd184dd5-08b2-584e-a601-1ed0bf019de5', 'Escuela Pública la Cartuja', NULL, 'Andalusia'),
  ('36b3a5e7-5f01-5bd2-a938-db6356dcae6b', 'Escuela Pública de Golf de Villanueva de la Serena', 'Villanueva de la Serena', 'Extremadura')
ON CONFLICT (id) DO NOTHING;
UPDATE public.courses SET club_id = 'cd184dd5-08b2-584e-a601-1ed0bf019de5'
 WHERE id = '704d6693-95b9-5de5-997c-a3bb70d67d29' AND club_id = 'e7e827dc-1f69-4f59-ae3c-6c5b591dd78a';
UPDATE public.courses SET club_id = '36b3a5e7-5f01-5bd2-a938-db6356dcae6b'
 WHERE id = 'f65dd5a7-6d25-5798-af57-5ed714a71cfe' AND club_id = 'e7e827dc-1f69-4f59-ae3c-6c5b591dd78a';
