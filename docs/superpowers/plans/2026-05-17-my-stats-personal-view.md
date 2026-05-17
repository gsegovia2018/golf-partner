# My Stats — Personal Statistics View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a personal "My Stats" screen, reached from the Home "play" menu, that aggregates the logged-in user's rounds across every tournament — with a round selector, a recent-vs-history form comparison, and a strengths/pain-points ranking.

**Architecture:** A pure data module (`personalStats.js`) collects the user's rounds across all tournaments, builds a *synthetic single-player tournament*, and reuses the existing per-player functions in `statsEngine.js`. One new engine function (`teeShotImpact`) is added. The screen (`MyStatsScreen.js`) and a selector sheet (`MyStatsRoundSelector.js`) render the results.

**Tech Stack:** React Native (Expo), React Navigation native-stack, Jest (`jest-expo` preset), `@react-native-async-storage/async-storage`.

**Spec:** `docs/superpowers/specs/2026-05-17-my-stats-personal-view-design.md`

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `src/store/personalStats.js` | Pure: collect rounds, synthetic tournament, metrics, form, ranking, selection resolution | Create |
| `src/store/statsEngine.js` | Add `teeShotImpact` (drive outcome × hole score) | Modify |
| `src/store/__tests__/personalStats.test.js` | Unit tests for `personalStats.js` | Create |
| `src/store/__tests__/statsEngine.test.js` | Unit tests for `teeShotImpact` | Create |
| `src/screens/MyStatsScreen.js` | Personal stats screen — load, states, sections | Create |
| `src/components/MyStatsRoundSelector.js` | Bottom-sheet round selector | Create |
| `App.js` | Register `MyStats` route | Modify |
| `src/screens/HomeScreen.js` | Point the play-menu "Statistics" item at `MyStats` | Modify |

**Resolved ambiguities (vs. spec):**
- The spec's engine-reuse map listed `strokeIndexAccuracy` for "hole difficulty". That function measures SI-*label* accuracy, not the player's scoring by difficulty band. This plan adds a small `holeDifficultySplit` in `personalStats.js` instead.
- The spec says "Recent = last N completed rounds". This plan treats **the selection as the universe**: every selected round counts everywhere (metrics, form, ranking). The `completed` flag only drives the *default* selection and the selector's "In progress" tag. If the user opts an incomplete round into the selection, it counts.
- Bounce-back is a *rate*, not points/hole, so it is **not** a ranking cell (the ranking needs one common yardstick). It stays a display-only breakdown.

---

## Task 1: `personalStats.js` scaffold + `collectMyRounds`

Collects every round the logged-in user played, across all tournaments, into a flat chronological list.

**Files:**
- Create: `src/store/personalStats.js`
- Test: `src/store/__tests__/personalStats.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/store/__tests__/personalStats.test.js`:

```js
import { collectMyRounds } from '../personalStats';

// ── Fixture helpers ───────────────────────────────────────────────
// hcp default 0; SI defaults to hole number; par defaults to 4.
function mkRound({ courseName = 'Course', holes, scores = {}, shotDetails = {}, playerHandicaps = {} }) {
  return { courseName, holes, scores, shotDetails, playerHandicaps };
}
// 18 holes, par 4, strokeIndex = hole number.
function holes18() {
  return Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
}
// scores object for one player: every hole = `strokes`.
function evenScores(holes, strokes) {
  const o = {};
  holes.forEach((h) => { o[h.number] = strokes; });
  return o;
}

describe('collectMyRounds', () => {
  test('returns one record per round the user has a score in', () => {
    const h = holes18();
    const tournaments = [{
      id: 10, name: 'Spring Cup',
      players: [{ id: 'p1', name: 'Me', handicap: 12, user_id: 'u1' }],
      rounds: [
        mkRound({ courseName: 'Pine', holes: h, scores: { p1: evenScores(h, 5) } }),
        mkRound({ courseName: 'Oak', holes: h, scores: { p1: evenScores(h, 4) } }),
      ],
    }];
    const result = collectMyRounds(tournaments, 'u1');
    expect(result).toHaveLength(2);
    expect(result[0].key).toBe('10:0');
    expect(result[0].tournamentName).toBe('Spring Cup');
    expect(result[0].courseName).toBe('Pine');
    expect(result[0].playerId).toBe('p1');
  });

  test('marks a round completed only when every hole has a score', () => {
    const h = holes18();
    const partial = evenScores(h, 5);
    delete partial[18];
    const tournaments = [{
      id: 7, name: 'T', players: [{ id: 'p1', user_id: 'u1' }],
      rounds: [
        mkRound({ holes: h, scores: { p1: evenScores(h, 5) } }),
        mkRound({ holes: h, scores: { p1: partial } }),
      ],
    }];
    const result = collectMyRounds(tournaments, 'u1');
    expect(result[0].completed).toBe(true);
    expect(result[1].completed).toBe(false);
  });

  test('excludes rounds where the user has no score, and tournaments without the user', () => {
    const h = holes18();
    const tournaments = [
      { id: 1, name: 'Mine', players: [{ id: 'p1', user_id: 'u1' }],
        rounds: [
          mkRound({ holes: h, scores: { p1: evenScores(h, 4) } }),
          mkRound({ holes: h, scores: {} }),
        ] },
      { id: 2, name: 'Theirs', players: [{ id: 'pX', user_id: 'other' }],
        rounds: [mkRound({ holes: h, scores: { pX: evenScores(h, 4) } })] },
    ];
    const result = collectMyRounds(tournaments, 'u1');
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('1:0');
  });

  test('orders rounds chronologically — oldest tournament first', () => {
    const h = holes18();
    // loaders return newest-first (id desc); collectMyRounds reverses.
    const tournaments = [
      { id: 20, name: 'Newer', players: [{ id: 'p1', user_id: 'u1' }],
        rounds: [mkRound({ holes: h, scores: { p1: evenScores(h, 4) } })] },
      { id: 10, name: 'Older', players: [{ id: 'p1', user_id: 'u1' }],
        rounds: [mkRound({ holes: h, scores: { p1: evenScores(h, 4) } })] },
    ];
    const result = collectMyRounds(tournaments, 'u1');
    expect(result.map((r) => r.tournamentName)).toEqual(['Older', 'Newer']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/store/__tests__/personalStats.test.js`
Expected: FAIL — "Cannot find module '../personalStats'".

- [ ] **Step 3: Write minimal implementation**

Create `src/store/personalStats.js`:

