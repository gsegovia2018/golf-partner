-- ============================================================================
-- round.pairs stores ids only.
--
-- pairs embedded whole player objects, which drift: measured 2026-07-28,
-- 14 of 143 embedded copies carried a user_id that disagreed with
-- game_players. Every client consumer resolves members through the roster
-- already (scrambleUnits' `byId[m.id] ?? m`, EditTeamsView's `nameFor`), so
-- the embedded fields were a dead -- but lie-prone -- fallback. The only
-- writer that maintained them (propagatePlayerToTournaments' "cosmetic pairs
-- snapshot") has been removed client-side.
--
-- Backward compatible with installed builds: an older client reading a thinned
-- pair still resolves names and handicaps from the roster.
--
-- Idempotent: re-running over already-thinned pairs is a no-op.
-- ============================================================================

UPDATE public.game_rounds gr
   SET body = jsonb_set(gr.body, '{pairs}', COALESCE((
         SELECT jsonb_agg(COALESCE((
                  SELECT jsonb_agg(jsonb_build_object('id', pl->>'id'))
                    FROM jsonb_array_elements(team) pl
                ), '[]'::jsonb))
           FROM jsonb_array_elements(gr.body->'pairs') team
       ), '[]'::jsonb))
 WHERE gr.body ? 'pairs'
   AND jsonb_typeof(gr.body->'pairs') = 'array'
   AND jsonb_array_length(gr.body->'pairs') > 0;

/* ===========================================================================
   HOW TO RUN
   ---------------------------------------------------------------------------
   Paste into the Supabase SQL editor and Run. Idempotent -- safe to re-run.

   VERIFY
   ---------------------------------------------------------------------------
   SELECT count(*) AS members,
          count(*) FILTER (
            WHERE pl ?| ARRAY['name','handicap','user_id','gender','avatar_url']
          ) AS still_rich
     FROM public.game_rounds gr,
          LATERAL jsonb_array_elements(COALESCE(gr.body->'pairs','[]'::jsonb)) team,
          LATERAL jsonb_array_elements(team) pl;
   -- expected: still_rich = 0
   =========================================================================== */
