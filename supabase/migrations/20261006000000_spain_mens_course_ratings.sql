-- Men's course rating + slope for the Spanish courses that had none.
--
-- Source: the Real Federación Española de Golf club pages
-- (rfegolf.es/club/<club>), which carry the official WHS Vc/Vs per tee.
-- Every course below was matched to its RFEG layout by par on all 18
-- holes before taking its numbers. Men's values only; rating_women and
-- slope_women stay as they were.
--
-- 1. Courses holding a single "Default" tee (seeded in April, mostly
--    unrated) get their full set of men's tees, longest first (the library
--    convention, see the Málaga courses). The Default tees held no women's
--    values or yardages.
--    Rounds and league cards snapshot their tee, so history is unchanged.
-- 2. Villaitana: men's values for the tees that had none. Levante Blue/Red
--    and Poniente White/Red are rated for men by the RFEG; Poniente Blue
--    is not, so it stays unrated.
-- 3. Three ratings that disagreed with the RFEG are corrected: Añoreta
--    (its Default tee held 71.1/135 for yellow, now 70.8/132 in the full
--    set), Villaitana Levante White slope 131 → 135, and Villaitana
--    Poniente Yellow 58.9/97 → 60.3/105.
-- 4. "La Cala Resort Campo America (North)" is the same course as
--    "La Cala America" (identical par and stroke index on all 18 holes)
--    and nothing references it, so it is removed in favour of the latter,
--    which is the name the existing round was played under.
--
-- Keyed by course id: on a database without these rows every statement
-- is a no-op.

-- Aloha Golf Club
DELETE FROM public.course_tees WHERE course_id = 'f408cb94-8b48-48d2-8f6e-3543014ab023' AND label = 'Default';
INSERT INTO public.course_tees (course_id, label, rating, slope, sort_order)
SELECT v.course_id::uuid, v.label, v.rating, v.slope, v.sort_order FROM (VALUES
  ('f408cb94-8b48-48d2-8f6e-3543014ab023', 'Blancas', 73.1, 132, 0),
  ('f408cb94-8b48-48d2-8f6e-3543014ab023', 'Amarillas', 71.5, 132, 1),
  ('f408cb94-8b48-48d2-8f6e-3543014ab023', 'Azules', 69.9, 130, 2),
  ('f408cb94-8b48-48d2-8f6e-3543014ab023', 'Rojas', 67.8, 124, 3),
  ('f408cb94-8b48-48d2-8f6e-3543014ab023', 'Naranjas', 66.6, 117, 4)
) AS v(course_id, label, rating, slope, sort_order)
WHERE EXISTS (SELECT 1 FROM public.courses WHERE id = v.course_id::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.course_tees t WHERE t.course_id = v.course_id::uuid AND t.label = v.label);

-- Cabopino Golf Marbella
DELETE FROM public.course_tees WHERE course_id = '25c10dc7-9566-48e7-a488-18d851efec56' AND label = 'Default';
INSERT INTO public.course_tees (course_id, label, rating, slope, sort_order)
SELECT v.course_id::uuid, v.label, v.rating, v.slope, v.sort_order FROM (VALUES
  ('25c10dc7-9566-48e7-a488-18d851efec56', 'Amarillas', 69.1, 130, 0),
  ('25c10dc7-9566-48e7-a488-18d851efec56', 'Azules', 67.9, 127, 1),
  ('25c10dc7-9566-48e7-a488-18d851efec56', 'Rojas', 65.1, 123, 2)
) AS v(course_id, label, rating, slope, sort_order)
WHERE EXISTS (SELECT 1 FROM public.courses WHERE id = v.course_id::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.course_tees t WHERE t.course_id = v.course_id::uuid AND t.label = v.label);

