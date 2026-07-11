-- ============================================================================
-- Sync v2 (normalized schema) — tables, RLS, realtime publication.
-- Spec: docs/superpowers/specs/2026-07-11-sync-v2-normalized-schema-design.md
-- Safe to re-run (every statement idempotent). Apply in the Supabase SQL editor.
-- ============================================================================
--
-- WHAT IT ADDS
-- ------------
--   1. tournaments.props / tournaments.current_round
--                              → new columns on the existing casual-tournament
--                                row, used by the sync-v2 client as the new
--                                home for tournament-level metadata that used
--                                to live only in the JSONB blob.
--   2. game_players, game_rounds, game_scores, game_shot_details,
--      game_round_notes       → normalized per-row storage for casual
--                                tournaments (mirrors what the JSONB blob
--                                held, split into columns for realtime +
--                                fine-grained sync). Named `game_*` (not
--                                `tournament_*`) to avoid colliding with the
--                                pre-existing official-tournament tables
--                                (tournament_roster/rounds/parties/... — see
--                                docs/superpowers/plans/sync-v2-schema-facts.md).
--   3. RLS on all five new tables, delegating to the parent tournament row's
--      own RLS via an invoker-context EXISTS subquery (same pattern as
--      tournament_media's policies): a row here is visible/writable exactly
--      when the caller can already see the matching public.tournaments row.
--   4. Realtime publication for the five new tables plus public.tournaments,
--      so clients get live updates without polling.
--   5. get_game_tournament / get_my_game_tournaments (read RPCs), set_game_score
--      / patch_game_round / patch_game_tournament / advance_game_round (write
--      RPCs), a claim_tournament_player dual-write, and
--      backfill_game_tournament (idempotent blob → normalized backfill,
--      section 8) plus its apply/verify Node scripts under scripts/sync-v2/.
--      All round-addressed objects are scoped by (tournament_id, round id) —
--      round ids are only unique per-tournament; see the game_rounds comment.
--
-- NOTE ON tournaments RLS drift (see schema-facts doc, decision #3): the live
-- `tournaments` table currently carries a stray permissive `allow_all`
-- policy (PERMISSIVE, {public}, USING true), which makes the EXISTS
-- delegation below pass for any row regardless of the named
-- tournaments_select/insert/update/delete policies. That is a pre-existing
-- production gap, out of scope for this migration — once `allow_all` is
-- dropped, these game_* policies start enforcing real ownership/membership
-- automatically, with no further change needed here.
--
-- HOW TO RUN
-- ----------
--   Paste into the Supabase SQL editor and Run. Idempotent — safe to re-run.
-- ============================================================================

-- 1) Tournament-level columns for sync-v2 -----------------------------------
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS props jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS current_round int;

-- 2) Normalized per-tournament tables ----------------------------------------

-- One row per player entered in a tournament. pos preserves the original
-- players[] array order; body carries the whole player object as jsonb.
CREATE TABLE IF NOT EXISTS public.game_players (
  tournament_id text NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  player_id     text NOT NULL,
  user_id       uuid,
  pos           int NOT NULL DEFAULT 0,          -- preserves players[] order
  body          jsonb NOT NULL DEFAULT '{}'::jsonb, -- the whole player object
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, player_id)
);

-- One row per round. body carries the round object minus its
-- scores/shotDetails/notes (those are split into their own tables below).
--
-- ROUND IDS ARE ONLY UNIQUE PER-TOURNAMENT, never globally: SetupScreen.js
-- assigns every tournament's rounds `r${i}` (so every tournament's first
-- round is literally "r0", second "r1", ...), and EditTournamentScreen.js's
-- "add round" handler uses `r${Date.now()}` for rounds appended later —
-- neither scheme is globally unique, and the app has never needed it to be
-- (every round lookup in the existing codebase already pairs tournamentId +
-- roundId; see src/store/mediaStore.js / mediaQueue.js). A bare `id` PK here
-- would collide the moment two tournaments are backfilled (the second
-- tournament's "r0" would steal the first's row — reproduced with real
-- fixtures in Docker; see the Task 5 report). Hence the composite
-- (tournament_id, id) PK, mirrored as composite FKs on the three per-cell
-- tables below.
CREATE TABLE IF NOT EXISTS public.game_rounds (
  id            text NOT NULL,                     -- unique per-tournament only
  tournament_id text NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  round_index   int NOT NULL,
  body          jsonb NOT NULL DEFAULT '{}'::jsonb, -- round minus scores/shotDetails/notes
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, id)
);
CREATE INDEX IF NOT EXISTS game_rounds_tournament_idx ON public.game_rounds (tournament_id);

