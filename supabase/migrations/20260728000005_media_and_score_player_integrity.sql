-- ============================================================================
-- Stop new orphans in tournament_media, without disturbing the existing ones.
--
-- PROBLEM
-- -------
--   tournament_media had NO foreign key to tournaments -- only uploader_id ->
--   auth.users. So when a game was hard-deleted (before soft-delete landed in
--   20260728000004), its photos were left behind: the rows survived pointing
--   at a tournament id that no longer exists, and their Storage objects were
--   never cleaned up either.
--
--   Found on prod 2026-07-28: 4 photo rows orphaned from tournament
--   1783415941585, deleted 7 Jul. Their Storage objects are STILL PRESENT
--   (verified: HTTP 200), so those photos are recoverable -- which is exactly
--   why this migration does not delete them.
--
-- FIX
-- ---
--   A real foreign key, added NOT VALID.
--
--   NOT VALID is the point, not a shortcut: it enforces the constraint on
--   every INSERT and UPDATE from now on, while leaving pre-existing rows
--   alone. New orphans become impossible; the four historic ones stay exactly
--   where they are until somebody decides what to do with them (see RECOVER
--   below). Running VALIDATE CONSTRAINT later would check them and fail --
--   deliberately -- until they are resolved.
--
--   ON DELETE CASCADE is now safe: since 20260728000004, deleting a game
--   writes a `deleted_at` tombstone rather than removing the row, so the
--   cascade only ever fires on a deliberate hard purge -- where taking the
--   photos with it is the correct behaviour.
--
-- Idempotent (DROP IF EXISTS + ADD); safe to re-run. No rows are modified.
-- ============================================================================

ALTER TABLE public.tournament_media
  DROP CONSTRAINT IF EXISTS tournament_media_tournament_id_fkey;
ALTER TABLE public.tournament_media
  ADD CONSTRAINT tournament_media_tournament_id_fkey
  FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id)
  ON DELETE CASCADE
  NOT VALID;

-- golf_shot stores round_id with no tournament and no reference of any kind.
-- It has no orphans today, but nothing prevents them, and a composite FK is
-- impossible without a tournament_id column. Record the gap rather than paper
-- over it:
COMMENT ON COLUMN public.golf_shot.round_id IS
  'Round id WITHOUT a tournament id, so this cannot be foreign-keyed to '
  'game_rounds (whose PK is (tournament_id, id)). Round ids were only unique '
  'per-tournament until 2026-07-23 -- "r0" belongs to 41 different games -- so '
  'a tournament_id column is needed before this can be constrained. No '
  'orphans exist today; verified 2026-07-28.';

/* ===========================================================================
   HOW TO RUN
   ---------------------------------------------------------------------------
   Paste into the Supabase SQL editor and Run. Idempotent -- safe to re-run.
   Destroys nothing.

   VERIFY
   ---------------------------------------------------------------------------
   SELECT conname, convalidated FROM pg_constraint
    WHERE conrelid = 'public.tournament_media'::regclass AND contype = 'f';
   -- expected: tournament_media_tournament_id_fkey with convalidated = false
   --           (false is correct here -- see NOT VALID above)

   -- a new orphan is now rejected with 23503:
   -- INSERT INTO public.tournament_media (tournament_id, kind, storage_path)
   -- VALUES ('no-such-game', 'photo', 'x.jpg');

   RECOVER the four orphaned photos
   ---------------------------------------------------------------------------
   -- Their game (1783415941585) is gone, but the rows and the Storage objects
   -- both survive. To get the images back, download each storage_path from
   -- the `tournament-media` bucket:
   SELECT id, storage_path, created_at
     FROM public.tournament_media m
    WHERE NOT EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = m.tournament_id);

   -- Once saved somewhere (or judged not worth keeping):
   -- DELETE FROM public.tournament_media m
   --  WHERE NOT EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = m.tournament_id);
   -- ...after which the constraint can be validated:
   -- ALTER TABLE public.tournament_media VALIDATE CONSTRAINT tournament_media_tournament_id_fkey;
   =========================================================================== */