-- Calanova Golf Club
DELETE FROM public.course_tees WHERE course_id = '1c049feb-be34-402a-945d-8bc515beda00' AND label = 'Default';
INSERT INTO public.course_tees (course_id, label, rating, slope, sort_order)
SELECT v.course_id::uuid, v.label, v.rating, v.slope, v.sort_order FROM (VALUES
  ('1c049feb-be34-402a-945d-8bc515beda00', 'Blancas', 72.1, 136, 0),
  ('1c049feb-be34-402a-945d-8bc515beda00', 'Amarillas', 71.5, 136, 1),
  ('1c049feb-be34-402a-945d-8bc515beda00', 'Azules', 69.4, 136, 2),
  ('1c049feb-be34-402a-945d-8bc515beda00', 'Rojas', 67.2, 126, 3)
) AS v(course_id, label, rating, slope, sort_order)
WHERE EXISTS (SELECT 1 FROM public.courses WHERE id = v.course_id::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.course_tees t WHERE t.course_id = v.course_id::uuid AND t.label = v.label);

-- Club de Golf Las Ramblas
DELETE FROM public.course_tees WHERE course_id = 'b5cb0e99-b692-4857-b44e-bc99d5e84621' AND label = 'Default';
INSERT INTO public.course_tees (course_id, label, rating, slope, sort_order)
SELECT v.course_id::uuid, v.label, v.rating, v.slope, v.sort_order FROM (VALUES
  ('b5cb0e99-b692-4857-b44e-bc99d5e84621', 'Blancas', 72.2, 137, 0),
  ('b5cb0e99-b692-4857-b44e-bc99d5e84621', 'Amarillas', 71.8, 136, 1),
  ('b5cb0e99-b692-4857-b44e-bc99d5e84621', 'Azules', 69.5, 131, 2),
  ('b5cb0e99-b692-4857-b44e-bc99d5e84621', 'Rojas', 66.4, 125, 3)
) AS v(course_id, label, rating, slope, sort_order)
WHERE EXISTS (SELECT 1 FROM public.courses WHERE id = v.course_id::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.course_tees t WHERE t.course_id = v.course_id::uuid AND t.label = v.label);

-- El Chaparral Golf Club
DELETE FROM public.course_tees WHERE course_id = 'dfeaa675-d821-4be4-9d0e-c20a0fa6e18b' AND label = 'Default';
INSERT INTO public.course_tees (course_id, label, rating, slope, sort_order)
SELECT v.course_id::uuid, v.label, v.rating, v.slope, v.sort_order FROM (VALUES
  ('dfeaa675-d821-4be4-9d0e-c20a0fa6e18b', 'Blancas', 71.4, 140, 0),
  ('dfeaa675-d821-4be4-9d0e-c20a0fa6e18b', 'Amarillas', 70.2, 137, 1),
  ('dfeaa675-d821-4be4-9d0e-c20a0fa6e18b', 'Azules', 68.7, 130, 2),
  ('dfeaa675-d821-4be4-9d0e-c20a0fa6e18b', 'Rojas', 66.2, 131, 3)
) AS v(course_id, label, rating, slope, sort_order)
WHERE EXISTS (SELECT 1 FROM public.courses WHERE id = v.course_id::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.course_tees t WHERE t.course_id = v.course_id::uuid AND t.label = v.label);

-- Finca Cortesín
DELETE FROM public.course_tees WHERE course_id = '4f2a6c84-5972-40b5-b28c-f4359c7b7a07' AND label = 'Default';
INSERT INTO public.course_tees (course_id, label, rating, slope, sort_order)
SELECT v.course_id::uuid, v.label, v.rating, v.slope, v.sort_order FROM (VALUES
  ('4f2a6c84-5972-40b5-b28c-f4359c7b7a07', 'Negras', 77.0, 138, 0),
  ('4f2a6c84-5972-40b5-b28c-f4359c7b7a07', 'Blancas', 74.6, 139, 1),
  ('4f2a6c84-5972-40b5-b28c-f4359c7b7a07', 'Amarillas', 72.0, 138, 2),
  ('4f2a6c84-5972-40b5-b28c-f4359c7b7a07', 'Doradas', 68.6, 131, 3),
  ('4f2a6c84-5972-40b5-b28c-f4359c7b7a07', 'Azules', 68.3, 122, 4),
  ('4f2a6c84-5972-40b5-b28c-f4359c7b7a07', 'Rojas', 66.5, 117, 5)
) AS v(course_id, label, rating, slope, sort_order)
WHERE EXISTS (SELECT 1 FROM public.courses WHERE id = v.course_id::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.course_tees t WHERE t.course_id = v.course_id::uuid AND t.label = v.label);