-- Per-hole strokes for a player in a round. strokes = NULL is a tombstone
-- (a cleared cell), not a missing row — kept so deletes replicate correctly.
CREATE TABLE IF NOT EXISTS public.game_scores (
  round_id      text NOT NULL,
  tournament_id text NOT NULL,
  player_id     text NOT NULL,
  hole          int  NOT NULL,
  strokes       int,                                -- NULL = cleared (tombstone)
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid,
  PRIMARY KEY (tournament_id, round_id, player_id, hole),
  FOREIGN KEY (tournament_id, round_id)
    REFERENCES public.game_rounds (tournament_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS game_scores_tournament_idx ON public.game_scores (tournament_id);

-- Per-hole shot detail (club, result, etc.) for a player in a round.
CREATE TABLE IF NOT EXISTS public.game_shot_details (
  round_id      text NOT NULL,
  tournament_id text NOT NULL,
  player_id     text NOT NULL,
  hole          int  NOT NULL,
  detail        jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, round_id, player_id, hole),
  FOREIGN KEY (tournament_id, round_id)
    REFERENCES public.game_rounds (tournament_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS game_shot_details_tournament_idx ON public.game_shot_details (tournament_id);

-- Free-text notes for a round, keyed by 'round' (the whole round) or a hole
-- number '1'..'18'.
CREATE TABLE IF NOT EXISTS public.game_round_notes (
  round_id      text NOT NULL,
  tournament_id text NOT NULL,
  hole_key      text NOT NULL,                      -- 'round' or '1'..'18'
  note          text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, round_id, hole_key),
  FOREIGN KEY (tournament_id, round_id)
    REFERENCES public.game_rounds (tournament_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS game_round_notes_tournament_idx ON public.game_round_notes (tournament_id);

-- 3) Row-level security -------------------------------------------------------
-- Every game_* row belongs to exactly one tournament (directly or via
-- round_id → game_rounds.tournament_id). Rather than re-deriving the owner/
-- member/friend rules here, each policy delegates to the tournaments table's
-- own RLS: the EXISTS subquery below only matches rows the caller can already
-- see under public.tournaments' SELECT policy (invoker-context, same pattern
-- tournament_media uses). No SECURITY DEFINER involved.
ALTER TABLE public.game_players      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_rounds       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_scores       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_shot_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_round_notes  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS game_players_all ON public.game_players;
CREATE POLICY game_players_all ON public.game_players
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id));

DROP POLICY IF EXISTS game_rounds_all ON public.game_rounds;
CREATE POLICY game_rounds_all ON public.game_rounds
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id));

DROP POLICY IF EXISTS game_scores_all ON public.game_scores;
CREATE POLICY game_scores_all ON public.game_scores
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id));

DROP POLICY IF EXISTS game_shot_details_all ON public.game_shot_details;
CREATE POLICY game_shot_details_all ON public.game_shot_details
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id));

DROP POLICY IF EXISTS game_round_notes_all ON public.game_round_notes;
CREATE POLICY game_round_notes_all ON public.game_round_notes
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id));

