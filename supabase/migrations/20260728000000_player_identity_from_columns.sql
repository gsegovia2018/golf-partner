-- ============================================================================
-- Player identity comes from the COLUMNS, not from body.
--
-- game_players stored player_id and user_id twice: as columns and inside the
-- body jsonb. The duplication forced claim/release to dual-write body, and
-- because body is NOT NULL DEFAULT '{}' with no CHECK, an id-less body was a
-- legal row. A realtime consumer that trusted body for the id therefore got a
-- player with no id -- nameless in the roster, and DUPLICATED by the next
-- event because it could no longer be matched (fixed client-side at 8548493;
-- this closes it at the source).
--
-- get_game_tournament now projects id/user_id from the columns.
--
-- ONE OBSERVABLE DELTA, measured on prod 2026-07-28: 27 players across 14 of
-- 48 tournaments carried a body with a `user_id` key set to JSON null (an
-- artifact of the old release path's `body - 'user_id'` / jsonb_set churn)
-- while the column was NULL. Those players used to be emitted as
-- "user_id": null and are now emitted with the key ABSENT. Nothing else
-- changes -- reproducing the old rule (keep a null-valued key when body had
-- one) yields byte-identical output for all 48, so this null-vs-absent
-- difference is the complete diff.
--
-- Safe for already-installed builds: every client read of a player's user_id
-- is either truthiness (`p.user_id && ...`, `p.user_id ? ... : ...`,
-- `!p.user_id`, `p.user_id ?? null`) or an equality test against a real uuid.
-- null and undefined behave identically under all of those, and NO consumer
-- anywhere does a key-presence check (`'user_id' in p` / hasOwnProperty /
-- Object.keys) -- verified across every src/ read site.
--
-- Idempotent (CREATE OR REPLACE / IF EXISTS); safe to re-run.
-- ============================================================================

-- 1) Constraint: body's id must agree with the primary key. NOT VALID keeps
--    the DDL non-blocking; VALIDATE then checks the (small) existing table.
ALTER TABLE public.game_players
  DROP CONSTRAINT IF EXISTS game_players_body_id_matches;
ALTER TABLE public.game_players
  ADD CONSTRAINT game_players_body_id_matches
  CHECK (body->>'id' = player_id) NOT VALID;
ALTER TABLE public.game_players
  VALIDATE CONSTRAINT game_players_body_id_matches;

