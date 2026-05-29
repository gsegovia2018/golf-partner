-- ============================================================================
-- Participant editor invites
--
-- App-linked players added to a casual game should not need the QR code. When
-- their participant row is indexed, grant editor membership and send the
-- existing "added_to_game" notification so the game appears in-app.
-- Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_participant_added() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_kind    text;
  v_name    text;
  v_creator uuid;
BEGIN
  SELECT kind, name, created_by INTO v_kind, v_name, v_creator
    FROM public.tournaments WHERE id = NEW.tournament_id;

  IF v_kind = 'casual' THEN
    IF v_creator IS NULL OR NEW.user_id <> v_creator THEN
      INSERT INTO public.tournament_members (tournament_id, user_id, role)
      VALUES (NEW.tournament_id, NEW.user_id, 'editor')
      ON CONFLICT (tournament_id, user_id) DO UPDATE
        SET role = CASE
          WHEN public.tournament_members.role = 'owner' THEN 'owner'
          ELSE 'editor'
        END;
    END IF;

    PERFORM public.create_notification(
      NEW.user_id, 'added_to_game', v_creator, NULL,
      jsonb_build_object(
        'tournament_id', NEW.tournament_id,
        'tournament_name', COALESCE(v_name, 'a game')));
  END IF;
  RETURN NEW;
END;
$$;
