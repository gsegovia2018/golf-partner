-- ============================================================================
-- round.startedAt is first-write-wins on the server, like finishedAt.
-- ============================================================================
--
-- The Scorecard stamps `startedAt` on the round's first score tap — the tee
-- time the durations (feed, round summary, report card) start from. Two
-- phones scoring the same round both stamp it; the earlier tap must stand,
-- and a device whose cached copy never saw the stamp must not move it. Same
-- rule 20260906000002 gave `finishedAt`; the body is otherwise identical.
-- Idempotent (CREATE OR REPLACE).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.patch_game_round(p_tournament_id text, p_round_id text, p_patch jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_body jsonb;
  v_k text;
  v_v jsonb;
BEGIN
  SELECT body INTO v_body FROM public.game_rounds
   WHERE tournament_id = p_tournament_id AND id = p_round_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such round % in tournament %', p_round_id, p_tournament_id;
  END IF;

  FOR v_k, v_v IN SELECT * FROM jsonb_each(p_patch) LOOP
    IF v_k IN ('finishedAt', 'startedAt')
      AND jsonb_typeof(v_v) <> 'null'
      AND jsonb_typeof(v_body -> v_k) IN ('string', 'number') THEN
      -- First write wins: an existing stamp is never moved by a later one.
      NULL;
    ELSIF jsonb_typeof(v_v) = 'object' AND jsonb_typeof(v_body -> v_k) = 'object' THEN
      v_body := jsonb_set(v_body, ARRAY[v_k], (v_body -> v_k) || v_v);
    ELSE
      v_body := jsonb_set(v_body, ARRAY[v_k], v_v);
    END IF;
  END LOOP;

  UPDATE public.game_rounds SET body = v_body, updated_at = now()
   WHERE tournament_id = p_tournament_id AND id = p_round_id;
END $$;
