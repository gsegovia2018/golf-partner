-- Los Angeles de San Rafael's 18-hole layout, under its real name.
--
-- The library already had it as "Air Golf Club" (same par and stroke index on
-- every hole, rating 72.3 / slope 134), so the federation import matched it
-- and skipped the layout, leaving only the club's P&P visible. Rename it after
-- the import's "Club — Layout" convention, put it under the club, and replace
-- its placeholder "Default" tee with the federation tees. No round uses it.

UPDATE public.courses
   SET name = 'Los Angeles de San Rafael Golf — Los Angeles San Rafael',
       club_id = '89a59aa2-ad01-5d3d-8a66-e2a5dca3d181',
       layout_name = 'Los Angeles San Rafael'
 WHERE id = 'b0f5dd13-dff2-4aa3-999b-9cd30706a80e';

DELETE FROM public.course_tees
 WHERE course_id = 'b0f5dd13-dff2-4aa3-999b-9cd30706a80e' AND label = 'Default';

INSERT INTO public.course_tees (course_id, label, rating, slope, rating_women, slope_women, sort_order, yardages)
SELECT 'b0f5dd13-dff2-4aa3-999b-9cd30706a80e'::uuid, v.label, v.rating, v.slope, v.rating_women, v.slope_women, v.sort_order, v.yardages::jsonb FROM (VALUES
  ('Blancas', 72.3, 134, 78.7, 149, 0, '{"1":456,"2":361,"3":157,"4":286,"5":357,"6":191,"7":485,"8":205,"9":394,"10":395,"11":541,"12":372,"13":362,"14":176,"15":492,"16":366,"17":174,"18":327}'),
  ('Amarillas', 69.2, 128, 73.9, 142, 1, '{"1":421,"2":317,"3":133,"4":259,"5":292,"6":158,"7":451,"8":166,"9":338,"10":359,"11":496,"12":345,"13":327,"14":153,"15":457,"16":337,"17":152,"18":301}'),
  ('Azules', 65.7, 112, 70.1, 132, 2, '{"1":383,"2":300,"3":123,"4":251,"5":254,"6":134,"7":417,"8":131,"9":308,"10":329,"11":463,"12":301,"13":272,"14":121,"15":415,"16":281,"17":124,"18":265}'),
  ('Rojas', 63.2, 106, 67.6, 125, 3, '{"1":357,"2":262,"3":98,"4":219,"5":231,"6":114,"7":383,"8":96,"9":265,"10":294,"11":431,"12":267,"13":243,"14":85,"15":382,"16":261,"17":96,"18":243}')
) AS v(label, rating, slope, rating_women, slope_women, sort_order, yardages)
WHERE NOT EXISTS (
  SELECT 1 FROM public.course_tees t
   WHERE t.course_id = 'b0f5dd13-dff2-4aa3-999b-9cd30706a80e' AND t.label = v.label);
