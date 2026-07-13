# Score Conflict & Sync Overhaul (v2.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the clock-skew, one-sided, unsynced score-conflict detector with a per-author submission layer whose conflict state is *derived*, synced, attributed ("who entered what"), and surfaced only once everyone is off the hole (plus a finish-review backstop).

**Architecture:** A new pure module `store/scoreEntries.js` derives each cell's effective value + conflict status from a per-author submission map. A new `game_score_entries` table (one row per cell per author) plus a `game_score_resolutions` table back it server-side, written via `submit_game_score` / `resolve_game_score` RPCs and streamed over the existing realtime channel. `game_scores` remains the effective-value projection so every current reader is untouched.

**Tech Stack:** Expo SDK 54 / React Native 0.81 / React 19; Supabase Postgres + Realtime (`postgres_changes` + presence); Jest (jest-expo); plain-JS store modules; ESLint 9 flat config (CI-blocking).

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-07-13-score-conflict-sync-v2-design.md` — this plan implements workstream A only.
- Keep domain logic in `src/store/`, never in screens (CLAUDE.md).
- `game_scores` stays the effective/resolved value — **no reader changes**; `get_game_tournament` output shape is unchanged.
- Round ids are **only unique per-tournament**: every cell/round key must pair `tournament_id` + `round_id` (matches sync-v2 migration).
- Conflict = **two different, non-blank values** coexisting. A blank (`NULL` / missing) never conflicts.
- `author_id` = the entering device's `tournament.meId` when set, else a persisted device id. Same-value entries from the same author merge (idempotent).
- Candidate object shape carried to the UI: `{ value, ts, authorId }` (was `{ value, ts }`).
- Local round-blob keys `scoreEntries` / `scoreResolutions` are **local mirror caches**, stripped before every blob server write exactly like the retired `scoreConflicts` (they have their own tables + RPCs).
- `npm test` and `npm run lint` must pass at the end of every task.
- Migrations are idempotent and safe to re-run (match the existing `20260712000000_sync_v2_normalized.sql` conventions).

---

## File Structure

- **Create** `src/store/scoreEntries.js` — pure derivation + surfacing-gate predicates. No I/O.
- **Create** `src/store/__tests__/scoreEntries.test.js` — unit tests for the above.
- **Create** `supabase/migrations/20260713000000_score_entries.sql` — two tables, RLS, realtime, two RPCs, backfill.
- **Modify** `src/store/tournamentRepo.js` — add `submitScore`, `resolveScore`.
- **Modify** `src/store/mutate.js` — `score.set` carries `authorId` and mirrors into `round.scoreEntries`; `conflict.resolve` writes `round.scoreResolutions`; retire `scoreConflicts` writers; update strip/preserve helpers.
- **Modify** `src/store/mutationWrites.js` — route `score.set`→`submitScore`, `conflict.resolve`→`resolveScore`; delete clock-based detection.
- **Modify** `src/store/realtimeSync.js` — appliers + subscriptions for `game_score_entries` and `game_score_resolutions`; presence (currentHole) tracking; swap `preserveLocalScoreConflicts`→`preserveLocalConflictState`.
- **Modify** `src/store/scoring.js` — re-export derivation-based `listRoundConflicts`/`roundHasConflicts` from `scoreEntries.js`; fix the stale `merge.js` comment.
- **Modify** `src/screens/ScorecardScreen.js` — thread `authorId`, broadcast `currentHole`, gate mid-round dots, build finish-conflict rows with authors from derivation.
- **Modify** `src/components/scorecard/HoleView.js` — conflict dots from gated derivation; feed author-bearing candidates.
- **Modify** `src/components/ScoreConflictSheet.js` & `src/components/scorecard/FinishConflictSheet.js` — render author names.

---

## Task 1: Derivation core — `deriveCell` / `cellEntries`

**Files:**
- Create: `src/store/scoreEntries.js`
- Test: `src/store/__tests__/scoreEntries.test.js`

**Interfaces:**
- Produces:
  - `cellEntries(round, playerId, hole) -> { [authorId]: { value, ts } }` (empty object when none).
  - `deriveCell(round, playerId, hole) -> { status, effective, candidates, blankAuthors }` where
    `status ∈ 'empty'|'agreed'|'conflict'|'resolved'`, `effective: number|null`,
    `candidates: [{ value, ts, authorId }]` (one per distinct non-null value, most-recent author of that value, sorted by `ts` asc),
    `blankAuthors: string[]` (active authors with no non-null entry for this cell).
  - Local shapes consumed: `round.scoreEntries[playerId][hole] = { [authorId]: { value, ts } }`, `round.scoreResolutions[playerId][hole] = { value, by, ts }`. Holes keyed by **plain number** (matches existing `scoreConflicts` keying).

- [ ] **Step 1: Write the failing tests**

```js
// src/store/__tests__/scoreEntries.test.js
import { cellEntries, deriveCell } from '../scoreEntries';

const round = (scoreEntries = {}, scoreResolutions = {}) => ({
  id: 'r0', scoreEntries, scoreResolutions,
});

describe('cellEntries', () => {
  test('returns the author map for a cell, or {} when absent', () => {
    const r = round({ p1: { 3: { a: { value: 4, ts: 10 } } } });
    expect(cellEntries(r, 'p1', 3)).toEqual({ a: { value: 4, ts: 10 } });
    expect(cellEntries(r, 'p1', 5)).toEqual({});
    expect(cellEntries(round(), 'p1', 3)).toEqual({});
  });
});