-- 2) Read path: project identity from the columns. ONLY the 'players'
--    aggregate changes; every other line is verbatim from
--    20260712000000_sync_v2_normalized.sql.
CREATE OR REPLACE FUNCTION public.get_game_tournament(p_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_t   record;
  v_out jsonb;
BEGIN
  SELECT * INTO v_t FROM public.tournaments WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_out := v_t.props || jsonb_build_object(
    'id', v_t.id, 'name', v_t.name,
    'kind', COALESCE(v_t.props->>'kind', v_t.kind),
    'createdAt', to_char(v_t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    -- id ALWAYS from the column. user_id added ONLY when non-null, so an
    -- unclaimed slot still has NO user_id key (not a null-valued one) and the
    -- emitted object matches today byte for byte.
    'players', COALESCE((
      SELECT jsonb_agg(
        CASE WHEN gp.user_id IS NULL
             THEN (gp.body - 'user_id') || jsonb_build_object('id', gp.player_id)
             ELSE gp.body || jsonb_build_object('id', gp.player_id,
                                                'user_id', gp.user_id::text)
        END
        ORDER BY gp.pos, gp.player_id)
      FROM public.game_players gp WHERE gp.tournament_id = p_id), '[]'::jsonb),
    'rounds', COALESCE((
      SELECT jsonb_agg(
        (gr.body - 'notes')
        || jsonb_build_object('id', gr.id)
        || jsonb_build_object('scores', COALESCE((
             SELECT jsonb_object_agg(q.player_id, q.per) FROM (
               SELECT s.player_id, jsonb_object_agg(s.hole::text, s.strokes) AS per
               FROM public.game_scores s
               WHERE s.round_id = gr.id AND s.tournament_id = gr.tournament_id AND s.strokes IS NOT NULL
               GROUP BY s.player_id) q), '{}'::jsonb))
        || jsonb_build_object('shotDetails', COALESCE((
             SELECT jsonb_object_agg(q.player_id, q.per) FROM (
               SELECT d.player_id, jsonb_object_agg(d.hole::text, d.detail) AS per
               FROM public.game_shot_details d
               WHERE d.round_id = gr.id AND d.tournament_id = gr.tournament_id AND d.detail IS NOT NULL
               GROUP BY d.player_id) q), '{}'::jsonb))
        || COALESCE((
             SELECT jsonb_build_object('notes',
               COALESCE((SELECT jsonb_build_object('round', n.note)
                         FROM public.game_round_notes n
                         WHERE n.round_id = gr.id AND n.tournament_id = gr.tournament_id AND n.hole_key = 'round' AND n.note IS NOT NULL), '{}'::jsonb)
               || COALESCE((SELECT jsonb_build_object('hole', jsonb_object_agg(n.hole_key, n.note))
                            FROM public.game_round_notes n
                            WHERE n.round_id = gr.id AND n.tournament_id = gr.tournament_id AND n.hole_key <> 'round' AND n.note IS NOT NULL
                            HAVING count(*) > 0), '{}'::jsonb))
             WHERE EXISTS (SELECT 1 FROM public.game_round_notes n2
                           WHERE n2.round_id = gr.id AND n2.tournament_id = gr.tournament_id AND n2.note IS NOT NULL)), '{}'::jsonb)
        ORDER BY gr.round_index, gr.id)
      FROM public.game_rounds gr WHERE gr.tournament_id = p_id), '[]'::jsonb));

  IF v_t.current_round IS NOT NULL THEN
    v_out := (v_out - 'currentRound') || jsonb_build_object('currentRound', v_t.current_round);
  ELSE
    v_out := v_out - 'currentRound';
  END IF;
  RETURN v_out;
END $$;

-- 3) Write path: the column is the source of truth, so stop touching body.
--    Everything else (auth checks, FOR UPDATE lock, legacy data mirror) is
--    verbatim from 20260713010000_claim_release_from_game_players.sql.
CREATE OR REPLACE FUNCTION public.claim_tournament_player(
  p_tournament_id text,
  p_player_id     text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_gp_user uuid;
  v_data    jsonb;
  v_idx     int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Must be signed in to claim a player';
  END IF;
  IF NOT public.can_edit_tournament(p_tournament_id, v_uid) THEN
    RAISE EXCEPTION 'You are not a member of this tournament';
  END IF;

  SELECT user_id INTO v_gp_user
    FROM public.game_players
   WHERE tournament_id = p_tournament_id AND player_id = p_player_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such player slot';
  END IF;
  IF v_gp_user IS NOT NULL AND v_gp_user <> v_uid THEN
    RAISE EXCEPTION 'SLOT_TAKEN';
  END IF;

  -- Column only: get_game_tournament projects user_id from here.
  UPDATE public.game_players
     SET user_id    = v_uid,
         updated_at = now()
   WHERE tournament_id = p_tournament_id AND player_id = p_player_id;

  -- Legacy data mirror (removed entirely in 20260728000002).
  SELECT data INTO v_data FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF v_data IS NOT NULL AND jsonb_typeof(v_data -> 'players') = 'array' THEN
    SELECT ord - 1 INTO v_idx
      FROM jsonb_array_elements(v_data -> 'players') WITH ORDINALITY AS t(elem, ord)
     WHERE elem ->> 'id' = p_player_id
     LIMIT 1;
    IF v_idx IS NOT NULL THEN
      UPDATE public.tournaments
         SET data = jsonb_set(v_data, ARRAY['players', v_idx::text, 'user_id'],
                              to_jsonb(v_uid::text), true)
       WHERE id = p_tournament_id;
    END IF;
  END IF;

  RETURN p_player_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_tournament_player(text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.claim_tournament_player(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.release_tournament_player(
  p_tournament_id text,
  p_player_id     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_claimer uuid;
  v_data    jsonb;
  v_idx     int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Must be signed in';
  END IF;
  IF NOT public.is_tournament_owner(p_tournament_id, v_uid) THEN
    RAISE EXCEPTION 'Only the tournament owner can release a player';
  END IF;

  SELECT user_id INTO v_claimer
    FROM public.game_players
   WHERE tournament_id = p_tournament_id AND player_id = p_player_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such player slot';
  END IF;

  UPDATE public.game_players
     SET user_id    = NULL,
         updated_at = now()
   WHERE tournament_id = p_tournament_id AND player_id = p_player_id;

  SELECT data INTO v_data FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF v_data IS NOT NULL AND jsonb_typeof(v_data -> 'players') = 'array' THEN
    SELECT ord - 1 INTO v_idx
      FROM jsonb_array_elements(v_data -> 'players') WITH ORDINALITY AS t(elem, ord)
     WHERE elem ->> 'id' = p_player_id
     LIMIT 1;
    IF v_idx IS NOT NULL THEN
      UPDATE public.tournaments
         SET data = jsonb_set(v_data, ARRAY['players', v_idx::text],
                              ((v_data -> 'players' -> v_idx) - 'user_id'), false)
       WHERE id = p_tournament_id;
    END IF;
  END IF;

  IF v_claimer IS NOT NULL
     AND NOT public.is_tournament_owner(p_tournament_id, v_claimer) THEN
    DELETE FROM public.tournament_members
     WHERE tournament_id = p_tournament_id
       AND user_id = v_claimer;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.release_tournament_player(text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.release_tournament_player(text, text) TO authenticated;

/* ===========================================================================
   HOW TO RUN
   ---------------------------------------------------------------------------
   Paste into the Supabase SQL editor and Run. Idempotent -- safe to re-run.

   VERIFY
   ---------------------------------------------------------------------------
   -- constraint present and validated
   SELECT conname, convalidated FROM pg_constraint
    WHERE conrelid = 'public.game_players'::regclass
      AND conname = 'game_players_body_id_matches';

   -- a claimed slot still emits user_id; an unclaimed one still OMITS the key
   SELECT p->>'id' AS id, p ? 'user_id' AS has_user_id
     FROM jsonb_array_elements(
            public.get_game_tournament('<a tournament id>')->'players') p;
   =========================================================================== */
