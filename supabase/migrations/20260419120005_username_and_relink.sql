-- ============================================================================
-- Usernames + smarter trigger + re-link Marbella to the 4 real users.
-- ============================================================================
--
-- 1) profiles.username: unique lowercase handle, separate from display_name
--    (free-text). Backfilled from email local part for existing users.
-- 2) sync_player_from_profile: on INSERT, if there is a library player with
--    a matching name and no user_id yet, link to it instead of creating a
--    duplicate. Drops the need for a manual one-off each time a friend signs
--    up with an email that doesn't match their "real" name.
-- 3) Fix the 4 Marbella embedded players: stamp user_id on each so personal
--    stats / claim / member lookups match by user_id, not by string name.
-- 4) Library cleanup: de-dupe Alex / Marcos / Noé, fix the Noé mojibake.

-- 1) username column --------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username text;

DROP INDEX IF EXISTS profiles_username_uq;
CREATE UNIQUE INDEX profiles_username_uq ON public.profiles (lower(username))
  WHERE username IS NOT NULL;

-- Backfill usernames from email local parts (lowercased). If someone's
-- local-part collides with an existing username, append their first 4
-- user_id chars as a suffix.
DO $$
DECLARE
  p record;
  candidate text;
BEGIN
  FOR p IN
    SELECT u.id, u.email
      FROM auth.users u
      JOIN public.profiles pr ON pr.user_id = u.id
     WHERE pr.username IS NULL
  LOOP
    candidate := lower(regexp_replace(split_part(p.email, '@', 1), '[^a-z0-9_]', '', 'g'));
    IF candidate = '' THEN candidate := 'user'; END IF;
    IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = candidate) THEN
      candidate := candidate || '_' || substring(p.id::text from 1 for 4);
    END IF;
    UPDATE public.profiles SET username = candidate, updated_at = now()
     WHERE user_id = p.id;
  END LOOP;
END $$;

-- 2) Smarter sync_player_from_profile ---------------------------------------
--    Match on name (case-insensitive, trimmed) against an unlinked library
--    player before inserting a new one.
CREATE OR REPLACE FUNCTION public.sync_player_from_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_player_id uuid;
BEGIN
  IF NEW.display_name IS NULL OR length(trim(NEW.display_name)) = 0 THEN
    RETURN NEW;
  END IF;

  -- Already linked to a library player? Just sync name + handicap.
  SELECT id INTO v_player_id FROM public.players WHERE user_id = NEW.user_id;
  IF v_player_id IS NOT NULL THEN
    UPDATE public.players
       SET name = NEW.display_name,
           handicap = COALESCE(NEW.handicap, 0)
     WHERE id = v_player_id;
    RETURN NEW;
  END IF;

  -- Prefer an unclaimed player with a matching name — it's likely the same
  -- person, added to the library before they had an account.
  SELECT id INTO v_player_id
    FROM public.players
   WHERE user_id IS NULL
     AND lower(trim(name)) = lower(trim(NEW.display_name))
   LIMIT 1;
  IF v_player_id IS NOT NULL THEN
    UPDATE public.players
       SET user_id = NEW.user_id,
           handicap = COALESCE(NEW.handicap, handicap)
     WHERE id = v_player_id;
  ELSE
    INSERT INTO public.players (user_id, name, handicap)
    VALUES (NEW.user_id, NEW.display_name, COALESCE(NEW.handicap, 0));
  END IF;

  RETURN NEW;
END;
$$;

-- 3) De-dupe the library + re-link Marbella ---------------------------------
DO $$
DECLARE
  v_guille uuid := '9a2d6444-2777-4ec7-af26-6c5605a31495';
  v_noe    uuid := '785bafbe-c2fe-4733-affb-e3c199d3fafe';
  v_marcos uuid := '7a9ec70d-4a4c-4509-bfbb-f1ba09120729';
  v_alex   uuid := '94af29cb-9f4d-4cce-ad88-76ee88b22f00';