-- 4) Realtime publication ------------------------------------------------------
-- Idempotent: each ADD TABLE gets its own BEGIN/EXCEPTION sub-block so that
-- one table already being a publication member (duplicate_object) does not
-- abort the rest — a single shared DO block would stop at the first failure.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.game_scores;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.game_shot_details;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.game_round_notes;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.game_rounds;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.game_players;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.tournaments;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5) Read RPCs ----------------------------------------------------------------
-- get_game_tournament(id) reassembles the exact legacy JSONB blob shape (the
-- shape rowToTournament()/mergeTournaments() already expect) from the
-- normalized game_* tables + tournaments.props, so client code that switches
-- to sync-v2 sees no shape change. STABLE + SECURITY INVOKER (the default):
-- callers only ever see rows the tournaments/game_* RLS policies above already
-- let them see — no privilege escalation here. Every per-cell subquery pairs
-- round_id WITH tournament_id: round ids are only unique per-tournament (see
-- the game_rounds comment above), so a bare round_id join could pull in a
-- same-named round from another tournament.
CREATE OR REPLACE FUNCTION public.get_game_tournament(p_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_t   record;
  v_out jsonb;
BEGIN
  SELECT * INTO v_t FROM public.tournaments WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- createdAt must byte-match what the legacy client wrote with JS
  -- `new Date().toISOString()` — "YYYY-MM-DDTHH:MM:SS.mmmZ" (milliseconds
  -- always exactly 3 digits, literal trailing 'Z'). jsonb_build_object on a
  -- raw timestamptz would emit "+00:00" instead of "Z", failing round-trip
  -- equality, so format explicitly.
  v_out := v_t.props || jsonb_build_object(
    'id', v_t.id, 'name', v_t.name, 'kind', v_t.kind,
    'createdAt', to_char(v_t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'players', COALESCE((
      SELECT jsonb_agg(gp.body ORDER BY gp.pos, gp.player_id)
      FROM public.game_players gp WHERE gp.tournament_id = p_id), '[]'::jsonb),
    'rounds', COALESCE((
      SELECT jsonb_agg(
        -- Strip any stale 'notes' left inside body before merging: 'notes'
        -- is only conditionally re-added below (when live note rows exist),
        -- so unlike scores/shotDetails it wouldn't be overwritten — a stale
        -- copy in body would leak through after every note was deleted.
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
               -- HAVING count(*) > 0 makes this subquery yield ZERO rows
               -- (hitting the COALESCE) when the round has no hole notes,
               -- instead of one row whose bare aggregate is NULL — which
               -- would otherwise surface as "hole": null. The legacy blob
               -- simply omits the key, so round-trip equality requires the
               -- same here.
               || COALESCE((SELECT jsonb_build_object('hole', jsonb_object_agg(n.hole_key, n.note))
                            FROM public.game_round_notes n
                            WHERE n.round_id = gr.id AND n.tournament_id = gr.tournament_id AND n.hole_key <> 'round' AND n.note IS NOT NULL
                            HAVING count(*) > 0), '{}'::jsonb))
             WHERE EXISTS (SELECT 1 FROM public.game_round_notes n2
                           WHERE n2.round_id = gr.id AND n2.tournament_id = gr.tournament_id AND n2.note IS NOT NULL)), '{}'::jsonb)
        ORDER BY gr.round_index, gr.id)
      FROM public.game_rounds gr WHERE gr.tournament_id = p_id), '[]'::jsonb));

  -- Same stale-key defense for the tournament level: 'currentRound' is only
  -- conditionally added, so a stale copy inside props must not survive when
  -- the column is NULL — strip it in both branches, re-adding the live
  -- column value only when present.
  IF v_t.current_round IS NOT NULL THEN
    v_out := (v_out - 'currentRound') || jsonb_build_object('currentRound', v_t.current_round);
  ELSE
    v_out := v_out - 'currentRound';
  END IF;
  RETURN v_out;
END $$;

