# Per-Player Tees Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make course rating + slope a property of a *tee*, let a course own an ordered list of tees, and let each player pick their tee per round so playing handicaps are derived per-player.

**Architecture:** Approach A — snapshot the tee into the round. A course owns `tees[]`; each round snapshots the course's `tees` and a per-player `playerTees` map (`{ label, slope, rating }`). `scoring.js` resolves each player's slope/rating from their tee, falling back to legacy `round.slope`/`round.courseRating`. Par and stroke index stay shared at the course level, so Stableford/Match/Sindicato math is untouched.

**Tech Stack:** React Native (Expo), Supabase (Postgres + PostgREST), Jest. JavaScript, no TypeScript.

**Spec:** `docs/superpowers/specs/2026-05-18-per-player-tees-design.md`

**Plan refinements over the spec (deliberate, not gaps):**
- The per-player snapshot is `{ label, slope, rating }` — **no `teeId`**. `course_tees` rows are saved delete-then-insert (mirroring `course_holes`), so tee ids are not stable. Propagation and pre-fill both match **by `label`**, which is consistent and robust.
- A round also stores a `tees` snapshot (the course's tee list at setup time), exactly as it already snapshots `holes`. The spec's "Propagation pushes `tees` into rounds" already implies this.
- The shared tee-list editor is extracted into a reusable `TeesEditor` component used by both `CourseEditorScreen` and `CourseLibraryDetailScreen` (they currently duplicate the slope/rating + holes UI).

**Non-Goals (explicit scope boundaries):**
- Per-hole **yardage entry UI** and scorecard yardage display. The `course_tees.yardages` jsonb column is created (nullable) so no future migration is needed, but no UI in this plan reads or writes it.
- Per-tee par or per-tee stroke index. Par/SI stay shared.
- Official tournaments (`officialScoring`/`officialAdmin`) tee UI.

---

## Data shapes used across tasks

```js
// Course (app shape, from normalizeCourse)
Course = {
  id, name, city, province,
  slope, rating,                         // legacy course-level fields, kept for back-compat reads
  holes: [{ number, par, strokeIndex }], // shared across tees
  tees:  [Tee],                          // ordered by sortOrder, longest first
}

Tee = { id, label, rating, slope, sortOrder, yardages }   // yardages: jsonb or undefined

// Round (additions to the existing shape)
Round = {
  ...existing (courseId, courseName, holes, scores, playerHandicaps, manualHandicaps),
  slope, courseRating,                   // legacy, retained read-only for old rounds
  tees: [Tee],                           // snapshot of the course's tee list
  playerTees: { [playerId]: { label, slope, rating } },   // per-player selection
}

// CourseEditor onSave patch object
onSave(roundIndex, { holes, tees, playerHandicaps, manualHandicaps, playerTees })
```

---

## Task 1: Pure tee helpers (`src/store/tees.js`)

**Files:**
- Create: `src/store/tees.js`
- Test: `src/store/__tests__/tees.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/store/__tests__/tees.test.js`:

```js
import { middleTee, teeByLabel, blankTee } from '../tees';

describe('middleTee', () => {
  it('returns null for an empty or missing tee list', () => {
    expect(middleTee([])).toBeNull();
    expect(middleTee(undefined)).toBeNull();
  });

  it('returns the only tee for a single-tee list', () => {
    const tees = [{ label: 'White' }];
    expect(middleTee(tees)).toBe(tees[0]);
  });

  it('returns the middle tee (floor index) for an odd-length list', () => {
    const tees = [{ label: 'Black' }, { label: 'White' }, { label: 'Red' }];
    expect(middleTee(tees)).toBe(tees[1]);
  });

  it('returns the lower-middle tee for an even-length list', () => {
    const tees = [{ label: 'Black' }, { label: 'Blue' }, { label: 'White' }, { label: 'Red' }];
    expect(middleTee(tees)).toBe(tees[2]); // floor(4/2) = 2
  });
});

describe('teeByLabel', () => {
  const tees = [{ label: 'White' }, { label: 'Yellow' }];

  it('finds a tee by exact label', () => {
    expect(teeByLabel(tees, 'Yellow')).toBe(tees[1]);
  });

  it('matches case-insensitively and trims', () => {
    expect(teeByLabel(tees, '  yellow ')).toBe(tees[1]);
  });

  it('returns null when nothing matches or inputs are missing', () => {
    expect(teeByLabel(tees, 'Red')).toBeNull();
    expect(teeByLabel(undefined, 'White')).toBeNull();
    expect(teeByLabel(tees, null)).toBeNull();
  });
});

describe('blankTee', () => {
  it('creates a tee with an id and empty fields', () => {
    const t = blankTee();
    expect(typeof t.id).toBe('string');
    expect(t.id.length).toBeGreaterThan(0);
    expect(t).toMatchObject({ label: '', rating: null, slope: null });
  });

  it('gives distinct ids', () => {
    expect(blankTee().id).not.toBe(blankTee().id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tees.test.js`
Expected: FAIL — `Cannot find module '../tees'`.

- [ ] **Step 3: Write the implementation**

Create `src/store/tees.js`:

```js
// ============================================================================
// Pure tee helpers. A "tee" is one set of markers on a course; each carries
// its own course rating and slope. A course owns an ordered list of tees
// (longest first). These functions have no IO and no module state.
// ============================================================================

// The middle tee of an ordered list — the sensible default when a player has
// no recorded tee history on a course. floor(length / 2): index 1 of 3,
// index 2 of 4. Returns null for an empty/missing list.
export function middleTee(tees) {
  if (!Array.isArray(tees) || tees.length === 0) return null;
  return tees[Math.floor(tees.length / 2)];
}

// Find a tee by label, case-insensitive and trimmed. Returns null when there
// is no match or inputs are missing.
export function teeByLabel(tees, label) {
  if (!Array.isArray(tees) || label == null) return null;
  const key = String(label).trim().toLowerCase();
  if (!key) return null;
  return tees.find((t) => String(t.label ?? '').trim().toLowerCase() === key) ?? null;
}

// A fresh empty tee for the editor. The id is client-generated so React keys
// are stable while editing; it is NOT persisted as a stable DB id (tees are
// saved delete-then-insert).
export function blankTee() {
  const id = `tee-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { id, label: '', rating: null, slope: null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tees.test.js`
Expected: PASS — all 9 assertions green.

- [ ] **Step 5: Commit**

```bash
git add src/store/tees.js src/store/__tests__/tees.test.js
git commit -m "feat: pure tee helpers (middleTee, teeByLabel, blankTee)"
```

---

## Task 2: Per-player tee resolution in `scoring.js`

**Files:**
- Modify: `src/store/scoring.js:37-86` (deriveRoundPlayingHandicap and its callers)
- Test: `src/store/__tests__/scoring.test.js:116-170`

Currently `deriveRoundPlayingHandicap(handicap, round)` uses `round.slope` /
`round.courseRating` for every player. It must resolve the player's own tee.

- [ ] **Step 1: Write the failing tests**

In `src/store/__tests__/scoring.test.js`, add `resolveRoundTee` to the import
list at the top (line 1-21 import block):

```js
  deriveRoundPlayingHandicap,
  resolveRoundTee,
  getPlayingHandicap,
```

Then add this describe block after the existing
`describe('deriveRoundPlayingHandicap / getPlayingHandicap', ...)` block
(after line 137):

```js
describe('resolveRoundTee', () => {
  it('prefers the player tee snapshot when present', () => {
    const round = {
      slope: 113, courseRating: 72,
      playerTees: { p1: { label: 'White', slope: 132, rating: 71.8 } },
    };
    expect(resolveRoundTee(round, 'p1')).toEqual({ slope: 132, rating: 71.8 });
  });

  it('falls back to round-level slope/rating for legacy rounds', () => {
    const round = { slope: 125, courseRating: 70.1 };
    expect(resolveRoundTee(round, 'p1')).toEqual({ slope: 125, rating: 70.1 });
  });
});

describe('deriveRoundPlayingHandicap with per-player tees', () => {
  const holes = Array.from({ length: 18 }, () => ({ par: 4 })); // par 72

  it('derives each player from their own tee', () => {
    const round = {
      holes,
      playerTees: {
        p1: { label: 'White',  slope: 132, rating: 71.8 },
        p2: { label: 'Yellow', slope: 113, rating: 69.0 },
      },
    };
    // p1: 10 * 132/113 + (71.8 - 72) = 11.68 - 0.2 = 11.48 -> 11
    expect(deriveRoundPlayingHandicap(10, round, 'p1')).toBe(11);
    // p2: 10 * 113/113 + (69.0 - 72) = 10 - 3 = 7
    expect(deriveRoundPlayingHandicap(10, round, 'p2')).toBe(7);
  });

  it('falls back to round.slope when the player has no tee entry', () => {
    const round = { holes, slope: 113, courseRating: 72, playerTees: {} };
    expect(deriveRoundPlayingHandicap(10, round, 'p1')).toBe(10);
  });
});
```

The existing block at line 116-137 keeps calling
`deriveRoundPlayingHandicap(10, round)` with no `playerId` — that must still
pass (no `playerTees` on that round → falls back to `round.slope`). Leave it
unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- scoring.test.js`
Expected: FAIL — `resolveRoundTee` is not exported (`resolveRoundTee is not a function`).

- [ ] **Step 3: Write the implementation**

In `src/store/scoring.js`, replace the `deriveRoundPlayingHandicap` function
(currently lines 37-45) with:

```js
// Resolve the slope + course rating a player plays off in a round. Prefers
// the player's per-player tee snapshot (round.playerTees); falls back to the
// round-level slope/courseRating for legacy rounds created before per-player
// tees existed.
export function resolveRoundTee(round, playerId) {
  const tee = round?.playerTees?.[playerId];
  if (tee) return { slope: tee.slope, rating: tee.rating };
  return { slope: round?.slope, rating: round?.courseRating };
}

// Convenience: derive a player's auto playing handicap for a given round,
// using that player's tee. `playerId` is optional — when omitted (e.g. legacy
// call sites, tests) it falls back to the round-level slope/rating.
export function deriveRoundPlayingHandicap(handicap, round, playerId) {
  const { slope, rating } = resolveRoundTee(round, playerId);
  return calcPlayingHandicap(
    handicap,
    slope,
    rating,
    totalParFromHoles(round?.holes),
  );
}
```

Then update the three callers in the same file to pass `p.id` / `player.id`:

`normalizeRoundHandicaps` (around line 56) — change:
```js
    const auto = deriveRoundPlayingHandicap(p.handicap, round);
```
to:
```js
    const auto = deriveRoundPlayingHandicap(p.handicap, round, p.id);
```

`getPlayingHandicap` (around line 73) — change:
```js
  return deriveRoundPlayingHandicap(player.handicap, round);
```
to:
```js
  return deriveRoundPlayingHandicap(player.handicap, round, player.id);
```

`recomputeRoundPlayingHandicaps` (around line 83) — change:
```js
    playerHandicaps[p.id] = deriveRoundPlayingHandicap(p.handicap, round);
```
to:
```js
    playerHandicaps[p.id] = deriveRoundPlayingHandicap(p.handicap, round, p.id);
```

- [ ] **Step 4: Run the full scoring suite to verify it passes**

Run: `npm test -- scoring.test.js`
Expected: PASS — new blocks green, all pre-existing blocks still green.

- [ ] **Step 5: Commit**

```bash
git add src/store/scoring.js src/store/__tests__/scoring.test.js
git commit -m "feat: resolve playing handicap from per-player tees"
```

---

## Task 3: Database migration — `course_tees` table

**Files:**
- Create: `supabase/migrations/20260518000003_course_tees.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260518000003_course_tees.sql`:

```sql
-- Per-tee course rating + slope. A course owns an ordered list of tees;
-- each tee (a colour, a number, or a name) has its own rating and slope.
-- Par and stroke index stay on course_holes, shared across tees.
-- yardages is an optional jsonb map { holeNumber: yards }; cosmetic.

CREATE TABLE IF NOT EXISTS public.course_tees (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   uuid        NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  label       text        NOT NULL,
  rating      numeric,
  slope       integer,
  sort_order  integer     NOT NULL DEFAULT 0,
  yardages    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS course_tees_course_id_idx
  ON public.course_tees (course_id);

ALTER TABLE public.course_tees ENABLE ROW LEVEL SECURITY;

-- The course library is shared/collaborative — any signed-in user may read
-- and edit courses (mirrors how courses / course_holes are used by
-- libraryStore.upsertCourse and saveCourseHoles). If course_holes carries a
-- stricter policy in the live database, mirror that here instead.
DROP POLICY IF EXISTS "course_tees_select" ON public.course_tees;
CREATE POLICY "course_tees_select"
  ON public.course_tees FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "course_tees_write" ON public.course_tees;
CREATE POLICY "course_tees_write"
  ON public.course_tees FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

-- Backfill: every existing course gets one "Default" tee carrying its current
-- course-level slope/rating, so existing courses keep a usable tee.
INSERT INTO public.course_tees (course_id, label, rating, slope, sort_order)
SELECT c.id, 'Default', c.rating, c.slope, 0
FROM public.courses c
WHERE NOT EXISTS (
  SELECT 1 FROM public.course_tees t WHERE t.course_id = c.id
);
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db push`
Expected: migration `20260518000003_course_tees` applies cleanly; output reports the new migration as applied.

If `supabase` is not linked in this environment, instead apply the SQL via the
Supabase dashboard SQL editor and note that in the commit message.

- [ ] **Step 3: Verify the table and backfill**

Run: `npx supabase db diff` (expect no pending diff) — or in the SQL editor:
`SELECT course_id, label, slope, rating FROM public.course_tees LIMIT 5;`
Expected: each existing course has one `Default` row.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260518000003_course_tees.sql
git commit -m "feat: course_tees table with per-course backfill"
```

---

## Task 4: `libraryStore.js` — tees in normalize, fetch, save

**Files:**
- Modify: `src/store/libraryStore.js:83-136,180-193`
- Test: `src/store/__tests__/libraryStore.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `src/store/__tests__/libraryStore.test.js` (after the last
`describe` block, before EOF):

```js
import { normalizeCourse } from '../libraryStore';

describe('normalizeCourse', () => {
  test('maps course_tees rows into a sorted tees array', () => {
    const out = normalizeCourse({
      id: 'c1', name: 'Pine', slope: null, rating: null,
      course_holes: [],
      course_tees: [
        { id: 't2', label: 'White',  rating: 71.8, slope: 132, sort_order: 1 },
        { id: 't1', label: 'Black',  rating: 73.5, slope: 140, sort_order: 0 },
      ],
    });
    expect(out.tees.map((t) => t.label)).toEqual(['Black', 'White']);
    expect(out.tees[0]).toMatchObject({ label: 'Black', rating: 73.5, slope: 140, sortOrder: 0 });
  });

  test('synthesizes a Default tee from legacy slope/rating when no tee rows', () => {
    const out = normalizeCourse({
      id: 'c2', name: 'Oak', slope: 125, rating: 70.1,
      course_holes: [], course_tees: [],
    });
    expect(out.tees).toHaveLength(1);
    expect(out.tees[0]).toMatchObject({ label: 'Default', slope: 125, rating: 70.1 });
  });

  test('yields an empty tees array when there is no tee data at all', () => {
    const out = normalizeCourse({
      id: 'c3', name: 'Elm', slope: null, rating: null,
      course_holes: [], course_tees: [],
    });
    expect(out.tees).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- libraryStore.test.js`
Expected: FAIL — `out.tees` is `undefined` (normalizeCourse does not map tees yet).

- [ ] **Step 3: Update `normalizeCourse`**

In `src/store/libraryStore.js`, replace the whole `normalizeCourse` function
(lines 180-193) with:

```js
// Convert Supabase course row → app-friendly shape
export function normalizeCourse(c) {
  const tees = (c.course_tees ?? [])
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((t) => ({
      id: t.id,
      label: t.label,
      rating: t.rating,
      slope: t.slope,
      sortOrder: t.sort_order ?? 0,
      yardages: t.yardages ?? undefined,
    }));
  // Legacy course with no tee rows but a stored course-level slope/rating →
  // synthesize a single Default tee so the app shape always has `tees`.
  const effectiveTees = tees.length > 0
    ? tees
    : (c.slope != null || c.rating != null)
      ? [{ id: `legacy-${c.id}`, label: 'Default', rating: c.rating, slope: c.slope, sortOrder: 0 }]
      : [];
  return {
    id: c.id,
    name: c.name,
    slope: c.slope,    // legacy course-level fields, kept for back-compat reads
    rating: c.rating,
    city: c.city,
    province: c.province,
    holes: (c.course_holes ?? [])
      .sort((a, b) => a.number - b.number)
      .map((h) => ({ number: h.number, par: h.par, strokeIndex: h.stroke_index })),
    tees: effectiveTees,
  };
}
```

- [ ] **Step 4: Update `fetchCourses` to join tees**

In `fetchCourses` (line 84-89), change the `.select(...)` line:
```js
    .select('*, course_holes(*)')
```
to:
```js
    .select('*, course_holes(*), course_tees(*)')
```

- [ ] **Step 5: Add `saveCourseTees` and update `updateCourseFromEditor`**

Replace `updateCourseFromEditor` (lines 125-136) with both functions below:

```js
// Replace a course's tee list. Delete-then-insert (mirrors saveCourseHoles);
// tee ids are therefore not stable across saves — callers match tees by
// `label`, never by id.
export async function saveCourseTees(courseId, tees) {
  await supabase.from('course_tees').delete().eq('course_id', courseId);
  if (!tees || !tees.length) return;
  const rows = tees.map((t, i) => ({
    course_id: courseId,
    label: String(t.label ?? '').trim(),
    rating: t.rating != null && t.rating !== '' ? parseFloat(t.rating) : null,
    slope: t.slope != null && t.slope !== '' ? parseInt(t.slope, 10) : null,
    sort_order: i,
    yardages: t.yardages ?? null,
  }));
  const { error } = await supabase.from('course_tees').insert(rows);
  if (error) throw error;
}

// Called from CourseEditorScreen / CourseLibraryDetailScreen to sync holes +
// tees back to the course library.
export async function updateCourseFromEditor(courseId, holes, tees) {
  await saveCourseHoles(courseId, holes);
  await saveCourseTees(courseId, tees);
}
```

- [ ] **Step 6: Update `upsertCourse` to drop slope/rating**

Replace `upsertCourse` (lines 92-104) with:

```js
export async function upsertCourse({ id, name, city, province }) {
  const row = {
    name,
    city: city?.trim() || null,
    province: province?.trim() || null,
  };
  if (id) row.id = id;
  const { data, error } = await supabase.from('courses').upsert(row).select().single();
  if (error) throw error;
  return data;
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -- libraryStore.test.js`
Expected: PASS — new `normalizeCourse` block green, existing player tests still green.

- [ ] **Step 8: Commit**

```bash
git add src/store/libraryStore.js src/store/__tests__/libraryStore.test.js
git commit -m "feat: course tees in libraryStore (normalize, fetch, save)"
```

---

## Task 5: `tournamentStore.js` — tee propagation + pre-fill helper

**Files:**
- Modify: `src/store/tournamentStore.js:501-529`
- Test: `src/store/__tests__/tournamentStore.test.js`

- [ ] **Step 1: Write the failing test**

Append to `src/store/__tests__/tournamentStore.test.js`:

```js
import { reTeeRound } from '../tournamentStore';

describe('reTeeRound', () => {
  const newTees = [
    { label: 'Black',  slope: 140, rating: 73.5 },
    { label: 'White',  slope: 130, rating: 71.0 }, // White edited: was 132/71.8
  ];

  test('refreshes a player tee snapshot from the matching new tee by label', () => {
    const round = {
      playerTees: { p1: { label: 'White', slope: 132, rating: 71.8 } },
    };
    const out = reTeeRound(round, newTees);
    expect(out.playerTees.p1).toEqual({ label: 'White', slope: 130, rating: 71.0 });
  });

  test('retains the existing snapshot when no new tee matches the label', () => {
    const round = {
      playerTees: { p1: { label: 'Yellow', slope: 118, rating: 68.0 } },
    };
    const out = reTeeRound(round, newTees);
    expect(out.playerTees.p1).toEqual({ label: 'Yellow', slope: 118, rating: 68.0 });
  });

  test('is a no-op when the round has no playerTees', () => {
    const round = { scores: {} };
    expect(reTeeRound(round, newTees)).toEqual({ scores: {} });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tournamentStore.test.js`
Expected: FAIL — `reTeeRound is not a function`.

- [ ] **Step 3: Add `reTeeRound` and update propagation**

In `src/store/tournamentStore.js`, add the `teeByLabel` import near the other
store imports at the top of the file:

```js
import { teeByLabel } from './tees';
```

Replace `propagateCourseToTournaments` (lines 501-529) with:

```js
// Re-resolve every per-player tee snapshot in a round against a fresh tee
// list, matching by label. A player whose tee label still exists gets its
// slope/rating refreshed; a player whose label is gone keeps the old
// snapshot. Pure — no IO.
export function reTeeRound(round, tees) {
  if (!round?.playerTees) return round;
  const next = {};
  for (const [playerId, snapshot] of Object.entries(round.playerTees)) {
    const match = teeByLabel(tees, snapshot?.label);
    next[playerId] = match
      ? { label: match.label, slope: match.slope, rating: match.rating }
      : snapshot;
  }
  return { ...round, playerTees: next };
}

// Push a course library edit (holes + tees) into every tournament round that
// references this courseId. Holes and tees are deep-copied per round. Each
// round's per-player tee snapshots are re-resolved by label, then non-manual
// playing handicaps are re-derived.
export async function propagateCourseToTournaments(courseId, { holes, tees }) {
  if (!courseId) return [];
  const tournaments = await loadAllTournaments();
  const updatedIds = [];
  for (const t of tournaments) {
    let changed = false;
    const nextRounds = t.rounds.map((round) => {
      if (round.courseId !== courseId) return round;
      changed = true;
      const reTeed = reTeeRound(round, tees);
      const nextRound = {
        ...reTeed,
        holes: holes.map((h) => ({ ...h })),
        tees: tees.map((tee) => ({ ...tee })),
      };
      return recomputeRoundPlayingHandicaps(nextRound, t.players);
    });
    if (changed) {
      const next = { ...t, rounds: nextRounds };
      await persistRemote(next);
      updatedIds.push(next.id);
    }
  }
  if (updatedIds.length > 0) _emitChange();
  return updatedIds;
}

// Most recent prior round on `courseId` that recorded a tee for `playerId`.
// Returns the stored { label, slope, rating } snapshot, or null. Used to
// pre-fill a player's tee when setting up a new round on the same course.
export async function lastTeeForPlayerOnCourse(courseId, playerId) {
  if (!courseId || !playerId) return null;
  const tournaments = await loadAllTournaments();
  let best = null; // { ts, tee }
  for (const t of tournaments) {
    const ts = t.createdAt ?? 0;
    for (const round of t.rounds ?? []) {
      if (round.courseId !== courseId) continue;
      const tee = round.playerTees?.[playerId];
      if (!tee) continue;
      if (!best || ts >= best.ts) best = { ts, tee };
    }
  }
  return best ? { label: best.tee.label, slope: best.tee.slope, rating: best.tee.rating } : null;
}
```

> `loadAllTournaments`, `persistRemote`, `_emitChange`, and
> `recomputeRoundPlayingHandicaps` were all already used by the original
> `propagateCourseToTournaments`, so they are in scope. Only the `./tees`
> import is new — verify it resolves.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tournamentStore.test.js`
Expected: PASS — `reTeeRound` block green, existing tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/store/tournamentStore.js src/store/__tests__/tournamentStore.test.js
git commit -m "feat: per-player tee propagation and last-used pre-fill"
```

---

## Task 6: Sample course tees (`src/data/sampleCourses.js`)

**Files:**
- Modify: `src/data/sampleCourses.js`

- [ ] **Step 1: Add a tees array to the sample course**

In `src/data/sampleCourses.js`, inside the `Pine Valley` course object, add a
`tees` array immediately after the `holes` array's closing `],` (line 25):

```js
    tees: [
      { label: 'White',  rating: 71.8, slope: 132, sortOrder: 0 },
      { label: 'Yellow', rating: 69.4, slope: 125, sortOrder: 1 },
      { label: 'Red',    rating: 73.0, slope: 128, sortOrder: 2 },
    ],
  },
];
```

- [ ] **Step 2: Run the full test suite (no regressions)**

Run: `npm test`
Expected: PASS — sampleCourses has no dedicated test; confirm nothing else broke.

- [ ] **Step 3: Commit**

```bash
git add src/data/sampleCourses.js
git commit -m "chore: add sample tees to Pine Valley"
```

---

## Task 7: Reusable `TeesEditor` component

**Files:**
- Create: `src/components/TeesEditor.js`

A self-contained, controlled component: given a `tees` array and an `onChange`
callback, it renders an editable list (label / rating / slope per row), an
"Add tee" button, and a duplicate-label warning. No yardage UI (see Non-Goals).

- [ ] **Step 1: Create the component**

Create `src/components/TeesEditor.js`:

```js
import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { blankTee } from '../store/tees';

// Controlled tee-list editor. `tees` is an array of
// { id, label, rating, slope } (rating/slope may be '' while editing).
// `onChange` receives the next array.
export default function TeesEditor({ tees, onChange, theme }) {
  const s = makeStyles(theme);

  function update(index, patch) {
    onChange(tees.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  }
  function add() {
    onChange([...tees, blankTee()]);
  }
  function remove(index) {
    onChange(tees.filter((_, i) => i !== index));
  }

  // Duplicate-label detection — labels must be unique within a course
  // because tee snapshots are matched by label.
  const labelCounts = tees.reduce((m, t) => {
    const k = String(t.label ?? '').trim().toLowerCase();
    if (k) m[k] = (m[k] ?? 0) + 1;
    return m;
  }, {});
  const dupes = Object.entries(labelCounts).filter(([, n]) => n > 1).map(([k]) => k);

  return (
    <View style={s.card}>
      <Text style={s.sectionTitle}>Tees</Text>

      <View style={s.headerRow}>
        <Text style={[s.headerText, s.labelCol]}>Label</Text>
        <Text style={[s.headerText, s.numCol]}>Rating</Text>
        <Text style={[s.headerText, s.numCol]}>Slope</Text>
        <View style={s.removeCol} />
      </View>

      {tees.map((tee, i) => (
        <View key={tee.id ?? i} style={s.row}>
          <TextInput
            style={[s.input, s.labelCol]}
            placeholder="White / 3 / Champ"
            placeholderTextColor={theme.text.muted}
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            value={tee.label ?? ''}
            onChangeText={(v) => update(i, { label: v })}
          />
          <TextInput
            style={[s.input, s.numCol]}
            keyboardType="decimal-pad"
            maxLength={5}
            placeholder="71.5"
            placeholderTextColor={theme.text.muted}
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            value={tee.rating != null ? String(tee.rating) : ''}
            onChangeText={(v) => update(i, { rating: v })}
          />
          <TextInput
            style={[s.input, s.numCol]}
            keyboardType="numeric"
            maxLength={3}
            placeholder="128"
            placeholderTextColor={theme.text.muted}
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            value={tee.slope != null ? String(tee.slope) : ''}
            onChangeText={(v) => update(i, { slope: v })}
          />
          <TouchableOpacity style={s.removeCol} onPress={() => remove(i)} activeOpacity={0.7}>
            <Feather name="x" size={16} color={theme.destructive} />
          </TouchableOpacity>
        </View>
      ))}

      <TouchableOpacity style={s.addBtn} onPress={add} activeOpacity={0.7}>
        <Feather name="plus" size={14} color={theme.accent.primary} style={{ marginRight: 6 }} />
        <Text style={s.addBtnText}>Add tee</Text>
      </TouchableOpacity>

      {dupes.length > 0 && (
        <Text style={s.warnText}>
          Tee labels must be unique — duplicate: {dupes.join(', ')}
        </Text>
      )}
      {tees.length === 0 && (
        <Text style={s.hintText}>
          No tees yet. Without a tee, players use their raw handicap index.
        </Text>
      )}
    </View>
  );
}

const makeStyles = (theme) => StyleSheet.create({
  card: {
    backgroundColor: theme.bg.card, borderRadius: 16, borderWidth: 1,
    borderColor: theme.isDark ? theme.glass?.border : theme.border.default,
    padding: 16, marginBottom: 16,
    ...(theme.isDark ? {} : theme.shadow.card),
  },
  sectionTitle: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.accent.primary,
    fontSize: 11, marginBottom: 10, letterSpacing: 1.5, textTransform: 'uppercase',
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4, gap: 8 },
  headerText: {
    fontFamily: 'PlusJakartaSans-Bold', color: theme.text.muted,
    fontSize: 11, letterSpacing: 0.5,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, gap: 8 },
  labelCol: { flex: 1 },
  numCol: { width: 64, textAlign: 'center' },
  removeCol: { width: 28, alignItems: 'center', justifyContent: 'center' },
  input: {
    backgroundColor: theme.isDark ? theme.bg.secondary : theme.bg.card,
    color: theme.text.primary, borderRadius: 8, borderWidth: 1,
    borderColor: theme.border.default, fontSize: 14,
    fontFamily: 'PlusJakartaSans-SemiBold', padding: 8,
  },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    backgroundColor: theme.accent.light, borderRadius: 8,
    borderWidth: 1, borderColor: theme.accent.primary + '40',
    paddingHorizontal: 10, paddingVertical: 6, marginTop: 8,
  },
  addBtnText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.accent.primary, fontSize: 12 },
  warnText: {
    fontFamily: 'PlusJakartaSans-Medium', color: theme.destructive,
    fontSize: 12, marginTop: 8,
  },
  hintText: {
    fontFamily: 'PlusJakartaSans-Regular', color: theme.text.secondary,
    fontSize: 12, marginTop: 8,
  },
});
```

- [ ] **Step 2: Verify it compiles (lint)**

Run: `npm run lint -- src/components/TeesEditor.js`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/TeesEditor.js
git commit -m "feat: reusable TeesEditor component"
```

---

## Task 8: `CourseEditorScreen` — tees editor + per-player tee picker

**Files:**
- Modify: `src/screens/CourseEditorScreen.js`

This replaces the single "Course Slope / Course Rating" card with `TeesEditor`,
adds a per-player tee picker to the Playing Handicaps section, and changes
`onSave` to the patch-object form. Route params gain `initialTees` and
`initialPlayerTees`.

- [ ] **Step 1: Update imports and route params**

At the top of `src/screens/CourseEditorScreen.js`, add imports below the
existing `calcPlayingHandicap` import (line 11 — keep that one line):

```js
import TeesEditor from '../components/TeesEditor';
import { middleTee } from '../store/tees';
import { lastTeeForPlayerOnCourse } from '../store/tournamentStore';
```

In the `route.params` destructure (lines 25-32), remove `initialSlope` and
`initialCourseRating`, and add `initialTees` and `initialPlayerTees`:

```js
  const {
    roundIndex, courseName,
    initialHoles, initialTees,
    initialPlayerHandicaps, initialManualHandicaps, initialPlayerTees,
    courseId,
    players = [],
    onSave,
  } = route.params;
```

- [ ] **Step 2: Replace slope/rating state with tees + playerTees state**

Replace the `slope` and `courseRating` state declarations (lines 37-40) with:

```js
  const [tees, setTees] = useState(
    () => (initialTees ?? []).map((t) => ({ ...t })),
  );
  // playerTees: { [playerId]: { label, slope, rating } } — resolved on mount.
  const [playerTees, setPlayerTees] = useState(
    () => ({ ...(initialPlayerTees ?? {}) }),
  );
```

- [ ] **Step 3: Resolve each player's tee on mount**

Replace the mount `useEffect` that aligns handicaps to slope (lines 63-84)
with this effect, which (a) fills missing per-player tees and (b) aligns
non-manual handicaps to each player's tee:

```js
  // On mount: ensure every player has a tee (last-used on this course, else
  // the middle tee), then align non-manual playing handicaps to each tee.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const resolved = { ...playerTees };
      for (const p of players) {
        if (resolved[p.id]) continue;
        let tee = null;
        if (courseId) {
          try { tee = await lastTeeForPlayerOnCourse(courseId, p.id); } catch (_) {}
        }
        if (!tee) {
          const mid = middleTee(tees);
          if (mid) tee = { label: mid.label, slope: mid.slope, rating: mid.rating };
        }
        if (tee) resolved[p.id] = tee;
      }
      if (cancelled) return;
      setPlayerTees(resolved);
      const par = holes.reduce((sum, h) => sum + (h.par || 0), 0);
      setPlayerHandicaps((prev) => {
        const next = { ...prev };
        let changed = false;
        players.forEach((p) => {
          if (manualHandicaps[p.id]) return;
          const tee = resolved[p.id];
          const auto = String(calcPlayingHandicap(p.handicap, tee?.slope, tee?.rating, par));
          if (next[p.id] !== auto) { next[p.id] = auto; changed = true; }
        });
        return changed ? next : prev;
      });
    })();
    return () => { cancelled = true; };
    // Run only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 4: Replace `recomputeAuto` / `applySlope` / `applyRating` / `resetAllToAuto`**