```js
// Personal cross-tournament statistics.
//
// Every function here is pure. The screen (MyStatsScreen) does the async
// loading and AsyncStorage persistence; this module only transforms data.
//
// Approach: collect the logged-in user's rounds from every tournament, build
// a synthetic single-player "tournament", and reuse the per-player functions
// in statsEngine.js. See docs/superpowers/specs/2026-05-17-my-stats-personal-view-design.md
import { getPlayingHandicap, calcStablefordPoints } from './tournamentStore';
import {
  parTypeSplit, warmupVsClosing, frontBackSplit, playerScoreDistribution,
  playerRoundHistory, playerConsistency, bounceBackRate, shotStats,
  teeShotImpact,
} from './statsEngine';

// Canonical player id used inside the synthetic tournament.
export const CANON_ID = 'me';

// ── collectMyRounds ──
// Flattens every tournament's rounds into MyRound records for the user.
// `tournaments` arrive newest-first (id desc) from the loaders, so we reverse
// to get chronological (oldest-first) order.
export function collectMyRounds(tournaments, userId) {
  const result = [];
  const chrono = [...(tournaments || [])].reverse();
  chrono.forEach((t) => {
    const me = (t.players || []).find((p) => p.user_id === userId);
    if (!me) return;
    (t.rounds || []).forEach((round, roundIndex) => {
      const myScores = round?.scores?.[me.id];
      if (!myScores || Object.keys(myScores).length === 0) return;
      const holes = round.holes || [];
      const completed = holes.length > 0
        && holes.every((h) => myScores[h.number] != null);
      result.push({
        key: `${t.id}:${roundIndex}`,
        round,
        tournamentId: t.id,
        tournamentName: t.name || 'Tournament',
        courseName: round.courseName || `Round ${roundIndex + 1}`,
        roundIndex,
        playerId: me.id,
        player: me,
        completed,
      });
    });
  });
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/store/__tests__/personalStats.test.js`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/store/personalStats.js src/store/__tests__/personalStats.test.js
git commit -m "feat: collectMyRounds — flatten user rounds across tournaments"
```

---

## Task 2: `buildSyntheticTournament`

Re-keys selected rounds to one canonical player so the existing engine functions can consume them.

**Files:**
- Modify: `src/store/personalStats.js`
- Test: `src/store/__tests__/personalStats.test.js`

- [ ] **Step 1: Write the failing test**

Change the import line at the top of `src/store/__tests__/personalStats.test.js` to:

```js
import { collectMyRounds, buildSyntheticTournament, CANON_ID } from '../personalStats';
```

Append to the same file:

```js
describe('buildSyntheticTournament', () => {
  test('returns an empty single-player tournament for no rounds', () => {
    const t = buildSyntheticTournament([]);
    expect(t.players).toEqual([]);
    expect(t.rounds).toEqual([]);
  });

  test('re-keys scores, shotDetails and playerHandicaps to the canonical id', () => {
    const h = holes18();
    const myRounds = collectMyRounds([{
      id: 5, name: 'T', players: [{ id: 'origA', name: 'Me', handicap: 9, user_id: 'u1' }],
      rounds: [mkRound({
        holes: h,
        scores: { origA: evenScores(h, 4) },
        shotDetails: { origA: { 1: { putts: 2 } } },
        playerHandicaps: { origA: 9 },
      })],
    }], 'u1');
    const t = buildSyntheticTournament(myRounds);
    expect(t.players).toHaveLength(1);
    expect(t.players[0].id).toBe(CANON_ID);
    expect(t.rounds[0].scores[CANON_ID][1]).toBe(4);
    expect(t.rounds[0].scores.origA).toBeUndefined();
    expect(t.rounds[0].shotDetails[CANON_ID][1].putts).toBe(2);
    expect(t.rounds[0].playerHandicaps[CANON_ID]).toBe(9);
  });

  test('keeps each round under its own original player id (different per tournament)', () => {
    const h = holes18();
    const myRounds = collectMyRounds([
      { id: 2, name: 'B', players: [{ id: 'pB', handicap: 10, user_id: 'u1' }],
        rounds: [mkRound({ holes: h, scores: { pB: evenScores(h, 5) }, playerHandicaps: { pB: 10 } })] },
      { id: 1, name: 'A', players: [{ id: 'pA', handicap: 14, user_id: 'u1' }],
        rounds: [mkRound({ holes: h, scores: { pA: evenScores(h, 6) }, playerHandicaps: { pA: 14 } })] },
    ], 'u1');
    const t = buildSyntheticTournament(myRounds);
    // chronological: A (id 1) first, B second
    expect(t.rounds[0].scores[CANON_ID][1]).toBe(6);
    expect(t.rounds[0].playerHandicaps[CANON_ID]).toBe(14);
    expect(t.rounds[1].scores[CANON_ID][1]).toBe(5);
    expect(t.rounds[1].playerHandicaps[CANON_ID]).toBe(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/store/__tests__/personalStats.test.js -t buildSyntheticTournament`
Expected: FAIL — "buildSyntheticTournament is not a function".

- [ ] **Step 3: Write minimal implementation**

Append to `src/store/personalStats.js`:

```js
// ── buildSyntheticTournament ──
// Produces { id, name, players: [me], rounds } where every round's scores,
// shotDetails, playerHandicaps and manualHandicaps are re-keyed from the
// round's original player id to CANON_ID. This object is the input to the
// existing per-player engine functions.
export function buildSyntheticTournament(myRounds) {
  if (!myRounds || myRounds.length === 0) {
    return { id: 'mystats', name: 'My Stats', players: [], rounds: [] };
  }
  const base = myRounds[0].player || {};
  const player = {
    id: CANON_ID,
    name: base.name || 'Me',
    handicap: base.handicap ?? 0,
    user_id: base.user_id ?? null,
  };
  const rounds = myRounds.map((mr) => {
    const { round, playerId } = mr;
    const rekey = (obj) => (obj && obj[playerId] != null
      ? { [CANON_ID]: obj[playerId] }
      : {});
    return {
      ...round,
      scores: rekey(round.scores),
      shotDetails: rekey(round.shotDetails),
      playerHandicaps: rekey(round.playerHandicaps),
      manualHandicaps: rekey(round.manualHandicaps),
    };
  });
  return { id: 'mystats', name: 'My Stats', players: [player], rounds };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/store/__tests__/personalStats.test.js`
Expected: PASS — all `collectMyRounds` + `buildSyntheticTournament` tests.

- [ ] **Step 5: Commit**

```bash
git add src/store/personalStats.js src/store/__tests__/personalStats.test.js
git commit -m "feat: buildSyntheticTournament — single-player normalization"
```

---

## Task 3: `teeShotImpact` engine function

Cross-references each par-4/5 hole's drive outcome and tee penalty with the Stableford points scored.

**Files:**
- Modify: `src/store/statsEngine.js` (append at end of file)
- Test: `src/store/__tests__/statsEngine.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/store/__tests__/statsEngine.test.js`:

```js
import { teeShotImpact } from '../statsEngine';

// 18 par-4 holes, strokeIndex = hole number.
function holes18() {
  return Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
}
function evenScores(holes, strokes) {
  const o = {};
  holes.forEach((h) => { o[h.number] = strokes; });
  return o;
}

describe('teeShotImpact', () => {
  test('reports no data when no shot detail exists', () => {
    const h = holes18();
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: evenScores(h, 4) }, shotDetails: {} }],
    };
    expect(teeShotImpact(t, 'p1').hasData).toBe(false);
  });

  test('separates fairway-hit holes from missed holes by average points', () => {
    const h = holes18();
    // holes 1-2 fairway scoring 4 (par, 2 pts); holes 3-4 missed scoring 6 (0 pts)
    const shotDetails = {
      p1: {
        1: { drive: 'fairway' }, 2: { drive: 'super' },
        3: { drive: 'left' }, 4: { drive: 'right' },
      },
    };
    const scores = { ...evenScores(h, 4) };
    scores[3] = 6; scores[4] = 6;
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: scores }, shotDetails }],
    };
    const r = teeShotImpact(t, 'p1');
    expect(r.hasData).toBe(true);
    expect(r.fairway.holes).toBe(2);
    expect(r.fairway.avgPoints).toBe(2);
    expect(r.missed.holes).toBe(2);
    expect(r.missed.avgPoints).toBe(0);
    expect(r.byDirection.left.holes).toBe(1);
    expect(r.byDirection.right.holes).toBe(1);
  });

  test('ignores par 3 holes', () => {
    const h = holes18().map((hole, i) => (i === 0 ? { ...hole, par: 3 } : hole));
    const shotDetails = { p1: { 1: { drive: 'fairway' } } };
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: evenScores(h, 4) }, shotDetails }],
    };
    expect(teeShotImpact(t, 'p1').fairway.holes).toBe(0);
  });

  test('measures tee-penalty holes against penalty-free holes', () => {
    const h = holes18();
    const scores = { ...evenScores(h, 4) };
    scores[1] = 6; // penalty hole scores worse
    const shotDetails = { p1: { 1: { teePenalties: 1 } } };
    const t = {
      players: [{ id: 'p1', handicap: 0 }],
      rounds: [{ courseName: 'C', holes: h, scores: { p1: scores }, shotDetails }],
    };
    const r = teeShotImpact(t, 'p1');
    expect(r.teePenalty.holes).toBe(1);
    expect(r.teePenalty.penaltyCount).toBe(1);
    expect(r.teePenalty.avgPoints).toBe(0);
    expect(r.withoutPenalty.avgPoints).toBe(2);
    expect(r.penaltyDrag).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/store/__tests__/statsEngine.test.js`
Expected: FAIL — "teeShotImpact is not a function".

- [ ] **Step 3: Write minimal implementation**

Append to the end of `src/store/statsEngine.js`:

```js
// ── Tee Shot Impact ──
// Cross-references each par-4/5 hole's drive outcome and tee penalty with the
// Stableford points scored, so a player can see what a good tee shot is worth.
// Par 3s are excluded — "tee shot" here means the drive on a 4 or 5.
export function teeShotImpact(tournament, playerId) {
  const player = (tournament.players || []).find((p) => p.id === playerId);
  const fairway = [];
  const missed = [];
  const byDir = { left: [], right: [], short: [] };
  const withPenalty = [];
  const withoutPenalty = [];
  let penaltyCount = 0;

  (tournament.rounds || []).forEach((round, roundIndex) => {
    if (!round.scores?.[playerId] || !player) return;
    const handicap = getPlayingHandicap(round, player);
    const details = round.shotDetails?.[playerId] || {};
    (round.holes || []).forEach((hole) => {
      if (hole.par === 3) return;
      const sc = round.scores[playerId]?.[hole.number];
      if (!sc) return;
      const d = details[hole.number];
      if (!d) return;
      const points = calcStablefordPoints(hole.par, sc, handicap, hole.strokeIndex);
      const entry = {
        roundIndex, courseName: round.courseName,
        holeNumber: hole.number, par: hole.par, strokes: sc, points,
      };
      if (d.drive != null) {
        if (d.drive === 'fairway' || d.drive === 'super') {
          fairway.push(entry);
        } else {
          missed.push(entry);
          if (byDir[d.drive]) byDir[d.drive].push(entry);
        }
      }
      const teePen = d.teePenalties ?? 0;
      if (teePen > 0) {
        withPenalty.push(entry);
        penaltyCount += teePen;
      } else {
        withoutPenalty.push(entry);
      }
    });
  });

  const avg = (arr) => (arr.length
    ? +(arr.reduce((s, e) => s + e.points, 0) / arr.length).toFixed(2)
    : 0);
  const summarize = (arr) => ({ holes: arr.length, avgPoints: avg(arr), breakdown: arr });
  const penaltyDrag = withPenalty.length && withoutPenalty.length
    ? +(avg(withoutPenalty) - avg(withPenalty)).toFixed(2)
    : 0;

  return {
    hasData: fairway.length + missed.length + withPenalty.length > 0,
    fairway: summarize(fairway),
    missed: summarize(missed),
    byDirection: {
      left: summarize(byDir.left),
      right: summarize(byDir.right),
      short: summarize(byDir.short),
    },
    teePenalty: { ...summarize(withPenalty), penaltyCount },
    withoutPenalty: summarize(withoutPenalty),
    penaltyDrag,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/store/__tests__/statsEngine.test.js`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/store/statsEngine.js src/store/__tests__/statsEngine.test.js
git commit -m "feat: teeShotImpact — drive outcome and tee penalty vs scoring"
```

---

## Task 4: `holeDifficultySplit` + `computeMetrics`

`holeDifficultySplit` buckets a player's holes by SI band. `computeMetrics` produces the round-level aggregates the Snapshot and Form sections consume.

**Files:**
- Modify: `src/store/personalStats.js`
- Test: `src/store/__tests__/personalStats.test.js`

- [ ] **Step 1: Write the failing test**

Change the personalStats import line at the top of `src/store/__tests__/personalStats.test.js` to:

```js
import {
  collectMyRounds, buildSyntheticTournament, CANON_ID,
  holeDifficultySplit, computeMetrics,
} from '../personalStats';
```

Append to the same file:

```js
describe('holeDifficultySplit', () => {
  test('buckets holes into hard (SI 1-6), mid (7-12), easy (13-18)', () => {
    const h = holes18(); // par 4, SI = hole number
    const myRounds = collectMyRounds([{
      id: 1, name: 'T', players: [{ id: 'p1', handicap: 0, user_id: 'u1' }],
      rounds: [mkRound({ holes: h, scores: { p1: evenScores(h, 4) }, playerHandicaps: { p1: 0 } })],
    }], 'u1');
    const split = holeDifficultySplit(buildSyntheticTournament(myRounds), CANON_ID);
    expect(split.hard.holes).toBe(6);
    expect(split.mid.holes).toBe(6);
    expect(split.easy.holes).toBe(6);
    expect(split.hard.avgPoints).toBe(2); // gross par, scratch → 2 pts
  });
});

describe('computeMetrics', () => {
  test('averages points and strokes-vs-par per round', () => {
    const h = holes18(); // par 4 × 18 → par total 72
    const myRounds = collectMyRounds([{
      id: 1, name: 'T', players: [{ id: 'p1', handicap: 0, user_id: 'u1' }],
      rounds: [
        mkRound({ holes: h, scores: { p1: evenScores(h, 4) }, playerHandicaps: { p1: 0 } }),
        mkRound({ holes: h, scores: { p1: evenScores(h, 5) }, playerHandicaps: { p1: 0 } }),
      ],
    }], 'u1');
    const m = computeMetrics(buildSyntheticTournament(myRounds));
    expect(m.rounds).toBe(2);
    expect(m.avgPoints).toBe(27);    // round1: 36 pts, round2: 18 pts → avg 27
    expect(m.avgVsPar).toBe(9);      // round1: 0, round2: +18 → avg 9
    expect(m.hasShotData).toBe(false);
  });

  test('reports shot metrics when shot detail exists', () => {
    const h = holes18();
    const shotDetails = {};
    h.forEach((hole) => { shotDetails[hole.number] = { putts: 2, drive: 'fairway' }; });
    const myRounds = collectMyRounds([{
      id: 1, name: 'T', players: [{ id: 'p1', handicap: 0, user_id: 'u1' }],
      rounds: [mkRound({
        holes: h, scores: { p1: evenScores(h, 4) },
        playerHandicaps: { p1: 0 }, shotDetails: { p1: shotDetails },
      })],
    }], 'u1');
    const m = computeMetrics(buildSyntheticTournament(myRounds));
    expect(m.hasShotData).toBe(true);
    expect(m.fairwayPct).toBe(100);
    expect(m.puttsPerRound).toBe(36);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/store/__tests__/personalStats.test.js -t computeMetrics`
Expected: FAIL — "computeMetrics is not a function".

- [ ] **Step 3: Write minimal implementation**

Append to `src/store/personalStats.js`:

```js
// ── holeDifficultySplit ──
// Buckets a player's holes by printed stroke index: hard 1-6, mid 7-12,
// easy 13-18. avgPoints is net Stableford points per hole in each band.
export function holeDifficultySplit(tournament, playerId) {
  const bands = { hard: [], mid: [], easy: [] };
  const player = (tournament.players || []).find((p) => p.id === playerId);
  if (player) {
    (tournament.rounds || []).forEach((round, roundIndex) => {
      if (!round.scores?.[playerId]) return;
      const handicap = getPlayingHandicap(round, player);
      (round.holes || []).forEach((hole) => {
        const sc = round.scores[playerId]?.[hole.number];
        if (!sc) return;
        const points = calcStablefordPoints(hole.par, sc, handicap, hole.strokeIndex);
        const band = hole.strokeIndex <= 6 ? 'hard'
          : hole.strokeIndex <= 12 ? 'mid' : 'easy';
        bands[band].push({
          roundIndex, courseName: round.courseName,
          holeNumber: hole.number, par: hole.par, si: hole.strokeIndex,
          strokes: sc, points,
        });
      });
    });
  }
  const summarize = (arr) => ({
    holes: arr.length,
    avgPoints: arr.length
      ? +(arr.reduce((s, e) => s + e.points, 0) / arr.length).toFixed(2)
      : 0,
    breakdown: arr,
  });
  return {
    hard: summarize(bands.hard),
    mid: summarize(bands.mid),
    easy: summarize(bands.easy),
  };
}

// ── computeMetrics ──
// Round-level aggregates over a synthetic tournament. Used for the Snapshot
// card and for both sides of the recent-vs-history comparison.
export function computeMetrics(synthetic) {
  const history = playerRoundHistory(synthetic, CANON_ID);
  const rounds = history.length;
  let vsParSum = 0;
  let vsParRounds = 0;
  (synthetic.rounds || []).forEach((round, ri) => {
    const h = history.find((x) => x.roundIndex === ri);
    if (!h) return;
    let parPlayed = 0;
    (round.holes || []).forEach((hole) => {
      if (round.scores?.[CANON_ID]?.[hole.number] != null) parPlayed += hole.par;
    });
    vsParSum += h.strokes - parPlayed;
    vsParRounds += 1;
  });
  const shots = shotStats(synthetic, CANON_ID);
  const div = (a, b) => (b > 0 ? +(a / b).toFixed(2) : 0);
  const totalPoints = history.reduce((s, h) => s + h.points, 0);
  return {
    rounds,
    avgPoints: div(totalPoints, rounds),
    avgVsPar: div(vsParSum, vsParRounds),
    bestRoundPoints: history.reduce((m, h) => Math.max(m, h.points), 0),
    hasShotData: shots.hasData,
    fairwayPct: shots.drives.fairwayPct,
    puttsPerRound: shots.putts.perRound,
    girPct: shots.gir.pct,
    threePuttsPerRound: div(shots.putts.threePuttPlus, shots.roundsWithData),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/store/__tests__/personalStats.test.js`
Expected: PASS — all tests including `holeDifficultySplit` and `computeMetrics`.

- [ ] **Step 5: Commit**

```bash
git add src/store/personalStats.js src/store/__tests__/personalStats.test.js
git commit -m "feat: holeDifficultySplit + computeMetrics for personal stats"
```

---

## Task 5: `computeRecentVsHistory`

Runs `computeMetrics` on the last N rounds and the earlier rounds, producing the Form section's comparison.

**Files:**
- Modify: `src/store/personalStats.js`
- Test: `src/store/__tests__/personalStats.test.js`

- [ ] **Step 1: Write the failing test**

Change the personalStats import line at the top of `src/store/__tests__/personalStats.test.js` to:

```js
import {
  collectMyRounds, buildSyntheticTournament, CANON_ID,
  holeDifficultySplit, computeMetrics, computeRecentVsHistory, FORM_METRICS,
} from '../personalStats';
```

Append to the same file:

```js
describe('computeRecentVsHistory', () => {
  // Build N rounds where round i scores `strokesByRound[i]` on every hole.
  function roundsTournament(strokesByRound) {
    const h = holes18();
    return [{
      id: 1, name: 'T', players: [{ id: 'p1', handicap: 0, user_id: 'u1' }],
      rounds: strokesByRound.map((str) => mkRound({
        holes: h, scores: { p1: evenScores(h, str) }, playerHandicaps: { p1: 0 },
      })),
    }];
  }

  test('keeps FORM_METRICS in sync — 6 metrics produced', () => {
    const my = collectMyRounds(roundsTournament([5, 5]), 'u1');
    expect(computeRecentVsHistory(my, 5).metrics).toHaveLength(FORM_METRICS.length);
  });

  test('splits into recent (last N) and history (earlier), disjoint', () => {
    // 7 rounds; N=5 → history = first 2, recent = last 5
    const my = collectMyRounds(roundsTournament([6, 6, 5, 5, 5, 4, 4]), 'u1');
    const r = computeRecentVsHistory(my, 5);
    expect(r.recentCount).toBe(5);
    expect(r.historyCount).toBe(2);
    expect(r.hasHistory).toBe(true);
    const points = r.metrics.find((m) => m.key === 'avgPoints');
    expect(points.recent).toBeGreaterThan(points.history); // recent rounds lower strokes → more points
    expect(points.direction).toBe('up');
  });

  test('marks no history when total rounds <= N', () => {
    const my = collectMyRounds(roundsTournament([5, 5, 4]), 'u1');
    const r = computeRecentVsHistory(my, 5);
    expect(r.hasHistory).toBe(false);
    expect(r.recentCount).toBe(3);
    const points = r.metrics.find((m) => m.key === 'avgPoints');
    expect(points.history).toBeNull();
    expect(points.delta).toBeNull();
  });

  test('direction respects polarity — fewer strokes-vs-par is an improvement', () => {
    // earlier rounds score 6 (worse), recent score 4 (better)
    const my = collectMyRounds(roundsTournament([6, 6, 6, 4, 4, 4, 4, 4]), 'u1');
    const r = computeRecentVsHistory(my, 5);
    const vsPar = r.metrics.find((m) => m.key === 'avgVsPar');
    expect(vsPar.recent).toBeLessThan(vsPar.history);
    expect(vsPar.direction).toBe('up'); // lower vsPar = green up
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/store/__tests__/personalStats.test.js -t computeRecentVsHistory`
Expected: FAIL — "computeRecentVsHistory is not a function".

- [ ] **Step 3: Write minimal implementation**

Append to `src/store/personalStats.js`:

```js
// ── Form metrics ──
// Each carries a polarity so the UI colors the trend arrow correctly.
// `shot: true` metrics need shot-tracking data to be meaningful.
export const FORM_METRICS = [
  { key: 'avgPoints',          label: 'Points / round',   polarity: 'higher', shot: false },
  { key: 'avgVsPar',           label: 'Strokes vs par',   polarity: 'lower',  shot: false },
  { key: 'fairwayPct',         label: 'Fairways hit %',   polarity: 'higher', shot: true },
  { key: 'girPct',             label: 'Greens in reg %',  polarity: 'higher', shot: true },
  { key: 'puttsPerRound',      label: 'Putts / round',    polarity: 'lower',  shot: true },
  { key: 'threePuttsPerRound', label: '3-putts / round',  polarity: 'lower',  shot: true },
];

// ── computeRecentVsHistory ──
// "Recent" = the last N rounds (chronologically). "History" = every earlier
// round. Disjoint, so the delta is a true improving/declining signal.
export function computeRecentVsHistory(myRounds, n = 5) {
  const all = myRounds || [];
  const recentRounds = all.slice(-n);
  const historyRounds = all.slice(0, Math.max(0, all.length - n));
  const hasHistory = historyRounds.length > 0;
  const recent = computeMetrics(buildSyntheticTournament(recentRounds));
  const history = hasHistory
    ? computeMetrics(buildSyntheticTournament(historyRounds))
    : null;
  const metrics = FORM_METRICS.map((m) => {
    const recentVal = recent[m.key];
    const historyVal = hasHistory ? history[m.key] : null;
    const delta = hasHistory ? +(recentVal - historyVal).toFixed(2) : null;
    let direction = 'flat';
    if (delta != null && delta !== 0) {
      const improved = m.polarity === 'higher' ? delta > 0 : delta < 0;
      direction = improved ? 'up' : 'down';
    }
    return { ...m, recent: recentVal, history: historyVal, delta, direction };
  });
  return {
    n,
    recentCount: recentRounds.length,
    historyCount: historyRounds.length,
    hasHistory,
    hasShotData: recent.hasShotData || (history?.hasShotData ?? false),
    metrics,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/store/__tests__/personalStats.test.js`
Expected: PASS — all tests including `computeRecentVsHistory`.

- [ ] **Step 5: Commit**

```bash
git add src/store/personalStats.js src/store/__tests__/personalStats.test.js
git commit -m "feat: computeRecentVsHistory — disjoint recent/history form split"
```

---

## Task 6: `rankStrengths`

Ranks scoring dimensions against the player's own baseline points/hole to surface strengths and pain points.

**Files:**
- Modify: `src/store/personalStats.js`
- Test: `src/store/__tests__/personalStats.test.js`

- [ ] **Step 1: Write the failing test**

Change the personalStats import line at the top of `src/store/__tests__/personalStats.test.js` to:

```js
import {
  collectMyRounds, buildSyntheticTournament, CANON_ID,
  holeDifficultySplit, computeMetrics, computeRecentVsHistory, FORM_METRICS,
  rankStrengths,
} from '../personalStats';
```

Append to the same file:

```js
describe('rankStrengths', () => {
  // Build a tournament where par-3 holes score badly and par-5 holes score
  // well, so par type becomes a clear strength/weakness.
  function skewedTournament() {
    const holes = Array.from({ length: 18 }, (_, i) => ({
      number: i + 1,
      par: i < 9 ? 3 : 5,             // 9 par-3, 9 par-5
      strokeIndex: i + 1,
    }));
    const scores = {};
    holes.forEach((h) => { scores[h.number] = h.par === 3 ? h.par + 2 : h.par; });
    // Three identical rounds → 27 holes per par bucket (above the 12 guard).
    const round = mkRound({ holes, scores: { p1: scores }, playerHandicaps: { p1: 0 } });
    return [{
      id: 1, name: 'T', players: [{ id: 'p1', handicap: 0, user_id: 'u1' }],
      rounds: [round, round, round],
    }];
  }

  test('ranks par 5s as a strength and par 3s as a pain point', () => {
    const my = collectMyRounds(skewedTournament(), 'u1');
    const r = rankStrengths(buildSyntheticTournament(my));
    expect(r.strengths[0].label).toBe('Par 5s');
    expect(r.strengths[0].deviation).toBeGreaterThan(0);
    expect(r.weaknesses[0].label).toBe('Par 3s');
    expect(r.weaknesses[0].deviation).toBeLessThan(0);
  });

  test('excludes cells below the sample-size guard', () => {
    // Single round → each par bucket has only 9 holes (< 12 guard).
    const one = skewedTournament();
    one[0].rounds = [one[0].rounds[0]];
    const my = collectMyRounds(one, 'u1');
    const r = rankStrengths(buildSyntheticTournament(my));
    const labels = [...r.strengths, ...r.weaknesses].map((c) => c.label);
    expect(labels).not.toContain('Par 3s');
    expect(labels).not.toContain('Par 5s');
  });

  test('returns empty lists when there are no rounds', () => {
    const r = rankStrengths(buildSyntheticTournament([]));
    expect(r.strengths).toEqual([]);
    expect(r.weaknesses).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/store/__tests__/personalStats.test.js -t rankStrengths`
Expected: FAIL — "rankStrengths is not a function".

- [ ] **Step 3: Write minimal implementation**

Append to `src/store/personalStats.js`:

```js
// Minimum holes for a hole-level cell to be eligible for ranking — guards
// against fake insights from tiny samples.
const HOLE_SAMPLE_MIN = 12;

// ── rankStrengths ──
// Every candidate cell is reduced to one comparable number: net points per
// hole. The baseline is the player's overall mean points/hole. Cells far
// above baseline are strengths; far below are pain points.
export function rankStrengths(synthetic) {
  const consistency = playerConsistency(synthetic)[0];
  const baseline = consistency?.mean ?? null;
  if (baseline == null) {
    return { baseline: null, strengths: [], weaknesses: [] };
  }

  const cells = [];
  const addCell = (label, avgPoints, holes) => {
    if (holes >= HOLE_SAMPLE_MIN) {
      cells.push({ label, avgPoints, sample: holes, unit: 'holes' });
    }
  };

  const pt = parTypeSplit(synthetic, CANON_ID);
  addCell('Par 3s', pt.par3.avgPoints, pt.par3.holes);
  addCell('Par 4s', pt.par4.avgPoints, pt.par4.holes);
  addCell('Par 5s', pt.par5.avgPoints, pt.par5.holes);

  const diff = holeDifficultySplit(synthetic, CANON_ID);
  addCell('Hard holes (SI 1-6)', diff.hard.avgPoints, diff.hard.holes);
  addCell('Mid holes (SI 7-12)', diff.mid.avgPoints, diff.mid.holes);
  addCell('Easy holes (SI 13-18)', diff.easy.avgPoints, diff.easy.holes);

  const wc = warmupVsClosing(synthetic, CANON_ID);
  addCell('Opening 3 holes', wc.warmup.avgPoints, wc.warmup.holes);
  addCell('Closing 3 holes', wc.closing.avgPoints, wc.closing.holes);

  const fb = frontBackSplit(synthetic)[0];
  if (fb) {
    addCell('Front nine', fb.frontAvg, fb.rounds.length * 9);
    addCell('Back nine', fb.backAvg, fb.rounds.length * 9);
  }

  const tee = teeShotImpact(synthetic, CANON_ID);
  addCell('Tee shot on the fairway', tee.fairway.avgPoints, tee.fairway.holes);
  addCell('Tee shot missing the fairway', tee.missed.avgPoints, tee.missed.holes);
  addCell('After a tee penalty', tee.teePenalty.avgPoints, tee.teePenalty.holes);

  const scored = cells.map((c) => ({
    ...c,
    deviation: +(c.avgPoints - baseline).toFixed(2),
  }));
  const strengths = scored
    .filter((c) => c.deviation > 0)
    .sort((a, b) => b.deviation - a.deviation)
    .slice(0, 3);
  const weaknesses = scored
    .filter((c) => c.deviation < 0)
    .sort((a, b) => a.deviation - b.deviation)
    .slice(0, 3);
  return { baseline: +baseline.toFixed(2), strengths, weaknesses };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/store/__tests__/personalStats.test.js`
Expected: PASS — all tests including `rankStrengths`.

- [ ] **Step 5: Commit**

```bash
git add src/store/personalStats.js src/store/__tests__/personalStats.test.js
git commit -m "feat: rankStrengths — baseline-relative strengths and pain points"
```

---

## Task 7: `resolveSelection` + `computeMyStats`

`resolveSelection` turns stored toggle overrides into the active round list. `computeMyStats` is the single entry point the screen calls.

**Files:**
- Modify: `src/store/personalStats.js`
- Test: `src/store/__tests__/personalStats.test.js`

- [ ] **Step 1: Write the failing test**

Change the personalStats import line at the top of `src/store/__tests__/personalStats.test.js` to:

```js
import {
  collectMyRounds, buildSyntheticTournament, CANON_ID,
  holeDifficultySplit, computeMetrics, computeRecentVsHistory, FORM_METRICS,
  rankStrengths, resolveSelection, computeMyStats,
} from '../personalStats';
```

Append to the same file:

```js
describe('resolveSelection', () => {
  function threeRounds() {
    const h = holes18();
    const partial = evenScores(h, 5);
    delete partial[18]; // round 3 incomplete
    return collectMyRounds([{
      id: 1, name: 'T', players: [{ id: 'p1', handicap: 0, user_id: 'u1' }],
      rounds: [
        mkRound({ holes: h, scores: { p1: evenScores(h, 4) } }),
        mkRound({ holes: h, scores: { p1: evenScores(h, 5) } }),
        mkRound({ holes: h, scores: { p1: partial } }),
      ],
    }], 'u1');
  }

  test('defaults to completed rounds when there are no overrides', () => {
    const selected = resolveSelection(threeRounds(), {});
    expect(selected.map((r) => r.key)).toEqual(['1:0', '1:1']);
  });

  test('an override can add an incomplete round or remove a completed one', () => {
    const selected = resolveSelection(threeRounds(), { '1:2': true, '1:0': false });
    expect(selected.map((r) => r.key)).toEqual(['1:1', '1:2']);
  });
});

describe('computeMyStats', () => {
  test('bundles round count, metrics, form and ranking', () => {
    const h = holes18();
    const my = collectMyRounds([{
      id: 1, name: 'T', players: [{ id: 'p1', handicap: 0, user_id: 'u1' }],
      rounds: [
        mkRound({ holes: h, scores: { p1: evenScores(h, 4) }, playerHandicaps: { p1: 0 } }),
        mkRound({ holes: h, scores: { p1: evenScores(h, 5) }, playerHandicaps: { p1: 0 } }),
      ],
    }], 'u1');
    const stats = computeMyStats(my, { n: 5 });
    expect(stats.roundCount).toBe(2);
    expect(stats.metrics.avgPoints).toBe(27);
    expect(stats.form.metrics.length).toBe(6);
    expect(stats.ranking).toHaveProperty('strengths');
    expect(stats.parType.par4.holes).toBe(36);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/store/__tests__/personalStats.test.js -t computeMyStats`
Expected: FAIL — "computeMyStats is not a function".

- [ ] **Step 3: Write minimal implementation**

Append to `src/store/personalStats.js`:

```js
// ── resolveSelection ──
// Given the full MyRound list and a stored override map ({ [key]: boolean }),
// returns the rounds that are active. Default (no override) = the round's
// `completed` flag. Storing only overrides means newly-played completed
// rounds are auto-included.
export function resolveSelection(myRounds, overrides = {}) {
  return (myRounds || []).filter((r) => (
    Object.prototype.hasOwnProperty.call(overrides, r.key)
      ? overrides[r.key]
      : r.completed
  ));
}

// ── computeMyStats ──
// Single entry point for the screen. `selectedRounds` is the active selection
// (already filtered via resolveSelection). The selection is the universe —
// every selected round counts in metrics, form and ranking alike.
export function computeMyStats(selectedRounds, { n = 5 } = {}) {
  const rounds = selectedRounds || [];
  const synthetic = buildSyntheticTournament(rounds);
  return {
    roundCount: rounds.length,
    metrics: computeMetrics(synthetic),
    form: computeRecentVsHistory(rounds, n),
    ranking: rankStrengths(synthetic),
    parType: parTypeSplit(synthetic, CANON_ID),
    difficulty: holeDifficultySplit(synthetic, CANON_ID),
    frontBack: frontBackSplit(synthetic)[0] ?? null,
    warmupClosing: warmupVsClosing(synthetic, CANON_ID),
    distribution: playerScoreDistribution(synthetic, CANON_ID),
    teeShot: teeShotImpact(synthetic, CANON_ID),
    shots: shotStats(synthetic, CANON_ID),
    bounceBack: bounceBackRate(synthetic)[0] ?? null,
    history: playerRoundHistory(synthetic, CANON_ID),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/store/__tests__/personalStats.test.js`
Expected: PASS — every personalStats test.

- [ ] **Step 5: Run the full suite and lint**

Run: `npm test`
Expected: PASS — all suites green.
Run: `npx eslint src/store/personalStats.js src/store/statsEngine.js`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/store/personalStats.js src/store/__tests__/personalStats.test.js
git commit -m "feat: resolveSelection + computeMyStats entry point"
```

---

## Task 8: Register `MyStats` route + rewire Home menu

**Files:**
- Modify: `App.js:47` (imports) and `App.js:271` (route list)
- Modify: `src/screens/HomeScreen.js:893`

- [ ] **Step 1: Add the screen import in `App.js`**

After the existing line `import StatsScreen from './src/screens/StatsScreen';` (line 47), add:

```js
import MyStatsScreen from './src/screens/MyStatsScreen';
```

- [ ] **Step 2: Register the route in `App.js`**

Immediately after the line `<Stack.Screen name="Stats" component={StatsScreen} />` (line 271), add:

```jsx
<Stack.Screen name="MyStats" component={MyStatsScreen} />
```

- [ ] **Step 3: Point the play-menu "Statistics" item at the new route**

In `src/screens/HomeScreen.js`, the list-view overflow menu item (around line 893) currently reads:

```jsx
onPress={() => { setShowListMenu(false); navigation.navigate('Stats'); }}
```

Change it to:

```jsx
onPress={() => { setShowListMenu(false); navigation.navigate('MyStats'); }}
```

Leave the in-tournament settings-menu item (around line 1503) **unchanged** — it stays `navigation.navigate('Stats')`.

- [ ] **Step 4: Create a temporary placeholder so the app builds**

Create `src/screens/MyStatsScreen.js`:

```jsx
import React from 'react';
import { View, Text } from 'react-native';

export default function MyStatsScreen() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>My Stats — placeholder</Text>
    </View>
  );
}
```

- [ ] **Step 5: Verify the app builds and routes**

Run: `npm run web`
Manual check: open the Home list view → overflow menu → "Statistics" → the placeholder screen renders. Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add App.js src/screens/HomeScreen.js src/screens/MyStatsScreen.js
git commit -m "feat: register MyStats route, point play-menu Statistics at it"
```

---

## Task 9: `MyStatsScreen` — data loading + loading/empty/error states

Replaces the placeholder with real data loading and the header.

**Files:**
- Modify: `src/screens/MyStatsScreen.js` (full rewrite)

- [ ] **Step 1: Implement the screen shell**

Replace the entire contents of `src/screens/MyStatsScreen.js`:

```jsx
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { loadAllTournamentsWithFallback } from '../store/tournamentStore';
import { collectMyRounds, resolveSelection, computeMyStats } from '../store/personalStats';

const SELECTION_PREFIX = '@mystats_round_selection:';

export default function MyStatsScreen({ navigation }) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const [myRounds, setMyRounds] = useState(null);   // null = loading
  const [error, setError] = useState(false);
  const [overrides, setOverrides] = useState({});
  const [metric, setMetric] = useState('points');   // 'points' | 'strokes'
  const [n, setN] = useState(5);
  const [selectorOpen, setSelectorOpen] = useState(false);

  const storageKey = user?.id ? `${SELECTION_PREFIX}${user.id}` : null;

  // Load all tournaments → collect this user's rounds. Restore stored overrides.
  useEffect(() => {
    let cancelled = false;
    setError(false);
    (async () => {
      try {
        const { list } = await loadAllTournamentsWithFallback();
        const rounds = collectMyRounds(list, user?.id);
        let stored = {};
        if (storageKey) {
          try {
            const raw = await AsyncStorage.getItem(storageKey);
            if (raw) stored = JSON.parse(raw) || {};
          } catch (_) { /* ignore corrupt storage */ }
        }
        // Drop overrides whose round no longer exists.
        const liveKeys = new Set(rounds.map((r) => r.key));
        const clean = {};
        Object.keys(stored).forEach((k) => {
          if (liveKeys.has(k)) clean[k] = stored[k];
        });
        if (!cancelled) {
          setMyRounds(rounds);
          setOverrides(clean);
        }
      } catch (e) {
        console.warn('MyStatsScreen: failed to load tournaments', e);
        if (!cancelled) setError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, storageKey]);

  const persistOverrides = useCallback((next) => {
    setOverrides(next);
    if (storageKey) {
      AsyncStorage.setItem(storageKey, JSON.stringify(next)).catch(() => {});
    }
  }, [storageKey]);

  const selected = useMemo(
    () => (myRounds ? resolveSelection(myRounds, overrides) : []),
    [myRounds, overrides],
  );
  const stats = useMemo(
    () => (selected.length ? computeMyStats(selected, { n }) : null),
    [selected, n],
  );

  const Header = (
    <View style={s.header}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
        <Feather name="chevron-left" size={22} color={theme.accent.primary} />
      </TouchableOpacity>
      <Text style={s.headerTitle}>My Stats</Text>
      <TouchableOpacity
        onPress={() => setSelectorOpen(true)}
        style={s.roundsBtn}
        disabled={!myRounds}
      >
        <Feather name="sliders" size={14} color={theme.accent.primary} />
        <Text style={s.roundsBtnText}>
          {myRounds ? `${selected.length} of ${myRounds.length}` : '—'}
        </Text>
      </TouchableOpacity>
    </View>
  );

  // ── Loading ──
  if (myRounds === null && !error) {
    return (
      <SafeAreaView style={s.container} edges={['top', 'bottom']}>
        {Header}
        <View style={s.center}>
          <ActivityIndicator color={theme.accent.primary} />
        </View>
      </SafeAreaView>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <SafeAreaView style={s.container} edges={['top', 'bottom']}>
        {Header}
        <View style={s.center}>
          <Feather name="wifi-off" size={32} color={theme.text.muted} />
          <Text style={s.emptyText}>Couldn't load your stats.</Text>
          <TouchableOpacity
            style={s.retryBtn}
            onPress={() => { setMyRounds(null); setError(false); }}
          >
            <Text style={s.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Empty: no rounds at all ──
  if (myRounds.length === 0) {
    return (
      <SafeAreaView style={s.container} edges={['top', 'bottom']}>
        {Header}
        <View style={s.center}>
          <Feather name="bar-chart-2" size={32} color={theme.text.muted} />
          <Text style={s.emptyText}>Play and score a round to see your stats.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const Selector = (
    <MyStatsRoundSelector
      visible={selectorOpen}
      myRounds={myRounds}
      overrides={overrides}
      onChange={persistOverrides}
      onClose={() => setSelectorOpen(false)}
    />
  );

  // ── Empty: every round deselected ──
  if (selected.length === 0) {
    return (
      <SafeAreaView style={s.container} edges={['top', 'bottom']}>
        {Header}
        <View style={s.center}>
          <Feather name="filter" size={32} color={theme.text.muted} />
          <Text style={s.emptyText}>No rounds selected.</Text>
          <TouchableOpacity style={s.retryBtn} onPress={() => setSelectorOpen(true)}>
            <Text style={s.retryText}>Choose rounds</Text>
          </TouchableOpacity>
        </View>
        {Selector}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={['top', 'bottom']}>
      {Header}
      <ScrollView contentContainerStyle={s.scroll}>
        {/* Sections added in Tasks 11-12 */}
        <Text style={s.debugText}>{stats.roundCount} rounds in scope</Text>
      </ScrollView>
      {Selector}
    </SafeAreaView>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.bg.primary },
    header: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border.default,
    },
    backBtn: { padding: theme.spacing.xs },
    headerTitle: { ...theme.typography.heading, color: theme.text.primary, flex: 1, marginLeft: theme.spacing.sm },
    roundsBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: theme.spacing.md, paddingVertical: 6,
      borderRadius: theme.radius.pill, backgroundColor: theme.accent.light,
    },
    roundsBtnText: { ...theme.typography.caption, color: theme.accent.primary, fontWeight: '700' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.md, padding: theme.spacing.xl },
    emptyText: { ...theme.typography.body, color: theme.text.muted, textAlign: 'center' },
    retryBtn: {
      paddingHorizontal: theme.spacing.xl, paddingVertical: theme.spacing.sm,
      borderRadius: theme.radius.pill, backgroundColor: theme.accent.primary,
    },
    retryText: { ...theme.typography.subhead, color: theme.text.inverse },
    scroll: { padding: theme.spacing.lg, gap: theme.spacing.lg },
    debugText: { ...theme.typography.body, color: theme.text.muted },
  });
}
```

Note: this file imports `MyStatsRoundSelector` and the section components, which are added in Tasks 10–12. Add the import line for the selector now so the next task only adds the file:

At the top of `src/screens/MyStatsScreen.js`, add after the other imports:

```js
import MyStatsRoundSelector from '../components/MyStatsRoundSelector';
```

(Task 10 creates that file. The app will not run cleanly until Task 10 is done — that is expected; do not run `npm run web` for this task.)

- [ ] **Step 2: Run tests + lint**

Run: `npm test`
Expected: PASS (no new tests, suite stays green — tests do not import the screen).
Run: `npx eslint src/screens/MyStatsScreen.js`
Expected: no errors (eslint does not resolve the missing module; if it reports `import/no-unresolved`, ignore it — Task 10 creates the file).

- [ ] **Step 3: Commit**

```bash
git add src/screens/MyStatsScreen.js
git commit -m "feat: MyStatsScreen shell — load, loading/empty/error states"
```

---

## Task 10: Round selector sheet

**Files:**
- Create: `src/components/MyStatsRoundSelector.js`

- [ ] **Step 1: Create the selector component**

Create `src/components/MyStatsRoundSelector.js`:

```jsx
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, Pressable, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { resolveSelection } from '../store/personalStats';

// Bottom-sheet round selector. Rounds are grouped by tournament, newest-first.
// `overrides` is the { [key]: boolean } map; `onChange` receives the next map.
export default function MyStatsRoundSelector({ visible, myRounds, overrides, onChange, onClose }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const selectedKeys = useMemo(
    () => new Set(resolveSelection(myRounds, overrides).map((r) => r.key)),
    [myRounds, overrides],
  );

  // Group by tournament, newest first (myRounds is chronological oldest-first).
  const groups = useMemo(() => {
    const byId = new Map();
    myRounds.forEach((r) => {
      if (!byId.has(r.tournamentId)) {
        byId.set(r.tournamentId, { id: r.tournamentId, name: r.tournamentName, rounds: [] });
      }
      byId.get(r.tournamentId).rounds.push(r);
    });
    return [...byId.values()].reverse();
  }, [myRounds]);

  // Set an explicit override; drop it when it matches the round's default.
  const setRound = (round, value) => {
    const next = { ...overrides };
    if (value === round.completed) delete next[round.key];
    else next[round.key] = value;
    onChange(next);
  };

  const setAll = (value) => {
    const next = {};
    myRounds.forEach((r) => { if (value !== r.completed) next[r.key] = value; });
    onChange(next);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => {}}>
          <View style={s.handle} />
          <View style={s.titleRow}>
            <Text style={s.title}>Rounds counted</Text>
            <View style={s.bulkRow}>
              <TouchableOpacity onPress={() => setAll(true)}>
                <Text style={s.bulkBtn}>Select all</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setAll(false)}>
                <Text style={s.bulkBtn}>Clear all</Text>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView style={s.list}>
            {groups.map((g) => (
              <View key={g.id} style={s.group}>
                <Text style={s.groupName}>{g.name}</Text>
                {g.rounds.map((r) => {
                  const on = selectedKeys.has(r.key);
                  return (
                    <TouchableOpacity
                      key={r.key}
                      style={s.row}
                      onPress={() => setRound(r, !on)}
                      activeOpacity={0.7}
                    >
                      <Feather
                        name={on ? 'check-square' : 'square'}
                        size={18}
                        color={on ? theme.accent.primary : theme.text.muted}
                      />
                      <Text style={s.rowText} numberOfLines={1}>
                        Round {r.roundIndex + 1} · {r.courseName}
                      </Text>
                      {!r.completed && <Text style={s.tag}>In progress</Text>}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </ScrollView>

          <Text style={s.footer}>
            {selectedKeys.size} of {myRounds.length} rounds
          </Text>
          <TouchableOpacity style={s.doneBtn} onPress={onClose}>
            <Text style={s.doneText}>Done</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: theme.bg.elevated,
      borderTopLeftRadius: theme.radius.xl, borderTopRightRadius: theme.radius.xl,
      paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.xl,
      paddingTop: theme.spacing.sm, maxHeight: '80%',
    },
    handle: {
      width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border.default,
      alignSelf: 'center', marginBottom: theme.spacing.md,
    },
    titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.spacing.sm },
    title: { ...theme.typography.heading, color: theme.text.primary },
    bulkRow: { flexDirection: 'row', gap: theme.spacing.md },
    bulkBtn: { ...theme.typography.caption, color: theme.accent.primary, fontWeight: '700' },
    list: { marginVertical: theme.spacing.sm },
    group: { marginBottom: theme.spacing.md },
    groupName: { ...theme.typography.overline, color: theme.text.muted, marginBottom: theme.spacing.xs },
    row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingVertical: theme.spacing.sm },
    rowText: { ...theme.typography.body, color: theme.text.primary, flex: 1 },
    tag: { ...theme.typography.tiny, color: theme.text.inverse, backgroundColor: theme.text.muted, paddingHorizontal: 6, paddingVertical: 2, borderRadius: theme.radius.sm, overflow: 'hidden' },
    footer: { ...theme.typography.caption, color: theme.text.muted, textAlign: 'center', marginTop: theme.spacing.sm },
    doneBtn: {
      marginTop: theme.spacing.md, paddingVertical: theme.spacing.md,
      borderRadius: theme.radius.pill, backgroundColor: theme.accent.primary, alignItems: 'center',
    },
    doneText: { ...theme.typography.subhead, color: theme.text.inverse },
  });
}
```

- [ ] **Step 2: Run tests + lint**

Run: `npm test`
Expected: PASS.
Run: `npx eslint src/components/MyStatsRoundSelector.js src/screens/MyStatsScreen.js`
Expected: no errors.

- [ ] **Step 3: Verify in the browser**

Run: `npm run web`
Manual check: open Home → menu → "Statistics" → the screen loads; tap the rounds chip → the sheet lists rounds grouped by tournament; toggling a round updates the "X of Y" count; closing and reopening the screen keeps the selection (AsyncStorage persisted). Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/components/MyStatsRoundSelector.js
git commit -m "feat: MyStats round selector sheet with persistent selection"
```

---

## Task 11: Snapshot card + Form section

**Files:**
- Modify: `src/screens/MyStatsScreen.js`

- [ ] **Step 1: Replace the ScrollView body with the snapshot and form sections**

In `src/screens/MyStatsScreen.js`, replace:

```jsx
      <ScrollView contentContainerStyle={s.scroll}>
        {/* Sections added in Tasks 11-12 */}
        <Text style={s.debugText}>{stats.roundCount} rounds in scope</Text>
      </ScrollView>
```

with:

```jsx
      <ScrollView contentContainerStyle={s.scroll}>
        <Snapshot stats={stats} metric={metric} onToggleMetric={setMetric} s={s} theme={theme} />
        <FormSection form={stats.form} n={n} onChangeN={setN} s={s} theme={theme} />
      </ScrollView>
```

- [ ] **Step 2: Add the Snapshot and FormSection components**

In `src/screens/MyStatsScreen.js`, add the `fmtVsPar` helper just below the `SELECTION_PREFIX` constant (above the `MyStatsScreen` component):

```js
// Format strokes-vs-par with an explicit sign.
function fmtVsPar(v) {
  if (v > 0) return `+${v}`;
  return `${v}`;
}
```

Then add these components immediately above the `makeStyles` function:

```jsx
function Snapshot({ stats, metric, onToggleMetric, s, theme }) {
  const { metrics } = stats;
  const headline = stats.form.hasHistory ? stats.form.metrics[0].direction : 'flat';
  const arrow = headline === 'up' ? '▲' : headline === 'down' ? '▼' : '—';
  const arrowColor = headline === 'up' ? theme.accent.primary
    : headline === 'down' ? theme.destructive : theme.text.muted;
  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <Text style={s.cardTitle}>Snapshot</Text>
        <View style={s.metricToggle}>
          {['points', 'strokes'].map((m) => (
            <TouchableOpacity
              key={m}
              onPress={() => onToggleMetric(m)}
              style={[s.metricChip, metric === m && s.metricChipOn]}
            >
              <Text style={[s.metricChipText, metric === m && s.metricChipTextOn]}>
                {m === 'points' ? 'Points' : 'Strokes'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <View style={s.statRow}>
        <Stat label="Rounds" value={`${stats.roundCount}`} s={s} />
        <Stat
          label={metric === 'points' ? 'Avg pts / round' : 'Avg vs par'}
          value={metric === 'points' ? `${metrics.avgPoints}` : fmtVsPar(metrics.avgVsPar)}
          s={s}
        />
        <Stat label="Best round" value={`${metrics.bestRoundPoints} pts`} s={s} />
        <Stat label="Form" value={arrow} valueColor={arrowColor} s={s} />
      </View>
    </View>
  );
}

function Stat({ label, value, valueColor, s }) {
  return (
    <View style={s.stat}>
      <Text style={[s.statValue, valueColor && { color: valueColor }]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function FormSection({ form, n, onChangeN, s, theme }) {
  return (
    <View style={s.card}>
      <View style={s.cardHead}>
        <Text style={s.cardTitle}>Recent vs History</Text>
        <View style={s.metricToggle}>
          {[3, 5, 10].map((opt) => (
            <TouchableOpacity
              key={opt}
              onPress={() => onChangeN(opt)}
              style={[s.metricChip, n === opt && s.metricChipOn]}
            >
              <Text style={[s.metricChipText, n === opt && s.metricChipTextOn]}>
                {`Last ${opt}`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <View style={s.formRow}>
        <Text style={[s.formLabel, s.formHeadCell]}>Metric</Text>
        <Text style={[s.formRecent, s.formHeadCell]}>Recent</Text>
        <Text style={[s.formHistory, s.formHeadCell]}>History</Text>
        <Text style={[s.formDelta, s.formHeadCell]}>Trend</Text>
      </View>
      {!form.hasHistory && (
        <Text style={s.note}>
          Not enough history yet — play more than {n} rounds to compare.
        </Text>
      )}
      {form.metrics.map((m) => {
        const color = m.direction === 'up' ? theme.accent.primary
          : m.direction === 'down' ? theme.destructive : theme.text.muted;
        const sign = m.delta != null && m.delta > 0 ? '+' : '';
        return (
          <View key={m.key} style={s.formRow}>
            <Text style={s.formLabel}>{m.label}</Text>
            <Text style={s.formRecent}>{m.recent}</Text>
            <Text style={s.formHistory}>{form.hasHistory ? m.history : '—'}</Text>
            <Text style={[s.formDelta, { color }]}>
              {m.delta == null ? '—'
                : m.direction === 'up' ? `▲ ${sign}${m.delta}`
                  : m.direction === 'down' ? `▼ ${sign}${m.delta}` : `${m.delta}`}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
```

- [ ] **Step 3: Add the supporting styles**

In `src/screens/MyStatsScreen.js`, inside the `StyleSheet.create({ ... })` object in `makeStyles`, remove the `debugText` entry and add:

```js
    card: {
      backgroundColor: theme.bg.card, borderRadius: theme.radius.lg,
      padding: theme.spacing.lg, gap: theme.spacing.sm,
      borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
    },
    cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    cardTitle: { ...theme.typography.heading, color: theme.text.primary },
    metricToggle: { flexDirection: 'row', gap: 4 },
    metricChip: {
      paddingHorizontal: theme.spacing.sm, paddingVertical: 4,
      borderRadius: theme.radius.pill, backgroundColor: theme.bg.secondary,
    },
    metricChipOn: { backgroundColor: theme.accent.primary },
    metricChipText: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '700' },
    metricChipTextOn: { color: theme.text.inverse },
    statRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.spacing.sm },
    stat: { alignItems: 'center', flex: 1 },
    statValue: { ...theme.typography.title, color: theme.text.primary },
    statLabel: { ...theme.typography.tiny, color: theme.text.muted, textAlign: 'center' },
    note: { ...theme.typography.caption, color: theme.text.muted, fontStyle: 'italic' },
    formRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
    formLabel: { ...theme.typography.body, color: theme.text.primary, flex: 2 },
    formRecent: { ...theme.typography.body, color: theme.text.primary, flex: 1, textAlign: 'right' },
    formHistory: { ...theme.typography.body, color: theme.text.muted, flex: 1, textAlign: 'right' },
    formDelta: { ...theme.typography.caption, fontWeight: '700', flex: 1, textAlign: 'right' },
    formHeadCell: { ...theme.typography.overline, color: theme.text.muted },
    subhead: { ...theme.typography.subhead, color: theme.text.secondary, marginTop: theme.spacing.sm },
    insightRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingVertical: 6 },
    insightText: { ...theme.typography.body, color: theme.text.primary, flex: 1 },
    insightDelta: { ...theme.typography.caption, fontWeight: '700' },
    dim: { color: theme.text.muted },
```

(The `subhead`, `insightRow`, `insightText`, `insightDelta`, and `dim` entries are used by Task 12 — adding them now keeps the styles in one edit.)

- [ ] **Step 4: Run tests + lint**

Run: `npm test`
Expected: PASS.
Run: `npx eslint src/screens/MyStatsScreen.js`
Expected: no errors.

- [ ] **Step 5: Verify in the browser**

Run: `npm run web`
Manual check: open My Stats → the Snapshot card shows rounds / avg / best / form arrow; the metric toggle switches the middle stat; the "Recent vs History" card lists six metrics with trend arrows; the `Last 3/5/10` chips change the split. Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/screens/MyStatsScreen.js
git commit -m "feat: MyStats snapshot card and recent-vs-history form section"
```

---

## Task 12: Strengths & Pain Points + breakdown cards

**Files:**
- Modify: `src/screens/MyStatsScreen.js`

- [ ] **Step 1: Extend the ScrollView body**

In `src/screens/MyStatsScreen.js`, replace:

```jsx
      <ScrollView contentContainerStyle={s.scroll}>
        <Snapshot stats={stats} metric={metric} onToggleMetric={setMetric} s={s} theme={theme} />
        <FormSection form={stats.form} n={n} onChangeN={setN} s={s} theme={theme} />
      </ScrollView>
```

with:

```jsx
      <ScrollView contentContainerStyle={s.scroll}>
        <Snapshot stats={stats} metric={metric} onToggleMetric={setMetric} s={s} theme={theme} />
        <FormSection form={stats.form} n={n} onChangeN={setN} s={s} theme={theme} />
        <StrengthsSection ranking={stats.ranking} s={s} theme={theme} />
        <BreakdownSection title="Par type" rows={[
          ['Par 3s', stats.parType.par3.avgPoints, stats.parType.par3.holes],
          ['Par 4s', stats.parType.par4.avgPoints, stats.parType.par4.holes],
          ['Par 5s', stats.parType.par5.avgPoints, stats.parType.par5.holes],
        ]} s={s} />
        <BreakdownSection title="Hole difficulty" rows={[
          ['Hard (SI 1-6)', stats.difficulty.hard.avgPoints, stats.difficulty.hard.holes],
          ['Mid (SI 7-12)', stats.difficulty.mid.avgPoints, stats.difficulty.mid.holes],
          ['Easy (SI 13-18)', stats.difficulty.easy.avgPoints, stats.difficulty.easy.holes],
        ]} s={s} />
        <BreakdownSection title="Round shape" rows={[
          ['Front nine', stats.frontBack ? stats.frontBack.frontAvg : 0, stats.frontBack ? stats.frontBack.rounds.length * 9 : 0],
          ['Back nine', stats.frontBack ? stats.frontBack.backAvg : 0, stats.frontBack ? stats.frontBack.rounds.length * 9 : 0],
          ['Opening 3', stats.warmupClosing.warmup.avgPoints, stats.warmupClosing.warmup.holes],
          ['Closing 3', stats.warmupClosing.closing.avgPoints, stats.warmupClosing.closing.holes],
        ]} s={s} />
        <DistributionSection dist={stats.distribution} s={s} />
        {stats.teeShot.hasData ? (
          <BreakdownSection title="Tee shot impact" rows={[
            ['Fairway found', stats.teeShot.fairway.avgPoints, stats.teeShot.fairway.holes],
            ['Fairway missed', stats.teeShot.missed.avgPoints, stats.teeShot.missed.holes],
            ['Miss left', stats.teeShot.byDirection.left.avgPoints, stats.teeShot.byDirection.left.holes],
            ['Miss right', stats.teeShot.byDirection.right.avgPoints, stats.teeShot.byDirection.right.holes],
            ['Miss short', stats.teeShot.byDirection.short.avgPoints, stats.teeShot.byDirection.short.holes],
            ['After tee penalty', stats.teeShot.teePenalty.avgPoints, stats.teeShot.teePenalty.holes],
          ]} s={s} />
        ) : null}
        {stats.shots.hasData ? (
          <BreakdownSection title="Putting & driving" rows={[
            ['Putts / round', stats.shots.putts.perRound, stats.shots.putts.holes],
            ['1-putts', stats.shots.putts.onePutts, stats.shots.putts.holes],
            ['3-putts+', stats.shots.putts.threePuttPlus, stats.shots.putts.holes],
            ['Fairways hit %', stats.shots.drives.fairwayPct, stats.shots.drives.recorded],
            ['Greens in reg %', stats.shots.gir.pct, stats.shots.gir.eligible],
            ['Penalties / round', stats.shots.penalties.total, stats.shots.roundsWithData],
          ]} s={s} />
        ) : null}
        {!stats.teeShot.hasData && !stats.shots.hasData ? (
          <View style={s.card}>
            <Text style={s.note}>
              Log putts and drives during a round to unlock tee-shot, putting and
              driving stats.
            </Text>
          </View>
        ) : null}
      </ScrollView>
```

- [ ] **Step 2: Add the section components**

In `src/screens/MyStatsScreen.js`, add these components immediately above the `makeStyles` function:

```jsx
function StrengthsSection({ ranking, s, theme }) {
  const Row = ({ cell, kind }) => (
    <View style={s.insightRow}>
      <Feather
        name={kind === 'good' ? 'trending-up' : 'trending-down'}
        size={16}
        color={kind === 'good' ? theme.accent.primary : theme.destructive}
      />
      <Text style={s.insightText}>
        {cell.label} — {cell.avgPoints} pts/hole
      </Text>
      <Text style={[s.insightDelta, { color: kind === 'good' ? theme.accent.primary : theme.destructive }]}>
        {cell.deviation > 0 ? `+${cell.deviation}` : `${cell.deviation}`}
      </Text>
    </View>
  );
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>Strengths & Pain Points</Text>
      {ranking.baseline == null ? (
        <Text style={s.note}>Not enough data yet.</Text>
      ) : (
        <>
          <Text style={s.subhead}>What's working</Text>
          {ranking.strengths.length === 0 && <Text style={s.note}>Nothing stands out yet.</Text>}
          {ranking.strengths.map((c) => <Row key={c.label} cell={c} kind="good" />)}
          <Text style={s.subhead}>Where you're losing points</Text>
          {ranking.weaknesses.length === 0 && <Text style={s.note}>Nothing stands out yet.</Text>}
          {ranking.weaknesses.map((c) => <Row key={c.label} cell={c} kind="bad" />)}
          <Text style={s.note}>Measured against your {ranking.baseline} pts/hole average.</Text>
        </>
      )}
    </View>
  );
}

// rows: array of [label, value, sample]. Rows with sample 0 are dimmed.
function BreakdownSection({ title, rows, s }) {
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>{title}</Text>
      {rows.map(([label, value, sample]) => (
        <View key={label} style={s.formRow}>
          <Text style={[s.formLabel, sample === 0 && s.dim]}>{label}</Text>
          <Text style={[s.formRecent, sample === 0 && s.dim]}>{sample === 0 ? '—' : value}</Text>
          <Text style={[s.formHistory, s.dim]}>{sample === 0 ? '' : `${sample} ×`}</Text>
        </View>
      ))}
    </View>
  );
}

function DistributionSection({ dist, s }) {
  const rows = [
    ['Eagles+', dist.eagles], ['Birdies', dist.birdies], ['Pars', dist.pars],
    ['Bogeys', dist.bogeys], ['Doubles', dist.doubles], ['Triple+', dist.worse],
  ];
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>Score distribution</Text>
      {rows.map(([label, count]) => (
        <View key={label} style={s.formRow}>
          <Text style={s.formLabel}>{label}</Text>
          <Text style={s.formRecent}>{count}</Text>
          <Text style={[s.formHistory, s.dim]}>
            {dist.total > 0 ? `${Math.round((count / dist.total) * 100)}%` : '—'}
          </Text>
        </View>
      ))}
    </View>
  );
}
```

(The styles these components use — `subhead`, `insightRow`, `insightText`, `insightDelta`, `dim` — were already added to `makeStyles` in Task 11.)

- [ ] **Step 3: Run tests + lint**

Run: `npm test`
Expected: PASS.
Run: `npx eslint src/screens/MyStatsScreen.js`
Expected: no errors.

- [ ] **Step 4: Verify in the browser**

Run: `npm run web`
Manual check: open My Stats → confirm the Strengths & Pain Points lists render with up/down icons; the Par type / Hole difficulty / Round shape / Score distribution cards show numbers; with shot data, the Tee shot impact and Putting & driving cards appear; without shot data, the single muted notice appears instead. Toggle rounds in the selector and confirm every section recomputes. Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/screens/MyStatsScreen.js
git commit -m "feat: MyStats strengths, breakdowns, distribution and shot cards"
```

---

## Final verification

- [ ] **Run the full test suite**

Run: `npm test`
Expected: PASS — all suites, including the new `personalStats.test.js` and `statsEngine.test.js`.

- [ ] **Lint the whole change set**

Run: `npx eslint src/store/personalStats.js src/store/statsEngine.js src/screens/MyStatsScreen.js src/components/MyStatsRoundSelector.js App.js src/screens/HomeScreen.js`
Expected: no errors.

- [ ] **End-to-end manual check**

Run: `npm run web`. Verify:
1. Home → menu → "Statistics" opens **My Stats** (not the per-tournament screen).
2. Opening a tournament → settings → "Statistics" still opens the per-tournament `Stats` screen.
3. The round selector defaults to all completed rounds; toggling persists across a reload.
4. Snapshot, Form, Strengths, and breakdown sections all render and recompute when the selection changes.
5. Empty states appear correctly with zero rounds and with everything deselected.
