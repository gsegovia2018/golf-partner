-- ============================================================================
-- Defense-in-depth: explicit authz guards on the tournament-mutating RPCs.
-- ============================================================================
--
-- patch_game_tournament and advance_game_round are SECURITY INVOKER, so their
-- UPDATE on public.tournaments is already subject to the tournaments_update RLS
-- (can_edit_tournament). But an unauthorized caller who can merely VIEW the
-- tournament passes the initial SELECT and then the UPDATE simply matches 0
-- rows — a SILENT no-op, not an error. That hides real authorization failures
-- from the sync layer (the write "succeeds" but nothing changes).
--
-- This adds an explicit can_edit_tournament(p_id, auth.uid()) check that RAISEs
-- 42501 (insufficient_privilege) so unauthorized mutations fail loudly, and the
-- functions no longer depend solely on RLS for authorization. Behaviour for
-- authorized callers (creator / editor-member) is unchanged.
--
-- Bodies are otherwise identical to the live definitions (verified 2026-07-15);
-- only the guard is prepended. Idempotent (CREATE OR REPLACE).
-- ============================================================================

-- advance_game_round: was LANGUAGE sql; reworked to plpgsql to carry the guard.
CREATE OR REPLACE FUNCTION public.advance_game_round(p_id text, p_round integer)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NOT public.can_edit_tournament(p_id, auth.uid()) THEN
    RAISE EXCEPTION 'not authorized to edit tournament %', p_id USING ERRCODE = '42501';
  END IF;

  UPDATE public.tournaments
     SET current_round = GREATEST(COALESCE(current_round, 0), p_round)
   WHERE id = p_id;
END $function$;

-- patch_game_tournament: guard added after the existence check, before mutation.
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

/* =========================================================================
   VERIFY (run after applying)
   ---------------------------
   -- As an editor/creator: patch_game_tournament / advance_game_round succeed.
   -- As a friend-only viewer (in a rolled-back tx): both RAISE 42501.
   ========================================================================= */