-- get_my_game_tournaments() replicates loadAllTournaments()'s role logic
-- (src/store/tournamentStore.js:204-263) server-side: owner (created_by =
-- auth.uid() OR created_by IS NULL) beats tournament_members beats
-- tournament_participants when the same tournament shows up in more than one
-- bucket, same precedence the client already applies via seenIds. Each
-- tournament appears once, newest-first by created_at (id is a client-side
-- timestamp string and can drift from created_at — see schema-facts decision
-- #6 — so created_at is the only safe recency key). With no session
-- (auth.uid() IS NULL) this mirrors the client's no-user branch: every
-- tournament visible under RLS, all tagged 'owner'.
CREATE OR REPLACE FUNCTION public.get_my_game_tournaments()
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN
    SELECT COALESCE(jsonb_agg(
             jsonb_build_object('tournament', public.get_game_tournament(t.id), 'role', 'owner')
             ORDER BY t.created_at DESC), '[]'::jsonb)
      INTO v_out
      FROM public.tournaments t;
    RETURN v_out;
  END IF;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object('tournament', public.get_game_tournament(x.id), 'role', x.role)
           ORDER BY x.created_at DESC), '[]'::jsonb)
    INTO v_out
    FROM (
      SELECT DISTINCT ON (u.id) u.id, u.created_at, u.role
      FROM (
        -- owner: created_by = me, or NULL (anonymous-era rows) — prio 1
        SELECT t.id, t.created_at, 'owner'::text AS role, 1 AS prio
        FROM public.tournaments t
        WHERE t.created_by = v_uid OR t.created_by IS NULL
        UNION ALL
        -- member: tournament_members row for me, role carried through as-is — prio 2
        SELECT t.id, t.created_at, tm.role, 2 AS prio
        FROM public.tournament_members tm
        JOIN public.tournaments t ON t.id = tm.tournament_id
        WHERE tm.user_id = v_uid
        UNION ALL
        -- participant fallback (see tournamentStore.js comment on the
        -- tournament_participants query) — prio 3
        SELECT t.id, t.created_at, 'participant'::text AS role, 3 AS prio
        FROM public.tournament_participants tp
        JOIN public.tournaments t ON t.id = tp.tournament_id
        WHERE tp.user_id = v_uid
      ) u
      ORDER BY u.id, u.prio) x;

  RETURN v_out;
END $$;

-- 6) Write RPCs ---------------------------------------------------------------
-- set_game_score: row-locked read-before-write so the client can show a
-- meaningful conflict/undo affordance (previousStrokes/previousUpdatedAt).
-- A score cell is addressed by (tournament_id, round_id, player_id, hole) —
-- round ids are only unique per-tournament (see the game_rounds comment
-- above), so tournament_id participates in the lookup, the advisory-lock
-- key, and the ON CONFLICT target, not just as a denormalized filter column.
CREATE OR REPLACE FUNCTION public.set_game_score(
  p_round_id text, p_tournament_id text, p_player_id text, p_hole int, p_strokes int)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_prev_strokes int;
  v_prev_at timestamptz;
BEGIN
  -- Serialize same-cell calls BEFORE reading: SELECT ... FOR UPDATE takes no
  -- lock when the row doesn't exist yet, so two concurrent FIRST writes to
  -- the same cell would otherwise both capture previous=null and the loser
  -- would report a wrong previous value — missing exactly the conflict
  -- signal this function exists to provide. The transaction-scoped advisory
  -- lock covers the nonexistent-row case too and releases automatically on
  -- commit/rollback.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_tournament_id || ':' || p_round_id || ':' || p_player_id || ':' || p_hole::text, 0));

  SELECT strokes, updated_at INTO v_prev_strokes, v_prev_at
  FROM public.game_scores
  WHERE tournament_id = p_tournament_id AND round_id = p_round_id AND player_id = p_player_id AND hole = p_hole
  FOR UPDATE;

  INSERT INTO public.game_scores (round_id, tournament_id, player_id, hole, strokes, updated_at, updated_by)
  VALUES (p_round_id, p_tournament_id, p_player_id, p_hole, p_strokes, now(), auth.uid())
  ON CONFLICT (tournament_id, round_id, player_id, hole)
  DO UPDATE SET strokes = EXCLUDED.strokes, updated_at = now(), updated_by = auth.uid();

  RETURN jsonb_build_object('previousStrokes', v_prev_strokes, 'previousUpdatedAt', v_prev_at);
END $$;

-- advance_game_round: monotonic bump of tournaments.current_round. Pulled out
-- of patch_game_tournament as its own function because it's also the routing
-- target for a 'currentRound' key in a patch payload (see below), and is
-- callable directly by later tasks' client code without going through the
-- generic patch path.
CREATE OR REPLACE FUNCTION public.advance_game_round(p_id text, p_round int)
RETURNS void LANGUAGE sql AS $$
  UPDATE public.tournaments
     SET current_round = GREATEST(COALESCE(current_round, 0), p_round)
   WHERE id = p_id;
$$;

