# Sync v2: Normalized Schema — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the blob-merge sync architecture with normalized tables (hot data as rows, cold config as JSONB bodies), realtime per-row updates, and server-arrival conflict ordering — per the approved spec `docs/superpowers/specs/2026-07-11-sync-v2-normalized-schema-design.md` (READ IT FIRST, including its Amendments section).

**Architecture:** New `game_*` tables + RPCs on Supabase; client keeps `mutate.js` typed mutations and optimistic local apply, but the sync drain executes targeted row writes instead of blob merges. `get_game_tournament` returns the exact legacy blob shape so all domain logic and screens are untouched. Realtime channel per active tournament patches the local cache. `merge.js`/`_meta` are deleted at the end.

**Tech Stack:** Expo SDK 54 / React Native 0.81, Supabase (`@supabase/supabase-js` ^2.103.3 — v2 `channel().on('postgres_changes', …)` realtime API), Postgres plpgsql, Jest (jest-expo).

## Global Constraints

- All work on branch `feature/sync-v2-normalized` in a worktree OUTSIDE the repo (memory: nested worktrees break jest). Base: current `master`.
- TDD every task: failing test → minimal implementation → full `npm test` + `npm run lint` green before commit. Lint baseline: 0 errors / 50 pre-existing warnings — add none.
- Execution subagents run on **Sonnet** (user instruction).
- The legacy `data` blob column is FROZEN: no code path may write it after Task 11 (except `claim_tournament_player`'s transitional dual-write).
- `meId` stays device-local. `scoreConflicts`/`scoreResolutions` become client-local only.
- The tournament object shape consumed by stores/screens must not change (round-trip equality per spec Amendment 6).
- Table/RPC names per spec Amendment 1/3 exactly: `game_players`, `game_rounds`, `game_scores`, `game_shot_details`, `game_round_notes`; `get_game_tournament`, `get_my_game_tournaments`, `set_game_score`, `patch_game_round`, `patch_game_tournament`, `advance_game_round`, `backfill_game_tournament`.
- Never run destructive SQL against the live DB; migration is additive-only. `.env` holds `SUPABASE_MANAGEMENT_API_TOKEN` for the Management API query endpoint (POST `/v1/projects/{ref}/database/query`, ref = subdomain of `EXPO_PUBLIC_SUPABASE_URL`).

---

### Task 1: Live schema facts + blob fixtures

**Files:**
- Create: `scripts/sync-v2/db.mjs` (shared Management-API query helper)
- Create: `scripts/sync-v2/inspect-schema.mjs`
- Create: `scripts/sync-v2/export-fixtures.mjs`
- Create: `docs/superpowers/plans/sync-v2-schema-facts.md` (output, committed)
- Create: `src/store/__tests__/fixtures/syncV2/` (3–5 real blob JSONs, output, committed)

**Interfaces:**
- Produces: `sync-v2-schema-facts.md` documenting the authoritative `tournaments` table columns and types (esp. `id` — expected `text`, verify) and RLS policies; fixture files named `fixture-<id>.json`, each the raw `data` blob of one real tournament (pick: 1 finished multi-round, 1 with shotDetails/notes, the live weekend one, 1 single-round game).
- Later tasks consume: FK types for DDL (Task 2), fixtures for round-trip and store tests (Tasks 5, 6, 10).

- [ ] **Step 1:** Write `scripts/sync-v2/db.mjs`:

```js
// Query the live DB via the Supabase Management API (no service key in repo).
import 'dotenv/config';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const ref = new URL(url).hostname.split('.')[0];
const token = process.env.SUPABASE_MANAGEMENT_API_TOKEN;

export async function dbQuery(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}
```

- [ ] **Step 2:** Write `inspect-schema.mjs` — query `information_schema.columns` for `tournaments` and all `tournament_*` tables, plus `pg_policies` for `tournaments`; print as markdown. Run it (`node scripts/sync-v2/inspect-schema.mjs`), paste output into `docs/superpowers/plans/sync-v2-schema-facts.md`, and add a "Decisions" section stating the confirmed `tournaments.id` type and any drift found.
- [ ] **Step 3:** Write `export-fixtures.mjs` — `SELECT id, name, kind, data FROM tournaments WHERE data IS NOT NULL AND data != '{}'::jsonb ORDER BY created_at DESC LIMIT 12`, then write the 4 selection-criteria blobs to `src/store/__tests__/fixtures/syncV2/fixture-<id>.json`. Run it.
- [ ] **Step 4:** Sanity-check each fixture parses and has `rounds[]`/`players[]` (a tiny Node assert inline in the script).
- [ ] **Step 5:** Commit: `git add scripts/sync-v2 docs/superpowers/plans/sync-v2-schema-facts.md src/store/__tests__/fixtures/syncV2 && git commit -m "chore(sync-v2): schema facts + real blob fixtures"`

### Task 2: Migration part 1 — tables, RLS, realtime publication

**Files:**
- Create: `supabase/migrations/20260712000000_sync_v2_normalized.sql`

**Interfaces:**
- Produces: the five `game_*` tables + `tournaments.props jsonb` / `tournaments.current_round int` columns. Consumed by every later task. Use the `tournaments.id` type confirmed in Task 1 for all FK columns (plan assumes `text`; adjust if facts say otherwise).

- [ ] **Step 1:** Write the DDL (top of the new migration file):

```sql
-- Sync v2 (normalized schema). Spec:
-- docs/superpowers/specs/2026-07-11-sync-v2-normalized-schema-design.md
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS props jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS current_round int;

CREATE TABLE IF NOT EXISTS public.game_players (
  tournament_id text NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  player_id     text NOT NULL,
  user_id       uuid,
  pos           int NOT NULL DEFAULT 0,          -- preserves players[] order
  body          jsonb NOT NULL DEFAULT '{}'::jsonb, -- the whole player object
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, player_id)
);

CREATE TABLE IF NOT EXISTS public.game_rounds (
  id            text PRIMARY KEY,
  tournament_id text NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  round_index   int NOT NULL,
  body          jsonb NOT NULL DEFAULT '{}'::jsonb, -- round minus scores/shotDetails/notes
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS game_rounds_tournament_idx ON public.game_rounds (tournament_id);

CREATE TABLE IF NOT EXISTS public.game_scores (
  round_id      text NOT NULL REFERENCES public.game_rounds(id) ON DELETE CASCADE,
  tournament_id text NOT NULL,
  player_id     text NOT NULL,
  hole          int  NOT NULL,
  strokes       int,                                -- NULL = cleared (tombstone)
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid,
  PRIMARY KEY (round_id, player_id, hole)
);
CREATE INDEX IF NOT EXISTS game_scores_tournament_idx ON public.game_scores (tournament_id);

CREATE TABLE IF NOT EXISTS public.game_shot_details (
  round_id      text NOT NULL REFERENCES public.game_rounds(id) ON DELETE CASCADE,
  tournament_id text NOT NULL,
  player_id     text NOT NULL,
  hole          int  NOT NULL,
  detail        jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, player_id, hole)
);
CREATE INDEX IF NOT EXISTS game_shot_details_tournament_idx ON public.game_shot_details (tournament_id);

CREATE TABLE IF NOT EXISTS public.game_round_notes (
  round_id      text NOT NULL REFERENCES public.game_rounds(id) ON DELETE CASCADE,
  tournament_id text NOT NULL,
  hole_key      text NOT NULL,                      -- 'round' or '1'..'18'
  note          text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, hole_key)
);
CREATE INDEX IF NOT EXISTS game_round_notes_tournament_idx ON public.game_round_notes (tournament_id);
```

- [ ] **Step 2:** RLS — enable on all five tables; one policy set each, delegating to the parent row's RLS via invoker-context subquery (pattern used by `tournament_media`):

```sql
ALTER TABLE public.game_players      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_rounds       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_scores       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_shot_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_round_notes  ENABLE ROW LEVEL SECURITY;

-- Repeat for each table (shown once; write all five):
CREATE POLICY game_players_all ON public.game_players
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id));
```

- [ ] **Step 3:** Realtime publication (idempotent):

```sql
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.game_scores;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.game_shot_details;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.game_round_notes;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.game_rounds;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.game_players;
  ALTER PUBLICATION supabase_realtime ADD TABLE public.tournaments;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

- [ ] **Step 4:** Verify the SQL parses (careful read; Task 14's staged apply is the real gate). Commit: `git commit -m "feat(sync-v2): normalized tables, RLS, realtime publication"`

### Task 3: Migration part 2 — read RPCs (`get_game_tournament`, `get_my_game_tournaments`)

**Files:**
- Modify: `supabase/migrations/20260712000000_sync_v2_normalized.sql` (append)

**Interfaces:**
- Produces: `get_game_tournament(p_id text) RETURNS jsonb` — the EXACT legacy blob shape; `get_my_game_tournaments() RETURNS jsonb` — array of `{ tournament: <blob-shape>, role: text }`. Consumed by Task 6 (repo) and Task 5 (round-trip verify).

- [ ] **Step 1:** Append `get_game_tournament` (plpgsql, `STABLE`, `SECURITY INVOKER` so RLS applies):

```sql
CREATE OR REPLACE FUNCTION public.get_game_tournament(p_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_t   record;
  v_out jsonb;
BEGIN
  SELECT * INTO v_t FROM public.tournaments WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_out := v_t.props || jsonb_build_object(
    'id', v_t.id, 'name', v_t.name, 'kind', v_t.kind, 'createdAt', v_t.created_at,
    'players', COALESCE((
      SELECT jsonb_agg(gp.body ORDER BY gp.pos, gp.player_id)
      FROM public.game_players gp WHERE gp.tournament_id = p_id), '[]'::jsonb),
    'rounds', COALESCE((
      SELECT jsonb_agg(
        gr.body
        || jsonb_build_object('id', gr.id)
        || jsonb_build_object('scores', COALESCE((
             SELECT jsonb_object_agg(q.player_id, q.per) FROM (
               SELECT s.player_id, jsonb_object_agg(s.hole::text, s.strokes) AS per
               FROM public.game_scores s
               WHERE s.round_id = gr.id AND s.strokes IS NOT NULL
               GROUP BY s.player_id) q), '{}'::jsonb))
        || jsonb_build_object('shotDetails', COALESCE((
             SELECT jsonb_object_agg(q.player_id, q.per) FROM (
               SELECT d.player_id, jsonb_object_agg(d.hole::text, d.detail) AS per
               FROM public.game_shot_details d
               WHERE d.round_id = gr.id AND d.detail IS NOT NULL
               GROUP BY d.player_id) q), '{}'::jsonb))
        || COALESCE((
             SELECT jsonb_build_object('notes',
               COALESCE((SELECT jsonb_build_object('round', n.note)
                         FROM public.game_round_notes n
                         WHERE n.round_id = gr.id AND n.hole_key = 'round' AND n.note IS NOT NULL), '{}'::jsonb)
               || COALESCE((SELECT jsonb_build_object('hole', jsonb_object_agg(n.hole_key, n.note))
                            FROM public.game_round_notes n
                            WHERE n.round_id = gr.id AND n.hole_key <> 'round' AND n.note IS NOT NULL), '{}'::jsonb))
             WHERE EXISTS (SELECT 1 FROM public.game_round_notes n2
                           WHERE n2.round_id = gr.id AND n2.note IS NOT NULL)), '{}'::jsonb)
        ORDER BY gr.round_index, gr.id)
      FROM public.game_rounds gr WHERE gr.tournament_id = p_id), '[]'::jsonb));

  IF v_t.current_round IS NOT NULL THEN
    v_out := v_out || jsonb_build_object('currentRound', v_t.current_round);
  END IF;
  RETURN v_out;
END $$;
```

- [ ] **Step 2:** Append `get_my_game_tournaments()` — replicate `loadAllTournaments`'s role logic server-side (owner: `created_by = auth.uid() OR created_by IS NULL`; member: `tournament_members`; participant fallback: `tournament_participants`), dedupe by id in that priority order, `ORDER BY created_at DESC`, return `jsonb_agg(jsonb_build_object('tournament', public.get_game_tournament(t.id), 'role', <role>))`. For official tournaments (`kind = 'official'`) `get_game_tournament` naturally returns empty `players`/`rounds` — same as today's `rowToTournament`.
- [ ] **Step 3:** Commit: `git commit -m "feat(sync-v2): read RPCs (assembled blob shape)"`

### Task 4: Migration part 3 — write RPCs + claim dual-write

**Files:**
- Modify: `supabase/migrations/20260712000000_sync_v2_normalized.sql` (append)

**Interfaces:**
- Produces (consumed by Tasks 6/8):
  - `set_game_score(p_round_id text, p_tournament_id text, p_player_id text, p_hole int, p_strokes int) RETURNS jsonb` → `{"previousStrokes": int|null, "previousUpdatedAt": timestamptz|null}` (row-locked read-before-write).
  - `patch_game_round(p_round_id text, p_patch jsonb) RETURNS void` — one-level-deep merge into `body` (object values merge one level, scalars/arrays replace; jsonb `null` stores null).
  - `patch_game_tournament(p_id text, p_patch jsonb) RETURNS void` — same merge into `props`; keys `name`/`kind` update the real columns instead; key `currentRound` routes to `advance_game_round`.
  - `advance_game_round(p_id text, p_round int) RETURNS void` — `UPDATE public.tournaments SET current_round = GREATEST(COALESCE(current_round, 0), p_round) WHERE id = p_id;`

- [ ] **Step 1:** Write `set_game_score`:

```sql
CREATE OR REPLACE FUNCTION public.set_game_score(
  p_round_id text, p_tournament_id text, p_player_id text, p_hole int, p_strokes int)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_prev_strokes int;
  v_prev_at timestamptz;
BEGIN
  SELECT strokes, updated_at INTO v_prev_strokes, v_prev_at
  FROM public.game_scores
  WHERE round_id = p_round_id AND player_id = p_player_id AND hole = p_hole
  FOR UPDATE;

  INSERT INTO public.game_scores (round_id, tournament_id, player_id, hole, strokes, updated_at, updated_by)
  VALUES (p_round_id, p_tournament_id, p_player_id, p_hole, p_strokes, now(), auth.uid())
  ON CONFLICT (round_id, player_id, hole)
  DO UPDATE SET strokes = EXCLUDED.strokes, updated_at = now(), updated_by = auth.uid();

  RETURN jsonb_build_object('previousStrokes', v_prev_strokes, 'previousUpdatedAt', v_prev_at);
END $$;
```

- [ ] **Step 2:** Write `patch_game_round` / `patch_game_tournament` / `advance_game_round` per the Interfaces block. Merge loop for both patch functions:

```sql
  FOR v_k, v_v IN SELECT * FROM jsonb_each(p_patch) LOOP
    IF jsonb_typeof(v_v) = 'object' AND jsonb_typeof(v_body -> v_k) = 'object' THEN
      v_body := jsonb_set(v_body, ARRAY[v_k], (v_body -> v_k) || v_v);
    ELSE
      v_body := jsonb_set(v_body, ARRAY[v_k], v_v);
    END IF;
  END LOOP;
```

then a single `UPDATE … SET body/props = v_body, updated_at = now()`.
- [ ] **Step 3:** Re-create `claim_tournament_player` with its EXACT current body from `supabase/migrations/20260522000002_fix_claim_jsonb_set.sql` PLUS, after the blob `jsonb_set` writes, the dual-write (match the function's actual variable names when copying — read the 20260522 file first):

```sql
  UPDATE public.game_players
     SET user_id = v_user_id,
         body = jsonb_set(body, '{user_id}', to_jsonb(v_user_id::text)),
         updated_at = now()
   WHERE tournament_id = p_tournament_id AND player_id = v_player_id;
```

- [ ] **Step 4:** Commit: `git commit -m "feat(sync-v2): write RPCs + claim dual-write"`

### Task 5: Migration part 4 — backfill + apply/verify scripts

**Files:**
- Modify: `supabase/migrations/20260712000000_sync_v2_normalized.sql` (append)
- Create: `scripts/sync-v2/apply-migration.mjs`
- Create: `scripts/sync-v2/verify-roundtrip.mjs`

**Interfaces:**
- Produces: `backfill_game_tournament(p_id text) RETURNS void` — idempotent, `_meta`-aware (spec Amendment 5). Scripts consumed by Task 14.

- [ ] **Step 1:** Write `backfill_game_tournament` (plpgsql). Logic, in order:
  1. Load `data` into `v_data`; `RETURN` if `v_data IS NULL OR v_data = '{}'::jsonb OR kind = 'official'`.
  2. `UPDATE tournaments SET props = v_data - 'players' - 'rounds' - 'id' - 'name' - 'kind' - 'createdAt' - 'currentRound' - '_meta' - 'meId', current_round = GREATEST(COALESCE(current_round, 0), COALESCE((v_data->>'currentRound')::int, 0)) WHERE id = p_id`.
  3. Players: `FOR … IN SELECT value, ordinality FROM jsonb_array_elements(v_data->'players') WITH ORDINALITY` → upsert `game_players (tournament_id, player_id, user_id, pos, body)` with `ON CONFLICT (tournament_id, player_id) DO UPDATE SET body = EXCLUDED.body, user_id = COALESCE(EXCLUDED.user_id, game_players.user_id), pos = EXCLUDED.pos`.
  4. Rounds: for each round element with ordinality → `v_body := value - 'scores' - 'shotDetails' - 'notes' - 'scoreConflicts' - 'scoreResolutions'`; upsert `game_rounds (id, tournament_id, round_index, body)`.
  5. Scores: for each `(pid, holes)` in `jsonb_each(value->'scores')`, each `(hole, strokes)` in `jsonb_each(holes)`: `v_cell_ts := to_timestamp(COALESCE((v_data->'_meta'->>('rounds.' || <round_id> || '.scores.' || pid || '.h' || hole))::bigint, 0) / 1000.0)`; when no stamp, fall back to the tournament's `created_at`. Upsert with the sweep guard: `ON CONFLICT (round_id, player_id, hole) DO UPDATE SET strokes = EXCLUDED.strokes, updated_at = EXCLUDED.updated_at WHERE game_scores.updated_at < EXCLUDED.updated_at`.
  6. Shot details + notes: same pattern (`_meta` paths `rounds.<rid>.shotDetails.<pid>.h<n>` and `rounds.<rid>.notes.*`; notes: one row per `notes.round` and per `notes.hole.{n}`).
- [ ] **Step 2:** `apply-migration.mjs`: read the migration file, POST it via `dbQuery` (Task 1 `db.mjs`); then `SELECT public.backfill_game_tournament(id) FROM public.tournaments;`; print row counts (`SELECT count(*) FROM public.game_scores` etc.).
- [ ] **Step 3:** `verify-roundtrip.mjs`: for every tournament with a non-empty blob: fetch `data` and `get_game_tournament(id)` via `dbQuery`; normalize both per spec Amendment 6 (drop `_meta`/`meId`/`scoreConflicts`/`scoreResolutions`; default `scores`/`shotDetails` to `{}` per round; drop empty `notes`; compare `createdAt` as `new Date(x).getTime()`); deep-equal; print PASS/FAIL per id; exit non-zero on any FAIL.
- [ ] **Step 4:** Commit: `git commit -m "feat(sync-v2): idempotent meta-aware backfill + apply/verify scripts"`

### Task 6: Client repository (`tournamentRepo.js`)

**Files:**
- Create: `src/store/tournamentRepo.js`
- Test: `src/store/__tests__/tournamentRepo.test.js`

**Interfaces:**
- Consumes: `supabase` from `src/lib/supabase.js`.
- Produces (exact signatures, consumed by Tasks 8–12):

```js
export async function fetchTournament(id)                    // rpc get_game_tournament → object|null
export async function fetchMyTournaments()                   // rpc get_my_game_tournaments → [{...t, _role}]
export async function setScore({ tournamentId, roundId, playerId, hole, strokes })
                                                             // rpc set_game_score → { previousStrokes, previousUpdatedAt }
export async function setShotDetail({ tournamentId, roundId, playerId, hole, detail })  // upsert game_shot_details
export async function setNote({ tournamentId, roundId, holeKey, note })                 // upsert game_round_notes
export async function patchRound(roundId, patch)             // rpc patch_game_round
export async function patchTournament(id, patch)             // rpc patch_game_tournament
export async function advanceRound(id, roundIndex)           // rpc advance_game_round
export async function upsertPlayer(tournamentId, player, pos)   // upsert game_players (body=player, user_id extracted)
export async function deletePlayer(tournamentId, playerId)    // delete game_players row
export async function clearPlayerRound(roundId, playerId)     // delete game_scores + game_shot_details rows for player
export async function deleteRound(roundId)                    // delete game_rounds row (cascades)
export async function upsertRound(tournamentId, roundIndex, round) // upsert game_rounds (body = round minus hot keys)
export async function createTournament(t)                     // insert tournaments row (props split) + players + rounds (+ scores if present)
```

- [ ] **Step 1:** Write failing tests with a jest supabase mock (follow the mocking style in `src/store/__tests__/tournamentStoreSync.test.js` — `jest.doMock('../../lib/supabase', …)` capturing `.rpc(name, args)` and `.from(table)` chains). Cover: each function calls the right RPC/table with the right args; `createTournament` splits `t` into columns + `props` (props = t minus id/name/kind/createdAt/currentRound/players/rounds/meId/_meta) and inserts players with `pos` = array index and rounds with `body` = round minus `scores`/`shotDetails`/`notes`; `fetchMyTournaments` maps `{tournament, role}` → `{...tournament, _role: role}`.
- [ ] **Step 2:** Run: `npm test -- tournamentRepo` → FAIL (module not found).
- [ ] **Step 3:** Implement `tournamentRepo.js` (~120 lines; every function throws on `error` — callers handle retry).
- [ ] **Step 4:** `npm test -- tournamentRepo` → PASS; full `npm test` + lint.
- [ ] **Step 5:** Commit: `git commit -m "feat(sync-v2): tournament repository over game_* tables"`

### Task 7: New mutation types + pending-overlay in `mutate.js`

**Files:**
- Modify: `src/store/mutate.js`
- Modify: `src/store/syncQueue.js` (stamp `ts: Date.now()` on each entry at enqueue if not already present)
- Test: `src/store/__tests__/mutate.test.js` (extend existing)

**Interfaces:**
- Produces (consumed by Tasks 8/10/11):
  - New mutation types handled by `applyToTournament` and `metaPathFor` (path retained purely as the queue-coalescing key):
    - `{ type: 'tournament.advanceRound', roundIndex }` → `t.currentRound = Math.max(t.currentRound ?? 0, roundIndex)`; path `currentRound`.
    - `{ type: 'round.reveal', roundId, pairs }` → sets `round.revealed = true` and, when `pairs` given, `round.pairs = pairs`; path `rounds.<rid>.revealed`.
    - `{ type: 'tournament.updateProfile', patch }` → merges `patch` into `t` (one level deep for object values, mirroring `patch_game_tournament`); path `props`.
    - `{ type: 'tournament.create', tournament }` → local no-op in `applyToTournament` (creation is already saved locally); path `create`.
  - `export function applyPendingMutations(tournament, entries)` — clones `tournament`, applies `entries.map(e => e.mutation)` via `applyToTournament` in order, returns the clone. This replaces LWW merging: server truth + my undrained ops.

- [ ] **Step 1:** Failing tests: each new type's `applyToTournament` behavior (exact assertions — e.g. advanceRound is monotonic: applying `{roundIndex: 0}` on `currentRound: 2` leaves 2); `applyPendingMutations` applies a queued `score.set` on top of a fetched object without mutating the input.
- [ ] **Step 2:** Run `npm test -- mutate` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** PASS + full suite + lint.
- [ ] **Step 5:** Commit: `git commit -m "feat(sync-v2): new mutation types + pending overlay"`

### Task 8: Mutation→row-write mapping (`mutationWrites.js`)

**Files:**
- Create: `src/store/mutationWrites.js`
- Test: `src/store/__tests__/mutationWrites.test.js`

**Interfaces:**
- Consumes: `tournamentRepo` (Task 6 signatures), local tournament snapshot, queue entries `{ tournamentId, mutation, path, ts }`.
- Produces (consumed by Task 9):

```js
// Executes one queued mutation against the server. Returns { conflict } where
// conflict is null or { roundId, playerId, hole, mine, theirs } for the
// score-cell case: previousStrokes != null, !== written value, and
// previousUpdatedAt > entry.ts (we stomped a value committed after our local write).
export async function executeMutation(entry, localTournament)
```

- Mapping (every `metaPathFor` type MUST have a branch; throw on unknown — same contract as today):
  - `score.set` → `repo.setScore(...)`; conflict rule above.
  - `shot.set` → `repo.setShotDetail`; `note.set` → `repo.setNote` (holeKey `'round'` or `String(m.hole)`).
  - `pairs.set` → `repo.patchRound(m.roundId, { pairs: localRound.pairs })`.
  - `round.setScoringMode` → `repo.patchRound(m.roundId, { scoringMode: localRound.scoringMode ?? null, pairs: localRound.pairs ?? null })`.
  - `round.setBestBallValues` → `repo.patchRound(m.roundId, { bestBallValue, worstBallValue })` from the local round.
  - `tournament.setTeamSettings` → `repo.patchTournament(id, { settings: { fixedTeams, manualTeams } })` from local settings.
  - `handicap.set` → `repo.patchRound(m.roundId, { playerHandicaps: { [m.playerId]: localRound.playerHandicaps?.[m.playerId] ?? null } })`; `index.set` analogous with `playerIndexes`.
  - `round.remove` → `repo.deleteRound(m.roundId)`.
  - `tournament.addPlayer` → `repo.upsertPlayer(id, m.player, local.players.findIndex(p => p.id === m.player.id))` + one `patchRound` per `m.roundPatches` (handicaps/pairs/scoringMode from the local round) + `patchTournament({ settings: { scoringMode: m.nextScoringMode } })` when `m.nextScoringMode`.
  - `tournament.removePlayer` → `repo.deletePlayer` + per-roundPatch `repo.clearPlayerRound(rid, m.playerId)` + `patchRound` for pairs/scoringMode.
  - `tournament.setFinished` → `repo.patchTournament(id, { finishedAt: local.finishedAt ?? null })`.
  - `tournament.claimPlayer` → `repo.upsertPlayer(id, localPlayer, pos)` (idempotent alongside the RPC dual-write).
  - `tournament.setScoringMode` → `repo.patchTournament(id, { settings: { scoringMode } })` + per-roundPatch `patchRound`.
  - `conflict.resolve` → `repo.setScore(...)` (marker clearing is local, Task 11).
  - `tournament.advanceRound` → `repo.advanceRound(id, m.roundIndex)`.
  - `round.reveal` → `repo.patchRound(m.roundId, { revealed: true, ...(m.pairs ? { pairs: m.pairs } : {}) })`.
  - `tournament.updateProfile` → `repo.patchTournament(id, m.patch)`.
  - `tournament.create` → `repo.createTournament(m.tournament)`.
  - `player.upsertLibrary` → NOT here; stays as the legacy RPC branch in syncWorker.
- [ ] **Step 1:** Failing tests: one per mapping branch (mock repo, assert exact call args); the conflict rule with three cases (no previous → null; same value → null; different + newer server ts → conflict object).
- [ ] **Step 2:** `npm test -- mutationWrites` → FAIL.
- [ ] **Step 3:** Implement (~150 lines).
- [ ] **Step 4:** PASS + full suite + lint.
- [ ] **Step 5:** Commit: `git commit -m "feat(sync-v2): mutation→row-write mapping with conflict detection"`

### Task 9: `syncWorker` drain rewrite

**Files:**
- Modify: `src/store/syncWorker.js`
- Test: `src/store/__tests__/syncWorker.test.js` (rewrite the drain tests)

**Interfaces:**
- Consumes: `executeMutation` (Task 8), `readLocal`/`saveLocal` (tournamentStore), `fetchTournament` (Task 6), `applyPendingMutations` (Task 7).
- Produces: same public surface as today (`syncNow`, status observable) — screens unchanged. Also calls the Task-11 conflict hook for each returned conflict.

- [ ] **Step 1:** Failing tests: drain executes queued mutations via `executeMutation` in order and drops them on success; keeps entry on transient error / drops on terminal `error.code` (preserve today's heuristic at `syncWorker.js:37-58`, including the `player.upsertLibrary` RPC branch); after a tournament's entries drain, it fetches the tournament once, overlays still-queued mutations, and `saveLocal`s the result; a returned conflict is forwarded to the marker hook (mock it).
- [ ] **Step 2:** `npm test -- syncWorker` → FAIL.
- [ ] **Step 3:** Rewrite `drainTournament`: delete `fetchRemote`/`mergeTournaments`/`pushRemote`; loop entries → `executeMutation(entry, await readLocal(tid))`; collect conflicts; post-drain reconcile: `const fresh = await repoFetchTournament(tid); if (fresh) await saveLocal(applyPendingMutations(fresh, stillQueued))`.
- [ ] **Step 4:** PASS + full suite + lint.
- [ ] **Step 5:** Commit: `git commit -m "feat(sync-v2): drain executes row writes, post-drain reconcile pull"`

### Task 10: `tournamentStore` read-path rewrite

**Files:**
- Modify: `src/store/tournamentStore.js`
- Test: `src/store/__tests__/tournamentStoreSync.test.js` (retarget), `src/store/__tests__/loadTournamentCached.test.js` (retarget mocks)

**Interfaces:**
- Consumes: `fetchTournament`/`fetchMyTournaments` (Task 6), `applyPendingMutations` (Task 7), `syncQueue` (to read pending entries per tournament).
- Produces: unchanged public surface (`loadTournament`, `getTournament`, `refreshTournamentFromRemote`, `loadAllTournaments`, `loadAllTournamentsWithFallback`, `saveLocal`, `readLocal`, snapshots, subscriptions).

- [ ] **Step 1:** Failing tests: background refresh becomes "fetch → `applyPendingMutations(fresh, queuedForId)` → `saveLocal`" (assert a queued-but-undrained `score.set` survives a refresh); `loadAllTournaments` = one `fetchMyTournaments` call + per-tournament pending overlay (no 3-query union, no `_finalizeTournamentList` blob merging); offline fallback behavior of `loadAllTournamentsWithFallback` unchanged.
- [ ] **Step 2:** Run the two test files → FAIL.
- [ ] **Step 3:** Implement: `fetchRemoteTournament` → `repo.fetchTournament`; delete `mergeTournaments` import/usage and `_finalizeTournamentList`; keep `writeIndex` fed from the fetched list; keep `rowToTournament` only if the offline index path still needs it (read first).
- [ ] **Step 4:** PASS + full suite (retarget fallout tests that mocked the old queries) + lint.
- [ ] **Step 5:** Commit: `git commit -m "feat(sync-v2): store reads via repository + pending overlay"`

### Task 11: Convert `saveTournament` call sites; conflict markers local-only

**Files:**
- Modify: `src/screens/NextRoundScreen.js:258-283`, `src/screens/HomeScreen.js:506,528,549,688`, `src/screens/SetupScreen.js:459`, `src/screens/EditTournamentScreen.js:158`, `src/screens/PlayersScreen.js:282`
- Modify: `src/store/tournamentStore.js` (delete `saveTournament`, `persistRemote`, `pushRemote`; move the `syncTournamentParticipants` mirror into the repo's `createTournament`/`upsertPlayer` follow-up)
- Modify: `src/store/mutate.js` (marker writer), `src/store/syncWorker.js` (wire conflicts → marker)
- Test: extend affected screen tests + create `src/store/__tests__/scoreConflicts.test.js`

**Interfaces:**
- Consumes: mutation types from Task 7.
- Produces: `export async function recordScoreConflict(tournamentId, { roundId, playerId, hole, mine, theirs })` in `mutate.js` — writes the SAME `round.scoreConflicts[pid]['h' + hole] = { candidates: [{ value: mine }, { value: theirs }], detectedAt }` shape the existing UI reads, via `readLocal` + `saveLocal` only (never synced). `conflict.resolve` additionally clears the local marker.

- Call-site conversions (each via `mutate(t, mutation)`):
  - NextRound `handleConfirm` → `mutate(t, { type: 'round.reveal', roundId, pairs: nextPairs })` + (when `!revealOnly`) `mutate(t, { type: 'tournament.advanceRound', roundIndex })`.
  - NextRound `reshuffle` (revealOnly branch) → `round.reveal` with the new pairs.
  - HomeScreen 506/528/549: READ EACH FIRST — they are pairs/reveal/settings edits; convert to `pairs.set` / `round.reveal` / `tournament.updateProfile` by actual intent.
  - HomeScreen 688 (`saveTournament(created)`) → `mutate(created, { type: 'tournament.create', tournament: created })` (drain inserts remotely; offline creation queues).
  - SetupScreen 459 / EditTournament 158 / PlayersScreen 282 → `tournament.updateProfile` for name/settings changes; roster/round-structure rebuilds reuse `tournament.addPlayer` / `tournament.removePlayer` / `upsertRound`-backed mutations (PlayersScreen already emits add/remove mutations — only the residual bulk-save becomes `tournament.updateProfile`).
- [ ] **Step 1:** Failing tests per conversion (screen-level where harnesses exist; store-level otherwise) + a marker round-trip test (record → visible in `readLocal` result → resolve clears it).
- [ ] **Step 2:** FAIL. **Step 3:** Convert all sites; delete `saveTournament`/`persistRemote`/`pushRemote`; `grep -rn "saveTournament\|persistRemote\|pushRemote" src/` must return zero non-test hits.
- [ ] **Step 4:** PASS + full suite + lint.
- [ ] **Step 5:** Commit: `git commit -m "feat(sync-v2)!: all writes flow through mutations; blob push deleted"`

### Task 12: Realtime (`realtimeSync.js`)

**Files:**
- Create: `src/store/realtimeSync.js`
- Modify: `src/screens/HomeScreen.js` (call on reload with active id), `src/screens/ScorecardScreen.js` (call in load effect), `src/screens/RoundSummaryScreen.js` (call on mount)
- Test: `src/store/__tests__/realtimeSync.test.js`

**Interfaces:**
- Consumes: `supabase.channel` (v2 API), `readLocal`/`saveLocal`.
- Produces:

```js
export function ensureRealtimeForTournament(id)  // idempotent; switches channel when id changes; no-op for null/official ids
export function stopRealtime()
// Pure row→object patchers (exported for tests):
export function applyScoreRow(t, row)        // sets/deletes t.rounds[byId].scores[pid][hole]
export function applyShotDetailRow(t, row)
export function applyNoteRow(t, row)
export function applyRoundRow(t, row)        // round = row.body + {id}; preserves existing hot keys (scores/shotDetails/notes)
export function applyPlayerRow(t, row)       // upserts players[] at row.pos
export function applyTournamentRow(t, row)   // props merge + currentRound = Math.max
```

- Channel: `supabase.channel('game-' + id)` with six `.on('postgres_changes', { event: '*', schema: 'public', table, filter: 'tournament_id=eq.' + id }, handler)` bindings (`tournaments` uses `filter: 'id=eq.' + id`); handler: `const cached = await readLocal(id); if (!cached) return; await saveLocal(applyXRow(cached, payload.new ?? payload.old))`. `saveLocal`'s identical-JSON suppression swallows self-echoes.
- [ ] **Step 1:** Failing tests for every patcher (pure functions, exact before/after objects) + `ensureRealtimeForTournament` idempotence/switch (mock `supabase.channel` chain).
- [ ] **Step 2:** `npm test -- realtimeSync` → FAIL.
- [ ] **Step 3:** Implement + wire the three screens (one-line calls in existing effects; ScorecardScreen skips official mode, same guard as the live pull).
- [ ] **Step 4:** PASS + full suite + lint.
- [ ] **Step 5:** Commit: `git commit -m "feat(sync-v2): realtime channel patches local cache"`

### Task 13: Deletion sweep + full green

**Files:**
- Delete: `src/store/merge.js`, `src/store/__tests__/merge.test.js`
- Modify: `src/store/mutate.js` (remove the `_meta` stamping block at ~318-325; KEEP `metaPathFor` as the queue-coalescing key), `src/store/conflictLabels.js` (read first; retarget only if it referenced merge internals)
- Modify: any remaining importers — `grep -rn "mergeTournaments\|_meta" src/` must end at zero non-comment hits outside `__tests__/fixtures/`

- [ ] **Step 1:** Grep-driven sweep; delete/retarget. The conflict-marker UI in ScorecardScreen STAYS (it reads `round.scoreConflicts`, now locally sourced).
- [ ] **Step 2:** `npm test` full suite green; `npm run lint` 0 errors, ≤50 warnings.
- [ ] **Step 3:** Commit: `git commit -m "refactor(sync-v2)!: delete blob-merge engine and _meta stamping"`

### Task 14: Apply, verify, roll out

**Files:** none new — uses Task 5 scripts. Merge + build + live verification.

- [ ] **Step 1:** `node scripts/sync-v2/apply-migration.mjs` (additive; old builds unaffected). Expected: table counts > 0 printed.
- [ ] **Step 2:** `node scripts/sync-v2/verify-roundtrip.mjs` — expected `PASS` for every tournament id, exit 0. Any FAIL blocks rollout; diff the normalized objects, fix backfill/assembler, re-apply (idempotent), re-run.
- [ ] **Step 3:** Runtime verify with the `verify` skill (Expo web): two browser contexts on the same tournament — a score entered in one appears in the other within ~2s (realtime); leaderboard includes all reached rounds; offline queue drains after reconnect (devtools offline toggle).
- [ ] **Step 4:** Merge `feature/sync-v2-normalized` → `master` (only after Steps 1–3 pass), push.
- [ ] **Step 5:** EAS build: `eas build -p android --profile preview`. Share the APK; the whole group installs.
- [ ] **Step 6:** Straggler sweep once everyone is on the new build: `SELECT public.backfill_game_tournament(id) FROM public.tournaments;` via `dbQuery` (safe: `_meta`-aware guard only overwrites older cells).
- [ ] **Step 7:** Record a memory: blob column frozen; sync v2 live; `claim_tournament_player` dual-write droppable in a future migration.

## Self-review notes

- Spec coverage: schema→T2, read RPCs→T3, write RPCs/claim→T4, backfill/round-trip→T5, repo→T6, overlay/new mutations→T7, mapping/conflicts→T8, drain→T9, store reads→T10, call-site conversion + local markers→T11, realtime→T12, deletions→T13, migration/rollout/straggler→T14. Spec Amendments 1–8 all covered.
- Name consistency: `game_*` tables, RPC names, repo signatures, `executeMutation(entry, localTournament)`, `applyPendingMutations(tournament, entries)` — used identically across T5–T12.
- Explicit read-first judgment calls for implementers: HomeScreen 506/528/549 intent, `conflictLabels.js`, the 20260522 claim function body, `rowToTournament` residual use.