Replace the `recomputeAuto`, `resetAllToAuto`, `applySlope`, and `applyRating`
functions (lines 103-153) with tee-aware versions:

```js
  // Recompute non-manual handicaps from each player's current tee.
  function recomputeAuto(nextPlayerTees) {
    const par = holes.reduce((sum, h) => sum + (h.par || 0), 0);
    setPlayerHandicaps((prev) => {
      const next = { ...prev };
      players.forEach((p) => {
        if (manualHandicaps[p.id]) return;
        const tee = nextPlayerTees[p.id];
        next[p.id] = String(calcPlayingHandicap(p.handicap, tee?.slope, tee?.rating, par));
      });
      return next;
    });
  }

  // Assign a tee to one player and refresh their auto handicap.
  function setPlayerTee(playerId, tee) {
    const snapshot = { label: tee.label, slope: tee.slope, rating: tee.rating };
    setPlayerTees((prev) => {
      const next = { ...prev, [playerId]: snapshot };
      recomputeAuto(next);
      return next;
    });
  }

  // Explicit "Reset all to auto": clear manual overrides, recompute from tees.
  function resetAllToAuto() {
    setManualHandicaps({});
    const par = holes.reduce((sum, h) => sum + (h.par || 0), 0);
    setPlayerHandicaps(() => {
      const next = {};
      players.forEach((p) => {
        const tee = playerTees[p.id];
        next[p.id] = String(calcPlayingHandicap(p.handicap, tee?.slope, tee?.rating, par));
      });
      return next;
    });
  }
```