-- Guadalmina Sur
DELETE FROM public.course_tees WHERE course_id = '1dbe2a7b-ce3f-407e-b9e4-b17a474abc9e' AND label = 'Default';
INSERT INTO public.course_tees (course_id, label, rating, slope, sort_order)
SELECT v.course_id::uuid, v.label, v.rating, v.slope, v.sort_order FROM (VALUES
  ('1dbe2a7b-ce3f-407e-b9e4-b17a474abc9e', 'Blancas', 73.5, 137, 0),
  ('1dbe2a7b-ce3f-407e-b9e4-b17a474abc9e', 'Amarillas', 72.1, 136, 1),
  ('1dbe2a7b-ce3f-407e-b9e4-b17a474abc9e', 'Azules', 70.2, 130, 2),
  ('1dbe2a7b-ce3f-407e-b9e4-b17a474abc9e', 'Rojas', 67.9, 128, 3),
  ('1dbe2a7b-ce3f-407e-b9e4-b17a474abc9e', 'Rosas', 65.7, 120, 4),
  ('1dbe2a7b-ce3f-407e-b9e4-b17a474abc9e', 'Negras', 64.4, 116, 5)
) AS v(course_id, label, rating, slope, sort_order)
WHERE EXISTS (SELECT 1 FROM public.courses WHERE id = v.course_id::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.course_tees t WHERE t.course_id = v.course_id::uuid AND t.label = v.label);

-- Higuerón Marbella Golf Resort
DELETE FROM public.course_tees WHERE course_id = 'a5c19562-3574-4f71-9e29-58b146dd7e61' AND label = 'Default';
INSERT INTO public.course_tees (course_id, label, rating, slope, sort_order)
SELECT v.course_id::uuid, v.label, v.rating, v.slope, v.sort_order FROM (VALUES
  ('a5c19562-3574-4f71-9e29-58b146dd7e61', 'Blancas', 72.1, 136, 0),
  ('a5c19562-3574-4f71-9e29-58b146dd7e61', 'Amarillas', 70.5, 134, 1),
  ('a5c19562-3574-4f71-9e29-58b146dd7e61', 'Azules', 68.3, 125, 2),
  ('a5c19562-3574-4f71-9e29-58b146dd7e61', 'Rojas', 66.3, 120, 3)
) AS v(course_id, label, rating, slope, sort_order)
WHERE EXISTS (SELECT 1 FROM public.courses WHERE id = v.course_id::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.course_tees t WHERE t.course_id = v.course_id::uuid AND t.label = v.label);

-- La Cala America
DELETE FROM public.course_tees WHERE course_id = '879f118e-39bb-45df-badb-7f05ded2330f' AND label = 'Default';
INSERT INTO public.course_tees (course_id, label, rating, slope, sort_order)
SELECT v.course_id::uuid, v.label, v.rating, v.slope, v.sort_order FROM (VALUES
  ('879f118e-39bb-45df-badb-7f05ded2330f', 'Blancas', 72.8, 138, 0),
  ('879f118e-39bb-45df-badb-7f05ded2330f', 'Amarillas', 70.6, 134, 1),
  ('879f118e-39bb-45df-badb-7f05ded2330f', 'Azules', 67.4, 124, 2),
  ('879f118e-39bb-45df-badb-7f05ded2330f', 'Rojas', 65.4, 114, 3),
  ('879f118e-39bb-45df-badb-7f05ded2330f', 'Verdes', 63.5, 108, 4)
) AS v(course_id, label, rating, slope, sort_order)
WHERE EXISTS (SELECT 1 FROM public.courses WHERE id = v.course_id::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.course_tees t WHERE t.course_id = v.course_id::uuid AND t.label = v.label);

