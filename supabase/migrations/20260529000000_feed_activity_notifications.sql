-- ============================================================================
-- Feed activity notifications.
-- ============================================================================
--
-- Reactions and comments are written client-side to feed_reactions/feed_comments.
-- This RPC fans those actions out to accepted friends who are also linked to
-- the same round's tournament. It is intentionally best-effort from the client:
-- the feed action succeeds even if this notification call is unavailable.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_feed_activity(
  p_tournament_id text,
  p_round_id text,
  p_item_key text,
  p_type text,
  p_round_index int DEFAULT 0,
  p_tournament_name text DEFAULT '',
  p_course_name text DEFAULT '',
  p_emoji text DEFAULT '',
  p_comment_body text DEFAULT ''
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_data jsonb;
BEGIN
  IF v_actor IS NULL THEN RETURN; END IF;
  IF p_type NOT IN ('feed_reaction', 'feed_comment') THEN RETURN; END IF;

  SELECT COALESCE(display_name, username, 'A friend') INTO v_actor_name
    FROM public.profiles WHERE user_id = v_actor;

  v_data := jsonb_build_object(
    'actor_name', COALESCE(v_actor_name, 'A friend'),
    'tournament_id', p_tournament_id,
    'round_id', p_round_id,
    'round_index', COALESCE(p_round_index, 0),
    'item_key', p_item_key,
    'tournament_name', COALESCE(p_tournament_name, ''),
    'course_name', COALESCE(p_course_name, ''),
    'emoji', COALESCE(p_emoji, ''),
    'comment_body', left(COALESCE(p_comment_body, ''), 120)
  );

  WITH tournament_blob AS (
    SELECT data::jsonb AS data
      FROM public.tournaments
     WHERE id = p_tournament_id
  ),
  round_players AS (
    SELECT DISTINCT NULLIF(player.value->>'user_id', '')::uuid AS user_id
      FROM tournament_blob t
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(t.data->'players', '[]'::jsonb)) AS player(value)
     WHERE NULLIF(player.value->>'user_id', '') IS NOT NULL
       AND EXISTS (
         SELECT 1
           FROM jsonb_array_elements(COALESCE(t.data->'rounds', '[]'::jsonb)) AS round(value)
          WHERE round.value->>'id' = p_round_id
            AND COALESCE(round.value->'scores', '{}'::jsonb) ? (player.value->>'id')
       )
  ),
  recipients AS (
    SELECT user_id FROM round_players
    UNION
    SELECT tp.user_id
      FROM public.tournament_participants tp
     WHERE tp.tournament_id = p_tournament_id
       AND NOT EXISTS (SELECT 1 FROM round_players)
  )
  INSERT INTO public.notifications (user_id, type, actor_id, entity_id, data)
  SELECT DISTINCT r.user_id, p_type, v_actor, NULL, v_data
    FROM recipients r
   WHERE r.user_id IS NOT NULL
     AND r.user_id <> v_actor
     AND public.are_friends(r.user_id, v_actor);
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_feed_activity(text,text,text,text,int,text,text,text,text)
  TO authenticated;