- [ ] **Step 5: Update the `onSave` effect to the patch-object form**

Replace the save `useEffect` (lines 86-99) with:

```js
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    const parsedHandicaps = {};
    players.forEach((p) => { parsedHandicaps[p.id] = parseInt(playerHandicaps[p.id], 10) || 0; });
    onSaveRef.current(roundIndex, {
      holes,
      tees,
      playerHandicaps: parsedHandicaps,
      manualHandicaps,
      playerTees,
    });
  }, [holes, tees, playerHandicaps, manualHandicaps, playerTees]);
```

- [ ] **Step 6: Replace the slope/rating card JSX with `<TeesEditor>`**

Replace the entire "Slope + Course Rating" `<View style={s.slopeCard}>` block
(lines 227-259) with:

```jsx
        <TeesEditor tees={tees} onChange={setTees} theme={theme} />
```

- [ ] **Step 7: Make the per-player `auto` value use the player's tee**

In the Playing Handicaps section's `players.map((p) => { ... })` (lines
276-303), replace the `const auto = ...` line with:

```js
              const pTee = playerTees[p.id];
              const auto = pTee
                ? calcPlayingHandicap(p.handicap, pTee.slope, pTee.rating, totalPar)
                : null;
```

Then replace the returned `<View key={p.id} style={s.hcpRow}>...</View>` with
this complete row (adds a tee-chip picker, keeps one handicap input):