-- La Cala Resort Campo Asia (South)
DELETE FROM public.course_tees WHERE course_id = 'd1bb1025-4a2a-4b51-a336-91c79b663b87' AND label = 'Default';
INSERT INTO public.course_tees (course_id, label, rating, slope, sort_order)
SELECT v.course_id::uuid, v.label, v.rating, v.slope, v.sort_order FROM (VALUES
  ('d1bb1025-4a2a-4b51-a336-91c79b663b87', 'Blancas', 72.0, 140, 0),
  ('d1bb1025-4a2a-4b51-a336-91c79b663b87', 'Amarillas', 69.1, 139, 1),
  ('d1bb1025-4a2a-4b51-a336-91c79b663b87', 'Azules', 66.6, 120, 2),
  ('d1bb1025-4a2a-4b51-a336-91c79b663b87', 'Rojas', 64.6, 115, 3),
  ('d1bb1025-4a2a-4b51-a336-91c79b663b87', 'Verdes', 62.9, 113, 4)
) AS v(course_id, label, rating, slope, sort_order)
WHERE EXISTS (SELECT 1 FROM public.courses WHERE id = v.course_id::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.course_tees t WHERE t.course_id = v.course_id::uuid AND t.label = v.label);

-- La Cala Resort Campo Europa
DELETE FROM public.course_tees WHERE course_id = 'a5dfdb1a-8223-4fa5-8d92-4cb12ec1903a' AND label = 'Default';
INSERT INTO public.course_tees (course_id, label, rating, slope, sort_order)
SELECT v.course_id::uuid, v.label, v.rating, v.slope, v.sort_order FROM (VALUES
  ('a5dfdb1a-8223-4fa5-8d92-4cb12ec1903a', 'Blancas', 72.1, 136, 0),
  ('a5dfdb1a-8223-4fa5-8d92-4cb12ec1903a', 'Amarillas', 69.5, 132, 1),
  ('a5dfdb1a-8223-4fa5-8d92-4cb12ec1903a', 'Azules', 65.4, 116, 2),
  ('a5dfdb1a-8223-4fa5-8d92-4cb12ec1903a', 'Rojas', 64.1, 112, 3),
  ('a5dfdb1a-8223-4fa5-8d92-4cb12ec1903a', 'Verdes', 63.5, 107, 4)
) AS v(course_id, label, rating, slope, sort_order)
WHERE EXISTS (SELECT 1 FROM public.courses WHERE id = v.course_id::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.course_tees t WHERE t.course_id = v.course_id::uuid AND t.label = v.label);

-- Los Naranjos Golf Club
DELETE FROM public.course_tees WHERE course_id = '0f93cab5-8e3d-47b7-acd5-8a5f3b9ebc6c' AND label = 'Default';
INSERT INTO public.course_tees (course_id, label, rating, slope, sort_order)
SELECT v.course_id::uuid, v.label, v.rating, v.slope, v.sort_order FROM (VALUES
  ('0f93cab5-8e3d-47b7-acd5-8a5f3b9ebc6c', 'Negras', 74.9, 133, 0),
  ('0f93cab5-8e3d-47b7-acd5-8a5f3b9ebc6c', 'Blancas', 72.4, 139, 1),
  ('0f93cab5-8e3d-47b7-acd5-8a5f3b9ebc6c', 'Amarillas', 71.0, 137, 2),
  ('0f93cab5-8e3d-47b7-acd5-8a5f3b9ebc6c', 'Rojas', 66.3, 124, 3)
) AS v(course_id, label, rating, slope, sort_order)
WHERE EXISTS (SELECT 1 FROM public.courses WHERE id = v.course_id::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.course_tees t WHERE t.course_id = v.course_id::uuid AND t.label = v.label);

