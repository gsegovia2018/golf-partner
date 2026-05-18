-- ============================================================================
-- Friend Request Notifications — schema.
-- Spec: docs/superpowers/specs/2026-05-18-friend-request-notifications-design.md
-- Safe to re-run (every statement idempotent). Apply in the Supabase SQL editor.
-- ============================================================================

-- 1) Generic notifications table. Knows nothing about friendships — `type` is
--    a free-text event string and `entity_id` is a polymorphic (FK-less)
--    reference, so future notification types reuse this table unchanged.
CREATE TABLE IF NOT EXISTS public.notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (length(type) > 0),
  actor_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  entity_id   uuid,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON public.notifications (user_id, read_at);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_select ON public.notifications
  FOR SELECT USING (user_id = auth.uid());

-- Clients only ever flip read_at; no INSERT/DELETE policy — rows are written
-- by create_notification and removed by delete_notification_for_entity.
DROP POLICY IF EXISTS notifications_update ON public.notifications;
CREATE POLICY notifications_update ON public.notifications
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 2) Expo push tokens, one row per device.
CREATE TABLE IF NOT EXISTS public.push_tokens (
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token       text NOT NULL,
  platform    text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, token)
);

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

-- Owner-only. The edge function reads tokens with the service-role key, which
-- bypasses RLS, so other clients never see another user's tokens.
DROP POLICY IF EXISTS push_tokens_all ON public.push_tokens;
CREATE POLICY push_tokens_all ON public.push_tokens
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 3) Single insertion point for every notification type. SECURITY DEFINER so
--    triggers can write rows the caller could not insert directly. No-op when
--    the recipient is the actor (never notify yourself).
CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id uuid, p_type text, p_actor_id uuid, p_entity_id uuid, p_data jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_user_id IS NULL OR p_user_id = p_actor_id THEN
    RETURN;
  END IF;
  INSERT INTO public.notifications (user_id, type, actor_id, entity_id, data)
  VALUES (p_user_id, p_type, p_actor_id, p_entity_id, COALESCE(p_data, '{}'::jsonb));
END;
$$;

-- 4) Cleanup helper — removes the caller's notification(s) for a given entity
--    (used when a friend request is declined). Scoped to auth.uid() so a
--    caller can only ever delete their own notifications.
CREATE OR REPLACE FUNCTION public.delete_notification_for_entity(
  p_entity_id uuid, p_type text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.notifications
  WHERE entity_id = p_entity_id
    AND type = p_type
    AND user_id = auth.uid();
END;
$$;

-- 5) The only friendship-specific server code: turn friendship row changes
--    into notifications. actor_name is baked into data so the edge function
--    never has to look it up.
CREATE OR REPLACE FUNCTION public.notify_friendship() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor_name text;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    SELECT COALESCE(display_name, username, 'A golfer') INTO actor_name
      FROM public.profiles WHERE user_id = NEW.requester_id;
    PERFORM public.create_notification(
      NEW.addressee_id, 'friend_request', NEW.requester_id, NEW.id,
      jsonb_build_object('actor_name', COALESCE(actor_name, 'A golfer')));
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    SELECT COALESCE(display_name, username, 'A golfer') INTO actor_name
      FROM public.profiles WHERE user_id = NEW.addressee_id;
    PERFORM public.create_notification(
      NEW.requester_id, 'friend_accepted', NEW.addressee_id, NEW.id,
      jsonb_build_object('actor_name', COALESCE(actor_name, 'A golfer')));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS friendships_notify ON public.friendships;
CREATE TRIGGER friendships_notify
  AFTER INSERT OR UPDATE ON public.friendships
  FOR EACH ROW EXECUTE FUNCTION public.notify_friendship();
