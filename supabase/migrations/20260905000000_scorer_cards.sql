-- ============================================================================
-- Scorecard cards engine — one card per scorer, version-anchored resolutions,
-- and a SQL projection onto game_scores / game_shot_details.
-- Plan: docs/superpowers/plans/2026-09-04-scorecard-cards-engine.md (§3.2, §3.3, §5)
-- Idempotent; safe to re-run. Same conventions as
-- 20260712000000_sync_v2_normalized.sql.
-- ============================================================================
--
-- PROBLEM
-- -------
-- The current scoring layer (game_score_entries / game_score_resolutions +
-- submit_game_score / resolve_game_score / recompute_game_score) publishes
-- every tap as its own per-cell row and stores one settled number per cell
-- chosen by whichever write reached the server last. Consequences, all
-- reproduced in the field:
--
--   * A hole is never atomic. A phone that loses signal mid-hole leaves half
--     the hole on the server; peers see a partial hole (plan R7).
--   * A peer's value can win the race and overwrite what the local scorer
--     entered, so a scorecard's own points change under it (R6).
--   * "Agreed" is decided by comparing `resolved_at` against entry
--     timestamps. Phones on a course disagree by minutes, so an agreement
--     either lapses when it should not, or survives an edit that should have
--     re-opened it (R4, S8).
--   * Every tap is broadcast, so a scorer entering their own score is
--     immediately visible to everyone (R1, R2).
--
-- FIX
-- ---
-- Two new tables. Each scorer's device owns exactly one row per round —
-- `scorer_cards`, keyed (tournament_id, round_id, author_id) — holding the
-- WHOLE published card as jsonb. Publishing a hole is one row upsert of a row
-- nobody else writes: atomic by construction, conflict-free, safe to retry
-- forever. Agreements live in `score_resolutions`, each anchored to the exact
-- card versions it settled, so an agreement lapses precisely when one of
-- those scorers re-publishes the hole — no clocks involved.
--
-- CARD SHAPE (plan §3.2)
-- ----------------------
--   card = {
--     scorer: { playerId, userId },              -- who is holding the phone
--     holes: {
--       "<hole>": {
--         v:       <int>,                        -- bumped on each publication
--         entries: { "<playerId>": <strokes int> },
--         shots:   { "<playerId>": <detail jsonb> },   -- optional
--         ts:      <epoch ms bigint>
--       }
--     }
--   }
--
-- A card MARKS (playerId, hole) exactly when
-- `holes-><hole>->'entries'-><playerId>` is a JSON number. Anything else —
-- key absent, JSON null, a string — is "no opinion on that cell": it never
-- agrees and never conflicts (plan's blank rule). That is the single
-- predicate every query below keys on.
--
--   resolution.basis = { "<author_id>": <v> }
-- the card version of EVERY scorer who marked the cell at the moment the
-- agreement was made.
--
-- SETTLED CELL RULE (plan §3.3, projected here in SQL)
-- ----------------------------------------------------
--   1. A resolution is VALID iff at least one card marks the cell AND, for
--      every author whose card marks it, (basis->>author_id)::int = that
--      card's holes-><hole>->'v'. An author missing from basis, or a bumped
--      v, invalidates it — that is how a re-publication (S8) and a fourth
--      scorer marking the cell for the first time (S13) both re-open a
--      settled row.
--   2. settled strokes = the valid resolution's `value` when there is one;
--      else the single distinct value when every marking author agrees;
--      else NULL (disputed).
--
-- NULL is written as a real row, not a missing one: game_scores already
-- treats `strokes IS NULL` as a tombstone (see the table comment in
-- 20260712000000) and get_game_tournament filters `strokes IS NOT NULL` out
-- of the assembled blob, so a disputed cell reads as "no score yet" to every
-- existing reader — feed, stats, shared board, Home — with no change to any
-- of them. A cell that no card marks any more (a scorer cleared it) has its
-- game_scores row DELETED.
--
-- SCOPE
-- -----
-- Additive only. game_score_entries / game_score_resolutions and
-- submit_game_score / resolve_game_score / recompute_game_score /
-- backfill_game_score_entries are left exactly as they are — cutover and
-- their removal are phase 5 of the plan.
--
-- HOW TO RUN
-- ----------
--   Paste into the Supabase SQL editor and Run. Idempotent — safe to re-run.
-- ============================================================================

-- 1) Tables --------------------------------------------------------------
-- One row per (round, scorer device). `author_id` is the persisted device id
-- (deviceId.js), never an auth id: it has to survive auth expiry offline
-- (plan R5/S10). Round ids are only unique PER TOURNAMENT (see the long
-- comment on game_rounds in 20260712000000), so every lookup pairs
-- (tournament_id, round_id). There is deliberately NO foreign key to
-- game_rounds: a card must never be blocked by the setup tables. A game
-- created offline can have its first hole published before the old sync
-- queue has landed its game_rounds row, and that card must still be
-- accepted (plan R7/R8). Cards for a round that is later deleted are
-- harmless orphans; the tournament FK still cascades on tournament delete.
CREATE TABLE IF NOT EXISTS public.scorer_cards (
  tournament_id text NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  round_id      text NOT NULL,
  author_id     text NOT NULL,               -- scoring device's persisted id
  card          jsonb NOT NULL,              -- { scorer, holes } — see header
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, round_id, author_id)
);
CREATE INDEX IF NOT EXISTS scorer_cards_tournament_idx
  ON public.scorer_cards (tournament_id);