```jsx
                <View key={p.id} style={s.hcpRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.hcpName}>{p.name}</Text>
                    <View style={s.teeChips}>
                      {tees.length === 0 && (
                        <Text style={s.noTeeText}>No tees — add tees above</Text>
                      )}
                      {tees.map((tee) => {
                        const selected = playerTees[p.id]?.label === tee.label;
                        return (
                          <TouchableOpacity
                            key={tee.id ?? tee.label}
                            style={[s.teeChip, selected && s.teeChipActive]}
                            onPress={() => setPlayerTee(p.id, tee)}
                            activeOpacity={0.7}
                          >
                            <Text style={[s.teeChipText, selected && s.teeChipTextActive]}>
                              {tee.label || '—'}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                  <Text style={s.hcpIndex}>Index {p.handicap}</Text>
                  {auto !== null && (
                    <Feather name="arrow-right" size={14} color={theme.text.muted} style={{ marginRight: 8 }} />
                  )}
                  <TextInput
                    style={[s.hcpInput, isDifferent && s.hcpInputOverride]}
                    keyboardType="numeric"
                    maxLength={2}
                    keyboardAppearance={theme.isDark ? 'dark' : 'light'}
                    selectionColor={theme.accent.primary}
                    value={playerHandicaps[p.id] ?? ''}
                    onChangeText={(v) => {
                      setPlayerHandicaps((prev) => ({ ...prev, [p.id]: v }));
                      setManualHandicaps((prev) => ({ ...prev, [p.id]: true }));
                    }}
                  />
                </View>
```

