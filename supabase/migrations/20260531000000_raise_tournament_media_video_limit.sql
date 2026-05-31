-- Allow short phone videos that exceed the original 25 MB cap while keeping
-- tournament media bounded enough for mobile upload/playback.
UPDATE storage.buckets
   SET file_size_limit = 104857600,
       allowed_mime_types = ARRAY[
         'image/jpeg','image/png','image/webp','image/heic','image/heif',
         'video/mp4','video/quicktime','video/webm'
       ]
 WHERE id = 'tournament-media';