-- Marbella Club Golf Resort
DELETE FROM public.course_tees WHERE course_id = '9c151554-ca85-4732-8614-0044289528f3' AND label = 'Default';
INSERT INTO public.course_tees (course_id, label, rating, slope, sort_order)
SELECT v.course_id::uuid, v.label, v.rating, v.slope, v.sort_order FROM (VALUES
  ('9c151554-ca85-4732-8614-0044289528f3', 'Blancas', 73.4, 134, 0),
  ('9c151554-ca85-4732-8614-0044289528f3', 'Amarillas', 71.1, 137, 1),
  ('9c151554-ca85-4732-8614-0044289528f3', 'Azules', 68.6, 127, 2),
  ('9c151554-ca85-4732-8614-0044289528f3', 'Rojas', 66.5, 120, 3)
) AS v(course_id, label, rating, slope, sort_order)
WHERE EXISTS (SELECT 1 FROM public.courses WHERE id = v.course_id::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.course_tees t WHERE t.course_id = v.course_id::uuid AND t.label = v.label);

-- Real Club de Golf Las Brisas
DELETE FROM public.course_tees WHERE course_id = 'e1f72f85-8dd2-4071-a6f9-6ddc8f719bc1' AND label = 'Default';
INSERT INTO public.course_tees (course_id, label, rating, slope, sort_order)
SELECT v.course_id::uuid, v.label, v.rating, v.slope, v.sort_order FROM (VALUES
  ('e1f72f85-8dd2-4071-a6f9-6ddc8f719bc1', 'Negras', 74.8, 149, 0),
  ('e1f72f85-8dd2-4071-a6f9-6ddc8f719bc1', 'Blancas', 73.3, 145, 1),
  ('e1f72f85-8dd2-4071-a6f9-6ddc8f719bc1', 'Amarillas', 71.9, 141, 2),
  ('e1f72f85-8dd2-4071-a6f9-6ddc8f719bc1', 'Azules', 70.6, 135, 3),
  ('e1f72f85-8dd2-4071-a6f9-6ddc8f719bc1', 'Doradas', 67.6, 130, 4),
  ('e1f72f85-8dd2-4071-a6f9-6ddc8f719bc1', 'Rojas', 66.7, 124, 5)
) AS v(course_id, label, rating, slope, sort_order)
WHERE EXISTS (SELECT 1 FROM public.courses WHERE id = v.course_id::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.course_tees t WHERE t.course_id = v.course_id::uuid AND t.label = v.label);

-- Río Real Golf
DELETE FROM public.course_tees WHERE course_id = '64876d6b-8e27-4979-aac4-e34e4e935c9e' AND label = 'Default';
INSERT INTO public.course_tees (course_id, label, rating, slope, sort_order)
SELECT v.course_id::uuid, v.label, v.rating, v.slope, v.sort_order FROM (VALUES
  ('64876d6b-8e27-4979-aac4-e34e4e935c9e', 'Blancas', 71.9, 139, 0),
  ('64876d6b-8e27-4979-aac4-e34e4e935c9e', 'Amarillas', 70.9, 137, 1),
  ('64876d6b-8e27-4979-aac4-e34e4e935c9e', 'Azules', 68.9, 130, 2),
  ('64876d6b-8e27-4979-aac4-e34e4e935c9e', 'Rojas', 66.9, 123, 3)
) AS v(course_id, label, rating, slope, sort_order)
WHERE EXISTS (SELECT 1 FROM public.courses WHERE id = v.course_id::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.course_tees t WHERE t.course_id = v.course_id::uuid AND t.label = v.label);