-- One row per agreed cell. `value` NULL is a deliberate "no score" agreement
-- (the scorers agreed the cell is blank), distinct from no row at all.
-- `basis` pins the card versions the agreement settled — see the header.
CREATE TABLE IF NOT EXISTS public.score_resolutions (
  tournament_id text NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  round_id      text NOT NULL,
  player_id     text NOT NULL,
  hole          int  NOT NULL,
  value         int,                          -- NULL = agreed "no score"
  resolved_by   text NOT NULL,                -- scorerKey (userId ?? authorId)
  basis         jsonb NOT NULL,               -- { "<author_id>": <v> }
  resolved_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, round_id, player_id, hole)
);
CREATE INDEX IF NOT EXISTS score_resolutions_tournament_idx
  ON public.score_resolutions (tournament_id);

-- 2) updated_at / resolved_at are server-stamped -----------------------------
-- Clients upsert the whole row and may replay a queued write hours later, so
-- the stamp is taken here rather than trusted from the payload. INSERT keeps
-- the column DEFAULT; only UPDATE is intercepted.
CREATE OR REPLACE FUNCTION public.scorer_cards_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS scorer_cards_touch ON public.scorer_cards;
CREATE TRIGGER scorer_cards_touch
  BEFORE UPDATE ON public.scorer_cards
  FOR EACH ROW EXECUTE FUNCTION public.scorer_cards_touch();

CREATE OR REPLACE FUNCTION public.score_resolutions_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.resolved_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS score_resolutions_touch ON public.score_resolutions;
CREATE TRIGGER score_resolutions_touch
  BEFORE UPDATE ON public.score_resolutions
  FOR EACH ROW EXECUTE FUNCTION public.score_resolutions_touch();

-- 3) Row-level security ------------------------------------------------------
-- Exactly the split established for the game_* tables in
-- 20260715000005_split_game_read_write_rls.sql:
--   READ  — anyone who can SEE the tournament (delegates to tournaments' own
--           RLS via EXISTS), so friend-of-participant viewers keep feed and
--           leaderboard access.
--   WRITE — can_edit_tournament(tournament_id, auth.uid()): creator, or an
--           owner/editor tournament_members row.
--
-- NOTE ON AUTHOR BINDING (deliberate): nothing here ties author_id to the
-- caller. author_id is a DEVICE id, not an auth id — it is generated locally
-- and never registered server-side, so there is no server-side fact to bind
-- it to. Any editor of the tournament can therefore write any author's card,
-- which is exactly the trust model the current game_score_entries.author_id
-- already has. Binding it would require a device-registration table and would
-- break the offline identity guarantee (R5/S10: a card must still push after
-- the session has expired). Revisit only alongside device registration.
ALTER TABLE public.scorer_cards      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.score_resolutions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scorer_cards_select ON public.scorer_cards;
CREATE POLICY scorer_cards_select ON public.scorer_cards
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id));

DROP POLICY IF EXISTS scorer_cards_insert ON public.scorer_cards;
CREATE POLICY scorer_cards_insert ON public.scorer_cards
  FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_tournament(tournament_id, auth.uid()));

DROP POLICY IF EXISTS scorer_cards_update ON public.scorer_cards;
CREATE POLICY scorer_cards_update ON public.scorer_cards
  FOR UPDATE TO authenticated
  USING (public.can_edit_tournament(tournament_id, auth.uid()))
  WITH CHECK (public.can_edit_tournament(tournament_id, auth.uid()));

