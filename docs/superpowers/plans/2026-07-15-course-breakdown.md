# Course Analysis Drill-Down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the Course Mastery card in MyStats, open a per-course detail screen showing the user's summary stats, shot stats, and a hole-by-hole breakdown (incl. best score, putts, penalties) for that course.

**Architecture:** A new pure store module `courseBreakdown.js` filters the user's rounds (from `collectMyRounds`) to one course, builds a synthetic single-course tournament with the existing `buildSyntheticTournament`, and reuses statsEngine functions (`courseMastery`, `courseDNA`, `playerScoreDistribution`, `frontBackSplit`, `shotStats`) plus one new hole-pooling computation. A new `CourseStatsScreen` renders it; Course Mastery rows navigate to it via a new `courseKey` field threaded through `courseDNA`/`courseMastery`.

**Tech Stack:** Expo SDK 54 / React Native 0.81 / React 19, plain JavaScript (NO TypeScript annotations), Jest via jest-expo, @testing-library/react-native for components.

**Spec:** `docs/superpowers/specs/2026-07-15-course-breakdown-design.md`

## Global Constraints

- Plain JS only — no TS syntax anywhere.
- Domain logic lives in `src/store/`, UI in `src/screens/` / `src/components/` (CLAUDE.md).
- All store functions must be pure (no async, no storage access) — the screen does the loading.
- Run tests file-scoped: `npm test -- src/store/__tests__/courseBreakdown.test.js`. Never bare `npm test` mid-task (repo jest config may scan nested worktree copies; full suite only in the final task from the main checkout).
- ESLint must stay clean: `npm run lint` (CI-blocking).
- Commit after every task with a conventional-commit message.
- No hardcoded 18-hole assumptions in new code.

---

### Task 1: `courseKey` on courseDNA and courseMastery rows

**Files:**
- Modify: `src/store/statsEngine.js:894` (courseDNA accumulator)
- Modify: `src/store/personalStats.js:605-611` (courseMastery return)
- Test: `src/store/__tests__/statsEngine.test.js`
- Test: `src/store/__tests__/personalStats.test.js`

**Interfaces:**
- Produces: every course row returned by `courseDNA(tournament)` and `courseMastery(synthetic)` gains `courseKey` — `round.courseId` when present, else the raw non-empty `round.courseName`, else `null` (unnamed ad-hoc rounds are not navigable as a course). Task 2 (`filterRoundsToCourse`) and Task 6 (tappable rows) rely on this exact semantics.

- [ ] **Step 1: Write the failing tests**

In `src/store/__tests__/statsEngine.test.js`, inside (or next to) the existing `courseDNA` describe block, add:

```js
test('courseDNA rows carry courseKey: courseId first, courseName fallback, null when unnamed', () => {
  const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
  const scores = {};
  holes.forEach((h) => { scores[h.number] = 5; });
  const t = {
    players: [{ id: 'p1', name: 'Me', handicap: 0 }],
    rounds: [
      { courseId: 'c-9', courseName: 'Pine Valley', holes, scores: { p1: scores } },
      { courseName: 'Oak Ridge', holes, scores: { p1: scores } },
      { holes, scores: { p1: scores } }, // unnamed ad-hoc round
    ],
  };
  const courses = courseDNA(t)[0].courses;
  const byName = Object.fromEntries(courses.map((c) => [c.courseName, c.courseKey]));
  expect(byName['Pine Valley']).toBe('c-9');
  expect(byName['Oak Ridge']).toBe('Oak Ridge');
  expect(byName['R3']).toBeNull();
});
```

In `src/store/__tests__/personalStats.test.js`, inside the existing `describe('courseMastery')` (line ~1224), add:

```js
test('passes courseKey through from courseDNA', () => {
  const h = holes18();
  const tournaments = [{
    id: 1, name: 'T',
    players: [{ id: 'p1', name: 'Me', handicap: 0, user_id: 'u1' }],
    rounds: [
      { courseId: 'c-1', courseName: 'Pine', holes: h, scores: { p1: evenScores(h, 5) }, shotDetails: {}, playerHandicaps: {} },
    ],
  }];
  const synthetic = buildSyntheticTournament(collectMyRounds(tournaments, 'u1'));
  expect(courseMastery(synthetic)[0].courseKey).toBe('c-1');
});
```