-- Club de Golf Costa Daurada Tarragona
DELETE FROM public.course_tees WHERE course_id = '3a5f742d-09b1-4cd5-9b32-1fc0f741b5b1' AND label = 'Default';
INSERT INTO public.course_tees (course_id, label, rating, slope, sort_order)
SELECT v.course_id::uuid, v.label, v.rating, v.slope, v.sort_order FROM (VALUES
  ('3a5f742d-09b1-4cd5-9b32-1fc0f741b5b1', 'Blancas', 71.3, 135, 0),
  ('3a5f742d-09b1-4cd5-9b32-1fc0f741b5b1', 'Amarillas', 69.8, 132, 1),
  ('3a5f742d-09b1-4cd5-9b32-1fc0f741b5b1', 'Azules', 67.6, 123, 2),
  ('3a5f742d-09b1-4cd5-9b32-1fc0f741b5b1', 'Rojas', 66.0, 115, 3)
) AS v(course_id, label, rating, slope, sort_order)
WHERE EXISTS (SELECT 1 FROM public.courses WHERE id = v.course_id::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.course_tees t WHERE t.course_id = v.course_id::uuid AND t.label = v.label);

-- Añoreta Golf
DELETE FROM public.course_tees WHERE course_id = 'd695ffd5-2912-418f-abe7-812aad3685eb' AND label = 'Default';
INSERT INTO public.course_tees (course_id, label, rating, slope, sort_order)
SELECT v.course_id::uuid, v.label, v.rating, v.slope, v.sort_order FROM (VALUES
  ('d695ffd5-2912-418f-abe7-812aad3685eb', 'Blancas', 71.7, 134, 0),
  ('d695ffd5-2912-418f-abe7-812aad3685eb', 'Amarillas', 70.8, 132, 1),
  ('d695ffd5-2912-418f-abe7-812aad3685eb', 'Azules', 68.2, 124, 2),
  ('d695ffd5-2912-418f-abe7-812aad3685eb', 'Rojas', 66.9, 119, 3)
) AS v(course_id, label, rating, slope, sort_order)
WHERE EXISTS (SELECT 1 FROM public.courses WHERE id = v.course_id::uuid)
  AND NOT EXISTS (SELECT 1 FROM public.course_tees t WHERE t.course_id = v.course_id::uuid AND t.label = v.label);

-- Meliã Villaitana Golf Club (Levante)
UPDATE public.course_tees SET rating = 67.8, slope = 129
 WHERE course_id = 'b4c1b386-864c-4c62-8763-30a038b52c11' AND label = 'Blue' AND rating IS NULL AND slope IS NULL;
UPDATE public.course_tees SET rating = 65.1, slope = 115
 WHERE course_id = 'b4c1b386-864c-4c62-8763-30a038b52c11' AND label = 'Red' AND rating IS NULL AND slope IS NULL;

-- Meliã Villaitana Golf Club (Poniente)
UPDATE public.course_tees SET rating = 61.8, slope = 109
 WHERE course_id = '9129ad80-73b0-43f9-a91a-32439958c2f9' AND label = 'White' AND rating IS NULL AND slope IS NULL;
UPDATE public.course_tees SET rating = 56.3, slope = 64
 WHERE course_id = '9129ad80-73b0-43f9-a91a-32439958c2f9' AND label = 'Red' AND rating IS NULL AND slope IS NULL;

-- Values that disagreed with the RFEG. Guarded on the old value.
UPDATE public.course_tees SET slope = 135
 WHERE course_id = 'b4c1b386-864c-4c62-8763-30a038b52c11' AND label = 'White' AND rating = 73.3 AND slope = 131;
UPDATE public.course_tees SET rating = 60.3, slope = 105
 WHERE course_id = '9129ad80-73b0-43f9-a91a-32439958c2f9' AND label = 'Yellow' AND rating = 58.9 AND slope = 97;

-- Duplicate La Cala America. Guarded: kept if anything ever pointed at it.
DELETE FROM public.courses c
 WHERE c.id = 'd8ecf57e-cea1-4b4b-bc34-4367f00095e2'
   AND NOT EXISTS (SELECT 1 FROM public.favorite_courses f WHERE f.course_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM public.game_rounds g WHERE g.body->>'courseId' = c.id::text)
   AND NOT EXISTS (SELECT 1 FROM public.league_cards l WHERE l.course->>'id' = c.id::text);