- [ ] **Step 8: Update the `hcpRow` style and add tee-chip styles**

In `makeStyles`, change `hcpRow` and add new styles:

```js
  hcpRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8 },
  teeChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  teeChip: {
    backgroundColor: theme.bg.secondary, borderRadius: 7, borderWidth: 1,
    borderColor: theme.border.default, paddingHorizontal: 9, paddingVertical: 4,
  },
  teeChipActive: { backgroundColor: theme.accent.primary, borderColor: theme.accent.primary },
  teeChipText: { fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary, fontSize: 12 },
  teeChipTextActive: { fontFamily: 'PlusJakartaSans-Bold', color: theme.text.inverse, fontSize: 12 },
  noTeeText: { fontFamily: 'PlusJakartaSans-Regular', color: theme.text.muted, fontSize: 12 },
```

- [ ] **Step 9: Fix the Done button call and remove dead slope locals**

In the Done button `onPress` (around line 385-388), replace:
```js
                try { await updateCourseFromEditor(courseId, slope, courseRating, holes); } catch (_) {}
```
with:
```js
                try { await updateCourseFromEditor(courseId, holes, tees); } catch (_) {}
```

Delete the now-unused `slopeNum`, `ratingNum`, `ratingForCalc` locals
(lines 206-208). Change the Playing Handicaps hint gate from
`{slopeNum > 0 && (` to `{tees.length > 0 && (`.