BEGIN
  -- Fix the mojibake Noé display_name so the trigger-driven sync stops
  -- producing "NoÃ©" library rows.
  UPDATE public.profiles
     SET display_name = 'Noé', updated_at = now()
   WHERE user_id = v_noe AND display_name <> 'Noé';

  -- Library de-dupe: delete the trigger-created duplicate first (otherwise
  -- the UNIQUE(user_id) index blocks re-assigning ownership), then move
  -- user_id onto the original library row that Marbella references.
  DELETE FROM public.players WHERE id = '2c873409-c574-41be-9b19-1f4fc03b94c0';
  UPDATE public.players SET user_id = v_alex
   WHERE id = '737a49c8-cac1-4d03-9282-5a58a06f9cae';

  DELETE FROM public.players WHERE id = '8b5bb3aa-dfe4-4df1-83ed-519ededc0151';
  UPDATE public.players SET user_id = v_marcos
   WHERE id = '95c89948-dc93-4ef1-a7ad-dbb638af98d9';

  DELETE FROM public.players WHERE id = 'db285b54-a665-4bfd-a169-0c2c91dfda99';
  UPDATE public.players SET user_id = v_noe, name = 'Noé'
   WHERE id = 'e6e97499-d506-4030-9183-5c96861258cf';

  -- Guille is already linked correctly; nothing to do.

  -- 4) Stamp user_id on Marbella's 4 embedded players. jsonb_set builds
  --    the new array element-by-element.
  UPDATE public.tournaments t
     SET data = jsonb_set(
       t.data,
       '{players}',
       (
         SELECT jsonb_agg(
           CASE
             WHEN elem->>'id' = '737a49c8-cac1-4d03-9282-5a58a06f9cae' THEN elem || jsonb_build_object('user_id', v_alex)
             WHEN elem->>'id' = 'f52eda0d-88d2-47bd-90c6-a61143222448' THEN elem || jsonb_build_object('user_id', v_guille)
             WHEN elem->>'id' = '95c89948-dc93-4ef1-a7ad-dbb638af98d9' THEN elem || jsonb_build_object('user_id', v_marcos)
             WHEN elem->>'id' = 'e6e97499-d506-4030-9183-5c96861258cf' THEN elem || jsonb_build_object('user_id', v_noe)
             ELSE elem
           END
         )
           FROM jsonb_array_elements(t.data->'players') AS elem
       )
     )
   WHERE t.id = '1776469141517';

  -- Also propagate user_id into round.pairs snapshots in Marbella. These
  -- are used by the scorecard to tag who owns which score.
  UPDATE public.tournaments t
     SET data = jsonb_set(
       t.data,
       '{rounds}',
       (
         SELECT jsonb_agg(
           jsonb_set(
             round_elem,
             '{pairs}',
             COALESCE(
               (
                 SELECT jsonb_agg(
                   (
                     SELECT jsonb_agg(
                       CASE
                         WHEN pp->>'id' = '737a49c8-cac1-4d03-9282-5a58a06f9cae' THEN pp || jsonb_build_object('user_id', v_alex)
                         WHEN pp->>'id' = 'f52eda0d-88d2-47bd-90c6-a61143222448' THEN pp || jsonb_build_object('user_id', v_guille)
                         WHEN pp->>'id' = '95c89948-dc93-4ef1-a7ad-dbb638af98d9' THEN pp || jsonb_build_object('user_id', v_marcos)
                         WHEN pp->>'id' = 'e6e97499-d506-4030-9183-5c96861258cf' THEN pp || jsonb_build_object('user_id', v_noe)
                         ELSE pp
                       END
                     )
                       FROM jsonb_array_elements(pair_elem) AS pp
                   )
                 )
                   FROM jsonb_array_elements(round_elem->'pairs') AS pair_elem
               ),
               round_elem->'pairs'
             )
           )
         )
           FROM jsonb_array_elements(t.data->'rounds') AS round_elem
       )
     )
   WHERE t.id = '1776469141517';
END $$;

/* VERIFY
   SELECT username, display_name, user_id FROM public.profiles ORDER BY username;
   SELECT name, user_id FROM public.players ORDER BY name;
   SELECT jsonb_agg(p->>'name' || ' → ' || (p->>'user_id')) FROM
     public.tournaments, jsonb_array_elements(data->'players') p WHERE id = '1776469141517';
*/