(Reuse that file's existing `holes18()` / `evenScores()` fixture helpers — they are defined at the top of the file.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/store/__tests__/statsEngine.test.js src/store/__tests__/personalStats.test.js -t courseKey`
Expected: both new tests FAIL (`courseKey` is `undefined`).

- [ ] **Step 3: Implement**

In `src/store/statsEngine.js` (courseDNA, line ~894), change the accumulator initializer:

```js
const cur = perPlayer[player.id].courses[key] || {
  // Navigable identity for drill-down screens: a real courseId, else a real
  // (non-empty) courseName, else null — the R{n} display fallback is an
  // index-dependent label, not an identity a screen can re-derive later.
  courseKey: round.courseId ?? (round.courseName || null),
  courseName: label, points: 0, strokes: 0, holesPlayed: 0, rounds: 0, roundTotals: [],
};
```

In `src/store/personalStats.js` (courseMastery return, line ~605), add the field:

```js
    return {
      courseKey: c.courseKey,
      courseName: c.courseName,
      rounds: c.rounds,
      avgPoints: c.roundPoints,
      bestPoints,
      trend,
    };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/store/__tests__/statsEngine.test.js src/store/__tests__/personalStats.test.js`
Expected: PASS. If a snapshot in `src/store/__tests__/__snapshots__/` fails **only** by the added `courseKey` field, update with `npm test -- src/store/__tests__/personalStats.test.js -u` and inspect the snapshot diff before committing. Any other diff is a bug — stop and fix.

- [ ] **Step 5: Commit**

```bash
git add src/store/statsEngine.js src/store/personalStats.js src/store/__tests__/statsEngine.test.js src/store/__tests__/personalStats.test.js src/store/__tests__/__snapshots__
git commit -m "feat(stats): expose courseKey on courseDNA/courseMastery rows"
```

---

### Task 2: `courseBreakdown.js` — filtering, summary, score mix, front/back, shots

**Files:**
- Create: `src/store/courseBreakdown.js`
- Test: `src/store/__tests__/courseBreakdown.test.js`

**Interfaces:**
- Consumes: `courseMastery` rows' `courseKey` (Task 1); `collectMyRounds` entries (`{ key, round, courseName, playerId, player, completed, isComplete, holesPlayed, points }`); `buildSyntheticTournament(myRounds)`, `CANON_ID` from `./personalStats`; `shotStats`, `playerScoreDistribution`, `frontBackSplit`, `courseDNA` from `./statsEngine`.
- Produces (Tasks 3–5 rely on these exact names):
  - `roundCourseKey(mr)` → `string | null`
  - `filterRoundsToCourse(myRounds, courseKey)` → `collectMyRounds`-shaped array
  - `buildCourseBreakdown(courseRounds)` → `null` when `courseRounds` is empty, else `{ courseName, summary, shots, holes, highlights }` where
    - `summary = { rounds, avgPoints, bestPoints, trend, avgStrokes, holesPlayed, scoreMix: { eagles, birdies, pars, bogeys, doubles, worse, total }, frontBack: { frontAvg, backAvg, delta, rounds } | null }`
    - `shots` = the `shotStats` object, or `null` when `hasData` is false
    - `holes` / `highlights` = `[]` / `null` until Task 3 implements them.

- [ ] **Step 1: Write the failing tests**

Create `src/store/__tests__/courseBreakdown.test.js`:

```js
import { collectMyRounds } from '../personalStats';
import {
  roundCourseKey, filterRoundsToCourse, buildCourseBreakdown,
} from '../courseBreakdown';

// ── Fixture helpers (same conventions as personalStats.test.js) ──
// par 4 everywhere, SI = hole number, handicap 0 → strokes 5 = 1 pt, 4 = 2 pts.
function mkHoles(n) {
  return Array.from({ length: n }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
}
function evenScores(holes, strokes) {
  const o = {};
  holes.forEach((h) => { o[h.number] = strokes; });
  return o;
}
function mkRound({ courseId, courseName = 'Pine', holes = mkHoles(18), scores, shotDetails = {} }) {
  return { courseId, courseName, holes, scores, shotDetails, playerHandicaps: {} };
}
function myRoundsFor(rounds) {
  const t = {
    id: 1, name: 'T',
    players: [{ id: 'p1', name: 'Me', handicap: 0, user_id: 'u1' }],
    rounds,
  };
  return collectMyRounds([t], 'u1');
}

describe('roundCourseKey / filterRoundsToCourse', () => {
  test('keys by courseId first, so a rename does not split the course', () => {
    const h = mkHoles(18);
    const rounds = myRoundsFor([
      mkRound({ courseId: 'c-1', courseName: 'Pine', scores: { p1: evenScores(h, 5) } }),
      mkRound({ courseId: 'c-1', courseName: 'Pine Valley GC', scores: { p1: evenScores(h, 4) } }),
      mkRound({ courseId: 'c-2', courseName: 'Oak', scores: { p1: evenScores(h, 5) } }),
    ]);
    expect(filterRoundsToCourse(rounds, 'c-1')).toHaveLength(2);
    expect(filterRoundsToCourse(rounds, 'c-2')).toHaveLength(1);
  });

  test('falls back to courseName for library-less courses; null key matches nothing', () => {
    const h = mkHoles(18);
    const rounds = myRoundsFor([
      mkRound({ courseName: 'Oak', scores: { p1: evenScores(h, 5) } }),
      { holes: h, scores: { p1: evenScores(h, 5) }, shotDetails: {}, playerHandicaps: {} }, // unnamed
    ]);
    expect(roundCourseKey(rounds[0])).toBe('Oak');
    expect(roundCourseKey(rounds[1])).toBeNull();
    expect(filterRoundsToCourse(rounds, 'Oak')).toHaveLength(1);
    expect(filterRoundsToCourse(rounds, null)).toHaveLength(0);
  });
});

describe('buildCourseBreakdown summary', () => {
  test('returns null for an empty course', () => {
    expect(buildCourseBreakdown([])).toBeNull();
    expect(buildCourseBreakdown(null)).toBeNull();
  });

  test('round-total metrics come from complete rounds and match courseMastery scale', () => {
    const h = mkHoles(18);
    const rounds = myRoundsFor([
      mkRound({ courseId: 'c-1', scores: { p1: evenScores(h, 5) } }), // 18 pts, 90 strokes
      mkRound({ courseId: 'c-1', scores: { p1: evenScores(h, 4) } }), // 36 pts, 72 strokes
    ]);
    const b = buildCourseBreakdown(filterRoundsToCourse(rounds, 'c-1'));
    expect(b.summary.rounds).toBe(2);
    expect(b.summary.avgPoints).toBe(27);      // (18+36)/2, courseMastery's roundPoints
    expect(b.summary.bestPoints).toBe(36);
    expect(b.summary.trend).toBe(1);           // 36 vs 18, above the ±2 noise band
    expect(b.summary.avgStrokes).toBe(81);     // (90+72)/2
    expect(b.summary.holesPlayed).toBe(36);
  });

  test('a partial round contributes holes but not round-total metrics', () => {
    const h = mkHoles(18);
    const partial = evenScores(h, 5);
    delete partial[18];
    const rounds = myRoundsFor([
      mkRound({ courseId: 'c-1', scores: { p1: evenScores(h, 5) } }),
      mkRound({ courseId: 'c-1', scores: { p1: partial } }),
    ]);
    const b = buildCourseBreakdown(filterRoundsToCourse(rounds, 'c-1'));
    expect(b.summary.rounds).toBe(1);           // only the complete round
    expect(b.summary.holesPlayed).toBe(35);     // but every scored hole counts
    expect(b.summary.scoreMix.total).toBe(35);
  });

  test('courseName is the most recent label; score mix and front/back populate', () => {
    const h = mkHoles(18);
    const rounds = myRoundsFor([
      mkRound({ courseId: 'c-1', courseName: 'Pine', scores: { p1: evenScores(h, 4) } }),
      mkRound({ courseId: 'c-1', courseName: 'Pine Valley GC', scores: { p1: evenScores(h, 5) } }),
    ]);
    const b = buildCourseBreakdown(filterRoundsToCourse(rounds, 'c-1'));
    expect(b.courseName).toBe('Pine Valley GC');
    expect(b.summary.scoreMix).toMatchObject({ pars: 18, bogeys: 18, total: 36 });
    expect(b.summary.frontBack).toMatchObject({ frontAvg: 1.5, backAvg: 1.5, rounds: 2 });
  });

  test('frontBack is null for a 9-hole course', () => {
    const h = mkHoles(9);
    const rounds = myRoundsFor([
      mkRound({ courseId: 'c-9', holes: h, scores: { p1: evenScores(h, 5) } }),
    ]);
    const b = buildCourseBreakdown(filterRoundsToCourse(rounds, 'c-9'));
    expect(b.summary.frontBack).toBeNull();
    expect(b.summary.rounds).toBe(1);
  });

  test('shots is null without shot detail, populated when logged', () => {
    const h = mkHoles(18);
    const noDetail = myRoundsFor([
      mkRound({ courseId: 'c-1', scores: { p1: evenScores(h, 5) } }),
    ]);
    expect(buildCourseBreakdown(filterRoundsToCourse(noDetail, 'c-1')).shots).toBeNull();

    const detail = {};
    h.forEach((hole) => { detail[hole.number] = { putts: 2, drive: 'fairway' }; });
    const withDetail = myRoundsFor([
      mkRound({ courseId: 'c-1', scores: { p1: evenScores(h, 5) }, shotDetails: { p1: detail } }),
    ]);
    const b = buildCourseBreakdown(filterRoundsToCourse(withDetail, 'c-1'));
    expect(b.shots.hasData).toBe(true);
    expect(b.shots.putts.perRound).toBe(36);
    expect(b.shots.drives.fairwayPct).toBe(100);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/store/__tests__/courseBreakdown.test.js`
Expected: FAIL — `Cannot find module '../courseBreakdown'`.

- [ ] **Step 3: Implement `src/store/courseBreakdown.js`**

```js
// Per-course drill-down statistics for the CourseStats screen.
//
// Pure module: the screen does the async loading (tournaments → collectMyRounds
// → filterRoundsToCourse); this module only transforms. It reuses the
// statsEngine per-player functions via a synthetic single-course tournament so
// every number here agrees with MyStats (courseMastery scale, shotStats
// semantics). See docs/superpowers/specs/2026-07-15-course-breakdown-design.md
import {
  buildSyntheticTournament, courseMastery, CANON_ID,
} from './personalStats';
import {
  shotStats, playerScoreDistribution, frontBackSplit, courseDNA,
} from './statsEngine';
import { getPlayingHandicap, calcStablefordPoints } from './tournamentStore';

// Navigable identity of a collectMyRounds entry — courseId when the round has
// one, else the raw (non-empty) courseName, else null. Must match the
// `courseKey` field courseDNA emits, or the drill-down would show a different
// set of rounds than the Course Mastery row that opened it.
export function roundCourseKey(mr) {
  return mr?.round?.courseId ?? (mr?.round?.courseName || null);
}

export function filterRoundsToCourse(myRounds, courseKey) {
  if (courseKey == null) return [];
  return (myRounds || []).filter((mr) => roundCourseKey(mr) === courseKey);
}

// courseRounds: collectMyRounds entries already filtered to one course
// (chronological, oldest first). Returns null when there is nothing to show.
export function buildCourseBreakdown(courseRounds) {
  if (!courseRounds || courseRounds.length === 0) return null;
  const synthetic = buildSyntheticTournament(courseRounds);

  // Round-total metrics share courseMastery/courseDNA exactly (complete
  // rounds only) — reusing them instead of re-deriving keeps the drill-down
  // header identical to the Course Mastery row the user just tapped.
  const mastery = courseMastery(synthetic)[0] ?? null;
  const completeRounds = synthetic.rounds.filter((r) => r.isComplete);
  const dnaCourse = completeRounds.length > 0
    ? (courseDNA({ ...synthetic, rounds: completeRounds })[0]?.courses[0] ?? null)
    : null;

  const dist = playerScoreDistribution(synthetic, CANON_ID);
  const fb = frontBackSplit(synthetic)[0] ?? null;
  const shots = shotStats(synthetic, CANON_ID);
  const holes = buildHoleRows(synthetic);

  return {
    // Latest label wins — same convention as courseDNA's display name.
    courseName: courseRounds[courseRounds.length - 1].courseName,
    summary: {
      rounds: mastery?.rounds ?? 0,
      avgPoints: mastery?.avgPoints ?? null,
      bestPoints: mastery?.bestPoints ?? null,
      trend: mastery?.trend ?? null,
      avgStrokes: dnaCourse?.roundStrokes ?? null,
      holesPlayed: courseRounds.reduce((s, r) => s + (r.holesPlayed ?? 0), 0),
      scoreMix: {
        eagles: dist.eagles, birdies: dist.birdies, pars: dist.pars,
        bogeys: dist.bogeys, doubles: dist.doubles, worse: dist.worse,
        total: dist.total,
      },
      frontBack: fb
        ? { frontAvg: fb.frontAvg, backAvg: fb.backAvg, delta: fb.delta, rounds: fb.rounds.length }
        : null,
    },
    shots: shots.hasData ? shots : null,
    holes,
    highlights: buildHighlights(holes),
  };
}

// Implemented in the next task.
function buildHoleRows() {
  return [];
}
function buildHighlights() {
  return null;
}
```

(The two stubs keep this task shippable; Task 3 replaces them. The unused
`getPlayingHandicap` / `calcStablefordPoints` imports belong to Task 3 — if
lint flags them now, add them in Task 3 instead.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/store/__tests__/courseBreakdown.test.js`
Expected: PASS (all Task 2 tests).

- [ ] **Step 5: Lint and commit**

Run: `npm run lint`
Expected: no new errors.

```bash
git add src/store/courseBreakdown.js src/store/__tests__/courseBreakdown.test.js
git commit -m "feat(stats): course breakdown store module — summary, score mix, shots"
```

---

### Task 3: `courseBreakdown.js` — hole-by-hole rows and highlights

**Files:**
- Modify: `src/store/courseBreakdown.js` (replace the `buildHoleRows` / `buildHighlights` stubs)
- Test: `src/store/__tests__/courseBreakdown.test.js` (append)

**Interfaces:**
- Produces (Task 4's `HoleBreakdownTable` and Task 5's screen rely on these exact names):
  - `breakdown.holes`: array of `{ holeNumber, par, strokeIndex, timesPlayed, avgStrokes, avgVsPar, avgPoints, bestStrokes, avgPutts, penalties }` — `avgStrokes`/`avgVsPar`/`avgPoints` rounded to 2 dp, `avgPutts` 1 dp or `null` when never logged, `penalties` integer count.
  - `breakdown.highlights`: `{ nemesis, best }` (each a hole row) or `null`.

- [ ] **Step 1: Write the failing tests**

Append to `src/store/__tests__/courseBreakdown.test.js`:

```js
describe('buildCourseBreakdown holes', () => {
  test('pools each hole across rounds: averages, best score, latest-wins metadata', () => {
    const h1 = mkHoles(18);
    // Second visit: hole 1 re-labelled par 5, SI unchanged.
    const h2 = mkHoles(18).map((h) => (h.number === 1 ? { ...h, par: 5 } : h));
    const s1 = evenScores(h1, 5); // hole 1: 5 (+1 on par 4)
    const s2 = evenScores(h2, 4); // hole 1: 4 (-1 on par 5)
    const rounds = myRoundsFor([
      mkRound({ courseId: 'c-1', holes: h1, scores: { p1: s1 } }),
      mkRound({ courseId: 'c-1', holes: h2, scores: { p1: s2 } }),
    ]);
    const { holes } = buildCourseBreakdown(filterRoundsToCourse(rounds, 'c-1'));
    expect(holes).toHaveLength(18);
    const hole1 = holes[0];
    expect(hole1).toMatchObject({
      holeNumber: 1,
      par: 5,               // latest round's metadata wins
      strokeIndex: 1,
      timesPlayed: 2,
      avgStrokes: 4.5,
      avgVsPar: 0,          // (+1 + -1) / 2
      bestStrokes: 4,
    });
    // hole 2 (par 4 both rounds): 5 then 4 → avgVsPar +0.5, points (1+2)/2
    expect(holes[1]).toMatchObject({ avgVsPar: 0.5, avgPoints: 1.5, bestStrokes: 4 });
  });

  test('partial rounds contribute only their scored holes', () => {
    const h = mkHoles(18);
    const partial = evenScores(h, 6);
    delete partial[18];
    const rounds = myRoundsFor([
      mkRound({ courseId: 'c-1', scores: { p1: evenScores(h, 4) } }),
      mkRound({ courseId: 'c-1', scores: { p1: partial } }),
    ]);
    const { holes } = buildCourseBreakdown(filterRoundsToCourse(rounds, 'c-1'));
    expect(holes[0].timesPlayed).toBe(2);
    expect(holes[17].timesPlayed).toBe(1);   // hole 18 unscored in round 2
    expect(holes[17].avgStrokes).toBe(4);
  });

  test('per-hole putts average and penalty totals; null putts when never logged', () => {
    const h = mkHoles(18);
    const d1 = { 1: { putts: 3, teePenalties: 1 }, 2: { putts: 2 } };
    const d2 = { 1: { putts: 1, otherPenalties: 1 } };
    const rounds = myRoundsFor([
      mkRound({ courseId: 'c-1', scores: { p1: evenScores(h, 5) }, shotDetails: { p1: d1 } }),
      mkRound({ courseId: 'c-1', scores: { p1: evenScores(h, 5) }, shotDetails: { p1: d2 } }),
    ]);
    const { holes } = buildCourseBreakdown(filterRoundsToCourse(rounds, 'c-1'));
    expect(holes[0].avgPutts).toBe(2);       // (3+1)/2
    expect(holes[0].penalties).toBe(2);      // 1 tee + 1 other
    expect(holes[1].avgPutts).toBe(2);       // logged once
    expect(holes[2].avgPutts).toBeNull();
    expect(holes[2].penalties).toBe(0);
  });

  test('9-hole course produces 9 rows', () => {
    const h = mkHoles(9);
    const rounds = myRoundsFor([
      mkRound({ courseId: 'c-9', holes: h, scores: { p1: evenScores(h, 5) } }),
    ]);
    expect(buildCourseBreakdown(filterRoundsToCourse(rounds, 'c-9')).holes).toHaveLength(9);
  });
});

describe('buildCourseBreakdown highlights', () => {
  test('nemesis is the worst pooled hole, best the lowest, needing 2+ rounds per hole', () => {
    const h = mkHoles(18);
    const bad = evenScores(h, 5);
    bad[7] = 8;   // hole 7 blows up both rounds
    const good = evenScores(h, 5);
    good[7] = 8;
    good[3] = 3;  // hole 3 shines once
    const rounds = myRoundsFor([
      mkRound({ courseId: 'c-1', scores: { p1: bad } }),
      mkRound({ courseId: 'c-1', scores: { p1: good } }),
    ]);
    const { highlights } = buildCourseBreakdown(filterRoundsToCourse(rounds, 'c-1'));
    expect(highlights.nemesis.holeNumber).toBe(7);
    expect(highlights.best.holeNumber).toBe(3);
  });

  test('a single-round course makes no highlight claim', () => {
    const h = mkHoles(18);
    const rounds = myRoundsFor([
      mkRound({ courseId: 'c-1', scores: { p1: evenScores(h, 5) } }),
    ]);
    expect(buildCourseBreakdown(filterRoundsToCourse(rounds, 'c-1')).highlights).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/store/__tests__/courseBreakdown.test.js`
Expected: the new `holes` / `highlights` tests FAIL (stubs return `[]` / `null`); Task 2 tests still PASS.

- [ ] **Step 3: Replace the stubs in `src/store/courseBreakdown.js`**

```js
const round2 = (n) => Math.round(n * 100) / 100;
const round1 = (n) => Math.round(n * 10) / 10;

// One row per physical hole, pooled by hole number across every round that
// scored it (courseDNA's partial-rounds-count-their-holes rule). Chronological
// iteration makes par/SI metadata and row order latest-wins.
function buildHoleRows(synthetic) {
  const me = synthetic.players[0];
  const byNumber = new Map();
  let latestOrder = [];

  synthetic.rounds.forEach((round) => {
    const scores = round.scores?.[CANON_ID];
    if (!scores) return;
    const handicap = getPlayingHandicap(round, me);
    (round.holes ?? []).forEach((hole) => {
      const sc = scores[hole.number];
      if (sc == null) return;
      let e = byNumber.get(hole.number);
      if (!e) {
        e = {
          holeNumber: hole.number, timesPlayed: 0, strokesSum: 0, vsParSum: 0,
          pointsSum: 0, bestStrokes: Infinity, puttsSum: 0, puttsCount: 0, penalties: 0,
        };
        byNumber.set(hole.number, e);
      }
      e.par = hole.par;
      e.strokeIndex = hole.strokeIndex ?? null;
      e.timesPlayed += 1;
      e.strokesSum += sc;
      e.vsParSum += sc - hole.par;
      e.pointsSum += calcStablefordPoints(hole.par, sc, handicap, hole.strokeIndex);
      if (sc < e.bestStrokes) e.bestStrokes = sc;
      const d = round.shotDetails?.[CANON_ID]?.[hole.number];
      if (d?.putts != null) { e.puttsSum += d.putts; e.puttsCount += 1; }
      e.penalties += (d?.teePenalties ?? 0) + (d?.otherPenalties ?? 0);
    });
    if (round.holes?.length) latestOrder = round.holes.map((h) => h.number);
  });

  // Latest round's hole order first; holes that only exist in older rounds
  // (course edited/renumbered) append in number order.
  const ordered = [];
  const seen = new Set();
  latestOrder.forEach((n) => {
    const e = byNumber.get(n);
    if (e) { ordered.push(e); seen.add(n); }
  });
  [...byNumber.keys()].filter((n) => !seen.has(n)).sort((a, b) => a - b)
    .forEach((n) => ordered.push(byNumber.get(n)));

  return ordered.map((e) => ({
    holeNumber: e.holeNumber,
    par: e.par,
    strokeIndex: e.strokeIndex,
    timesPlayed: e.timesPlayed,
    avgStrokes: round2(e.strokesSum / e.timesPlayed),
    avgVsPar: round2(e.vsParSum / e.timesPlayed),
    avgPoints: round2(e.pointsSum / e.timesPlayed),
    bestStrokes: e.bestStrokes,
    avgPutts: e.puttsCount > 0 ? round1(e.puttsSum / e.puttsCount) : null,
    penalties: e.penalties,
  }));
}

// Nemesis/best claims need at least 2 observations of a hole (one bad day is
// noise, not a nemesis) and at least 2 distinct eligible holes — with one,
// "nemesis" and "best" would be the same row.
const HIGHLIGHT_MIN_ROUNDS = 2;

function buildHighlights(holes) {
  const eligible = holes.filter((h) => h.timesPlayed >= HIGHLIGHT_MIN_ROUNDS);
  if (eligible.length < 2) return null;
  const nemesis = eligible.reduce((m, h) => (h.avgVsPar > m.avgVsPar ? h : m));
  const best = eligible.reduce((m, h) => (h.avgVsPar < m.avgVsPar ? h : m));
  if (nemesis === best) return null;
  return { nemesis, best };
}
```

Delete the two placeholder stub functions from Task 2. Ensure the imports
`getPlayingHandicap, calcStablefordPoints` from `./tournamentStore` are present.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/store/__tests__/courseBreakdown.test.js`
Expected: PASS (all Task 2 + Task 3 tests).

- [ ] **Step 5: Lint and commit**

Run: `npm run lint`

```bash
git add src/store/courseBreakdown.js src/store/__tests__/courseBreakdown.test.js
git commit -m "feat(stats): per-hole pooling and nemesis/best highlights for course breakdown"
```

---

### Task 4: `HoleBreakdownTable` component

**Files:**
- Create: `src/components/mystats/HoleBreakdownTable.js`
- Test: `src/components/mystats/__tests__/HoleBreakdownTable.test.js`

**Interfaces:**
- Consumes: `holes` rows from Task 3 (`{ holeNumber, par, strokeIndex, timesPlayed, avgStrokes, avgVsPar, avgPoints, bestStrokes, avgPutts, penalties }`).
- Produces: `export default function HoleBreakdownTable({ holes })` — renders `null` for empty input. Task 5's screen imports it.

- [ ] **Step 1: Write the failing test**

Create `src/components/mystats/__tests__/HoleBreakdownTable.test.js`:

```js
import React from 'react';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import HoleBreakdownTable from '../HoleBreakdownTable';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => new Promise(() => {})),
  setItem: jest.fn(),
}));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const hole = (over = {}) => ({
  holeNumber: 1, par: 4, strokeIndex: 7, timesPlayed: 3,
  avgStrokes: 5.33, avgVsPar: 1.33, avgPoints: 0.67, bestStrokes: 4,
  avgPutts: null, penalties: 0,
  ...over,
});

describe('HoleBreakdownTable', () => {
  test('renders a row per hole with par/SI, averages and best score', () => {
    const { getByText } = render(wrap(
      <HoleBreakdownTable holes={[
        hole(),
        // Distinct values on hole 2 — getByText throws on duplicate matches.
        hole({
          holeNumber: 2, strokeIndex: 3, avgStrokes: 3.8, avgVsPar: -0.2,
          avgPoints: 2.2, bestStrokes: 3,
        }),
      ]} />
    ));
    expect(getByText('Par 4 · SI 7 · 3x')).toBeTruthy();
    expect(getByText('Par 4 · SI 3 · 3x')).toBeTruthy();
    expect(getByText('+1.33')).toBeTruthy();  // hole 1 signed vs par
    expect(getByText('-0.2')).toBeTruthy();   // hole 2 signed vs par
    expect(getByText('3')).toBeTruthy();      // best score on hole 2
  });

  test('shows putts/penalty detail only when logged', () => {
    const { getByText, queryByText } = render(wrap(
      <HoleBreakdownTable holes={[hole({ avgPutts: 2.5, penalties: 2 })]} />
    ));
    expect(getByText('2.5 putts avg · 2 pen')).toBeTruthy();
    expect(queryByText('null putts avg')).toBeNull();
  });

  test('renders nothing for empty input', () => {
    const { toJSON } = render(wrap(<HoleBreakdownTable holes={[]} />));
    expect(toJSON()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/mystats/__tests__/HoleBreakdownTable.test.js`
Expected: FAIL — `Cannot find module '../HoleBreakdownTable'`.

- [ ] **Step 3: Implement `src/components/mystats/HoleBreakdownTable.js`**

```js
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { toneColor } from './metricTone';

// Hole-by-hole rows for one course — see buildCourseBreakdown().holes in
// store/courseBreakdown.js. Renders nothing when there are no rows.
export default function HoleBreakdownTable({ holes }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  if (!holes || holes.length === 0) return null;

  return (
    <View style={s.table}>
      <View style={s.headRow}>
        <Text style={[s.headCell, s.holeCol]}>Hole</Text>
        <Text style={[s.headCell, s.numCol]}>Avg</Text>
        <Text style={[s.headCell, s.numCol]}>Best</Text>
        <Text style={[s.headCell, s.numCol]}>Pts</Text>
      </View>
      {holes.map((h) => <HoleRow key={h.holeNumber} hole={h} s={s} theme={theme} />)}
    </View>
  );
}

function HoleRow({ hole, s, theme }) {
  // Under par on average is genuinely good; more than half a stroke over is
  // where a hole starts costing real points.
  const tone = hole.avgVsPar < 0 ? 'good' : hole.avgVsPar > 0.5 ? 'bad' : 'neutral';
  const vsPar = hole.avgVsPar > 0 ? `+${hole.avgVsPar}` : `${hole.avgVsPar}`;
  const detail = [
    hole.avgPutts != null ? `${hole.avgPutts} putts avg` : null,
    hole.penalties > 0 ? `${hole.penalties} pen` : null,
  ].filter(Boolean).join(' · ');

  return (
    <View
      style={s.row}
      accessible
      accessibilityLabel={
        `Hole ${hole.holeNumber}, par ${hole.par}, average ${hole.avgStrokes} strokes, best ${hole.bestStrokes}`
      }
    >
      <View style={s.holeCol}>
        <Text style={s.holeNum}>{hole.holeNumber}</Text>
        <Text style={s.holeMeta}>
          {`Par ${hole.par}${hole.strokeIndex != null ? ` · SI ${hole.strokeIndex}` : ''} · ${hole.timesPlayed}x`}
        </Text>
        {detail ? <Text style={s.holeMeta}>{detail}</Text> : null}
      </View>
      <View style={s.numCol}>
        <Text style={[s.num, { color: toneColor(theme, tone) }]}>{hole.avgStrokes}</Text>
        <Text style={s.numMeta}>{vsPar}</Text>
      </View>
      <View style={s.numCol}>
        <Text style={s.num}>{hole.bestStrokes}</Text>
      </View>
      <View style={s.numCol}>
        <Text style={s.num}>{hole.avgPoints}</Text>
      </View>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    table: { gap: 4 },
    headRow: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: theme.spacing.sm, paddingBottom: 2,
    },
    headCell: {
      ...theme.typography.tiny, color: theme.text.muted,
      fontWeight: '700', textTransform: 'uppercase',
    },
    row: {
      flexDirection: 'row', alignItems: 'center',
      paddingVertical: theme.spacing.sm, paddingHorizontal: theme.spacing.sm,
      borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
      borderRadius: theme.radius.md, backgroundColor: theme.bg.card,
    },
    holeCol: { flex: 1, minWidth: 0, gap: 1 },
    numCol: { width: 52, alignItems: 'center' },
    holeNum: { ...theme.typography.body, color: theme.text.primary, fontWeight: '800' },
    holeMeta: { ...theme.typography.caption, color: theme.text.secondary },
    num: { ...theme.typography.body, color: theme.text.primary, fontWeight: '800' },
    numMeta: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '700' },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/mystats/__tests__/HoleBreakdownTable.test.js`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

Run: `npm run lint`

```bash
git add src/components/mystats/HoleBreakdownTable.js src/components/mystats/__tests__/HoleBreakdownTable.test.js
git commit -m "feat(mystats): hole breakdown table component"
```

---

### Task 5: `CourseStatsScreen` + navigation registration

**Files:**
- Create: `src/screens/CourseStatsScreen.js`
- Modify: `App.js` (import block ~line 56; add a `Stack.Screen` next to the existing `MyStats` registration at ~line 230)

**Interfaces:**
- Consumes: `filterRoundsToCourse` / `buildCourseBreakdown` (Tasks 2–3), `HoleBreakdownTable` (Task 4), route params `{ courseKey, courseName }`.
- Produces: stack route named `CourseStats` — Task 6 navigates to it.

- [ ] **Step 1: Implement `src/screens/CourseStatsScreen.js`**

(No unit test for the screen — screens in this repo are not unit-tested; runtime verification happens in Task 6 Step 4. Model everything on MyStatsScreen's load/error/empty pattern.)

```js
import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScreenContainer from '../components/ScreenContainer';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { loadAllTournamentsWithFallback } from '../store/tournamentStore';
import { loadProfile } from '../store/profileStore';
import { collectMyRounds } from '../store/personalStats';
import { filterRoundsToCourse, buildCourseBreakdown } from '../store/courseBreakdown';
import SectionCard from '../components/mystats/SectionCard';
import StatTile from '../components/mystats/StatTile';
import DistributionBars from '../components/mystats/DistributionBars';
import HoleBreakdownTable from '../components/mystats/HoleBreakdownTable';
import { toneColor, toneFill } from '../components/mystats/metricTone';
import { DRIVE_ORDER } from '../components/mystats/shotMetrics';

// Short bar labels — the long DRIVE_LABELS copy doesn't fit under a bar.
const DRIVE_BAR_LABELS = {
  super: 'Super', fairway: 'Fairway', left: 'Left', right: 'Right', short: 'Short',
};

// Per-course drill-down: personal stats on one course, down to hole level.
// Opened from the Course Mastery card with { courseKey, courseName }.
// See docs/superpowers/specs/2026-07-15-course-breakdown-design.md
export default function CourseStatsScreen({ navigation, route }) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const courseKey = route?.params?.courseKey ?? null;
  const fallbackName = route?.params?.courseName ?? 'Course';

  const [breakdown, setBreakdown] = useState(undefined); // undefined = loading, null = no rounds
  const [error, setError] = useState(false);
  const [loadNonce, setLoadNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    (async () => {
      try {
        const [{ list }, profile] = await Promise.all([
          loadAllTournamentsWithFallback(),
          loadProfile().catch(() => null),
        ]);
        const myRounds = collectMyRounds(list, user?.id, profile?.displayName);
        const courseRounds = filterRoundsToCourse(myRounds, courseKey);
        if (!cancelled) setBreakdown(buildCourseBreakdown(courseRounds));
      } catch (e) {
        console.warn('CourseStatsScreen: failed to load', e);
        if (!cancelled) setError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, courseKey, loadNonce]);

  const Header = (
    <View style={s.header}>
      <TouchableOpacity
        accessibilityLabel="Back"
        onPress={() => navigation.goBack()}
        style={s.backBtn}
      >
        <Feather name="chevron-left" size={22} color={theme.accent.primary} />
      </TouchableOpacity>
      <Text style={s.headerTitle} numberOfLines={1}>
        {breakdown?.courseName ?? fallbackName}
      </Text>
      <View style={s.backBtn} />
    </View>
  );

  if (breakdown === undefined && !error) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        {Header}
        <View style={s.center}><ActivityIndicator color={theme.accent.primary} /></View>
      </ScreenContainer>
    );
  }

  if (error) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        {Header}
        <View style={s.center}>
          <Feather name="wifi-off" size={32} color={theme.text.muted} />
          <Text style={s.emptyText}>Could not load course stats.</Text>
          <TouchableOpacity
            style={s.retryBtn}
            onPress={() => { setBreakdown(undefined); setError(false); setLoadNonce((v) => v + 1); }}
          >
            <Text style={s.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

  if (breakdown === null) {
    return (
      <ScreenContainer style={s.container} edges={['top', 'bottom']}>
        {Header}
        <View style={s.center}>
          <Feather name="map" size={32} color={theme.text.muted} />
          <Text style={s.emptyText}>No rounds at this course yet.</Text>
        </View>
      </ScreenContainer>
    );
  }

  const { summary, shots, holes, highlights } = breakdown;

  return (
    <ScreenContainer style={s.container} edges={['top', 'bottom']}>
      {Header}
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <SectionCard title="Course record">
          <View style={s.tileRow}>
            <StatTile value={summary.rounds} caption="rounds" />
            <StatTile value={summary.avgPoints ?? '—'} caption="avg pts" />
            <StatTile value={summary.bestPoints ?? '—'} caption="best pts" tone="up" />
            <StatTile value={summary.avgStrokes ?? '—'} caption="avg strokes" />
          </View>
          {summary.frontBack ? (
            <Text style={s.metaLine}>
              {`Front ${summary.frontBack.frontAvg} · back ${summary.frontBack.backAvg} pts/hole across ${summary.frontBack.rounds} round${summary.frontBack.rounds === 1 ? '' : 's'}`}
            </Text>
          ) : null}
          {summary.rounds === 0 ? (
            <Text style={s.metaLine}>No complete round here yet — hole stats below still count every scored hole.</Text>
          ) : null}
        </SectionCard>

        {summary.scoreMix.total > 0 ? (
          <SectionCard title="Score mix">
            <DistributionBars bars={[
              { label: 'Eagle+', count: summary.scoreMix.eagles, muted: summary.scoreMix.eagles === 0 },
              { label: 'Birdie', count: summary.scoreMix.birdies, muted: summary.scoreMix.birdies === 0 },
              { label: 'Par', count: summary.scoreMix.pars, muted: summary.scoreMix.pars === 0 },
              { label: 'Bogey', count: summary.scoreMix.bogeys, muted: summary.scoreMix.bogeys === 0 },
              { label: 'Double', count: summary.scoreMix.doubles, muted: summary.scoreMix.doubles === 0 },
              { label: 'Worse', count: summary.scoreMix.worse, muted: summary.scoreMix.worse === 0 },
            ]} />
          </SectionCard>
        ) : null}

        {highlights ? (
          <SectionCard title="Highlights">
            <HighlightRow
              icon="alert-triangle"
              tone="bad"
              label={`Nemesis · hole ${highlights.nemesis.holeNumber}`}
              detail={`${signed(highlights.nemesis.avgVsPar)} vs par over ${highlights.nemesis.timesPlayed} rounds`}
              s={s}
              theme={theme}
            />
            <HighlightRow
              icon="award"
              tone="good"
              label={`Best hole · ${highlights.best.holeNumber}`}
              detail={`${signed(highlights.best.avgVsPar)} vs par over ${highlights.best.timesPlayed} rounds`}
              s={s}
              theme={theme}
            />
          </SectionCard>
        ) : null}

        {shots ? (
          <SectionCard title="Shot detail here">
            <View style={s.tileRow}>
              <StatTile value={shots.putts.holes > 0 ? shots.putts.perRound : '—'} caption="putts / round" />
              <StatTile value={shots.drives.recorded > 0 ? `${shots.drives.fairwayPct}%` : '—'} caption="fairways" />
              <StatTile value={shots.penalties.total} caption="penalties" />
              <StatTile value={shots.gir.eligible > 0 ? `${shots.gir.pct}%` : '—'} caption="GIR" />
            </View>
            {shots.drives.recorded > 0 ? (
              <DistributionBars bars={DRIVE_ORDER.map((k) => ({
                label: DRIVE_BAR_LABELS[k],
                count: shots.drives.distribution[k] ?? 0,
                muted: (shots.drives.distribution[k] ?? 0) === 0,
              }))} />
            ) : null}
          </SectionCard>
        ) : (
          <SectionCard title="Shot detail here">
            <Text style={s.metaLine}>No shot detail logged at this course yet.</Text>
          </SectionCard>
        )}

        {holes.length > 0 ? (
          <SectionCard title="Hole by hole">
            <HoleBreakdownTable holes={holes} />
          </SectionCard>
        ) : null}
      </ScrollView>
    </ScreenContainer>
  );
}

function HighlightRow({ icon, tone, label, detail, s, theme }) {
  return (
    <View style={s.highlightRow}>
      <View style={[s.highlightIcon, { backgroundColor: toneFill(theme, tone) }]}>
        <Feather name={icon} size={14} color={toneColor(theme, tone)} />
      </View>
      <View style={s.highlightCopy}>
        <Text style={s.highlightLabel}>{label}</Text>
        <Text style={s.highlightDetail}>{detail}</Text>
      </View>
    </View>
  );
}

function signed(n) {
  return n > 0 ? `+${n}` : `${n}`;
}

function makeStyles(theme) {
  return StyleSheet.create({
    container: { flex: 1 },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm,
      gap: theme.spacing.sm,
    },
    backBtn: { width: 32, alignItems: 'flex-start' },
    headerTitle: {
      ...theme.typography.heading, color: theme.text.primary,
      flex: 1, textAlign: 'center',
    },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.md },
    emptyText: { ...theme.typography.body, color: theme.text.secondary },
    retryBtn: {
      paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm,
      borderRadius: theme.radius.pill, backgroundColor: theme.accent.light,
    },
    retryText: { ...theme.typography.body, color: theme.accent.primary, fontWeight: '700' },
    scroll: { padding: theme.spacing.md, gap: theme.spacing.lg, paddingBottom: theme.spacing.lg * 2 },
    tileRow: { flexDirection: 'row', gap: theme.spacing.sm },
    metaLine: { ...theme.typography.caption, color: theme.text.secondary },
    highlightRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingVertical: 4 },
    highlightIcon: {
      width: 28, height: 28, borderRadius: theme.radius.pill,
      alignItems: 'center', justifyContent: 'center',
    },
    highlightCopy: { flex: 1, minWidth: 0, gap: 1 },
    highlightLabel: { ...theme.typography.body, color: theme.text.primary, fontWeight: '700' },
    highlightDetail: { ...theme.typography.caption, color: theme.text.secondary },
  });
}
```

Adaptation checks before committing (verify against the real files, don't assume):
- Match `container` / `header` / `backBtn` / `center` style values to `MyStatsScreen`'s `makeStyles` so the screen looks native to the flow.
- Confirm `DRIVE_ORDER` is exported from `src/components/mystats/shotMetrics.js` (BreakdownTab already imports it from there).
- Confirm `ScreenContainer` accepts `edges` (MyStatsScreen uses `edges={['top', 'bottom']}`).

- [ ] **Step 2: Register the route in `App.js`**

Add to the screen imports (near line 56):

```js
import CourseStatsScreen from './src/screens/CourseStatsScreen';
```

Add after the `MyStats` Stack.Screen (line ~230):

```js
        <Stack.Screen name="CourseStats" component={CourseStatsScreen} />
```

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/screens/CourseStatsScreen.js App.js
git commit -m "feat(stats): course stats drill-down screen"
```

---

### Task 6: Tappable Course Mastery rows → CourseStats

**Files:**
- Modify: `src/components/mystats/CourseMasteryCard.js`
- Modify: `src/components/mystats/tabs/BreakdownTab.js:43,80`
- Modify: `src/screens/MyStatsScreen.js:384` (BreakdownTab render) + a `useCallback` near the other callbacks (~line 164)
- Test: `src/components/mystats/__tests__/CourseMasteryCard.test.js` (new)

**Interfaces:**
- Consumes: `courseMastery` rows now carrying `courseKey` (Task 1); route `CourseStats` (Task 5).
- Produces: `CourseMasteryCard({ courses, onInfo, onSelectCourse })` — rows call `onSelectCourse(course)` only when `course.courseKey != null`; `BreakdownTab({ stats, onInfo, onSelectCourse })` passes it through.

- [ ] **Step 1: Write the failing test**

Create `src/components/mystats/__tests__/CourseMasteryCard.test.js`:

```js
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import CourseMasteryCard from '../CourseMasteryCard';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => new Promise(() => {})),
  setItem: jest.fn(),
}));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const course = (over = {}) => ({
  courseKey: 'c-1', courseName: 'Pine', rounds: 2, avgPoints: 30, bestPoints: 34, trend: 1,
  ...over,
});

describe('CourseMasteryCard navigation', () => {
  test('tapping a row with a courseKey calls onSelectCourse with the course', () => {
    const onSelectCourse = jest.fn();
    const { getByLabelText } = render(wrap(
      <CourseMasteryCard courses={[course()]} onSelectCourse={onSelectCourse} />
    ));
    fireEvent.press(getByLabelText('Open Pine stats'));
    expect(onSelectCourse).toHaveBeenCalledWith(expect.objectContaining({ courseKey: 'c-1' }));
  });

  test('rows without a courseKey are not tappable', () => {
    const onSelectCourse = jest.fn();
    const { queryByLabelText, getByText } = render(wrap(
      <CourseMasteryCard
        courses={[course({ courseKey: null, courseName: 'R3' })]}
        onSelectCourse={onSelectCourse}
      />
    ));
    expect(getByText('R3')).toBeTruthy();
    expect(queryByLabelText('Open R3 stats')).toBeNull();
  });

  test('renders plain rows when no onSelectCourse handler is given', () => {
    const { getByText, queryByLabelText } = render(wrap(
      <CourseMasteryCard courses={[course()]} />
    ));
    expect(getByText('Pine')).toBeTruthy();
    expect(queryByLabelText('Open Pine stats')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/mystats/__tests__/CourseMasteryCard.test.js`
Expected: FAIL — no element with label `Open Pine stats`.

- [ ] **Step 3: Implement**

In `src/components/mystats/CourseMasteryCard.js`:

1. Add `TouchableOpacity` to the react-native import.
2. Change the component signature and row mapping:

```js
export default function CourseMasteryCard({ courses, onInfo, onSelectCourse }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const rows = courses ?? [];
  if (rows.length === 0) return null;

  return (
    <SectionCard title="Course Mastery" infoKey="courseMastery" onInfo={onInfo}>
      <View style={s.rows}>
        {rows.map((course) => (
          <CourseRow
            key={course.courseKey ?? course.courseName}
            course={course}
            s={s}
            theme={theme}
            onPress={course.courseKey != null && onSelectCourse
              ? () => onSelectCourse(course)
              : null}
          />
        ))}
      </View>
    </SectionCard>
  );
}
```

3. Make `CourseRow` wrap in a `TouchableOpacity` when pressable, with a chevron:

```js
function CourseRow({ course, s, theme, onPress }) {
  const hasTrend = course.trend != null;
  const tone = course.trend > 0 ? 'good' : course.trend < 0 ? 'bad' : 'neutral';
  const icon = course.trend > 0 ? 'trending-up' : course.trend < 0 ? 'trending-down' : 'minus';
  const color = toneColor(theme, tone);
  const body = (
    <>
      <View style={s.copy}>
        <Text style={s.courseName} numberOfLines={1}>{course.courseName}</Text>
        <Text style={s.meta}>
          {`${course.rounds} round${course.rounds === 1 ? '' : 's'} · best ${course.bestPoints} pts`}
        </Text>
      </View>
      <View style={s.right}>
        <Text style={s.avg}>{`${course.avgPoints} pts avg`}</Text>
        {hasTrend ? (
          <View
            style={[s.trendPill, { backgroundColor: toneFill(theme, tone) }]}
            accessible
            accessibilityLabel={`${course.courseName} trend ${tone}`}
          >
            <Feather name={icon} size={13} color={color} />
          </View>
        ) : (
          <View style={s.trendPill} />
        )}
        {onPress ? <Feather name="chevron-right" size={16} color={theme.text.muted} /> : null}
      </View>
    </>
  );
  if (!onPress) return <View style={s.row}>{body}</View>;
  return (
    <TouchableOpacity
      style={s.row}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Open ${course.courseName} stats`}
    >
      {body}
    </TouchableOpacity>
  );
}
```

In `src/components/mystats/tabs/BreakdownTab.js`, thread the prop:

```js
export default function BreakdownTab({ stats, onInfo, onSelectCourse }) {
```

and

```js
      <CourseMasteryCard courses={courseMastery} onInfo={onInfo} onSelectCourse={onSelectCourse} />
```

In `src/screens/MyStatsScreen.js`, add near the other `useCallback`s (~line 164):

```js
  const openCourseStats = useCallback((course) => {
    if (!course?.courseKey) return;
    navigation.navigate('CourseStats', {
      courseKey: course.courseKey,
      courseName: course.courseName,
    });
  }, [navigation]);
```

and change line ~384:

```js
        {tab === 'breakdown' && <BreakdownTab stats={stats} onInfo={onInfo} onSelectCourse={openCourseStats} />}
```

- [ ] **Step 4: Run tests, lint, and runtime-verify**

Run: `npm test -- src/components/mystats/__tests__/CourseMasteryCard.test.js`
Expected: PASS.

Run: `npm run lint`
Expected: clean.

Runtime verification (use the project's `verify` skill if executing interactively): start `npm run web`, open MyStats → Breakdown, tap a Course Mastery row, confirm the CourseStats screen renders record tiles, score mix, hole table, and back navigation works.

- [ ] **Step 5: Commit**

```bash
git add src/components/mystats/CourseMasteryCard.js src/components/mystats/tabs/BreakdownTab.js src/screens/MyStatsScreen.js src/components/mystats/__tests__/CourseMasteryCard.test.js
git commit -m "feat(mystats): navigate from course mastery rows to course drill-down"
```

---

### Task 7: Full-suite verification

**Files:** none new.

- [ ] **Step 1: Run the full test suite from the main checkout**

Run: `npm test`
Expected: all tests pass (~1830+). If failures appear in paths under `.claude/worktrees` or `.worktrees`, they are stale worktree copies — ignore those paths (known jest scanning quirk), but every failure under `src/` must be fixed.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: zero errors (pre-existing warnings acceptable).

- [ ] **Step 3: Fix anything found, commit fixes**

```bash
git add -A src docs
git commit -m "test: full-suite verification for course drill-down"
```

(Skip the commit if there is nothing to fix.)