- [ ] **Step 10: Lint and manual check**

Run: `npm run lint -- src/screens/CourseEditorScreen.js`
Expected: no errors; no remaining references to `slope`, `courseRating`,
`applySlope`, `applyRating`, `slopeNum`.

Manual: `npm run web`, open a tournament setup → Configure holes. Expected:
a Tees editor card; each player row shows tee chips; tapping a chip changes
that player's auto handicap.

- [ ] **Step 11: Commit**

```bash
git add src/screens/CourseEditorScreen.js
git commit -m "feat: tees editor and per-player tee picker in CourseEditor"
```

---

## Task 9: `SetupScreen` — round creation, save handler, route params

**Files:**
- Modify: `src/screens/SetupScreen.js:137-177,447-467`

- [ ] **Step 1: Update round creation to carry tees, not slope**

In the `consumePendingCourses` effect, replace the `roundData` object
(lines 139-148) with:

```js
            const roundData = {
              courseId: course.id,
              courseName: course.name,
              // Deep-copy so later edits in CourseEditor don't mutate the
              // library's in-memory objects.
              holes: course.holes.map((h) => ({ ...h })),
              tees: (course.tees ?? []).map((t) => ({ ...t })),
              playerHandicaps: null,
              playerTees: null,
            };
```

- [ ] **Step 2: Update `handleHolesSaved` to the patch-object form**

