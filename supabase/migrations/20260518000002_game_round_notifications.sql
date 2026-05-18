-- ============================================================================
-- Game & Round Notifications — schema.
-- Spec: docs/superpowers/specs/2026-05-18-game-and-round-notifications-design.md
-- Builds on 20260518000001_notifications.sql (notifications table,
-- create_notification). Safe to re-run. Apply in the Supabase SQL editor.
-- ============================================================================

-- 1) Fan-out helper: create one notification per accepted friend of p_actor.
--    Bakes the actor's display name into data.actor_name so both the push
--    text and the in-app inbox can render without an extra lookup.
CREATE OR REPLACE FUNCTION public.notify_friends(
  p_actor uuid, p_type text, p_data jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor_name text;
  v_data jsonb;
BEGIN
  IF p_actor IS NULL THEN RETURN; END IF;
  SELECT COALESCE(display_name, username, 'A friend') INTO v_actor_name
    FROM public.profiles WHERE user_id = p_actor;
  v_data := COALESCE(p_data, '{}'::jsonb)
            || jsonb_build_object('actor_name', COALESCE(v_actor_name, 'A friend'));
  INSERT INTO public.notifications (user_id, type, actor_id, entity_id, data)
  SELECT
    CASE WHEN f.requester_id = p_actor THEN f.addressee_id ELSE f.requester_id END,
    p_type, p_actor, NULL, v_data
  FROM public.friendships f
  WHERE f.status = 'accepted'
    AND (f.requester_id = p_actor OR f.addressee_id = p_actor);
END;
$$;

-- 2) Trigger: a user added to a CASUAL game gets an 'added_to_game'
--    notification. create_notification no-ops when recipient = actor, so a
--    creator appearing as their own participant is skipped. Official
--    tournaments are intentionally not covered (players self-join via tokens).
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
    PERFORM public.create_notification(
      NEW.user_id, 'added_to_game', v_creator, NULL,
      jsonb_build_object(
        'tournament_id', NEW.tournament_id,
        'tournament_name', COALESCE(v_name, 'a game')));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tournament_participants_notify ON public.tournament_participants;
CREATE TRIGGER tournament_participants_notify
  AFTER INSERT ON public.tournament_participants
  FOR EACH ROW EXECUTE FUNCTION public.notify_participant_added();

-- 3) Trigger: a player attesting their card in an official tournament has
--    finished their round — notify all of that player's friends. Guests
--    (roster rows with no linked account) are skipped.
CREATE OR REPLACE FUNCTION public.notify_attestation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user             uuid;
  v_round_index      int;
  v_tournament_id    text;
  v_course_name      text;
  v_tournament_name  text;
BEGIN
  SELECT user_id INTO v_user FROM public.tournament_roster WHERE id = NEW.roster_id;
  IF v_user IS NULL THEN RETURN NEW; END IF;
  SELECT r.round_index, r.tournament_id, COALESCE(r.course->>'name', '')
    INTO v_round_index, v_tournament_id, v_course_name
    FROM public.tournament_rounds r WHERE r.id = NEW.round_id;
  SELECT name INTO v_tournament_name
    FROM public.tournaments WHERE id = v_tournament_id;
  PERFORM public.notify_friends(v_user, 'round_finished', jsonb_build_object(
    'tournament_id',   v_tournament_id,
    'round_id',        NEW.round_id::text,
    'round_index',     v_round_index,
    'tournament_name', COALESCE(v_tournament_name, 'a tournament'),
    'course_name',     v_course_name,
    'kind',            'official'));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tournament_attestations_notify ON public.tournament_attestations;
CREATE TRIGGER tournament_attestations_notify
  AFTER INSERT ON public.tournament_attestations
  FOR EACH ROW EXECUTE FUNCTION public.notify_attestation();

-- 4) RPC: casual "round finished". The casual "Finish" button persists
--    nothing, so this is idempotent — a re-tap finds the existing
--    notification and returns. Actor is always the caller.
CREATE OR REPLACE FUNCTION public.notify_round_finished(
  p_tournament_id text, p_round_id text, p_round_index int,
  p_tournament_name text, p_course_name text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN RETURN; END IF;
  IF EXISTS (
    SELECT 1 FROM public.notifications
     WHERE actor_id = v_actor
       AND type = 'round_finished'
       AND data->>'round_id' = p_round_id
  ) THEN
    RETURN;
  END IF;
  PERFORM public.notify_friends(v_actor, 'round_finished', jsonb_build_object(
    'tournament_id',   p_tournament_id,
    'round_id',        p_round_id,
    'round_index',     p_round_index,
    'tournament_name', COALESCE(p_tournament_name, 'a game'),
    'course_name',     COALESCE(p_course_name, ''),
    'kind',            'casual'));
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_round_finished(text,text,int,text,text)
  TO authenticated;