DROP POLICY IF EXISTS scorer_cards_delete ON public.scorer_cards;
CREATE POLICY scorer_cards_delete ON public.scorer_cards
  FOR DELETE TO authenticated
  USING (public.can_edit_tournament(tournament_id, auth.uid()));

DROP POLICY IF EXISTS score_resolutions_select ON public.score_resolutions;
CREATE POLICY score_resolutions_select ON public.score_resolutions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id));

DROP POLICY IF EXISTS score_resolutions_insert ON public.score_resolutions;
CREATE POLICY score_resolutions_insert ON public.score_resolutions
  FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_tournament(tournament_id, auth.uid()));

DROP POLICY IF EXISTS score_resolutions_update ON public.score_resolutions;
CREATE POLICY score_resolutions_update ON public.score_resolutions
  FOR UPDATE TO authenticated
  USING (public.can_edit_tournament(tournament_id, auth.uid()))
  WITH CHECK (public.can_edit_tournament(tournament_id, auth.uid()));

DROP POLICY IF EXISTS score_resolutions_delete ON public.score_resolutions;
CREATE POLICY score_resolutions_delete ON public.score_resolutions
  FOR DELETE TO authenticated
  USING (public.can_edit_tournament(tournament_id, auth.uid()));

-- 4) Realtime publication ------------------------------------------------------
-- One BEGIN/EXCEPTION sub-block per table so an already-published table
-- (duplicate_object) does not abort the rest.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.scorer_cards;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.score_resolutions;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5) Projection ----------------------------------------------------------------
-- settled_round_cells() is the settledCell rule of plan §3.3 expressed as one
-- query. It is a set-returning helper rather than being inlined into
-- project_round_scores because the projection needs the same set TWICE — once
-- to upsert, once to decide which existing rows are now orphaned — and a
-- second copy of the rule is exactly the kind of drift this design exists to
-- avoid.
--
-- Returns one row per (player_id, hole) that AT LEAST ONE card marks, with
-- the settled strokes (NULL when disputed). Cells no card marks are absent —
-- that absence is what the DELETE below keys on.
--
-- KNOWN DIVERGENCE from src/engine/cards.js: the engine folds two devices
-- signed into one account into one scorer (later publication wins); this
-- projection treats every author_id separately, so such a pair disagreeing
-- with itself projects as disputed (NULL) rather than as the later value.
-- Accepted for now — the projection only feeds Home/feed/stats, and the
-- phones' own view is authoritative during play. Fold here if it ever shows.
--
-- Defensive shape guards throughout (jsonb_typeof / the '^[0-9]+$' hole-key
-- filter): this runs inside a trigger, so a malformed card must project to
-- nothing rather than raise and reject the whole write.
CREATE OR REPLACE FUNCTION public.settled_round_cells(
  p_tournament_id text, p_round_id text)