describe('deriveCell', () => {
  test('no entries -> empty', () => {
    expect(deriveCell(round(), 'p1', 3)).toEqual({
      status: 'empty', effective: null, candidates: [], blankAuthors: [],
    });
  });

  test('all authors agree -> agreed, no conflict', () => {
    const r = round({ p1: { 3: { a: { value: 4, ts: 10 }, b: { value: 4, ts: 12 } } } });
    const d = deriveCell(r, 'p1', 3);
    expect(d.status).toBe('agreed');
    expect(d.effective).toBe(4);
    expect(d.candidates).toEqual([{ value: 4, ts: 12, authorId: 'b' }]);
    expect(d.blankAuthors).toEqual([]);
  });

  test('blank from one author + number from another -> agreed, fills in, no conflict', () => {
    const r = round({ p1: { 3: { a: { value: null, ts: 20 }, b: { value: 5, ts: 12 } } } });
    const d = deriveCell(r, 'p1', 3);
    expect(d.status).toBe('agreed');
    expect(d.effective).toBe(5);
    expect(d.blankAuthors).toEqual(['a']);
  });

  test('two different non-null values -> conflict, effective is most recent', () => {
    const r = round({ p1: { 3: { a: { value: 4, ts: 10 }, b: { value: 5, ts: 20 } } } });
    const d = deriveCell(r, 'p1', 3);
    expect(d.status).toBe('conflict');
    expect(d.effective).toBe(5);
    expect(d.candidates).toEqual([
      { value: 4, ts: 10, authorId: 'a' },
      { value: 5, ts: 20, authorId: 'b' },
    ]);
  });

  test('self-correction clears the conflict', () => {
    const r = round({ p1: { 3: { a: { value: 5, ts: 30 }, b: { value: 5, ts: 20 } } } });
    expect(deriveCell(r, 'p1', 3).status).toBe('agreed');
  });

  test('resolution newer than all entries -> resolved with the picked value', () => {
    const r = round(
      { p1: { 3: { a: { value: 4, ts: 10 }, b: { value: 5, ts: 20 } } } },
      { p1: { 3: { value: 4, by: 'a', ts: 25 } } },
    );
    const d = deriveCell(r, 'p1', 3);
    expect(d.status).toBe('resolved');
    expect(d.effective).toBe(4);
  });

  test('a new edit after resolution re-opens the conflict', () => {
    const r = round(
      { p1: { 3: { a: { value: 4, ts: 10 }, b: { value: 6, ts: 40 } } } },
      { p1: { 3: { value: 4, by: 'a', ts: 25 } } },
    );
    expect(deriveCell(r, 'p1', 3).status).toBe('conflict');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/store/__tests__/scoreEntries.test.js`
Expected: FAIL — "Cannot find module '../scoreEntries'".

- [ ] **Step 3: Implement the module**

```js
// src/store/scoreEntries.js
// Per-author score submissions and the conflict state DERIVED from them.
// Local round-blob shapes (mirrors of game_score_entries / game_score_resolutions):
//   round.scoreEntries[playerId][hole]     = { [authorId]: { value, ts } }
//   round.scoreResolutions[playerId][hole] = { value, by, ts }
// Holes are keyed by the plain number (matches the legacy scoreConflicts keying).
// A blank is value == null; it never contributes a conflict candidate.

export function cellEntries(round, playerId, hole) {
  const byAuthor = round?.scoreEntries?.[playerId]?.[hole];
  return byAuthor && typeof byAuthor === 'object' ? byAuthor : {};
}

function cellResolution(round, playerId, hole) {
  const res = round?.scoreResolutions?.[playerId]?.[hole];
  return res && typeof res === 'object' && 'value' in res ? res : null;
}

// { status, effective, candidates, blankAuthors }
export function deriveCell(round, playerId, hole) {
  const byAuthor = cellEntries(round, playerId, hole);
  const authorIds = Object.keys(byAuthor);

  const nonBlank = authorIds
    .map((authorId) => ({ authorId, ...byAuthor[authorId] }))
    .filter((e) => e.value != null);
  const blankAuthors = authorIds.filter((a) => byAuthor[a]?.value == null);

  const maxEntryTs = authorIds.reduce((m, a) => Math.max(m, byAuthor[a]?.ts ?? 0), 0);
  const resolution = cellResolution(round, playerId, hole);
  const resolvedValid = resolution && (resolution.ts ?? 0) >= maxEntryTs && authorIds.length > 0;

  // One candidate per distinct non-null value: the most-recent author of that value.
  const byValue = new Map();
  for (const e of nonBlank) {
    const prev = byValue.get(e.value);
    if (!prev || e.ts > prev.ts) byValue.set(e.value, { value: e.value, ts: e.ts, authorId: e.authorId });
  }
  const candidates = [...byValue.values()].sort((a, b) => a.ts - b.ts);

  if (resolvedValid) {
    return { status: 'resolved', effective: resolution.value, candidates, blankAuthors };
  }
  if (nonBlank.length === 0) {
    return { status: 'empty', effective: null, candidates: [], blankAuthors };
  }
  if (candidates.length === 1) {
    return { status: 'agreed', effective: candidates[0].value, candidates, blankAuthors };
  }
  const mostRecent = nonBlank.reduce((a, b) => (b.ts > a.ts ? b : a));
  return { status: 'conflict', effective: mostRecent.value, candidates, blankAuthors };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/store/__tests__/scoreEntries.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/store/scoreEntries.js src/store/__tests__/scoreEntries.test.js
git commit -m "feat(sync): per-author score derivation core (deriveCell/cellEntries)"
```

---

## Task 2: Conflict list + surfacing gate

**Files:**
- Modify: `src/store/scoreEntries.js`
- Test: `src/store/__tests__/scoreEntries.test.js`

**Interfaces:**
- Consumes: `deriveCell`, `cellEntries` (Task 1).
- Produces:
  - `activeAuthors(round) -> Set<string>` — authors with any entry anywhere in the round.
  - `listRoundConflicts(round) -> [{ playerId, hole }]` — cells whose status is `'conflict'`, hole ascending.
  - `roundHasConflicts(round) -> boolean`.
  - `authorProgress(round, presence) -> { [authorId]: highestHole }` — per author, `max(presence.currentHole, highest hole with a non-null entry)`. `presence` = `{ [authorId]: currentHole }` (1-based) or omitted.
  - `isCellSurfaceable(round, hole, progress) -> boolean` — true when **every** active author's progress `> hole`.
  - `surfaceableConflicts(round, presence) -> [{ playerId, hole }]` — `listRoundConflicts` filtered by `isCellSurfaceable`.

- [ ] **Step 1: Write the failing tests** (append)

```js
import {
  activeAuthors, listRoundConflicts, roundHasConflicts,
  authorProgress, isCellSurfaceable, surfaceableConflicts,
} from '../scoreEntries';

describe('conflict listing + gate', () => {
  const conflicted = () => round({
    p1: { 3: { a: { value: 4, ts: 10 }, b: { value: 5, ts: 20 } } },
    p2: { 1: { a: { value: 3, ts: 5 } } },
  });

  test('activeAuthors spans the whole round', () => {
    expect(activeAuthors(conflicted())).toEqual(new Set(['a', 'b']));
  });

  test('listRoundConflicts returns only conflict cells, ascending', () => {
    expect(listRoundConflicts(conflicted())).toEqual([{ playerId: 'p1', hole: 3 }]);
    expect(roundHasConflicts(conflicted())).toBe(true);
  });

  test('authorProgress uses max(presence, highest entered hole)', () => {
    const r = round({ p1: { 3: { a: { value: 4, ts: 10 } }, 7: { a: { value: 4, ts: 10 } } } });
    expect(authorProgress(r, { a: 2 })).toEqual({ a: 7 });   // entries win
    expect(authorProgress(r, { a: 9 })).toEqual({ a: 9 });   // presence wins
  });

  test('a conflict is not surfaceable until every active author is past the hole', () => {
    const r = conflicted();
    // author b is still on hole 3 (progress 3, not > 3)
    expect(isCellSurfaceable(r, 3, { a: 5, b: 3 })).toBe(false);
    expect(isCellSurfaceable(r, 3, { a: 5, b: 4 })).toBe(true);
    expect(surfaceableConflicts(r, { a: 5, b: 3 })).toEqual([]);
    expect(surfaceableConflicts(r, { a: 5, b: 4 })).toEqual([{ playerId: 'p1', hole: 3 }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/store/__tests__/scoreEntries.test.js -t 'conflict listing'`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement (append to `src/store/scoreEntries.js`)**

```js
export function activeAuthors(round) {
  const out = new Set();
  const byPlayer = round?.scoreEntries;
  if (!byPlayer || typeof byPlayer !== 'object') return out;
  for (const byHole of Object.values(byPlayer)) {
    if (!byHole || typeof byHole !== 'object') continue;
    for (const byAuthor of Object.values(byHole)) {
      if (byAuthor && typeof byAuthor === 'object') {
        for (const a of Object.keys(byAuthor)) out.add(a);
      }
    }
  }
  return out;
}

export function listRoundConflicts(round) {
  const byPlayer = round?.scoreEntries;
  if (!byPlayer || typeof byPlayer !== 'object') return [];
  const out = [];
  for (const [playerId, byHole] of Object.entries(byPlayer)) {
    if (!byHole || typeof byHole !== 'object') continue;
    for (const holeKey of Object.keys(byHole)) {
      const hole = Number(holeKey);
      if (deriveCell(round, playerId, hole).status === 'conflict') out.push({ playerId, hole });
    }
  }
  return out.sort((a, b) => a.hole - b.hole);
}

export function roundHasConflicts(round) {
  return listRoundConflicts(round).length > 0;
}

export function authorProgress(round, presence = {}) {
  const progress = {};
  for (const a of activeAuthors(round)) progress[a] = presence[a] ?? 0;
  const byPlayer = round?.scoreEntries ?? {};
  for (const byHole of Object.values(byPlayer)) {
    if (!byHole || typeof byHole !== 'object') continue;
    for (const [holeKey, byAuthor] of Object.entries(byHole)) {
      const hole = Number(holeKey);
      for (const [authorId, entry] of Object.entries(byAuthor ?? {})) {
        if (entry?.value != null && hole > (progress[authorId] ?? 0)) progress[authorId] = hole;
      }
    }
  }
  for (const [authorId, cur] of Object.entries(presence)) {
    if (cur > (progress[authorId] ?? 0)) progress[authorId] = cur;
  }
  return progress;
}

export function isCellSurfaceable(round, hole, progress) {
  const authors = [...activeAuthors(round)];
  if (authors.length === 0) return false;
  return authors.every((a) => (progress?.[a] ?? 0) > hole);
}

export function surfaceableConflicts(round, presence = {}) {
  const progress = authorProgress(round, presence);
  return listRoundConflicts(round).filter((c) => isCellSurfaceable(round, c.hole, progress));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/store/__tests__/scoreEntries.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/scoreEntries.js src/store/__tests__/scoreEntries.test.js
git commit -m "feat(sync): round conflict listing + everyone-off-the-hole gate"
```

---

## Task 3: Migration — entries & resolutions tables, RLS, realtime

**Files:**
- Create: `supabase/migrations/20260713000000_score_entries.sql`

**Interfaces:**
- Produces tables `public.game_score_entries` and `public.game_score_resolutions`, both realtime-published, both RLS-delegating to `tournaments` (same pattern as `game_scores`).

- [ ] **Step 1: Write the migration (tables + RLS + realtime)**

```sql
-- ============================================================================
-- Sync v2.1 — per-author score entries + resolutions.
-- Spec: docs/superpowers/specs/2026-07-13-score-conflict-sync-v2-design.md
-- Idempotent; safe to re-run. Same conventions as 20260712000000_sync_v2_normalized.sql.
-- ============================================================================

-- 1) Per-author submission layer. One row per (cell, author). strokes NULL = a
-- blank submission (kept so a cleared cell replicates); it never conflicts.
CREATE TABLE IF NOT EXISTS public.game_score_entries (
  tournament_id text NOT NULL,
  round_id      text NOT NULL,
  player_id     text NOT NULL,
  hole          int  NOT NULL,
  author_id     text NOT NULL,               -- entering device's meId / device id
  strokes       int,                          -- NULL = blank submission
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, round_id, player_id, hole, author_id),
  FOREIGN KEY (tournament_id, round_id)
    REFERENCES public.game_rounds (tournament_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS game_score_entries_tournament_idx
  ON public.game_score_entries (tournament_id);

-- 2) Resolution decisions. One row per cell; supersedes derivation while its
-- resolved_at is >= the newest entry for the cell (a later edit re-opens it).
CREATE TABLE IF NOT EXISTS public.game_score_resolutions (
  tournament_id text NOT NULL,
  round_id      text NOT NULL,
  player_id     text NOT NULL,
  hole          int  NOT NULL,
  value         int,                          -- chosen strokes (NULL = "no score")
  resolved_by   text,
  resolved_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, round_id, player_id, hole),
  FOREIGN KEY (tournament_id, round_id)
    REFERENCES public.game_rounds (tournament_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS game_score_resolutions_tournament_idx
  ON public.game_score_resolutions (tournament_id);

-- 3) RLS — delegate to the parent tournament row (same pattern as game_scores).
ALTER TABLE public.game_score_entries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_score_resolutions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS game_score_entries_all ON public.game_score_entries;
CREATE POLICY game_score_entries_all ON public.game_score_entries
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id));

DROP POLICY IF EXISTS game_score_resolutions_all ON public.game_score_resolutions;
CREATE POLICY game_score_resolutions_all ON public.game_score_resolutions
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tournaments t WHERE t.id = tournament_id));

-- 4) Realtime publication (idempotent per-table sub-blocks).
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.game_score_entries;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.game_score_resolutions;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

- [ ] **Step 2: Verify the SQL parses (dry check)**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('supabase/migrations/20260713000000_score_entries.sql','utf8');if(!/CREATE TABLE IF NOT EXISTS public\.game_score_entries/.test(s)||!/game_score_resolutions/.test(s))throw new Error('missing table');console.log('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260713000000_score_entries.sql
git commit -m "feat(sync): game_score_entries + game_score_resolutions tables, RLS, realtime"
```

---

## Task 4: Migration — `submit_game_score` / `resolve_game_score` RPCs + backfill

**Files:**
- Modify: `supabase/migrations/20260713000000_score_entries.sql`

**Interfaces:**
- Produces RPCs:
  - `submit_game_score(p_tournament_id, p_round_id, p_player_id, p_hole, p_author_id, p_strokes)` → `jsonb { status, effective, candidates }`; upserts the author entry and recomputes `game_scores`.
  - `resolve_game_score(p_tournament_id, p_round_id, p_player_id, p_hole, p_value, p_resolver)` → `void`; upserts a resolution and sets `game_scores` effective value.
  - `backfill_game_score_entries(p_id)` → `void`; seeds one `legacy` entry per existing `game_scores` cell.

- [ ] **Step 1: Append the RPCs + backfill to the migration**

```sql
-- 5) Effective-value recompute helper (shared by submit + resolve). Mirrors
-- store/scoreEntries.js deriveCell: resolution wins while newer than every
-- entry; else 0/1 distinct value = agreed; >=2 = most-recent value.
CREATE OR REPLACE FUNCTION public.recompute_game_score(
  p_tournament_id text, p_round_id text, p_player_id text, p_hole int)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_eff int;
  v_max_ts timestamptz;
  v_res_val int;
  v_res_at timestamptz;
BEGIN
  SELECT max(updated_at) INTO v_max_ts FROM public.game_score_entries
   WHERE tournament_id = p_tournament_id AND round_id = p_round_id
     AND player_id = p_player_id AND hole = p_hole;

  SELECT value, resolved_at INTO v_res_val, v_res_at FROM public.game_score_resolutions
   WHERE tournament_id = p_tournament_id AND round_id = p_round_id
     AND player_id = p_player_id AND hole = p_hole;

  IF v_res_at IS NOT NULL AND (v_max_ts IS NULL OR v_res_at >= v_max_ts) THEN
    v_eff := v_res_val;
  ELSE
    -- most-recent non-null author value (NULL when every author is blank)
    SELECT strokes INTO v_eff FROM public.game_score_entries
     WHERE tournament_id = p_tournament_id AND round_id = p_round_id
       AND player_id = p_player_id AND hole = p_hole AND strokes IS NOT NULL
     ORDER BY updated_at DESC LIMIT 1;
  END IF;

  INSERT INTO public.game_scores (round_id, tournament_id, player_id, hole, strokes, updated_at)
  VALUES (p_round_id, p_tournament_id, p_player_id, p_hole, v_eff, now())
  ON CONFLICT (tournament_id, round_id, player_id, hole)
  DO UPDATE SET strokes = EXCLUDED.strokes, updated_at = now();
END $$;

-- submit_game_score: upsert one author's submission, recompute the effective
-- value, return the derived state for the caller's optimistic UI.
CREATE OR REPLACE FUNCTION public.submit_game_score(
  p_tournament_id text, p_round_id text, p_player_id text, p_hole int,
  p_author_id text, p_strokes int)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_distinct int;
  v_status text;
  v_eff int;
  v_candidates jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_tournament_id || ':' || p_round_id || ':' || p_player_id || ':' || p_hole::text, 0));

  INSERT INTO public.game_score_entries
    (tournament_id, round_id, player_id, hole, author_id, strokes, updated_at)
  VALUES (p_tournament_id, p_round_id, p_player_id, p_hole, p_author_id, p_strokes, now())
  ON CONFLICT (tournament_id, round_id, player_id, hole, author_id)
  DO UPDATE SET strokes = EXCLUDED.strokes, updated_at = now();

  PERFORM public.recompute_game_score(p_tournament_id, p_round_id, p_player_id, p_hole);

  SELECT count(DISTINCT strokes) INTO v_distinct FROM public.game_score_entries
   WHERE tournament_id = p_tournament_id AND round_id = p_round_id
     AND player_id = p_player_id AND hole = p_hole AND strokes IS NOT NULL;
  SELECT strokes INTO v_eff FROM public.game_scores
   WHERE tournament_id = p_tournament_id AND round_id = p_round_id
     AND player_id = p_player_id AND hole = p_hole;

  v_status := CASE WHEN v_distinct >= 2 THEN 'conflict'
                   WHEN v_distinct = 1 THEN 'agreed' ELSE 'empty' END;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'value', strokes, 'authorId', author_id,
           'ts', (extract(epoch from updated_at) * 1000)::bigint) ORDER BY updated_at), '[]'::jsonb)
    INTO v_candidates FROM public.game_score_entries
   WHERE tournament_id = p_tournament_id AND round_id = p_round_id
     AND player_id = p_player_id AND hole = p_hole AND strokes IS NOT NULL;

  RETURN jsonb_build_object('status', v_status, 'effective', v_eff, 'candidates', v_candidates);
END $$;

-- resolve_game_score: pin the chosen value; recompute clamps game_scores to it.
CREATE OR REPLACE FUNCTION public.resolve_game_score(
  p_tournament_id text, p_round_id text, p_player_id text, p_hole int,
  p_value int, p_resolver text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.game_score_resolutions
    (tournament_id, round_id, player_id, hole, value, resolved_by, resolved_at)
  VALUES (p_tournament_id, p_round_id, p_player_id, p_hole, p_value, p_resolver, now())
  ON CONFLICT (tournament_id, round_id, player_id, hole)
  DO UPDATE SET value = EXCLUDED.value, resolved_by = EXCLUDED.resolved_by, resolved_at = now();

  PERFORM public.recompute_game_score(p_tournament_id, p_round_id, p_player_id, p_hole);
END $$;

-- 6) Backfill: seed a single 'legacy' author entry from every existing
-- game_scores cell, so historical rounds derive as 'agreed' (no false
-- conflicts). Idempotent: ON CONFLICT keeps the newer updated_at.
CREATE OR REPLACE FUNCTION public.backfill_game_score_entries(p_id text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.game_score_entries
    (tournament_id, round_id, player_id, hole, author_id, strokes, updated_at)
  SELECT s.tournament_id, s.round_id, s.player_id, s.hole, 'legacy', s.strokes, s.updated_at
    FROM public.game_scores s
   WHERE s.tournament_id = p_id
  ON CONFLICT (tournament_id, round_id, player_id, hole, author_id)
  DO UPDATE SET strokes = EXCLUDED.strokes, updated_at = EXCLUDED.updated_at
    WHERE public.game_score_entries.updated_at < EXCLUDED.updated_at;
END $$;
```

- [ ] **Step 2: Verify the SQL contains all four functions**

Run: `node -e "const s=require('fs').readFileSync('supabase/migrations/20260713000000_score_entries.sql','utf8');['submit_game_score','resolve_game_score','backfill_game_score_entries','recompute_game_score'].forEach(f=>{if(!s.includes(f))throw new Error('missing '+f)});console.log('ok')"`
Expected: `ok`.

- [ ] **Step 3: Apply to the live database and smoke-test**

The repo inspects/applies via the Supabase Management API token in `.env` (see the "Supabase schema drift" memory and `scripts/sync-v2/`). Apply this migration the same way prior sync-v2 migrations were applied, then run, for a real tournament id:

```sql
SELECT public.backfill_game_score_entries('<tournamentId>');
SELECT public.submit_game_score('<tid>','<rid>','<pid>',3,'authorA',4);
SELECT public.submit_game_score('<tid>','<rid>','<pid>',3,'authorB',5);  -- expect status 'conflict'
SELECT public.resolve_game_score('<tid>','<rid>','<pid>',3,4,'authorA');
SELECT strokes FROM public.game_scores WHERE round_id='<rid>' AND player_id='<pid>' AND hole=3; -- expect 4
```
Expected: second submit returns `"status":"conflict"` with two candidates; after resolve, `game_scores.strokes = 4`.

> If applying to prod is not possible in this environment, record that the migration is written and unit-verified, and flag it for manual apply (mirrors the "Batched score sync rollout" memory's device-gated rollout note).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260713000000_score_entries.sql
git commit -m "feat(sync): submit/resolve/backfill RPCs for per-author score entries"
```

---

## Task 5: Repo layer — `submitScore` / `resolveScore`

**Files:**
- Modify: `src/store/tournamentRepo.js` (add after `setScore`, ~line 76)
- Test: `src/store/__tests__/tournamentRepo.scoreEntries.test.js` (create)

**Interfaces:**
- Consumes: `submit_game_score`, `resolve_game_score` RPCs (Task 4).
- Produces:
  - `submitScore({ tournamentId, roundId, playerId, hole, authorId, strokes }) -> Promise<{status, effective, candidates}>`.
  - `resolveScore({ tournamentId, roundId, playerId, hole, value, resolvedBy }) -> Promise<void>`.

- [ ] **Step 1: Write the failing test**

```js
// src/store/__tests__/tournamentRepo.scoreEntries.test.js
jest.mock('../../lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
import { supabase } from '../../lib/supabase';
import { submitScore, resolveScore } from '../tournamentRepo';

beforeEach(() => supabase.rpc.mockReset());

test('submitScore calls submit_game_score with p_ params and returns data', async () => {
  supabase.rpc.mockResolvedValue({ data: { status: 'agreed', effective: 4, candidates: [] }, error: null });
  const out = await submitScore({ tournamentId: 't', roundId: 'r', playerId: 'p', hole: 3, authorId: 'a', strokes: 4 });
  expect(supabase.rpc).toHaveBeenCalledWith('submit_game_score', {
    p_tournament_id: 't', p_round_id: 'r', p_player_id: 'p', p_hole: 3, p_author_id: 'a', p_strokes: 4,
  });
  expect(out).toEqual({ status: 'agreed', effective: 4, candidates: [] });
});

test('resolveScore calls resolve_game_score', async () => {
  supabase.rpc.mockResolvedValue({ data: null, error: null });
  await resolveScore({ tournamentId: 't', roundId: 'r', playerId: 'p', hole: 3, value: 4, resolvedBy: 'a' });
  expect(supabase.rpc).toHaveBeenCalledWith('resolve_game_score', {
    p_tournament_id: 't', p_round_id: 'r', p_player_id: 'p', p_hole: 3, p_value: 4, p_resolver: 'a',
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/store/__tests__/tournamentRepo.scoreEntries.test.js`
Expected: FAIL — `submitScore` / `resolveScore` not exported.

- [ ] **Step 3: Implement (add to `src/store/tournamentRepo.js`)**

```js
export async function submitScore({
  tournamentId, roundId, playerId, hole, authorId, strokes,
}) {
  const { data, error } = await supabase.rpc('submit_game_score', {
    p_tournament_id: tournamentId,
    p_round_id: roundId,
    p_player_id: playerId,
    p_hole: hole,
    p_author_id: authorId,
    p_strokes: strokes,
  });
  if (error) throw error;
  return data;
}

export async function resolveScore({
  tournamentId, roundId, playerId, hole, value, resolvedBy,
}) {
  const { error } = await supabase.rpc('resolve_game_score', {
    p_tournament_id: tournamentId,
    p_round_id: roundId,
    p_player_id: playerId,
    p_hole: hole,
    p_value: value,
    p_resolver: resolvedBy,
  });
  if (error) throw error;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest src/store/__tests__/tournamentRepo.scoreEntries.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/tournamentRepo.js src/store/__tests__/tournamentRepo.scoreEntries.test.js
git commit -m "feat(sync): repo submitScore/resolveScore wrappers"
```

---

## Task 6: `mutate.js` — author-stamped entries + resolutions, retire scoreConflicts

**Files:**
- Modify: `src/store/mutate.js`
- Test: `src/store/__tests__/mutate.scoreEntries.test.js` (create)

**Interfaces:**
- Consumes: local shapes from Task 1.
- Produces (mutation payloads):
  - `score.set` now carries `authorId`; `applyToTournament` writes both `round.scores[playerId][hole]` (optimistic effective) **and** `round.scoreEntries[playerId][hole][authorId] = { value, ts }`.
  - `conflict.resolve` now carries `resolvedBy`; writes `round.scoreResolutions[playerId][hole] = { value, by: resolvedBy, ts }` and the effective `round.scores` cell (no more `scoreConflicts` delete).
  - Rename `preserveLocalScoreConflicts` → `preserveLocalConflictState` (preserves `scoreEntries` + `scoreResolutions`).
  - Remove `recordScoreConflict` export.
  - Strip helper (wherever `scoreConflicts`/`scoreResolutions` are stripped before blob writes) now strips `scoreEntries` + `scoreResolutions`.

- [ ] **Step 1: Write the failing test**

```js
// src/store/__tests__/mutate.scoreEntries.test.js
import { applyToTournament, preserveLocalConflictState } from '../mutate';

const base = () => ({ id: 't', rounds: [{ id: 'r0', scores: {}, scoreEntries: {}, scoreResolutions: {} }] });

test('score.set records the author entry and the optimistic effective value', () => {
  const t = base();
  applyToTournament(t, { type: 'score.set', roundId: 'r0', playerId: 'p1', hole: 3, value: 4, authorId: 'a', ts: 100 });
  expect(t.rounds[0].scores.p1[3]).toBe(4);
  expect(t.rounds[0].scoreEntries.p1[3].a).toEqual({ value: 4, ts: 100 });
});

test('conflict.resolve writes a resolution stamp', () => {
  const t = base();
  applyToTournament(t, { type: 'conflict.resolve', roundId: 'r0', playerId: 'p1', hole: 3, value: 5, resolvedBy: 'a', ts: 200 });
  expect(t.rounds[0].scores.p1[3]).toBe(5);
  expect(t.rounds[0].scoreResolutions.p1[3]).toEqual({ value: 5, by: 'a', ts: 200 });
});

test('preserveLocalConflictState carries entries+resolutions from source onto target', () => {
  const target = { rounds: [{ id: 'r0', scores: {} }] };
  const source = { rounds: [{ id: 'r0', scoreEntries: { p1: { 3: { a: { value: 4, ts: 1 } } } }, scoreResolutions: { p1: { 3: { value: 4, by: 'a', ts: 2 } } } }] };
  const out = preserveLocalConflictState(target, source);
  expect(out.rounds[0].scoreEntries.p1[3].a).toEqual({ value: 4, ts: 1 });
  expect(out.rounds[0].scoreResolutions.p1[3]).toEqual({ value: 4, by: 'a', ts: 2 });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/store/__tests__/mutate.scoreEntries.test.js`
Expected: FAIL — new keys/exports absent.

- [ ] **Step 3: Replace the `score.set` case** (`src/store/mutate.js:144-152`)

```js
case 'score.set': {
  const round = t.rounds.find((r) => r.id === m.roundId);
  if (!round) return;
  round.scores = { ...(round.scores ?? {}) };
  round.scores[m.playerId] = { ...(round.scores[m.playerId] ?? {}) };
  if (m.value == null) delete round.scores[m.playerId][m.hole];
  else round.scores[m.playerId][m.hole] = m.value;
  // Per-author submission mirror (source of derived conflict state).
  round.scoreEntries = { ...(round.scoreEntries ?? {}) };
  round.scoreEntries[m.playerId] = { ...(round.scoreEntries[m.playerId] ?? {}) };
  round.scoreEntries[m.playerId][m.hole] = {
    ...(round.scoreEntries[m.playerId][m.hole] ?? {}),
    [m.authorId]: { value: m.value ?? null, ts: m.ts },
  };
  break;
}
```

- [ ] **Step 4: Replace the `conflict.resolve` case** (`src/store/mutate.js:153-175`)

```js
case 'conflict.resolve': {
  const round = t.rounds.find((r) => r.id === m.roundId);
  if (!round) return;
  round.scores = { ...(round.scores ?? {}) };
  round.scores[m.playerId] = { ...(round.scores[m.playerId] ?? {}) };
  if (m.value == null) delete round.scores[m.playerId][m.hole];
  else round.scores[m.playerId][m.hole] = m.value;
  round.scoreResolutions = { ...(round.scoreResolutions ?? {}) };
  round.scoreResolutions[m.playerId] = { ...(round.scoreResolutions[m.playerId] ?? {}) };
  round.scoreResolutions[m.playerId][m.hole] = { value: m.value ?? null, by: m.resolvedBy, ts: m.ts };
  break;
}
```

- [ ] **Step 5: Replace `preserveLocalScoreConflicts` with `preserveLocalConflictState`** (`src/store/mutate.js:448-456`)

```js
export function preserveLocalConflictState(target, source) {
  if (!target?.rounds?.length || !source?.rounds?.length) return target;
  const byId = new Map(source.rounds.map((r) => [r.id, {
    scoreEntries: r?.scoreEntries, scoreResolutions: r?.scoreResolutions,
  }]));
  target.rounds = target.rounds.map((r) => {
    const s = byId.get(r.id);
    if (!s) return r;
    return {
      ...r,
      ...(s.scoreEntries ? { scoreEntries: s.scoreEntries } : {}),
      ...(s.scoreResolutions ? { scoreResolutions: s.scoreResolutions } : {}),
    };
  });
  return target;
}
```

- [ ] **Step 6: Delete `recordScoreConflict`** (`src/store/mutate.js:469-488`) and update the strip helper so the list of stripped hot keys is `['scores','shotDetails','notes','scoreEntries','scoreResolutions']` (drop `scoreConflicts`). Search `mutate.js` for `scoreConflicts` and remove every remaining reference.

Run: `grep -n "scoreConflicts\|recordScoreConflict\|preserveLocalScoreConflicts" src/store/mutate.js`
Expected: no matches.

- [ ] **Step 7: Run tests**

Run: `npx jest src/store/__tests__/mutate.scoreEntries.test.js && npx jest src/store/__tests__/mutate`
Expected: PASS (fix any legacy `mutate` test still asserting `scoreConflicts`/`recordScoreConflict` by porting it to the new keys).

- [ ] **Step 8: Commit**

```bash
git add src/store/mutate.js src/store/__tests__/mutate.scoreEntries.test.js
git commit -m "feat(sync): author-stamped score entries + synced resolutions in mutate"
```

---

## Task 7: `mutationWrites.js` — route to submit/resolve, delete clock detector

**Files:**
- Modify: `src/store/mutationWrites.js` (`score.set` ~90-111, `conflict.resolve` ~113-119)
- Modify: `src/store/syncWorker.js` (remove the conflict-notify branch)
- Test: `src/store/__tests__/mutationWrites.scoreEntries.test.js` (create)

**Interfaces:**
- Consumes: `repo.submitScore`, `repo.resolveScore` (Task 5).
- Produces: `score.set` → `submitScore(...author...)` returning `NO_CONFLICT` (conflict state is derived from realtime entries now, not raised here); `conflict.resolve` → `resolveScore(...)`.

- [ ] **Step 1: Write the failing test**

```js
// src/store/__tests__/mutationWrites.scoreEntries.test.js
jest.mock('../tournamentRepo');
jest.mock('../tournamentStore', () => ({ syncTournamentParticipants: jest.fn() }));
import * as repo from '../tournamentRepo';
import { executeMutation } from '../mutationWrites';

beforeEach(() => { repo.submitScore = jest.fn().mockResolvedValue({ status: 'agreed' }); repo.resolveScore = jest.fn().mockResolvedValue(); });

test('score.set calls submitScore with authorId and never returns a conflict', async () => {
  const entry = { tournamentId: 't', ts: 1, mutation: { type: 'score.set', roundId: 'r', playerId: 'p', hole: 3, value: 4, authorId: 'a' } };
  const out = await executeMutation(entry, null);
  expect(repo.submitScore).toHaveBeenCalledWith({ tournamentId: 't', roundId: 'r', playerId: 'p', hole: 3, authorId: 'a', strokes: 4 });
  expect(out).toEqual({ conflict: null });
});

test('conflict.resolve calls resolveScore', async () => {
  const entry = { tournamentId: 't', ts: 1, mutation: { type: 'conflict.resolve', roundId: 'r', playerId: 'p', hole: 3, value: 5, resolvedBy: 'a' } };
  await executeMutation(entry, null);
  expect(repo.resolveScore).toHaveBeenCalledWith({ tournamentId: 't', roundId: 'r', playerId: 'p', hole: 3, value: 5, resolvedBy: 'a' });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/store/__tests__/mutationWrites.scoreEntries.test.js`
Expected: FAIL — still calling `setScore`, still returning a clock-based conflict.

- [ ] **Step 3: Replace the `score.set` branch** (`src/store/mutationWrites.js:90-111`)

```js
case 'score.set': {
  await repo.submitScore({
    tournamentId: id, roundId: m.roundId, playerId: m.playerId,
    hole: m.hole, authorId: m.authorId, strokes: m.value,
  });
  // Conflict state is derived from synced entries (store/scoreEntries.js),
  // never raised one-sidedly here.
  return NO_CONFLICT;
}
```

- [ ] **Step 4: Replace the `conflict.resolve` branch** (`src/store/mutationWrites.js:113-119`)

```js
case 'conflict.resolve': {
  await repo.resolveScore({
    tournamentId: id, roundId: m.roundId, playerId: m.playerId,
    hole: m.hole, value: m.value, resolvedBy: m.resolvedBy,
  });
  return NO_CONFLICT;
}
```

- [ ] **Step 5: Remove the conflict plumbing that consumed the old detector.** In `syncWorker.js`, `drainTournament` calls `notifyScoreConflict`/`recordScoreConflict` when `executeMutation` returns a `conflict`. Since `score.set` now always returns `NO_CONFLICT`, delete that branch and the `recordScoreConflict` import.

Run: `grep -rn "recordScoreConflict\|notifyScoreConflict" src/store/`
Expected: no matches.

- [ ] **Step 6: Run tests**

Run: `npx jest src/store/__tests__/mutationWrites`
Expected: PASS (port any legacy assertion about the clock-based `conflict` return).

- [ ] **Step 7: Commit**

```bash
git add src/store/mutationWrites.js src/store/syncWorker.js src/store/__tests__/mutationWrites.scoreEntries.test.js
git commit -m "feat(sync): route score writes through submit/resolve, drop clock detector"
```

---

## Task 8: `realtimeSync.js` — subscribe entries + resolutions

**Files:**
- Modify: `src/store/realtimeSync.js`
- Test: `src/store/__tests__/realtimeSync.scoreEntries.test.js` (create)

**Interfaces:**
- Consumes: `preserveLocalConflictState` (Task 6).
- Produces:
  - `applyScoreEntryRow(t, row, eventType) -> t'` writing `round.scoreEntries[player_id][hole][author_id] = { value: strokes, ts }` (delete on DELETE/absent).
  - `applyScoreResolutionRow(t, row, eventType) -> t'` writing `round.scoreResolutions[player_id][hole] = { value, by: resolved_by, ts }`.
  - `APPLIERS` gains `game_score_entries` + `game_score_resolutions`; both subscribed on the `game-${id}` channel.
  - `makeHandler` calls `preserveLocalConflictState` (renamed) instead of `preserveLocalScoreConflicts`.

- [ ] **Step 1: Write the failing test**

```js
// src/store/__tests__/realtimeSync.scoreEntries.test.js
import { applyScoreEntryRow, applyScoreResolutionRow } from '../realtimeSync';

const t = () => ({ rounds: [{ id: 'r0', scores: {}, scoreEntries: {}, scoreResolutions: {} }] });

test('applyScoreEntryRow writes the author entry', () => {
  const out = applyScoreEntryRow(t(), {
    round_id: 'r0', player_id: 'p1', hole: 3, author_id: 'a', strokes: 4,
    updated_at: '2026-07-13T10:00:00.000Z',
  }, 'INSERT');
  expect(out.rounds[0].scoreEntries.p1[3].a.value).toBe(4);
  expect(typeof out.rounds[0].scoreEntries.p1[3].a.ts).toBe('number');
});

test('applyScoreEntryRow removes the author entry on DELETE', () => {
  const seed = t(); seed.rounds[0].scoreEntries = { p1: { 3: { a: { value: 4, ts: 1 } } } };
  const out = applyScoreEntryRow(seed, { round_id: 'r0', player_id: 'p1', hole: 3, author_id: 'a' }, 'DELETE');
  expect(out.rounds[0].scoreEntries.p1?.[3]?.a).toBeUndefined();
});

test('applyScoreResolutionRow writes the resolution', () => {
  const out = applyScoreResolutionRow(t(), {
    round_id: 'r0', player_id: 'p1', hole: 3, value: 5, resolved_by: 'a',
    resolved_at: '2026-07-13T10:05:00.000Z',
  }, 'INSERT');
  expect(out.rounds[0].scoreResolutions.p1[3]).toMatchObject({ value: 5, by: 'a' });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/store/__tests__/realtimeSync.scoreEntries.test.js`
Expected: FAIL — appliers not exported.

- [ ] **Step 3: Add the appliers** (near `applyScoreRow`, `src/store/realtimeSync.js:52`)

```js
export function applyScoreEntryRow(t, row, eventType) {
  const next = deepClone(t);
  const round = next.rounds?.find((r) => r.id === row.round_id);
  if (!round) return next;
  const entries = { ...(round.scoreEntries ?? {}) };
  const byHole = { ...(entries[row.player_id] ?? {}) };
  const byAuthor = { ...(byHole[row.hole] ?? {}) };
  if (isDeleteEvent(eventType)) delete byAuthor[row.author_id];
  else byAuthor[row.author_id] = { value: row.strokes ?? null, ts: new Date(row.updated_at).getTime() };
  if (Object.keys(byAuthor).length === 0) delete byHole[row.hole];
  else byHole[row.hole] = byAuthor;
  if (Object.keys(byHole).length === 0) delete entries[row.player_id];
  else entries[row.player_id] = byHole;
  round.scoreEntries = entries;
  return next;
}

export function applyScoreResolutionRow(t, row, eventType) {
  const next = deepClone(t);
  const round = next.rounds?.find((r) => r.id === row.round_id);
  if (!round) return next;
  const res = { ...(round.scoreResolutions ?? {}) };
  const byHole = { ...(res[row.player_id] ?? {}) };
  if (isDeleteEvent(eventType)) delete byHole[row.hole];
  else byHole[row.hole] = { value: row.value ?? null, by: row.resolved_by, ts: new Date(row.resolved_at).getTime() };
  if (Object.keys(byHole).length === 0) delete res[row.player_id];
  else res[row.player_id] = byHole;
  round.scoreResolutions = res;
  return next;
}
```

- [ ] **Step 4: Register in `APPLIERS`** (`src/store/realtimeSync.js:212-219`) — add:

```js
  game_score_entries: applyScoreEntryRow,
  game_score_resolutions: applyScoreResolutionRow,
```

- [ ] **Step 5: Rename the preserve call** — update the import (`src/store/realtimeSync.js:16`) and the `makeHandler` body (`:271`) from `preserveLocalScoreConflicts` to `preserveLocalConflictState`.

Run: `grep -n "preserveLocalScoreConflicts" src/store/realtimeSync.js`
Expected: no matches.

- [ ] **Step 6: Run tests**

Run: `npx jest src/store/__tests__/realtimeSync`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/store/realtimeSync.js src/store/__tests__/realtimeSync.scoreEntries.test.js
git commit -m "feat(sync): realtime subscriptions for score entries + resolutions"
```

---

## Task 9: Presence — broadcast `currentHole`

**Files:**
- Modify: `src/store/realtimeSync.js`
- Test: `src/store/__tests__/realtimeSync.presence.test.js` (create)

**Interfaces:**
- Produces:
  - `setPresenceHole(authorId, hole)` — tracks this device's `{ authorId, currentHole }` on the active channel (no-op when no channel).
  - `getPresenceProgress() -> { [authorId]: currentHole }` — merges all tracked presence states on the channel.
  - `subscribeProgress(cb) -> unsubscribe` — invokes `cb(getPresenceProgress())` on every presence sync event.
  - `reducePresenceProgress(state) -> { [authorId]: currentHole }` (pure; the tested core).

- [ ] **Step 1: Write the failing test**

```js
// src/store/__tests__/realtimeSync.presence.test.js
import { reducePresenceProgress } from '../realtimeSync';

test('reducePresenceProgress keeps the highest currentHole per author', () => {
  const state = {
    key1: [{ authorId: 'a', currentHole: 4 }],
    key2: [{ authorId: 'a', currentHole: 6 }, { authorId: 'b', currentHole: 2 }],
  };
  expect(reducePresenceProgress(state)).toEqual({ a: 6, b: 2 });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/store/__tests__/realtimeSync.presence.test.js`
Expected: FAIL — `reducePresenceProgress` not exported.

- [ ] **Step 3: Implement presence** (`src/store/realtimeSync.js`)

Add the pure reducer and presence wiring:

```js
export function reducePresenceProgress(state) {
  const out = {};
  for (const metas of Object.values(state ?? {})) {
    for (const m of metas ?? []) {
      if (m?.authorId && (m.currentHole ?? 0) > (out[m.authorId] ?? 0)) out[m.authorId] = m.currentHole;
    }
  }
  return out;
}

const _presenceCbs = new Set();
let _lastHole = null;
let _lastAuthor = null;

export function getPresenceProgress() {
  if (!_channel) return {};
  return reducePresenceProgress(_channel.presenceState());
}

export function subscribeProgress(cb) {
  _presenceCbs.add(cb);
  return () => _presenceCbs.delete(cb);
}

export function setPresenceHole(authorId, hole) {
  _lastAuthor = authorId; _lastHole = hole;
  if (_channel && authorId) _channel.track({ authorId, currentHole: hole });
}
```

Inside `ensureRealtimeForTournament`, before `channel.subscribe()`:

```js
  channel.on('presence', { event: 'sync' }, () => {
    const progress = reducePresenceProgress(channel.presenceState());
    for (const cb of _presenceCbs) cb(progress);
  });
```

Change the bare `channel.subscribe()` to re-track on (re)join:

```js
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED' && _lastAuthor) channel.track({ authorId: _lastAuthor, currentHole: _lastHole });
  });
```

(Leave `_presenceCbs` intact across `stopRealtime`; presence auto-clears when the socket drops.)

- [ ] **Step 4: Run tests**

Run: `npx jest src/store/__tests__/realtimeSync.presence.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/realtimeSync.js src/store/__tests__/realtimeSync.presence.test.js
git commit -m "feat(sync): realtime presence broadcast of currentHole"
```

---

## Task 10: `scoring.js` — derivation-based conflict list

**Files:**
- Modify: `src/store/scoring.js` (lines 850-873)

**Interfaces:**
- Consumes: `listRoundConflicts`, `roundHasConflicts` from `scoreEntries.js` (Task 2).
- Produces: `scoring.js` re-exports the derivation-based `listRoundConflicts` / `roundHasConflicts` so existing importers (`HoleView`, `ScorecardScreen`) keep working with the new semantics.

- [ ] **Step 1: Replace the block** (`src/store/scoring.js:850-873`)

```js
// ── Score conflict helpers ───────────────────────────────
// Conflicts are DERIVED from the per-author submission layer (store/
// scoreEntries.js): a cell is in conflict when two different non-blank values
// coexist. Re-exported here for the screens/components that import from
// scoring.js.
export { listRoundConflicts, roundHasConflicts } from './scoreEntries';
```

- [ ] **Step 2: Verify no duplicate definition remains**

Run: `grep -n "function listRoundConflicts\|function roundHasConflicts\|merge.js" src/store/scoring.js`
Expected: no matches (the stale `merge.js` comment is gone; no local function defs).

- [ ] **Step 3: Run the store test suite**

Run: `npx jest src/store/__tests__/scoring`
Expected: PASS (port any test that seeded `round.scoreConflicts` to seed `round.scoreEntries` instead).

- [ ] **Step 4: Commit**

```bash
git add src/store/scoring.js src/store/__tests__/scoring*
git commit -m "refactor(sync): derive listRoundConflicts from per-author entries"
```

---

## Task 11: `ScorecardScreen.js` — author id, presence, gated dots, attributed rows

**Files:**
- Modify: `src/screens/ScorecardScreen.js`
- Create: `src/store/deviceId.js`

**Interfaces:**
- Consumes: `surfaceableConflicts`, `deriveCell`, `listRoundConflicts` (`scoreEntries.js`); `setPresenceHole`, `getPresenceProgress`, `subscribeProgress` (`realtimeSync.js`); `getDeviceAuthorId` (`deviceId.js`).
- Produces: `score.set` mutations carry `authorId`; `conflict.resolve` carries `resolvedBy`; `finishConflictRows` built from derivation with `authorName`s; a gated `conflictHoles` set + `authorName` passed to `HoleView`; `currentHole` broadcast via presence.

- [ ] **Step 1: Add a persisted device-author fallback module** — create `src/store/deviceId.js`:

```js
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@golf_device_author_id';
let _cached = null;

// Synchronous best-effort id for author stamping; hydrated once on first call.
export function getDeviceAuthorId() {
  if (_cached) return _cached;
  _cached = `dev-${Math.random().toString(36).slice(2)}`;
  AsyncStorage.getItem(KEY).then((v) => {
    if (v) _cached = v; else AsyncStorage.setItem(KEY, _cached);
  }).catch(() => {});
  return _cached;
}
```

- [ ] **Step 2: Add an author id + name resolver** in `ScorecardScreen.js` (near `const meId = tournament?.meId ?? null;`, `:847`). Import `getDeviceAuthorId` from `../store/deviceId`:

```js
const authorId = meId ?? getDeviceAuthorId();
const authorName = useCallback((aId) => {
  if (aId === 'legacy') return 'Earlier entry';
  const p = (tournament?.players ?? []).find((pl) => pl.id === aId);
  return p?.name ?? 'Someone';
}, [tournament]);
```

> `meId` is set for every claimed player (the norm — everyone claims their player on web); the device fallback only covers an unclaimed spectator device.

- [ ] **Step 3: Thread `authorId` into `autoSave`'s mutation** (`:569-575`) — add `authorId` to the `score.set` payload and to the `autoSave` `useCallback` dependency array:

```js
      t = await mutate(t, {
        type: 'score.set',
        roundId: round.id,
        playerId: cell.playerId,
        hole: cell.hole,
        value: cell.value,
        authorId,
      }, { deferSync: true });
```

- [ ] **Step 4: Thread `resolvedBy` into `resolveConflict`** (`:663-669`) — add `resolvedBy: authorId` to the `conflict.resolve` payload and to its dependency array.

- [ ] **Step 5: Broadcast presence on hole change** — extend the existing `useEffect(() => { flushScoreSync(); }, [currentHole, flushScoreSync])` (`:1164`). Import `setPresenceHole, getPresenceProgress, subscribeProgress` from `../store/realtimeSync`:

```js
useEffect(() => {
  flushScoreSync();
  setPresenceHole(authorId, currentHole);
}, [currentHole, flushScoreSync, authorId]);
```

- [ ] **Step 6: Hold live presence progress in state** — add near other state:

```js
const [presenceProgress, setPresenceProgress] = useState({});
useEffect(() => {
  setPresenceProgress(getPresenceProgress());
  return subscribeProgress(setPresenceProgress);
}, [tournament?.id]);
```

- [ ] **Step 7: Build a gated conflict-hole set for mid-round dots** — import `surfaceableConflicts`, `deriveCell`, `listRoundConflicts` from `../store/scoreEntries`:

```js
const conflictHoles = useMemo(
  () => new Set(surfaceableConflicts(round, presenceProgress).map((c) => c.hole)),
  [round, presenceProgress],
);
```

Pass `conflictHoles={conflictHoles}` and `authorName={authorName}` to both `HoleView` usages.

- [ ] **Step 8: Rebuild `finishConflictRows` from derivation with authors** (`:1033-1043`)

```js
const finishConflictRows = useMemo(() => {
  const t = tournament; const r = t?.rounds?.[roundIndex];
  if (!r) return [];
  return listRoundConflicts(r).map(({ playerId, hole }) => {
    const d = deriveCell(r, playerId, hole);
    return {
      playerId, hole,
      playerName: (t.players ?? []).find((p) => p.id === playerId)?.name ?? 'Player',
      currentValue: d.effective,
      candidates: d.candidates.map((c) => ({ value: c.value, ts: c.ts, authorId: c.authorId, authorName: authorName(c.authorId) })),
      blankAuthors: d.blankAuthors.map((a) => authorName(a)),
    };
  });
}, [tournament, roundIndex, authorName]);
```

- [ ] **Step 9: Confirm the finish gate uses the derived list** — `handleFinish` (`:1243`) already calls `listRoundConflicts(freshRound)`. Change its import to `../store/scoreEntries` (or keep the `scoring.js` re-export — same fn). The finish gate stays **un-gated by presence** (it must surface **all** remaining conflicts).

- [ ] **Step 10: App-level checks**

Run: `npx jest src/screens 2>/dev/null; npm run lint`
Expected: lint passes; any screen tests pass.

- [ ] **Step 11: Commit**

```bash
git add src/screens/ScorecardScreen.js src/store/deviceId.js
git commit -m "feat(scorecard): author-stamped writes, presence, gated + attributed conflicts"
```

---

## Task 12: Conflict sheets — show who entered what

**Files:**
- Modify: `src/components/scorecard/HoleView.js`
- Modify: `src/components/ScoreConflictSheet.js`
- Modify: `src/components/scorecard/FinishConflictSheet.js`
- Test: `src/components/__tests__/ScoreConflictSheet.render.test.js` (create)

**Interfaces:**
- Consumes: gated `conflictHoles` + `authorName` props (Task 11); `deriveCell` (`scoreEntries.js`); candidate shape `{ value, ts, authorId, authorName }`.
- Produces: both sheets render an author name per candidate + a blank-authors line; `HoleView` builds its inline sheet candidates from `deriveCell`.

- [ ] **Step 1: `HoleView` — use the passed `conflictHoles`, derive candidates**

Replace the `conflictHoles` `useMemo` (`:84-88`) with the incoming prop (destructure `conflictHoles = new Set()` and `authorName` from props; drop the now-unused `listRoundConflicts` import if nothing else uses it). Replace the inline-sheet marker lookup (`:469-489`):

```jsx
{conflictTarget && (() => {
  const { hole: cHole, playerId } = conflictTarget;
  const d = deriveCell(round, playerId, cHole);
  if (d.status !== 'conflict') return null;
  const subject = players.find((p) => p.id === playerId);
  return (
    <ScoreConflictSheet
      visible
      onClose={() => setConflictTarget(null)}
      hole={cHole}
      subjectName={subject?.name ?? 'Player'}
      candidates={d.candidates.map((c) => ({ value: c.value, ts: c.ts, authorId: c.authorId, authorName: authorName?.(c.authorId) ?? 'Someone' }))}
      blankAuthors={d.blankAuthors.map((a) => authorName?.(a) ?? 'Someone')}
      currentValue={d.effective}
      onResolve={(value) => { onResolveConflict?.(playerId, cHole, value); setConflictTarget(null); }}
    />
  );
})()}
```

Add `import { deriveCell } from '../../store/scoreEntries';`.

- [ ] **Step 2: `ScoreConflictSheet` — render the author**

Add `blankAuthors` to the destructured props. In the candidate card (`:72-100`), change the label line to prefer the author name:

```jsx
        <Text style={s.cardLabel}>{c.authorName ?? (c.value === currentValue ? 'Current score' : 'Other entry')}</Text>
```

Below the `cardsRow` view, add a blank line + a muted `blankNote` style:

```jsx
{Array.isArray(blankAuthors) && blankAuthors.length > 0 && (
  <Text style={s.blankNote}>{`No score from ${blankAuthors.join(', ')}`}</Text>
)}
```

- [ ] **Step 3: Write a render smoke test**

```js
// src/components/__tests__/ScoreConflictSheet.render.test.js
import React from 'react';
import renderer from 'react-test-renderer';
import ScoreConflictSheet from '../ScoreConflictSheet';

test('renders author names for candidates', () => {
  const tree = renderer.create(
    <ScoreConflictSheet
      visible hole={3} subjectName="Ana"
      candidates={[{ value: 4, ts: 1, authorId: 'a', authorName: 'Marco' }, { value: 5, ts: 2, authorId: 'b', authorName: 'Claudia' }]}
      blankAuthors={['Ana']}
      currentValue={5}
      onResolve={() => {}}
    />,
  ).toJSON();
  const text = JSON.stringify(tree);
  expect(text).toContain('Marco');
  expect(text).toContain('Claudia');
  expect(text).toContain('Ana');
});
```

Run: `npx jest src/components/__tests__/ScoreConflictSheet.render.test.js`
Expected: PASS.

- [ ] **Step 4: `FinishConflictSheet` — render the author**

In the candidate chip (`:60-74`), change the hint line to show the author:

```jsx
            <Text style={s.chipValue}>{valueLabel(c.value)}</Text>
            <Text style={s.chipHint}>{c.authorName ?? (isCurrent ? 'On this phone' : 'Other phone')}</Text>
```

After the `chips` view, render blank authors when present (add a muted `rowBlank` style):

```jsx
    {Array.isArray(row.blankAuthors) && row.blankAuthors.length > 0 && (
      <Text style={s.rowBlank}>{`No score from ${row.blankAuthors.join(', ')}`}</Text>
    )}
```

- [ ] **Step 5: Full suite + lint**

Run: `npm test && npm run lint`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/components/scorecard/HoleView.js src/components/ScoreConflictSheet.js src/components/scorecard/FinishConflictSheet.js src/components/__tests__/ScoreConflictSheet.render.test.js
git commit -m "feat(scorecard): show who entered what in conflict sheets"
```

---

## Task 13: End-to-end verification (runtime)

**Files:** none (verification only)

- [ ] **Step 1: Run the full suite + lint**

Run: `npm test && npm run lint`
Expected: all pass.

- [ ] **Step 2: Drive the web app** using the `verify` skill (Playwright MCP over the Expo web build — same codebase as Android). With two browser sessions against one round, verify:
  - Both enter the same value on a hole → no conflict dot, effective agrees.
  - One enters a value, the other leaves it blank → fills in, no conflict.
  - Two different values on hole N, both still on hole N → **no** dot yet.
  - Both advance to hole N+1 → dot appears; opening the sheet shows both names + values; resolving on one device clears it on the other.
  - Finish is blocked while an unresolved conflict remains, then proceeds once resolved; both sessions show identical final scores.

- [ ] **Step 3: Record results.** If any check fails, invoke `superpowers:systematic-debugging` before patching. When green, note completion (per the "Summarize completed implementations" memory).

---

## Self-Review

**Spec coverage** (spec §2 decisions → tasks):
1. Prompt only for real disagreements → Tasks 1, 4 (derivation, distinct non-null), 7 (drop clock detector). ✅
2. Attribution → Tasks 1 (candidate authorId), 11/12 (author names). ✅
3. Synced, symmetric markers → Tasks 3/4 (tables + RPCs), 8 (realtime), anyone-resolves via 5/7/11. ✅
4. Everyone-off-the-hole + finish backstop → Tasks 2 (gate), 9 (presence), 11 (gated dots + un-gated finish). ✅
5. Per-author model → Tasks 1–8. ✅
- Blank ≠ conflict → Task 1 tests. ✅  Migration/back-compat (§8) → Task 4 backfill. ✅  Retire local-only markers / fix stale comment (§7) → Tasks 6, 10. ✅

**Placeholder scan:** every code step carries real code; the only environment-dependent step (Task 4 Step 3, prod apply) states an explicit fallback. No TBD/TODO. ✅

**Type consistency:** candidate shape `{ value, ts, authorId }` consistent across Tasks 1, 4 (RPC `authorId`/`value`/`ts`), 8 (row→`{value,ts}`), 11/12 (+`authorName`). `authorId` param name consistent across mutation payloads, repo `submitScore`, RPC `p_author_id`. `preserveLocalConflictState` used in Tasks 6 + 8. `listRoundConflicts`/`roundHasConflicts` single source (`scoreEntries.js`), re-exported in Task 10. ✅