Replace `handleHolesSaved` (lines 167-177) with:

```js
  const handleHolesSaved = useCallback((roundIndex, patch) => {
    setRounds((prev) => {
      const next = [...prev];
      next[roundIndex] = {
        ...next[roundIndex],
        holes: patch.holes,
        tees: patch.tees,
        playerHandicaps: patch.playerHandicaps,
        playerTees: patch.playerTees,
        manualHandicaps: { ...(patch.manualHandicaps ?? {}) },
      };
      return next;
    });
  }, []);
```

- [ ] **Step 3: Update the CourseEditor navigation params**

Replace the `navigation.navigate('CourseEditor', { ... })` params (lines
456-467) with:

```jsx
                    navigation.navigate('CourseEditor', {
                      roundIndex: i,
                      courseName: r.courseName || `Round ${i + 1}`,
                      initialHoles: r.holes,
                      initialTees: r.tees ?? [],
                      initialPlayerHandicaps: r.playerHandicaps,
                      initialManualHandicaps: r.manualHandicaps ?? {},
                      initialPlayerTees: r.playerTees ?? {},
                      players: players,
                      onSave: handleHolesSaved,
                      courseId: r.courseId ?? null,
                    })
```

- [ ] **Step 4: Update the course-stat display**

The course stats row shows `SLOPE` (lines 447-450), which no longer exists per
round. Replace that `<View style={s.courseStat}>` block with a tee count:

```jsx
                  <View style={s.courseStat}>
                    <Text style={s.courseStatValue}>{r.tees?.length ?? 0}</Text>
                    <Text style={s.courseStatLabel}>TEES</Text>
                  </View>
```

- [ ] **Step 5: Lint and verify the wizard logic test**

Run: `npm run lint -- src/screens/SetupScreen.js`
Run: `npm test -- setupWizard.test.js`
Expected: lint clean; setupWizard tests still pass (they test course-name
validation, unaffected).

- [ ] **Step 6: Commit**

```bash
git add src/screens/SetupScreen.js
git commit -m "feat: thread tees and playerTees through SetupScreen"
```

---

## Task 10: `EditTournamentScreen` — save handler, route params, derive call

**Files:**
- Modify: `src/screens/EditTournamentScreen.js:176-209,414-432`

- [ ] **Step 1: Update `handleHolesSaved` to the patch-object form**

Replace `handleHolesSaved` (lines 176-192) with:

```js
  const handleHolesSaved = useCallback((roundIndex, patch) => {
    setRounds((prev) => {
      const next = [...prev];
      next[roundIndex] = {
        ...next[roundIndex],
        holes: patch.holes,
        tees: patch.tees,
        // CourseEditor returns numbers; convert to strings for our inputs
        playerHandicaps: Object.fromEntries(
          Object.entries(patch.playerHandicaps).map(([id, v]) => [id, String(v)]),
        ),
        playerTees: patch.playerTees,
        manualHandicaps: { ...(patch.manualHandicaps ?? {}) },
      };
      return next;
    });
  }, []);
```

- [ ] **Step 2: Pass `playerId` to `deriveRoundPlayingHandicap`**

In `updateBaseHandicap` (around line 205), replace:
```js
      const derived = deriveRoundPlayingHandicap(parsedIndex, r);
```
with:
```js
      const derived = deriveRoundPlayingHandicap(parsedIndex, r, playerId);
```

- [ ] **Step 3: Update the CourseEditor navigation params**

Replace the `navigation.navigate('CourseEditor', { ... })` params (lines
415-426) with:

```jsx
                  navigation.navigate('CourseEditor', {
                    roundIndex: ri,
                    courseName: r.courseName,
                    initialHoles: r.holes,
                    initialTees: r.tees ?? [],
                    initialPlayerHandicaps: Object.fromEntries(
                      Object.entries(r.playerHandicaps ?? {}).map(([id, v]) => [id, parseInt(v, 10) || 0]),
                    ),
                    initialManualHandicaps: r.manualHandicaps ?? {},
                    initialPlayerTees: r.playerTees ?? {},
                    players: players.map((p) => ({ ...p, handicap: parseInt(p.handicap, 10) || 0 })),
                    onSave: handleHolesSaved,
                    courseId: r.courseId ?? null,
                  })
```

- [ ] **Step 4: Update the button label**

The button text reads "Edit Holes & Slope" (line 432). Change it to:
```jsx
                  Edit Holes & Tees
```