RETURNS TABLE (player_id text, hole int, strokes int)
LANGUAGE sql STABLE AS $$
  WITH marks AS (
    -- One row per (author, hole, player) the author actually marked.
    SELECT c.author_id,
           (h.key)::int                     AS hole,
           e.key                            AS player_id,
           (e.value #>> '{}')::numeric::int AS strokes,
           CASE WHEN jsonb_typeof(h.value -> 'v') = 'number'
                THEN (h.value ->> 'v')::numeric::int END AS v
      FROM public.scorer_cards c
      CROSS JOIN LATERAL jsonb_each(
        CASE WHEN jsonb_typeof(c.card -> 'holes') = 'object'
             THEN c.card -> 'holes' ELSE '{}'::jsonb END) AS h(key, value)
      CROSS JOIN LATERAL jsonb_each(
        CASE WHEN jsonb_typeof(h.value -> 'entries') = 'object'
             THEN h.value -> 'entries' ELSE '{}'::jsonb END) AS e(key, value)
     WHERE c.tournament_id = p_tournament_id
       AND c.round_id      = p_round_id
       AND h.key ~ '^[0-9]+$'
       -- THE mark predicate: only a JSON number is an opinion.
       AND jsonb_typeof(e.value) = 'number'
  ),
  valid_res AS (
    -- basis must pin the CURRENT version of every card that marks the cell.
    -- Compared as jsonb against to_jsonb(v) rather than casting basis' text
    -- to int, so a malformed basis can never raise inside the trigger; a
    -- non-number there simply fails to match and the resolution is ignored.
    -- `m.v IS NULL` (a hole with no version) can never validate.
    SELECT r.player_id, r.hole, r.value
      FROM public.score_resolutions r
     WHERE r.tournament_id = p_tournament_id
       AND r.round_id      = p_round_id
       AND EXISTS (SELECT 1 FROM marks m
                    WHERE m.player_id = r.player_id AND m.hole = r.hole)
       AND NOT EXISTS (
             SELECT 1 FROM marks m
              WHERE m.player_id = r.player_id
                AND m.hole      = r.hole
                AND (m.v IS NULL
                     OR (r.basis -> m.author_id) IS DISTINCT FROM to_jsonb(m.v)))
  ),
  cells AS (
    SELECT m.player_id, m.hole,
           count(DISTINCT m.strokes) AS distinct_values,
           min(m.strokes)            AS only_value
      FROM marks m
     GROUP BY m.player_id, m.hole
  )
  SELECT c.player_id,
         c.hole,
         CASE
           -- A valid resolution wins outright, including when its agreed
           -- value is NULL ("no score") — hence the IS NOT NULL probe on the
           -- join key rather than on vr.value.
           WHEN vr.player_id IS NOT NULL      THEN vr.value
           WHEN c.distinct_values = 1         THEN c.only_value
           ELSE NULL                          -- disputed
         END
    FROM cells c
    LEFT JOIN valid_res vr
      ON vr.player_id = c.player_id AND vr.hole = c.hole;
$$;

-- projected_round_shots(): shot detail for a cell comes from ONE card — the
-- card of the scorer who is that player (card.scorer.playerId = the player),
-- because that is the phone that recorded their own clubs and results. When
-- nobody scored themselves, any card carrying detail for the cell will do,
-- picked deterministically by author_id so the projection is stable.
CREATE OR REPLACE FUNCTION public.projected_round_shots(
  p_tournament_id text, p_round_id text)
RETURNS TABLE (player_id text, hole int, detail jsonb)
LANGUAGE sql STABLE AS $$
  SELECT DISTINCT ON (s.player_id, s.hole) s.player_id, s.hole, s.detail
    FROM (
      SELECT sh.key         AS player_id,
             (h.key)::int   AS hole,
             sh.value       AS detail,
             COALESCE(c.card -> 'scorer' ->> 'playerId' = sh.key, false) AS own_card,
             c.author_id
        FROM public.scorer_cards c
        CROSS JOIN LATERAL jsonb_each(
          CASE WHEN jsonb_typeof(c.card -> 'holes') = 'object'
               THEN c.card -> 'holes' ELSE '{}'::jsonb END) AS h(key, value)
        CROSS JOIN LATERAL jsonb_each(
          CASE WHEN jsonb_typeof(h.value -> 'shots') = 'object'
               THEN h.value -> 'shots' ELSE '{}'::jsonb END) AS sh(key, value)
       WHERE c.tournament_id = p_tournament_id
         AND c.round_id      = p_round_id
         AND h.key ~ '^[0-9]+$'
         AND jsonb_typeof(sh.value) <> 'null'
    ) s
   ORDER BY s.player_id, s.hole, s.own_card DESC, s.author_id;
$$;

-- project_round_scores(): rebuild game_scores + game_shot_details for ONE
-- round from the cards and resolutions currently stored for it. Idempotent —
-- it is a full recompute of the round, not an incremental patch, so a
-- duplicate realtime echo, a replayed queued write and a straggler re-run all
-- land on the same state (S11).
--
-- SECURITY INVOKER (the default): every caller reaching this through the
-- triggers below has already passed the scorer_cards / score_resolutions
-- write policy, which is the SAME can_edit_tournament predicate the
-- game_scores write policies use — so no privilege escalation is needed and
-- none is granted.
CREATE OR REPLACE FUNCTION public.project_round_scores(
  p_tournament_id text, p_round_id text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- Scores: upsert every marked cell (NULL strokes = disputed tombstone).
  INSERT INTO public.game_scores
    (round_id, tournament_id, player_id, hole, strokes, updated_at)
  SELECT p_round_id, p_tournament_id, s.player_id, s.hole, s.strokes, now()
    FROM public.settled_round_cells(p_tournament_id, p_round_id) s
  ON CONFLICT (tournament_id, round_id, player_id, hole)
  DO UPDATE SET strokes = EXCLUDED.strokes, updated_at = now();

  -- Scores: a cell no card marks any more was cleared by its scorer — the row
  -- goes, rather than lingering as a value nobody stands behind.
  -- MATERIALIZED so the helper is evaluated once, not once per candidate row.
  WITH kept AS MATERIALIZED (
    SELECT s.player_id, s.hole
      FROM public.settled_round_cells(p_tournament_id, p_round_id) s)
  DELETE FROM public.game_scores g
   WHERE g.tournament_id = p_tournament_id
     AND g.round_id      = p_round_id
     AND NOT EXISTS (SELECT 1 FROM kept k
                      WHERE k.player_id = g.player_id AND k.hole = g.hole);

  -- Shot details: same shape, one winning card per cell.
  INSERT INTO public.game_shot_details
    (round_id, tournament_id, player_id, hole, detail, updated_at)
  SELECT p_round_id, p_tournament_id, d.player_id, d.hole, d.detail, now()
    FROM public.projected_round_shots(p_tournament_id, p_round_id) d
  ON CONFLICT (tournament_id, round_id, player_id, hole)
  DO UPDATE SET detail = EXCLUDED.detail, updated_at = now();

  WITH kept AS MATERIALIZED (
    SELECT d.player_id, d.hole
      FROM public.projected_round_shots(p_tournament_id, p_round_id) d)
  DELETE FROM public.game_shot_details g
   WHERE g.tournament_id = p_tournament_id
     AND g.round_id      = p_round_id
     AND NOT EXISTS (SELECT 1 FROM kept k
                      WHERE k.player_id = g.player_id AND k.hole = g.hole);
END $$;

-- Trigger glue for both tables. Branching on TG_OP rather than
-- COALESCE(NEW, OLD): in PL/pgSQL an OR is not guaranteed to short-circuit,
-- so touching NEW on a DELETE (or OLD on an INSERT) inside one expression is
-- not safe. An UPDATE that moves a row to another round — possible in
-- principle, the PK columns are not frozen — re-projects BOTH rounds, so the
-- vacated one does not keep a stale score.
--
-- No re-entrancy guard is needed: this writes only game_scores and
-- game_shot_details, neither of which has a trigger writing back here.
CREATE OR REPLACE FUNCTION public.scorer_cards_project()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.project_round_scores(NEW.tournament_id, NEW.round_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.project_round_scores(OLD.tournament_id, OLD.round_id);
  ELSE
    PERFORM public.project_round_scores(NEW.tournament_id, NEW.round_id);
    IF OLD.tournament_id IS DISTINCT FROM NEW.tournament_id
       OR OLD.round_id IS DISTINCT FROM NEW.round_id THEN
      PERFORM public.project_round_scores(OLD.tournament_id, OLD.round_id);
    END IF;
  END IF;
  RETURN NULL;                                -- AFTER trigger: value ignored
END $$;

DROP TRIGGER IF EXISTS scorer_cards_project ON public.scorer_cards;
CREATE TRIGGER scorer_cards_project
  AFTER INSERT OR UPDATE OR DELETE ON public.scorer_cards
  FOR EACH ROW EXECUTE FUNCTION public.scorer_cards_project();

DROP TRIGGER IF EXISTS score_resolutions_project ON public.score_resolutions;
CREATE TRIGGER score_resolutions_project
  AFTER INSERT OR UPDATE OR DELETE ON public.score_resolutions
  FOR EACH ROW EXECUTE FUNCTION public.scorer_cards_project();

-- 6) Backfill ------------------------------------------------------------------
-- backfill_scorer_cards(tid): fold the per-cell game_score_entries rows of one
-- tournament into one card per (round, author), and every existing
-- game_score_resolutions row into a score_resolutions row anchored to those
-- cards. Runs once per casual tournament at cutover (plan phase 5, S15).
--
-- Every backfilled hole gets `v = 1` — the entries table has no notion of a
-- publication counter, and one version for the whole history is exactly right:
-- nothing was ever re-published, so no agreement should lapse. The matching
-- basis below is therefore `{ author: 1 }` for each author marking the cell,
-- which validates immediately and keeps every historical agreement standing.
--
-- IDEMPOTENT by the strongest available guard: it returns immediately if the
-- tournament has ANY scorer_cards row. Once a device has published a real
-- card, re-running must not fabricate a second card from the frozen legacy
-- entries — a straggler re-run after cutover is a no-op, not a revert.
--
-- The projection is NOT called here; the row triggers above fire on each
-- insert and rebuild game_scores for the affected rounds.
CREATE OR REPLACE FUNCTION public.backfill_scorer_cards(p_tournament_id text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.scorer_cards c
              WHERE c.tournament_id = p_tournament_id) THEN
    RETURN;
  END IF;

  -- Cards. `scorer` is resolved by matching author_id against
  -- game_players.user_id AS TEXT — historically some devices used the signed-in
  -- user's uuid as their author/meId, and a text comparison identifies exactly
  -- those without needing a uuid-shape test (and without a cast that could
  -- raise on a device id that merely looks uuid-ish). A device id that matches
  -- no player leaves both keys JSON null, which is the correct "we do not know
  -- which player was holding this phone".
  INSERT INTO public.scorer_cards (tournament_id, round_id, author_id, card, updated_at)
  SELECT p_tournament_id, x.round_id, x.author_id,
         jsonb_build_object(
           'scorer', jsonb_build_object('playerId', gp.player_id,
                                        'userId',   gp.user_id),
           'holes',  x.holes),
         x.updated_at
    FROM (
      SELECT byh.round_id, byh.author_id,
             jsonb_object_agg(byh.hole::text, jsonb_build_object(
               'v', 1, 'entries', byh.entries, 'ts', byh.ts)) AS holes,
             max(byh.hole_at) AS updated_at
        FROM (
          SELECT e.round_id, e.author_id, e.hole,
                 jsonb_object_agg(e.player_id, e.strokes)               AS entries,
                 (extract(epoch from max(e.updated_at)) * 1000)::bigint AS ts,
                 max(e.updated_at)                                      AS hole_at
            FROM public.game_score_entries e
           WHERE e.tournament_id = p_tournament_id
             AND e.strokes IS NOT NULL          -- a blank entry is no opinion
           GROUP BY e.round_id, e.author_id, e.hole
        ) byh
       GROUP BY byh.round_id, byh.author_id
    ) x
    -- Legacy author ids were `meId ?? deviceId` (ScorecardScreen), and meId is
    -- the roster PLAYER id — so match player_id first, then the user id some
    -- older devices used. A device id that matches neither leaves both keys
    -- JSON null: "we do not know which player was holding this phone".
    LEFT JOIN LATERAL (
      SELECT p.player_id, p.user_id
        FROM public.game_players p
       WHERE p.tournament_id = p_tournament_id
         AND (p.player_id = x.author_id OR p.user_id::text = x.author_id)
       ORDER BY (p.player_id = x.author_id) DESC
       LIMIT 1
    ) gp ON true;

  -- Resolutions. basis pins v = 1 for every author whose (now backfilled)
  -- card marks the cell, so the agreement is valid the moment it lands.
  -- A cell no author marks yields an empty basis; the resolution is then
  -- inert (settled_round_cells requires at least one marking card), which is
  -- the right outcome for an orphaned legacy resolution.
  -- resolved_by is NOT NULL here while game_score_resolutions.resolved_by is
  -- nullable, hence the 'legacy' fallback.
  INSERT INTO public.score_resolutions
    (tournament_id, round_id, player_id, hole, value, resolved_by, basis, resolved_at)
  SELECT r.tournament_id, r.round_id, r.player_id, r.hole, r.value,
         COALESCE(r.resolved_by, 'legacy'),
         COALESCE((SELECT jsonb_object_agg(e.author_id, 1)
                     FROM public.game_score_entries e
                    WHERE e.tournament_id = r.tournament_id
                      AND e.round_id      = r.round_id
                      AND e.player_id     = r.player_id
                      AND e.hole          = r.hole
                      AND e.strokes IS NOT NULL), '{}'::jsonb),
         r.resolved_at
    FROM public.game_score_resolutions r
   WHERE r.tournament_id = p_tournament_id
  ON CONFLICT (tournament_id, round_id, player_id, hole) DO NOTHING;
END $$;

/* ===========================================================================
   VERIFY (run after applying)
   ---------------------------------------------------------------------------
   -- Both tables exist, with only the tournament FK (no round FK by design):
   SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid)
     FROM pg_constraint
    WHERE conrelid::regclass::text IN ('scorer_cards', 'score_resolutions')
      AND contype IN ('p', 'f')
    ORDER BY tbl, contype;

   -- RLS on, four policies each (select/insert/update/delete):
   SELECT c.relname, c.relrowsecurity, count(p.polname) AS policies
     FROM pg_class c LEFT JOIN pg_policy p ON p.polrelid = c.oid
    WHERE c.relname IN ('scorer_cards', 'score_resolutions')
    GROUP BY 1, 2 ORDER BY 1;
   -- expected: scorer_cards t 4 | score_resolutions t 4

   -- Realtime publication membership:
   SELECT tablename FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename IN ('scorer_cards', 'score_resolutions') ORDER BY 1;

   -- Triggers present (touch + project on both tables):
   SELECT tgrelid::regclass::text AS tbl, tgname FROM pg_trigger
    WHERE tgrelid IN ('public.scorer_cards'::regclass,
                      'public.score_resolutions'::regclass)
      AND NOT tgisinternal ORDER BY 1, 2;

   -- Functions present:
   SELECT proname, pg_get_function_identity_arguments(oid) FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname IN ('settled_round_cells', 'projected_round_shots',
                      'project_round_scores', 'backfill_scorer_cards')
    ORDER BY proname;

   -- End-to-end smoke, inside a transaction you roll back. Replace <tid>/<rid>
   -- with a real (tournament, round) pair from game_rounds:
   --
   --   BEGIN;
   --   INSERT INTO public.scorer_cards (tournament_id, round_id, author_id, card)
   --   VALUES ('<tid>', '<rid>', 'devA', jsonb_build_object(
   --     'scorer', jsonb_build_object('playerId', 'p1', 'userId', NULL),
   --     'holes',  jsonb_build_object('1', jsonb_build_object(
   --       'v', 1, 'entries', jsonb_build_object('p1', 4, 'p2', 5),
   --       'ts', 1757000000000::bigint))));
   --
   --   -- one scorer only -> both cells settle at that scorer's values
   --   SELECT player_id, hole, strokes FROM public.game_scores
   --    WHERE tournament_id = '<tid>' AND round_id = '<rid>' ORDER BY 1, 2;
   --   -- expected: p1 1 4 | p2 1 5
   --
   --   INSERT INTO public.scorer_cards (tournament_id, round_id, author_id, card)
   --   VALUES ('<tid>', '<rid>', 'devB', jsonb_build_object(
   --     'scorer', jsonb_build_object('playerId', 'p2', 'userId', NULL),
   --     'holes',  jsonb_build_object('1', jsonb_build_object(
   --       'v', 1, 'entries', jsonb_build_object('p1', 4, 'p2', 6),
   --       'ts', 1757000000001::bigint))));
   --
   --   -- p1 agreed; p2 disputed -> NULL tombstone
   --   SELECT player_id, hole, strokes FROM public.game_scores
   --    WHERE tournament_id = '<tid>' AND round_id = '<rid>' ORDER BY 1, 2;
   --   -- expected: p1 1 4 | p2 1 NULL
   --
   --   INSERT INTO public.score_resolutions
   --     (tournament_id, round_id, player_id, hole, value, resolved_by, basis)
   --   VALUES ('<tid>', '<rid>', 'p2', 1, 5, 'devA',
   --           '{"devA": 1, "devB": 1}'::jsonb);
   --
   --   SELECT strokes FROM public.game_scores
   --    WHERE tournament_id = '<tid>' AND round_id = '<rid>'
   --      AND player_id = 'p2' AND hole = 1;
   --   -- expected: 5
   --
   --   -- devB re-publishes hole 1 (v -> 2): the agreement lapses
   --   UPDATE public.scorer_cards SET card = jsonb_set(card, '{holes,1,v}', '2')
   --    WHERE tournament_id = '<tid>' AND round_id = '<rid>' AND author_id = 'devB';
   --
   --   SELECT strokes FROM public.game_scores
   --    WHERE tournament_id = '<tid>' AND round_id = '<rid>'
   --      AND player_id = 'p2' AND hole = 1;
   --   -- expected: NULL
   --   ROLLBACK;

   -- Backfill (replace <tid>); second call must be a no-op:
   -- SELECT public.backfill_scorer_cards('<tid>');
   -- SELECT round_id, author_id, jsonb_pretty(card) FROM public.scorer_cards
   --  WHERE tournament_id = '<tid>' ORDER BY round_id, author_id;
   =========================================================================== */
