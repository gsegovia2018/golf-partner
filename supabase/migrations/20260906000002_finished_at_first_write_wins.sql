-- ============================================================================
-- finishedAt is first-write-wins on the server, for tournaments AND rounds.
-- ============================================================================
--
-- The feed and the History tab sort on the finalization stamp — the instant
-- Finish was FIRST tapped. The client already guards this (mutate.js:
-- `round.setFinished` and `tournament.setFinished` skip when a stamp exists),
-- but a device whose cached copy never saw the stamp (finished on another
-- phone, offline since) still sends a fresh one, and the generic one-level
-- merge in patch_game_tournament / patch_game_round would overwrite the
-- server's older value — re-surfacing a month-old game at the top of every
-- friend's feed. Observed 2026-09-06 on a game created 2026-08-04 whose
-- props.finishedAt was re-stamped that night with no scoring activity.
--
-- Rule, for the `finishedAt` key only:
--   * a non-null patch value lands ONLY when no non-null stamp exists;
--   * a jsonb null still clears it (Reopen);
--   * every other key keeps the existing merge semantics untouched.
--
-- Bodies are otherwise identical to the live definitions
-- (patch_game_tournament: 20260715000006; patch_game_round: 20260712000000).
-- Idempotent (CREATE OR REPLACE).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.patch_game_tournament(p_id text, p_patch jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_props jsonb;
  v_k text;
  v_v jsonb;
  v_set_name boolean := false;
  v_set_kind boolean := false;
  v_name text;
  v_kind text;
BEGIN
  SELECT props INTO v_props FROM public.tournaments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such tournament %', p_id;
  END IF;

  IF NOT public.can_edit_tournament(p_id, auth.uid()) THEN
    RAISE EXCEPTION 'not authorized to edit tournament %', p_id USING ERRCODE = '42501';
  END IF;

  FOR v_k, v_v IN SELECT * FROM jsonb_each(p_patch) LOOP
    -- name/kind are NOT NULL columns: a jsonb null for either is treated as
    -- "skip the column update". Unlike body/props keys, null cannot mean
    -- "clear". name is never merged into props (real, unconstrained column).
    -- kind IS additionally merged into props — see the function header.
    IF v_k = 'name' THEN
      IF jsonb_typeof(v_v) <> 'null' THEN
        v_name := v_v #>> '{}';
        v_set_name := true;
      END IF;
    ELSIF v_k = 'kind' THEN
      IF jsonb_typeof(v_v) <> 'null' THEN
        -- Domain kind into props (what get_game_tournament emits)...
        v_props := jsonb_set(v_props, ARRAY['kind'], v_v);
        -- ...and the derived casual/official value into the CHECK-
        -- constrained column, never the raw patched value.
        v_kind := CASE WHEN (v_v #>> '{}') = 'official' THEN 'official' ELSE 'casual' END;
        v_set_kind := true;
      END IF;
    ELSIF v_k = 'currentRound' THEN
      PERFORM public.advance_game_round(p_id, (v_v #>> '{}')::int);
    ELSIF v_k = 'finishedAt'
      AND jsonb_typeof(v_v) <> 'null'
      AND jsonb_typeof(v_props -> 'finishedAt') IN ('string', 'number') THEN
      -- First write wins: an existing stamp is never moved by a later one.
      NULL;
    ELSE
      IF jsonb_typeof(v_v) = 'object' AND jsonb_typeof(v_props -> v_k) = 'object' THEN
        v_props := jsonb_set(v_props, ARRAY[v_k], (v_props -> v_k) || v_v);
      ELSE
        v_props := jsonb_set(v_props, ARRAY[v_k], v_v);
      END IF;
    END IF;
  END LOOP;

  UPDATE public.tournaments
     SET props = v_props,
         name  = CASE WHEN v_set_name THEN v_name ELSE name END,
         kind  = CASE WHEN v_set_kind THEN v_kind ELSE kind END
   WHERE id = p_id;
END $function$;

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
    IF v_k = 'finishedAt'
      AND jsonb_typeof(v_v) <> 'null'
      AND jsonb_typeof(v_body -> 'finishedAt') IN ('string', 'number') THEN
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

/* =========================================================================
   VERIFY (run after applying, inside a rolled-back transaction)
   ---------------------------
   -- Given a tournament whose props.finishedAt = '2026-08-04T19:24:55.450Z':
   SELECT public.patch_game_tournament('<id>', '{"finishedAt":"2026-09-06T00:50:07.516Z"}');
   SELECT props->>'finishedAt' FROM public.tournaments WHERE id = '<id>';
   -- → still 2026-08-04T19:24:55.450Z
   SELECT public.patch_game_tournament('<id>', '{"finishedAt":null}');
   -- → NULL (reopen still clears)
   ========================================================================= */