- [ ] **Step 5: Lint**

Run: `npm run lint -- src/screens/EditTournamentScreen.js`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/screens/EditTournamentScreen.js
git commit -m "feat: thread tees through EditTournamentScreen"
```

---

## Task 11: `CourseLibraryDetailScreen` — TeesEditor instead of slope/rating

**Files:**
- Modify: `src/screens/CourseLibraryDetailScreen.js`

- [ ] **Step 1: Update imports**

Change the libraryStore import (line 10) and add TeesEditor:

```js
import { fetchCourses, updateCourseFromEditor, upsertCourse } from '../store/libraryStore';
import { propagateCourseToTournaments } from '../store/tournamentStore';
import TeesEditor from '../components/TeesEditor';
```

(`saveCourseHoles` is no longer imported — `updateCourseFromEditor` saves both
holes and tees.)

- [ ] **Step 2: Replace slope/rating state with tees state**

Replace the `slope` and `rating` state (lines 23-24) with:

```js
  const [tees, setTees] = useState([]);
```

- [ ] **Step 3: Load tees in the fetch effect**

In the load effect (lines 31-45), replace the `setSlope` / `setRating` lines
(37-38) with:

```js
        setTees((course.tees ?? []).map((t) => ({ ...t })));
```

- [ ] **Step 4: Update `handleSave`**

Replace `handleSave` (lines 51-64) with:

```js
  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await upsertCourse({ id: courseId, name: name.trim(), city, province });
      await updateCourseFromEditor(courseId, holes, tees);
      await propagateCourseToTournaments(courseId, { holes, tees });
      navigation.goBack();
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }
```

- [ ] **Step 5: Replace the slope/rating JSX with `<TeesEditor>`**

Replace the entire `<View style={s.ratingRow}>` block (lines 115-144) with:

```jsx
        <TeesEditor tees={tees} onChange={setTees} theme={theme} />
```

The `ratingRow`, `ratingHalf`, `slopeLabel`, and `slopeInput` styles are now
unused — delete them from `makeStyles` (lines 239-240, 249-255).

- [ ] **Step 6: Lint and manual check**

Run: `npm run lint -- src/screens/CourseLibraryDetailScreen.js`
Expected: no errors, no unused-variable warnings.

Manual: open Courses Library → a course → confirm a Tees editor renders, add
a tee, Save, reopen → tee persists.

- [ ] **Step 7: Commit**

```bash
git add src/screens/CourseLibraryDetailScreen.js
git commit -m "feat: tees editor in CourseLibraryDetailScreen"
```

---

## Task 12: Show each player's tee on the scorecard

**Files:**
- Modify: `src/screens/ScorecardScreen.js`
- Modify: `src/screens/RoundSummaryScreen.js`

A small read-only tee label next to each player. The exact insertion point
depends on each screen's player-row markup — the steps below describe the
change; apply it where each screen renders a player's name/handicap.

- [ ] **Step 1: Find where ScorecardScreen renders a player row**

Run: `grep -n "playerHandicaps\|getPlayingHandicap\|\.name" src/screens/ScorecardScreen.js`
Identify the JSX that renders a player's name + playing handicap (the
per-player header/row), and confirm the `round` object is in scope there.

- [ ] **Step 2: Add a tee label beside the player name in ScorecardScreen**

Where the round and player are in scope, render the tee label next to the
existing name/handicap text:

```jsx
{round.playerTees?.[player.id]?.label ? (
  <Text style={s.teeBadge}>{round.playerTees[player.id].label}</Text>
) : null}
```

Add the `teeBadge` style to that screen's `makeStyles`:

```js
  teeBadge: {
    fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 11,
    color: theme.accent.primary, backgroundColor: theme.accent.light,
    borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
    overflow: 'hidden', marginLeft: 6,
  },
```

- [ ] **Step 3: Repeat for RoundSummaryScreen**

Run: `grep -n "playerHandicaps\|getPlayingHandicap\|\.name" src/screens/RoundSummaryScreen.js`
Apply the same `teeBadge` text + style next to each player's name where the
round object is in scope.

- [ ] **Step 4: Lint and manual check**

Run: `npm run lint -- src/screens/ScorecardScreen.js src/screens/RoundSummaryScreen.js`
Expected: no errors.

Manual: open a round whose players have tees set → each player shows their tee
label; a legacy round with no `playerTees` shows no badge (no crash).

- [ ] **Step 5: Commit**

```bash
git add src/screens/ScorecardScreen.js src/screens/RoundSummaryScreen.js
git commit -m "feat: show each player's tee label on the scorecard"
```

---

## Task 13: Full regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all suites PASS — `tees.test.js`, `scoring.test.js`,
`libraryStore.test.js`, `tournamentStore.test.js`, and every pre-existing
suite.

- [ ] **Step 2: Run the linter across the repo**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 3: Manual end-to-end smoke test**

Run: `npm run web`. Verify:
1. Create a tournament, pick a course, Configure holes → add 2-3 tees with
   distinct ratings/slopes.
2. Assign two players to different tees → their auto playing handicaps differ.
3. Save, enter scores, open the leaderboard → Stableford totals reflect the
   different handicaps.
4. Open an existing (pre-feature) tournament → it still loads and scores
   correctly using the legacy `slope`/`courseRating` fallback.
5. Edit a course in the Courses Library (change a tee's slope) → reopen an
   affected round → that tee's players' handicaps updated.

- [ ] **Step 4: Commit any fixes**

If the smoke test surfaced issues, fix them with focused commits referencing
the task they belong to.

---

## Self-review notes

- **Spec coverage:** data model (Tasks 1, 4, 5), scoring (Task 2), DB +
  migration (Task 3), libraryStore (Task 4), propagation + pre-fill (Task 5),
  UI editor + picker (Tasks 7, 8, 11), round wiring (Tasks 9, 10), scorecard
  display (Task 12). Yardage UI is an explicit Non-Goal; the column exists.
- **Snapshot shape** is `{ label, slope, rating }` everywhere — Tasks 2, 5, 8,
  9, 10, 12 all read/write that exact shape.
- **`onSave` patch object** `{ holes, tees, playerHandicaps, manualHandicaps,
  playerTees }` is emitted in Task 8 and consumed identically in Tasks 9, 10.
- **`updateCourseFromEditor(courseId, holes, tees)`** signature is defined in
  Task 4 and called with that signature in Tasks 8 and 11.
- **`propagateCourseToTournaments(courseId, { holes, tees })`** is defined in
  Task 5 and called with that signature in Task 11.
```