-- patch_game_round: one-level-deep merge into game_rounds.body. jsonb object
-- values merge one level via (body->k) || v; scalars/arrays/jsonb null
-- replace outright (jsonb_set stores a JSON null when v_v is 'null'::jsonb —
-- it is never skipped, since the client uses null to explicitly clear a
-- field). updated_at is bumped on every patch so realtime subscribers keyed
-- on row events see the change even when body's content ends up identical.
-- Takes the tournament id because round_id alone cannot address a round
-- (round ids are only unique per-tournament — see the game_rounds comment).
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
    IF jsonb_typeof(v_v) = 'object' AND jsonb_typeof(v_body -> v_k) = 'object' THEN
      v_body := jsonb_set(v_body, ARRAY[v_k], (v_body -> v_k) || v_v);
    ELSE
      v_body := jsonb_set(v_body, ARRAY[v_k], v_v);
    END IF;
  END LOOP;

  UPDATE public.game_rounds SET body = v_body, updated_at = now()
   WHERE tournament_id = p_tournament_id AND id = p_round_id;
END $$;

-- patch_game_tournament: same one-level merge, but targeting
-- tournaments.props with two routing exceptions: 'name'/'kind' land on the
-- real tournaments columns (never merged into props), and 'currentRound'
-- routes to advance_game_round's monotonic GREATEST (also never merged into
-- props — there is no props.currentRound). Every other key merges into props
-- exactly like patch_game_round merges into body. tournaments has no
-- updated_at column (see schema-facts doc) so there is nothing to bump here;
-- game_players/game_rounds/game_scores each carry their own updated_at.
CREATE OR REPLACE FUNCTION public.patch_game_tournament(p_id text, p_patch jsonb)
RETURNS void LANGUAGE plpgsql AS $$
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

  FOR v_k, v_v IN SELECT * FROM jsonb_each(p_patch) LOOP
    -- name/kind are NOT NULL columns: a jsonb null for either is treated as
    -- "skip the column update" (and, like every name/kind value, is never
    -- merged into props). Unlike body/props keys, null cannot mean "clear".
    IF v_k = 'name' THEN
      IF jsonb_typeof(v_v) <> 'null' THEN
        v_name := v_v #>> '{}';
        v_set_name := true;
      END IF;
    ELSIF v_k = 'kind' THEN
      IF jsonb_typeof(v_v) <> 'null' THEN
        v_kind := v_v #>> '{}';
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
END $$;

