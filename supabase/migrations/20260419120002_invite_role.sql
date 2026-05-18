-- Per-invite role so owners can mint either editor or viewer codes.
-- Default editor: the common case is "friends scoring a tournament together,"
-- not spectators. Viewer invites become an opt-in the owner can flip.

ALTER TABLE public.tournament_invites
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'editor';

-- Anything that was 'viewer' on an existing invite becomes 'editor' to
-- align with the new default. If you want to keep a code as viewer-only,
-- UPDATE that row explicitly afterwards.
UPDATE public.tournament_invites SET role = 'editor' WHERE role = 'viewer';

-- Already applied to the project 2026-04-19.