-- 7) claim_tournament_player — dual-write onto game_players ------------------
-- Re-created with its EXACT current body (see
-- 20260522000002_fix_claim_jsonb_set.sql — the create_missing=true fix for
-- the players[].user_id stamp), plus a dual-write onto game_players so a
-- claim made through the legacy blob path is also visible to sync-v2 readers
-- (get_game_tournament()/get_my_game_tournaments() serve game_players.body,
-- not the blob). The UPDATE is a plain no-op (0 rows, no error) when the
-- tournament hasn't been backfilled into game_players yet — migration order
-- means casual tournaments existing before Task 5's backfill will have no
-- matching row here until then.
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
  v_uid     uuid   := auth.uid();
  v_idx     int;
  v_data    jsonb;
  v_players jsonb;
  v_slot    jsonb;
  v_now_ms  bigint := (extract(epoch from now()) * 1000)::bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Must be signed in to claim a player';
  END IF;
  -- can_edit_tournament passes for the owner, legacy NULL-owner rows, and
  -- editor/owner members; the join flow establishes editor membership via
  -- redeem_invite_code before this is called.
  IF NOT public.can_edit_tournament(p_tournament_id, v_uid) THEN
    RAISE EXCEPTION 'You are not a member of this tournament';
  END IF;

  -- Lock the tournament row. A concurrent claim of the same slot blocks here
  -- and, once this transaction commits, re-reads the post-claim row below.
  SELECT data INTO v_data
    FROM public.tournaments
   WHERE id = p_tournament_id
   FOR UPDATE;
  IF v_data IS NULL THEN
    RAISE EXCEPTION 'No such tournament';
  END IF;

  v_players := v_data -> 'players';
  IF v_players IS NULL THEN
    RAISE EXCEPTION 'Tournament has no players';
  END IF;

  SELECT ord - 1, elem
    INTO v_idx, v_slot
    FROM jsonb_array_elements(v_players) WITH ORDINALITY AS t(elem, ord)
   WHERE elem ->> 'id' = p_player_id
   LIMIT 1;

  IF v_idx IS NULL THEN
    RAISE EXCEPTION 'No such player slot';
  END IF;

  IF v_slot ->> 'user_id' IS NOT NULL
     AND v_slot ->> 'user_id' <> v_uid::text THEN
    RAISE EXCEPTION 'SLOT_TAKEN';
  END IF;

  -- Ensure _meta exists, set the slot's user_id, and bump the players LWW
  -- timestamp so the claim wins the next casual-tournament sync merge.
  v_data := v_data || jsonb_build_object(
              '_meta', COALESCE(v_data -> '_meta', '{}'::jsonb));
  -- create_missing = true: a never-claimed slot has no 'user_id' key yet, and
  -- jsonb_set() with false would return the document unchanged (the bug).
  v_data := jsonb_set(v_data,
              ARRAY['players', v_idx::text, 'user_id'],
              to_jsonb(v_uid::text), true);
  v_data := jsonb_set(v_data,
              ARRAY['_meta', 'players'],
              to_jsonb(v_now_ms), true);

  UPDATE public.tournaments SET data = v_data WHERE id = p_tournament_id;

  -- sync-v2 dual-write: stamp the matching game_players row (if the
  -- tournament has been backfilled into the normalized tables already).
  -- A missing row is a plain 0-row UPDATE, not an error.
  UPDATE public.game_players
     SET user_id    = v_uid,
         body       = jsonb_set(body, '{user_id}', to_jsonb(v_uid::text), true),
         updated_at = now()
   WHERE tournament_id = p_tournament_id AND player_id = p_player_id;

  RETURN p_player_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_tournament_player(text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.claim_tournament_player(text, text) TO authenticated;

-- 8) backfill_game_tournament — idempotent, _meta-aware blob → normalized-
-- tables backfill (spec Amendment 5) -----------------------------------------
-- One-shot per tournament: strips the hot keys out of the blob into
-- tournaments.props / game_rounds.body (the exact same strip contract
-- get_game_tournament's reassembly depends on — see the comments on that
-- function above), and fans every scores/shotDetails/notes cell out into its
-- own row. Safe to re-run (apply-migration.mjs calls it for every tournament
-- on every deploy of this migration): a re-run only overwrites a
-- game_scores/game_shot_details/game_round_notes row when the blob cell is
-- genuinely newer than what's already stored (the `_meta` per-cell
-- timestamp, falling back to the tournament's created_at when no stamp
-- exists), so sweeping after client cut-over cannot clobber a newer write
-- that already landed through set_game_score. Skips official-mode rows
-- (kind = 'official') and rows with no blob at all — those never had
-- anything to normalize.
CREATE OR REPLACE FUNCTION public.backfill_game_tournament(p_id text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_data       jsonb;
  v_kind       text;
  v_created_at timestamptz;
  v_round      jsonb;
  v_ridx       int;
  v_round_id   text;
  v_body       jsonb;
  v_player     jsonb;
  v_pidx       int;
  v_pid        text;
  v_holes      jsonb;
  v_hole       text;
  v_strokes    jsonb;
  v_stamp      bigint;
  v_cell_ts    timestamptz;
  v_detail     jsonb;
  v_hkey       text;
  v_note       text;
BEGIN
  SELECT data, kind, created_at INTO v_data, v_kind, v_created_at
  FROM public.tournaments WHERE id = p_id;

  -- Defensive only: the live column is NOT NULL DEFAULT 'casual' (see
  -- schema-facts), so kind can't actually be NULL — but if it ever were,
  -- `v_kind = 'official'` evaluates to NULL, which IF treats as
  -- not-satisfied, correctly falling through to the casual path.
  IF v_data IS NULL OR v_data = '{}'::jsonb OR v_kind = 'official' THEN
    RETURN;
  END IF;

  UPDATE public.tournaments
     SET props = v_data - 'players' - 'rounds' - 'id' - 'name' - 'kind' - 'createdAt' - 'currentRound' - '_meta' - 'meId',
         current_round = GREATEST(COALESCE(current_round, 0), COALESCE((v_data->>'currentRound')::int, 0))
   WHERE id = p_id;

  -- Players -------------------------------------------------------------
  FOR v_player, v_pidx IN
    SELECT value, ordinality - 1 FROM jsonb_array_elements(v_data->'players') WITH ORDINALITY AS t(value, ordinality)
  LOOP
    v_pid := v_player->>'id';
    INSERT INTO public.game_players (tournament_id, player_id, user_id, pos, body)
    VALUES (p_id, v_pid, NULLIF(v_player->>'user_id', '')::uuid, v_pidx, v_player)
    ON CONFLICT (tournament_id, player_id) DO UPDATE
      SET body = EXCLUDED.body,
          user_id = COALESCE(EXCLUDED.user_id, public.game_players.user_id),
          pos = EXCLUDED.pos;
  END LOOP;

  -- Rounds (+ nested scores/shotDetails/notes) -----------------------------
  FOR v_round, v_ridx IN
    SELECT value, ordinality - 1 FROM jsonb_array_elements(v_data->'rounds') WITH ORDINALITY AS t(value, ordinality)
  LOOP
    v_round_id := v_round->>'id';
    -- Strip contract (load-bearing — see get_game_tournament above): the
    -- round body stored here is the round minus its hot per-cell keys.
    v_body := v_round - 'scores' - 'shotDetails' - 'notes' - 'scoreConflicts' - 'scoreResolutions';

    INSERT INTO public.game_rounds (id, tournament_id, round_index, body)
    VALUES (v_round_id, p_id, v_ridx, v_body)
    ON CONFLICT (tournament_id, id) DO UPDATE
      SET round_index = EXCLUDED.round_index,
          body = EXCLUDED.body;

    -- Scores --------------------------------------------------------------
    FOR v_pid, v_holes IN SELECT * FROM jsonb_each(COALESCE(v_round->'scores', '{}'::jsonb)) LOOP
      FOR v_hole, v_strokes IN SELECT * FROM jsonb_each(v_holes) LOOP
        v_stamp := (v_data->'_meta'->>('rounds.' || v_round_id || '.scores.' || v_pid || '.h' || v_hole))::bigint;
        v_cell_ts := CASE WHEN v_stamp IS NULL THEN v_created_at ELSE to_timestamp(v_stamp / 1000.0) END;

        INSERT INTO public.game_scores (round_id, tournament_id, player_id, hole, strokes, updated_at)
        VALUES (v_round_id, p_id, v_pid, v_hole::int, (v_strokes #>> '{}')::int, v_cell_ts)
        ON CONFLICT (tournament_id, round_id, player_id, hole) DO UPDATE
          SET strokes = EXCLUDED.strokes, updated_at = EXCLUDED.updated_at
          WHERE public.game_scores.updated_at < EXCLUDED.updated_at;
      END LOOP;
    END LOOP;

    -- Shot details ----------------------------------------------------------
    FOR v_pid, v_holes IN SELECT * FROM jsonb_each(COALESCE(v_round->'shotDetails', '{}'::jsonb)) LOOP
      FOR v_hole, v_detail IN SELECT * FROM jsonb_each(v_holes) LOOP
        v_stamp := (v_data->'_meta'->>('rounds.' || v_round_id || '.shotDetails.' || v_pid || '.h' || v_hole))::bigint;
        v_cell_ts := CASE WHEN v_stamp IS NULL THEN v_created_at ELSE to_timestamp(v_stamp / 1000.0) END;

        INSERT INTO public.game_shot_details (round_id, tournament_id, player_id, hole, detail, updated_at)
        VALUES (v_round_id, p_id, v_pid, v_hole::int, v_detail, v_cell_ts)
        ON CONFLICT (tournament_id, round_id, player_id, hole) DO UPDATE
          SET detail = EXCLUDED.detail, updated_at = EXCLUDED.updated_at
          WHERE public.game_shot_details.updated_at < EXCLUDED.updated_at;
      END LOOP;
    END LOOP;

    -- Notes: one row for the whole-round note ('round'), one per hole note --
    IF (v_round -> 'notes') ? 'round' THEN
      v_stamp := (v_data->'_meta'->>('rounds.' || v_round_id || '.notes.round'))::bigint;
      v_cell_ts := CASE WHEN v_stamp IS NULL THEN v_created_at ELSE to_timestamp(v_stamp / 1000.0) END;
      v_note := v_round->'notes'->>'round';

      INSERT INTO public.game_round_notes (round_id, tournament_id, hole_key, note, updated_at)
      VALUES (v_round_id, p_id, 'round', v_note, v_cell_ts)
      ON CONFLICT (tournament_id, round_id, hole_key) DO UPDATE
        SET note = EXCLUDED.note, updated_at = EXCLUDED.updated_at
        WHERE public.game_round_notes.updated_at < EXCLUDED.updated_at;
    END IF;

    IF (v_round -> 'notes') ? 'hole' THEN
      FOR v_hkey, v_note IN SELECT * FROM jsonb_each_text(v_round->'notes'->'hole') LOOP
        v_stamp := (v_data->'_meta'->>('rounds.' || v_round_id || '.notes.hole.' || v_hkey))::bigint;
        v_cell_ts := CASE WHEN v_stamp IS NULL THEN v_created_at ELSE to_timestamp(v_stamp / 1000.0) END;

        INSERT INTO public.game_round_notes (round_id, tournament_id, hole_key, note, updated_at)
        VALUES (v_round_id, p_id, v_hkey, v_note, v_cell_ts)
        ON CONFLICT (tournament_id, round_id, hole_key) DO UPDATE
          SET note = EXCLUDED.note, updated_at = EXCLUDED.updated_at
          WHERE public.game_round_notes.updated_at < EXCLUDED.updated_at;
      END LOOP;
    END IF;
  END LOOP;
END $$;

/* ===========================================================================
   VERIFY
   ---------------------------------------------------------------------------
   -- New tournaments columns present:
   SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='tournaments'
      AND column_name IN ('props','current_round');

   -- All five tables exist:
   SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name LIKE 'game_%'
    ORDER BY table_name;

   -- RLS enabled on all five:
   SELECT relname, relrowsecurity FROM pg_class WHERE relname LIKE 'game_%';

   -- Policies present:
   SELECT tablename, policyname, cmd FROM pg_policies
    WHERE schemaname='public' AND tablename LIKE 'game_%'
    ORDER BY tablename, policyname;

   -- Realtime publication membership:
   SELECT schemaname, tablename FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND (tablename LIKE 'game_%' OR tablename = 'tournaments')
    ORDER BY tablename;

   -- Read RPCs present:
   SELECT proname FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('get_game_tournament', 'get_my_game_tournaments')
    ORDER BY proname;

   -- Smoke test (replace :id with a real tournament id):
   -- SELECT public.get_game_tournament(:'id');
   -- SELECT public.get_my_game_tournaments();

   -- Write RPCs present:
   SELECT proname FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('set_game_score', 'patch_game_round',
                       'patch_game_tournament', 'advance_game_round')
    ORDER BY proname;

   -- claim_tournament_player still SECURITY DEFINER, still locked to
   -- authenticated only:
   SELECT proname, prosecdef FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND proname = 'claim_tournament_player';
   SELECT grantee, privilege_type FROM information_schema.role_routine_grants
    WHERE routine_name = 'claim_tournament_player';

   -- backfill_game_tournament present, patch_game_round now 3-arg:
   SELECT proname, pg_get_function_identity_arguments(oid) FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('backfill_game_tournament', 'patch_game_round')
    ORDER BY proname;

   -- Tournament-scoped composite PKs/FKs in place (no bare round-id keys):
   SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid)
    FROM pg_constraint
    WHERE conrelid::regclass::text IN
          ('game_rounds', 'game_scores', 'game_shot_details', 'game_round_notes')
      AND contype IN ('p', 'f')
    ORDER BY tbl, contype;

   -- Backfill smoke test (replace :id with a real tournament id), then
   -- confirm round-trip equality against the original blob:
   -- SELECT public.backfill_game_tournament(:'id');
   -- SELECT data FROM public.tournaments WHERE id = :'id';
   -- SELECT public.get_game_tournament(:'id');
   =========================================================================== */
