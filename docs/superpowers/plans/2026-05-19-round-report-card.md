# Round Report Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-round personal "Report Card" — a good/bad retrospective — as the first tab of the personal stats screen, reachable directly after finishing a round.

**Architecture:** A new pure module `roundReportCard.js` diffs one round against the player's career average by reusing `computeMyStats` from `personalStats.js`. A presentational `RoundReportCard` component renders verdict + callouts + an expandable breakdown. `MyStatsScreen` gains a default first tab with a round dropdown; `ScorecardScreen` redirects there on round finish.

**Tech Stack:** React Native, Jest. Pure stats modules in `src/store/`, screens in `src/screens/`, components in `src/components/`.

---

## Background — verified facts about the existing code

Engine functions the new module builds on (all pure, all already exist):

- `computeMyStats(selectedRounds, { n })` in `src/store/personalStats.js` returns
  `{ roundCount, metrics, form, ranking, parType, difficulty, frontBack, warmupClosing, distribution, teeShot, shots, bounceBack, scrambling, history }`.
- `computeMyStats` internally calls `buildSyntheticTournament(myRounds)`, which re-keys
  each `MyRound`'s `round.scores`/`shotDetails`/`playerHandicaps` from `mr.playerId` to a
  canonical id. A `MyRound` is `{ key, round, playerId, player, completed, courseName, tournamentName, tournamentDate, roundIndex, points }` — produced by `collectMyRounds`.
- `metrics` = `{ rounds, avgPoints, avgVsPar, bestRoundPoints, hasShotData, fairwayPct, puttsPerRound, girPct, threePuttsPerRound }`. `avgPoints` is total Stableford points per round.
- `parType` = `{ par3, par4, par5 }`, each `{ holes, avgPoints, avgStrokes, totalPoints, breakdown }`.
- `difficulty` = `{ hard, mid, easy }`, each `{ holes, avgPoints, breakdown }`.
- `warmupClosing` = `{ warmup: { avgPoints, holes, breakdown }, closing: {…}, delta }`.
- `frontBack` = `frontBackSplit(...)[0]` → `{ player, rounds, frontAvg, backAvg, frontTotal, backTotal, delta }` **or `null`** (null whenever the round is not a fully-scored 18-hole round).
- `distribution` = `{ eagles, birdies, pars, bogeys, doubles, worse, total, …Holes }` (net Stableford). "Blow-ups" = `doubles + worse`.
- `shots` = `{ hasData, roundsWithData, putts: { total, holes, perHole, perRound, onePutts, threePuttPlus }, drives: { recorded, fairwaysHit, fairwayPct, distribution }, penalties: { tee, other, total }, gir: { holes, eligible, pct } }`.
- `history` = array of `{ roundIndex, courseName, points, strokes, holesPlayed, avgPerHole }` (one entry per round with scores).
- `computeMyStats([])` does NOT return null — it returns an all-zero object. The new
  module must therefore treat an empty history list explicitly as "no history".

Test conventions (`src/store/__tests__/personalStats.test.js`): plain Jest, fixture
helpers built inline at the top of the file, `calcStablefordPoints(par, strokes, 0, si)`
with handicap 0 gives `2 + par - strokes` floored at 0 (so a par-4 hole: strokes 4 → 2 pts,
3 → 3 pts, 5 → 1 pt).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/store/roundReportCard.js` | New. Pure `buildRoundReportCard(myRounds, roundKey)` → `ReportCard` object. |
| `src/store/__tests__/roundReportCard.test.js` | New. Unit tests for the module. |
| `src/components/RoundReportCard.js` | New. Presentational component: dropdown + verdict + callouts + breakdown. |
| `src/screens/MyStatsScreen.js` | Modify. New first/default `Report Card` tab; `{ tab, roundKey }` route params. |
| `src/screens/ScorecardScreen.js` | Modify. `handleFinish` redirects non-official rounds to the Report Card. |

The `ReportCard` object shape (built incrementally across Tasks 1-3):

```
ReportCard {
  round:    { key, courseName, tournamentName, tournamentDate, holesPlayed, complete },
  headline: { points, perHole, vsAvg, clearedBenchmark, verdict },
  hasHistory: boolean,
  callouts: { bright: Cell[], cost: Cell[] },          // added Task 2
  hasShotData: boolean,                                // added Task 3
  groups:   [ { key, label, cells: Cell[] } ],         // added Task 3
}
Cell {
  label, group, value, baseline, deltaVsAvg, deltaVs2, holes, polarity
}
```

---

## Task 1: Pure module — round meta, headline & verdict

**Files:**
- Create: `src/store/roundReportCard.js`
- Test: `src/store/__tests__/roundReportCard.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/store/__tests__/roundReportCard.test.js`:

```javascript
import { buildRoundReportCard } from '../roundReportCard';

// ── Fixture helpers ───────────────────────────────────────────────
// 18 holes, par 4, strokeIndex = hole number.
function mkHoles(n = 18, par = 4) {
  return Array.from({ length: n }, (_, i) => ({ number: i + 1, par, strokeIndex: i + 1 }));
}
// scores object: every hole = `strokes`.
function evenScores(holes, strokes) {
  const o = {};
  holes.forEach((h) => { o[h.number] = strokes; });
  return o;
}
// Build a MyRound record (matches collectMyRounds output shape).
function mkMyRound({
  key, courseName = 'Course', holes, scores, shotDetails = {},
  completed = true, tournamentName = 'Cup', tournamentDate = '2026-05-01',
}) {
  return {
    key, courseName, tournamentName, tournamentDate, roundIndex: 0,
    playerId: 'p1',
    player: { id: 'p1', name: 'Me', handicap: 0, user_id: 'u1' },
    round: {
      courseName, holes,
      scores: { p1: scores },
      shotDetails: { p1: shotDetails },
      playerHandicaps: { p1: 0 },
    },
    completed,
    points: 0,
  };
}

describe('buildRoundReportCard — meta & headline', () => {
  test('returns null when the round key is not found', () => {
    const h = mkHoles();
    const rounds = [mkMyRound({ key: 'a', holes: h, scores: evenScores(h, 4) })];
    expect(buildRoundReportCard(rounds, 'missing')).toBeNull();
  });

  test('headline reports points, per-hole and round meta', () => {
    const h = mkHoles();
    // One round, all par (strokes 4 on par 4) → 2 pts/hole → 36 pts.
    const rounds = [mkMyRound({
      key: 't1:0', courseName: 'Pine', holes: h, scores: evenScores(h, 4),
    })];
    const card = buildRoundReportCard(rounds, 't1:0');
    expect(card.round).toMatchObject({
      key: 't1:0', courseName: 'Pine', tournamentName: 'Cup',
      holesPlayed: 18, complete: true,
    });
    expect(card.headline.points).toBe(36);
    expect(card.headline.perHole).toBe(2);
    expect(card.headline.clearedBenchmark).toBe(true);
    expect(card.hasHistory).toBe(false);
  });

  test('no history → verdict from per-hole vs the 2.0 benchmark', () => {
    const h = mkHoles();
    // Single round, strokes 3 on par 4 → 3 pts/hole → "Strong round".
    const rounds = [mkMyRound({ key: 'x', holes: h, scores: evenScores(h, 3) })];
    const card = buildRoundReportCard(rounds, 'x');
    expect(card.hasHistory).toBe(false);
    expect(card.headline.vsAvg).toBeNull();
    expect(card.headline.verdict).toBe('Strong round');
  });

  test('with history → verdict from points vs career average', () => {
    const h = mkHoles();
    // History: two 2-pt/hole rounds (36 pts each). Target: 3 pts/hole (54 pts).
    const rounds = [
      mkMyRound({ key: 'h1', holes: h, scores: evenScores(h, 4) }),
      mkMyRound({ key: 'h2', holes: h, scores: evenScores(h, 4) }),
      mkMyRound({ key: 'target', holes: h, scores: evenScores(h, 3) }),
    ];
    const card = buildRoundReportCard(rounds, 'target');
    expect(card.hasHistory).toBe(true);
    // (3.0 - 2.0) * 18 = +18 vs average.
    expect(card.headline.vsAvg).toBe(18);
    expect(card.headline.verdict).toBe('Standout round');
  });

  test('verdict bands: a round near the career average is "Solid round"', () => {
    const h = mkHoles();
    const rounds = [
      mkMyRound({ key: 'h1', holes: h, scores: evenScores(h, 4) }),
      mkMyRound({ key: 'target', holes: h, scores: evenScores(h, 4) }),
    ];
    const card = buildRoundReportCard(rounds, 'target');
    expect(card.headline.vsAvg).toBe(0);
    expect(card.headline.verdict).toBe('Solid round');
  });

  test('incomplete round: per-hole and holesPlayed reflect holes actually scored', () => {
    const h = mkHoles();
    const partial = {};
    h.slice(0, 9).forEach((hole) => { partial[hole.number] = 4; });
    const rounds = [mkMyRound({
      key: 'p', holes: h, scores: partial, completed: false,
    })];
    const card = buildRoundReportCard(rounds, 'p');
    expect(card.round.holesPlayed).toBe(9);
    expect(card.round.complete).toBe(false);
    expect(card.headline.points).toBe(18);
    expect(card.headline.perHole).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/store/__tests__/roundReportCard.test.js`
Expected: FAIL — "Cannot find module '../roundReportCard'".

- [ ] **Step 3: Write the minimal implementation**

Create `src/store/roundReportCard.js`:

```javascript
// Per-round personal Report Card.
//
// Pure module: given the user's collected rounds (MyRound[] from
// collectMyRounds) and one round's key, it diffs that round against the
// player's career average and the fixed Stableford benchmark.
//
// All heavy lifting is delegated to computeMyStats — this module only
// selects rounds, diffs the two results, and shapes the output.
// See docs/superpowers/specs/2026-05-19-round-report-card-design.md
import { computeMyStats } from './personalStats';

// Stableford points per hole when a player plays exactly to handicap.
const BENCHMARK = 2.0;

// Verdict from points-per-round delta vs the player's career average.
function verdictFromVsAvg(vsAvg) {
  if (vsAvg >= 6) return 'Standout round';
  if (vsAvg >= 2) return 'Strong round';
  if (vsAvg > -2) return 'Solid round';
  if (vsAvg > -6) return 'Off day';
  return 'Tough day';
}

// Verdict when the player has no prior rounds — judged against the benchmark.
function verdictFromPerHole(perHole) {
  if (perHole >= 2.4) return 'Strong round';
  if (perHole >= 2.0) return 'Solid round';
  if (perHole >= 1.6) return 'Off day';
  return 'Tough day';
}

// Career points-per-hole across every round in `history` (a stats object
// from computeMyStats). Returns null when there is no history.
function careerPerHole(baseStats) {
  if (!baseStats) return null;
  const totals = (baseStats.history || []).reduce(
    (acc, h) => ({ pts: acc.pts + h.points, holes: acc.holes + h.holesPlayed }),
    { pts: 0, holes: 0 },
  );
  return totals.holes > 0 ? totals.pts / totals.holes : null;
}

export function buildRoundReportCard(myRounds, roundKey) {
  const all = myRounds || [];
  const selected = all.find((r) => r.key === roundKey);
  if (!selected) return null;

  // History = every OTHER completed round — the career-average baseline.
  const history = all.filter((r) => r.key !== roundKey && r.completed);
  const hasHistory = history.length > 0;

  const thisStats = computeMyStats([selected]);
  const baseStats = hasHistory ? computeMyStats(history) : null;

  const hist = thisStats.history[0] || { points: 0, strokes: 0, holesPlayed: 0 };
  const points = hist.points;
  const holesPlayed = hist.holesPlayed;
  const perHole = holesPlayed > 0 ? +(points / holesPlayed).toFixed(2) : 0;

  const baseline = careerPerHole(baseStats);
  // vsAvg is a round-sized figure: per-hole delta projected over 18 holes,
  // which keeps it fair for 9-hole and incomplete rounds.
  const vsAvg = baseline != null ? +(((perHole - baseline) * 18)).toFixed(1) : null;

  const verdict = vsAvg != null
    ? verdictFromVsAvg(vsAvg)
    : verdictFromPerHole(perHole);

  return {
    round: {
      key: selected.key,
      courseName: selected.courseName,
      tournamentName: selected.tournamentName,
      tournamentDate: selected.tournamentDate,
      holesPlayed,
      complete: !!selected.completed,
    },
    headline: {
      points,
      perHole,
      vsAvg,
      clearedBenchmark: perHole >= BENCHMARK,
      verdict,
    },
    hasHistory,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/store/__tests__/roundReportCard.test.js`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/store/roundReportCard.js src/store/__tests__/roundReportCard.test.js
git commit -m "feat: round report card module — headline & verdict"
```

---

## Task 2: Callouts — bright spots & cost-you-points

The callout pool is the ten **net-points-per-hole** cells (par 3/4/5, hard/mid/easy
SI bands, opening 3, closing 3, front 9, back 9). They all share one unit, so ranking
them by delta is sound. Distribution and shot-stat cells (different units) are added to
the breakdown in Task 3 but are NOT in the callout pool.

**Files:**
- Modify: `src/store/roundReportCard.js`
- Test: `src/store/__tests__/roundReportCard.test.js`

- [ ] **Step 1: Write the failing test**

Append to `src/store/__tests__/roundReportCard.test.js`:

```javascript
describe('buildRoundReportCard — callouts', () => {
  // A round that is par everywhere EXCEPT par-3 holes are birdied and
  // SI 1-6 holes are double-bogeyed, against a flat 2-pt/hole history.
  function scoresWithStandoutAndWeak(holes) {
    const o = {};
    holes.forEach((h) => {
      if (h.par === 3) o[h.number] = h.par - 1;        // birdie → 3 pts
      else if (h.strokeIndex <= 6) o[h.number] = h.par + 2; // double → 0 pts
      else o[h.number] = h.par;                        // par → 2 pts
    });
    return o;
  }

  test('bright spots and cost cells rank by delta vs career average', () => {
    // 18 holes: holes 1-3 are par 3, rest par 4. SI = hole number.
    const holes = Array.from({ length: 18 }, (_, i) => ({
      number: i + 1, par: i < 3 ? 3 : 4, strokeIndex: i + 1,
    }));
    const flat = {};
    holes.forEach((h) => { flat[h.number] = h.par; }); // 2 pts everywhere
    const rounds = [
      mkMyRound({ key: 'h1', holes, scores: flat }),
      mkMyRound({ key: 'h2', holes, scores: flat }),
      mkMyRound({ key: 'target', holes, scores: scoresWithStandoutAndWeak(holes) }),
    ];
    const card = buildRoundReportCard(rounds, 'target');
    const brightLabels = card.callouts.bright.map((c) => c.label);
    const costLabels = card.callouts.cost.map((c) => c.label);
    expect(brightLabels).toContain('Par 3s');
    expect(costLabels).toContain('Hard holes (SI 1-6)');
    expect(card.callouts.bright.length).toBeLessThanOrEqual(2);
    expect(card.callouts.cost.length).toBeLessThanOrEqual(2);
  });

  test('a cell with fewer than 3 holes this round is not callout-eligible', () => {
    // Only ONE par-3 hole — Par 3s has a 1-hole sample and must be excluded
    // even though it is birdied (a large delta).
    const holes = Array.from({ length: 18 }, (_, i) => ({
      number: i + 1, par: i === 0 ? 3 : 4, strokeIndex: i + 1,
    }));
    const flat = {};
    holes.forEach((h) => { flat[h.number] = h.par; });
    const target = { ...flat, 1: 2 }; // birdie the single par 3
    const rounds = [
      mkMyRound({ key: 'h1', holes, scores: flat }),
      mkMyRound({ key: 'target', holes, scores: target }),
    ];
    const card = buildRoundReportCard(rounds, 'target');
    expect(card.callouts.bright.map((c) => c.label)).not.toContain('Par 3s');
  });

  test('no history → callouts rank on delta vs the 2.0 benchmark', () => {
    const holes = Array.from({ length: 18 }, (_, i) => ({
      number: i + 1, par: i < 3 ? 3 : 4, strokeIndex: i + 1,
    }));
    const rounds = [mkMyRound({
      key: 'solo', holes, scores: scoresWithStandoutAndWeak(holes),
    })];
    const card = buildRoundReportCard(rounds, 'solo');
    expect(card.hasHistory).toBe(false);
    expect(card.callouts.bright.map((c) => c.label)).toContain('Par 3s');
    expect(card.callouts.cost.map((c) => c.label)).toContain('Hard holes (SI 1-6)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/store/__tests__/roundReportCard.test.js -t callouts`
Expected: FAIL — `card.callouts` is undefined.

- [ ] **Step 3: Write the minimal implementation**

In `src/store/roundReportCard.js`, add this constant below `BENCHMARK`:

```javascript
// A net-points-per-hole cell needs at least this many holes in the round
// to be callout-eligible — guards against fake insights off tiny samples.
const CALLOUT_MIN_HOLES = 3;
```

Add these helpers above `buildRoundReportCard`:

```javascript
// Build one net-points-per-hole cell. `thisSplit`/`baseSplit` are
// { avgPoints, holes } shaped (parType.parN, difficulty.band, warmup, …).
// Returns null when the round has no holes of this kind.
function hpCell(label, group, thisSplit, baseSplit) {
  if (!thisSplit || thisSplit.holes === 0) return null;
  const value = thisSplit.avgPoints;
  const baseline = (baseSplit && baseSplit.holes > 0) ? baseSplit.avgPoints : null;
  return {
    label,
    group,
    value,
    baseline,
    deltaVsAvg: baseline != null ? +(value - baseline).toFixed(2) : null,
    deltaVs2: +(value - BENCHMARK).toFixed(2),
    holes: thisSplit.holes,
    polarity: 'higher',
  };
}

// The ten net-points-per-hole cells: par types, difficulty bands,
// opening/closing stretch, and the two nines.
function pointsPerHoleCells(thisStats, baseStats) {
  const base = baseStats || {};
  const cells = [
    hpCell('Par 3s', 'course', thisStats.parType.par3, base.parType?.par3),
    hpCell('Par 4s', 'course', thisStats.parType.par4, base.parType?.par4),
    hpCell('Par 5s', 'course', thisStats.parType.par5, base.parType?.par5),
    hpCell('Hard holes (SI 1-6)', 'course', thisStats.difficulty.hard, base.difficulty?.hard),
    hpCell('Mid holes (SI 7-12)', 'course', thisStats.difficulty.mid, base.difficulty?.mid),
    hpCell('Easy holes (SI 13-18)', 'course', thisStats.difficulty.easy, base.difficulty?.easy),
    hpCell('Opening 3', 'timing', thisStats.warmupClosing.warmup, base.warmupClosing?.warmup),
    hpCell('Closing 3', 'timing', thisStats.warmupClosing.closing, base.warmupClosing?.closing),
  ];
  // Front/back nine come from frontBack, which is null for any round that
  // is not a fully-scored 18-hole round.
  if (thisStats.frontBack) {
    const fb = thisStats.frontBack;
    const baseFb = base.frontBack;
    cells.push(hpCell('Front 9', 'timing',
      { avgPoints: fb.frontAvg, holes: 9 },
      baseFb ? { avgPoints: baseFb.frontAvg, holes: 9 } : null));
    cells.push(hpCell('Back 9', 'timing',
      { avgPoints: fb.backAvg, holes: 9 },
      baseFb ? { avgPoints: baseFb.backAvg, holes: 9 } : null));
  }
  return cells.filter(Boolean);
}

// Pick the bright spots / cost-you-points from a cell pool.
function selectCallouts(cells, hasHistory) {
  const rankKey = hasHistory ? 'deltaVsAvg' : 'deltaVs2';
  const pool = cells.filter(
    (c) => c.holes >= CALLOUT_MIN_HOLES && c[rankKey] != null,
  );
  const bright = [...pool]
    .sort((a, b) => b[rankKey] - a[rankKey])
    .filter((c) => c[rankKey] > 0)
    .slice(0, 2);
  const cost = [...pool]
    .sort((a, b) => a[rankKey] - b[rankKey])
    .filter((c) => c[rankKey] < 0)
    .slice(0, 2);
  return { bright, cost };
}
```

In `buildRoundReportCard`, add the callout computation just before the `return`:

```javascript
  const pphCells = pointsPerHoleCells(thisStats, baseStats);
  const callouts = selectCallouts(pphCells, hasHistory);
```

And add `callouts` to the returned object (after `hasHistory`):

```javascript
    hasHistory,
    callouts,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/store/__tests__/roundReportCard.test.js`
Expected: PASS — all tests including the `callouts` describe block.

- [ ] **Step 5: Commit**

```bash
git add src/store/roundReportCard.js src/store/__tests__/roundReportCard.test.js
git commit -m "feat: round report card callouts"
```

---

## Task 3: Breakdown groups & shot data

Adds the full `groups` array (the expandable grid) and the `hasShotData` flag.
Groups: `course` and `timing` reuse the Task 2 net-points-per-hole cells;
`distribution` and `shots` are new cell kinds.

**Files:**
- Modify: `src/store/roundReportCard.js`
- Test: `src/store/__tests__/roundReportCard.test.js`

- [ ] **Step 1: Write the failing test**

Append to `src/store/__tests__/roundReportCard.test.js`:

```javascript
describe('buildRoundReportCard — breakdown groups', () => {
  test('groups cover course, timing and distribution for an 18-hole round', () => {
    const h = mkHoles();
    const rounds = [
      mkMyRound({ key: 'h1', holes: h, scores: evenScores(h, 4) }),
      mkMyRound({ key: 'target', holes: h, scores: evenScores(h, 4) }),
    ];
    const card = buildRoundReportCard(rounds, 'target');
    const keys = card.groups.map((g) => g.key);
    expect(keys).toEqual(expect.arrayContaining(['course', 'timing', 'distribution']));
    const course = card.groups.find((g) => g.key === 'course');
    expect(course.cells.map((c) => c.label)).toContain('Par 4s');
    const timing = card.groups.find((g) => g.key === 'timing');
    expect(timing.cells.map((c) => c.label)).toEqual(
      expect.arrayContaining(['Front 9', 'Back 9']),
    );
  });

  test('distribution group reports blow-ups (double bogey or worse)', () => {
    const h = mkHoles();
    // Target round: holes 1-2 are triple bogey (par+3) → blow-ups; rest par.
    const target = evenScores(h, 4);
    target[1] = 7; target[2] = 7;
    const rounds = [
      mkMyRound({ key: 'h1', holes: h, scores: evenScores(h, 4) }),
      mkMyRound({ key: 'target', holes: h, scores: target }),
    ];
    const card = buildRoundReportCard(rounds, 'target');
    const dist = card.groups.find((g) => g.key === 'distribution');
    const blowups = dist.cells.find((c) => c.label === 'Blow-ups');
    expect(blowups.value).toBe(2);
    expect(blowups.polarity).toBe('lower');
  });

  test('9-hole round omits the front/back nine cells', () => {
    const h = mkHoles(9);
    const rounds = [mkMyRound({ key: 'nine', holes: h, scores: evenScores(h, 4) })];
    const card = buildRoundReportCard(rounds, 'nine');
    const timing = card.groups.find((g) => g.key === 'timing');
    expect(timing.cells.map((c) => c.label)).not.toContain('Front 9');
    expect(timing.cells.map((c) => c.label)).toContain('Opening 3');
  });

  test('round without shot detail → hasShotData false, no shots group', () => {
    const h = mkHoles();
    const rounds = [mkMyRound({ key: 'noshots', holes: h, scores: evenScores(h, 4) })];
    const card = buildRoundReportCard(rounds, 'noshots');
    expect(card.hasShotData).toBe(false);
    expect(card.groups.map((g) => g.key)).not.toContain('shots');
  });

  test('round with shot detail → shots group with putts and GIR', () => {
    const h = mkHoles();
    const shot = {};
    h.forEach((hole) => { shot[hole.number] = { putts: 2, drive: 'fairway', teePenalties: 0, otherPenalties: 0 }; });
    const rounds = [mkMyRound({
      key: 'shots', holes: h, scores: evenScores(h, 4), shotDetails: shot,
    })];
    const card = buildRoundReportCard(rounds, 'shots');
    expect(card.hasShotData).toBe(true);
    const shots = card.groups.find((g) => g.key === 'shots');
    expect(shots.cells.map((c) => c.label)).toEqual(
      expect.arrayContaining(['Putts', 'Fairways hit %', 'Greens in reg %']),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/store/__tests__/roundReportCard.test.js -t "breakdown groups"`
Expected: FAIL — `card.groups` is undefined.

- [ ] **Step 3: Write the minimal implementation**

In `src/store/roundReportCard.js`, add these helpers above `buildRoundReportCard`:

```javascript
// Build a count cell (birdies, blow-ups, …): value is this round's count,
// baseline is the career per-round average count.
function countCell(label, value, baseTotal, baseRounds, polarity) {
  const baseline = baseRounds > 0 ? +(baseTotal / baseRounds).toFixed(1) : null;
  return {
    label,
    group: 'distribution',
    value,
    baseline,
    deltaVsAvg: baseline != null ? +(value - baseline).toFixed(1) : null,
    deltaVs2: null,
    holes: null,
    polarity,
  };
}

// Build a shot-stat cell. value is this round's figure; baseline is the
// career figure (already per-round in shotStats output).
function shotCell(label, value, baseline, polarity) {
  return {
    label,
    group: 'shots',
    value,
    baseline: baseline != null ? baseline : null,
    deltaVsAvg: baseline != null ? +(value - baseline).toFixed(1) : null,
    deltaVs2: null,
    holes: null,
    polarity,
  };
}

// The distribution cells: birdies-or-better, pars, bogeys, blow-ups.
function distributionCells(thisStats, baseStats) {
  const d = thisStats.distribution;
  const bd = baseStats ? baseStats.distribution : null;
  const bRounds = baseStats ? baseStats.roundCount : 0;
  const thisBirdies = d.eagles + d.birdies;
  const thisBlowups = d.doubles + d.worse;
  return [
    countCell('Birdies+', thisBirdies,
      bd ? bd.eagles + bd.birdies : 0, bRounds, 'higher'),
    countCell('Pars', d.pars, bd ? bd.pars : 0, bRounds, 'higher'),
    countCell('Bogeys', d.bogeys, bd ? bd.bogeys : 0, bRounds, 'lower'),
    countCell('Blow-ups', thisBlowups,
      bd ? bd.doubles + bd.worse : 0, bRounds, 'lower'),
  ];
}

// The shot-stat cells — only meaningful when the round has shot detail.
function shotCells(thisStats, baseStats) {
  const s = thisStats.shots;
  const bs = baseStats ? baseStats.shots : null;
  const basePenaltiesPerRound = bs && bs.roundsWithData > 0
    ? +(bs.penalties.total / bs.roundsWithData).toFixed(1)
    : null;
  return [
    shotCell('Putts', s.putts.perRound,
      bs ? bs.putts.perRound : null, 'lower'),
    shotCell('Fairways hit %', s.drives.fairwayPct,
      bs ? bs.drives.fairwayPct : null, 'higher'),
    shotCell('Greens in reg %', s.gir.pct,
      bs ? bs.gir.pct : null, 'higher'),
    shotCell('Penalties', s.penalties.total, basePenaltiesPerRound, 'lower'),
  ];
}
```

In `buildRoundReportCard`, replace the callout block and `return` so the tail of
the function reads exactly:

```javascript
  const pphCells = pointsPerHoleCells(thisStats, baseStats);
  const callouts = selectCallouts(pphCells, hasHistory);

  const hasShotData = !!thisStats.shots.hasData;

  const groups = [
    { key: 'course', label: 'Where on the course',
      cells: pphCells.filter((c) => c.group === 'course') },
    { key: 'timing', label: 'When in the round',
      cells: pphCells.filter((c) => c.group === 'timing') },
    { key: 'distribution', label: 'Scoring',
      cells: distributionCells(thisStats, baseStats) },
  ];
  if (hasShotData) {
    groups.push({ key: 'shots', label: 'Shot stats',
      cells: shotCells(thisStats, baseStats) });
  }

  return {
    round: {
      key: selected.key,
      courseName: selected.courseName,
      tournamentName: selected.tournamentName,
      tournamentDate: selected.tournamentDate,
      holesPlayed,
      complete: !!selected.completed,
    },
    headline: {
      points,
      perHole,
      vsAvg,
      clearedBenchmark: perHole >= BENCHMARK,
      verdict,
    },
    hasHistory,
    callouts,
    hasShotData,
    groups,
  };
```

(Delete the old `return { … }` block from Task 2 — there must be exactly one
`return` shape in the function.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/store/__tests__/roundReportCard.test.js`
Expected: PASS — every describe block green.

- [ ] **Step 5: Commit**

```bash
git add src/store/roundReportCard.js src/store/__tests__/roundReportCard.test.js
git commit -m "feat: round report card breakdown groups"
```

---

## Task 4: RoundReportCard component

A presentational component — props in, no data loading. Renders the round dropdown,
verdict block, callouts, and an expandable breakdown grid.

**Files:**
- Create: `src/components/RoundReportCard.js`

- [ ] **Step 1: Create the component**

Create `src/components/RoundReportCard.js`:

```javascript
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

// Signed delta in the "good" direction for a cell, regardless of polarity.
function goodDelta(cell) {
  if (cell.deltaVsAvg == null) return null;
  return cell.polarity === 'lower' ? -cell.deltaVsAvg : cell.deltaVsAvg;
}

// "+1.2" / "-0.4" / "0".
function fmtDelta(v) {
  if (v == null) return '—';
  if (v > 0) return `+${v}`;
  return `${v}`;
}

function Callout({ cell, kind, s }) {
  const good = kind === 'bright';
  const delta = cell.deltaVsAvg != null ? cell.deltaVsAvg : cell.deltaVs2;
  return (
    <View style={[s.callout, good ? s.calloutGood : s.calloutBad]}>
      <View style={[s.calloutDot, good ? s.dotGood : s.dotBad]}>
        <Feather name={good ? 'arrow-up' : 'arrow-down'} size={10} color="#fff" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.calloutLabel}>{cell.label}</Text>
        <Text style={s.calloutSub}>
          {cell.value} / hole · {fmtDelta(delta)} vs {cell.deltaVsAvg != null ? 'your avg' : 'the 2.0 mark'}
        </Text>
      </View>
    </View>
  );
}

function BreakdownRow({ cell, s, theme }) {
  const gd = goodDelta(cell);
  const color = gd == null ? theme.text.muted
    : gd > 0 ? theme.accent.primary
    : gd < 0 ? theme.destructive : theme.text.muted;
  return (
    <View style={s.row}>
      <Text style={s.rowLabel} numberOfLines={1}>{cell.label}</Text>
      <Text style={s.rowValue}>{cell.value}</Text>
      <Text style={[s.rowDelta, { color }]}>
        {cell.deltaVsAvg != null ? fmtDelta(cell.deltaVsAvg) : '—'}
      </Text>
    </View>
  );
}

export default function RoundReportCard({ card, rounds, selectedKey, onSelect }) {
  const { theme } = useTheme();
  const s = makeStyles(theme);
  const [expanded, setExpanded] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  if (!card) {
    return (
      <View style={s.empty}>
        <Feather name="clipboard" size={28} color={theme.text.muted} />
        <Text style={s.emptyText}>No round selected.</Text>
      </View>
    );
  }

  const { round, headline, callouts, groups, hasHistory } = card;

  return (
    <View style={s.wrap}>
      {/* Round dropdown */}
      <TouchableOpacity style={s.drop} onPress={() => setPickerOpen(true)} activeOpacity={0.8}>
        <View style={{ flex: 1 }}>
          <Text style={s.dropTitle} numberOfLines={1}>{round.courseName}</Text>
          <Text style={s.dropSub} numberOfLines={1}>{round.tournamentName}</Text>
        </View>
        <Feather name="chevron-down" size={18} color={theme.text.muted} />
      </TouchableOpacity>

      {/* Verdict */}
      <View style={s.verdict}>
        <Text style={s.verdictPhrase}>{headline.verdict}</Text>
        <Text style={s.verdictNums}>
          {headline.points} pts · {headline.perHole} / hole
          {headline.vsAvg != null
            ? ` · ${fmtDelta(headline.vsAvg)} vs your average`
            : ''}
        </Text>
        <Text style={s.verdictBench}>
          {headline.clearedBenchmark
            ? 'Above the 2.0 playing-to-handicap mark'
            : 'Below the 2.0 playing-to-handicap mark'}
          {round.complete ? '' : ` · through ${round.holesPlayed} holes`}
        </Text>
        {!hasHistory && (
          <Text style={s.verdictNote}>
            The "vs your average" comparison appears once you have more rounds.
          </Text>
        )}
      </View>

      {/* Callouts */}
      {callouts.bright.length > 0 && (
        <>
          <Text style={s.sectionLabel}>BRIGHT SPOTS</Text>
          {callouts.bright.map((c) => (
            <Callout key={c.label} cell={c} kind="bright" s={s} />
          ))}
        </>
      )}
      {callouts.cost.length > 0 && (
        <>
          <Text style={s.sectionLabel}>COST YOU POINTS</Text>
          {callouts.cost.map((c) => (
            <Callout key={c.label} cell={c} kind="cost" s={s} />
          ))}
        </>
      )}

      {/* Expandable breakdown */}
      <TouchableOpacity style={s.expandBtn} onPress={() => setExpanded((v) => !v)} activeOpacity={0.8}>
        <Text style={s.expandText}>
          {expanded ? 'Hide full breakdown' : 'Show full breakdown'}
        </Text>
        <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={theme.accent.primary} />
      </TouchableOpacity>
      {expanded && groups.map((g) => (
        <View key={g.key} style={s.group}>
          <Text style={s.groupLabel}>{g.label}</Text>
          {g.cells.map((c) => (
            <BreakdownRow key={c.label} cell={c} s={s} theme={theme} />
          ))}
        </View>
      ))}

      {/* Round picker modal */}
      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setPickerOpen(false)}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Choose a round</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {[...(rounds || [])].slice().reverse().map((r) => (
                <TouchableOpacity
                  key={r.key}
                  style={[s.pickRow, r.key === selectedKey && s.pickRowOn]}
                  onPress={() => { onSelect(r.key); setPickerOpen(false); }}
                >
                  <Text style={s.pickName} numberOfLines={1}>{r.courseName}</Text>
                  <Text style={s.pickSub} numberOfLines={1}>{r.tournamentName}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { padding: 4 },
    empty: { alignItems: 'center', justifyContent: 'center', padding: 40, gap: 10 },
    emptyText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontSize: 14 },

    drop: {
      flexDirection: 'row', alignItems: 'center',
      borderWidth: 1, borderColor: theme.border.default, borderRadius: 12,
      padding: 12, marginBottom: 14, backgroundColor: theme.bg.card,
    },
    dropTitle: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 15, color: theme.text.primary },
    dropSub: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme.text.muted, marginTop: 1 },

    verdict: {
      backgroundColor: theme.bg.card, borderRadius: 14, borderWidth: 1,
      borderColor: theme.border.default, padding: 14, marginBottom: 16,
    },
    verdictPhrase: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 22, color: theme.accent.primary },
    verdictNums: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 13, color: theme.text.primary, marginTop: 4 },
    verdictBench: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme.text.muted, marginTop: 2 },
    verdictNote: { fontFamily: 'PlusJakartaSans-Regular', fontSize: 11, color: theme.text.muted, marginTop: 6 },

    sectionLabel: {
      fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 10,
      letterSpacing: 1.5, marginTop: 14, marginBottom: 8, textTransform: 'uppercase',
    },
    callout: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 10,
      borderRadius: 12, padding: 11, marginBottom: 7,
    },
    calloutGood: { backgroundColor: theme.accent.light },
    calloutBad: { backgroundColor: theme.bg.secondary },
    calloutDot: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
    dotGood: { backgroundColor: theme.accent.primary },
    dotBad: { backgroundColor: theme.destructive },
    calloutLabel: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 13, color: theme.text.primary },
    calloutSub: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme.text.secondary, marginTop: 1 },

    expandBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      backgroundColor: theme.bg.secondary, borderRadius: 12, padding: 12, marginTop: 12,
    },
    expandText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 12, color: theme.accent.primary },

    group: { marginTop: 14 },
    groupLabel: {
      fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.muted, fontSize: 10,
      letterSpacing: 1.2, marginBottom: 6, textTransform: 'uppercase',
    },
    row: {
      flexDirection: 'row', alignItems: 'center',
      paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: theme.border.default,
    },
    rowLabel: { flex: 1, fontFamily: 'PlusJakartaSans-Medium', fontSize: 12, color: theme.text.primary },
    rowValue: { width: 48, textAlign: 'right', fontFamily: 'PlusJakartaSans-Bold', fontSize: 12, color: theme.text.primary },
    rowDelta: { width: 52, textAlign: 'right', fontFamily: 'PlusJakartaSans-Bold', fontSize: 12 },

    modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
    modalCard: { backgroundColor: theme.bg.card, borderRadius: 16, padding: 16, width: '100%' },
    modalTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 17, color: theme.text.primary, marginBottom: 10 },
    pickRow: { paddingVertical: 11, paddingHorizontal: 10, borderRadius: 10 },
    pickRowOn: { backgroundColor: theme.accent.light },
    pickName: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: theme.text.primary },
    pickSub: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme.text.muted, marginTop: 1 },
  });
}
```

Note on theme tokens: this component uses `theme.accent.primary`, `theme.accent.light`,
`theme.bg.card`, `theme.bg.secondary`, `theme.border.default`, `theme.destructive`,
`theme.text.primary/secondary/muted` — all confirmed present and already used by
`RoundSummaryScreen.js` and `MyStatsScreen.js` (`theme.destructive` is used in
`MyStatsScreen.js`'s `Snapshot` component for the down-arrow color).

- [ ] **Step 2: Verify it compiles**

Run: `npx jest src/store/__tests__/roundReportCard.test.js` (sanity — module still green)
Run: `npx eslint src/components/RoundReportCard.js`
Expected: exit 0, no errors. (`node --check` cannot be used here — the file
contains JSX. The project's `lint` script is `eslint .`, and ESLint parses JSX.)

- [ ] **Step 3: Commit**

```bash
git add src/components/RoundReportCard.js
git commit -m "feat: RoundReportCard presentational component"
```

---

## Task 5: Integrate into MyStatsScreen

Add `Report Card` as the new first and default tab. It uses **all** of `myRounds`
(not the aggregate `selected`/`overrides` set), with its own single-round key state.
Accepts `{ tab, roundKey }` route params for the post-round redirect.

**Files:**
- Modify: `src/screens/MyStatsScreen.js`

- [ ] **Step 1: Add imports and route params**

In `src/screens/MyStatsScreen.js`, add to the imports (after the `personalStats`
import on line 9):

```javascript
import { buildRoundReportCard } from '../store/roundReportCard';
import RoundReportCard from '../components/RoundReportCard';
```

Change the component signature (line 28) from:

```javascript
export default function MyStatsScreen({ navigation }) {
```

to:

```javascript
export default function MyStatsScreen({ navigation, route }) {
```

- [ ] **Step 2: Add the Report Card tab and its state**

Change `ALL_TABS` (lines 15-20) to put Report Card first:

```javascript
const ALL_TABS = [
  { key: 'reportCard', label: 'Report Card' },
  { key: 'overview',  label: 'Overview' },
  { key: 'form',      label: 'Form' },
  { key: 'breakdown', label: 'Breakdown' },
  { key: 'shots',     label: 'Shots' },
];
```

Change the `tab` state initializer (line 40) from:

```javascript
  const [tab, setTab] = useState('overview');
```

to (defaults to Report Card, or whatever the route requests):

```javascript
  const [tab, setTab] = useState(route?.params?.tab ?? 'reportCard');
  const [reportRoundKey, setReportRoundKey] = useState(route?.params?.roundKey ?? null);
```

- [ ] **Step 3: Default the report round once rounds load**

Add this effect right after the existing data-loading `useEffect` (after its
closing `}, [user?.id, storageKey, loadNonce]);` on line 75):

```javascript
  // Default the Report Card to the most recent round once rounds are loaded.
  // collectMyRounds returns rounds chronologically (oldest first), so the
  // last entry is the most recent.
  useEffect(() => {
    if (!myRounds || myRounds.length === 0) return;
    setReportRoundKey((prev) => {
      if (prev && myRounds.some((r) => r.key === prev)) return prev;
      return myRounds[myRounds.length - 1].key;
    });
  }, [myRounds]);
```

- [ ] **Step 4: Compute the report card**

Add this `useMemo` right after the existing `stats` useMemo (after its
closing `[selected, n],\n  );` on line 91):

```javascript
  const reportCard = useMemo(
    () => (myRounds && reportRoundKey
      ? buildRoundReportCard(myRounds, reportRoundKey)
      : null),
    [myRounds, reportRoundKey],
  );
```

- [ ] **Step 5: Render the Report Card tab**

In the returned JSX the tab bodies begin with `{tab === 'overview' && (` (line 209).
Add this block immediately before that line:

```javascript
        {tab === 'reportCard' && (
          <RoundReportCard
            card={reportCard}
            rounds={myRounds}
            selectedKey={reportRoundKey}
            onSelect={setReportRoundKey}
          />
        )}

```

Note: the Report Card tab intentionally ignores the round-selector filter — it
always sees every round, since each card already chooses its own baseline.

- [ ] **Step 6: Keep the Report Card tab reachable when no rounds are selected**

`MyStatsScreen` has an early return for the case where the aggregate round
selector has every round deselected (`selected.length === 0`, around line 185).
That early return must NOT fire on the Report Card tab — the Report Card does
not use that selection. Two edits:

Change the early-return condition (line 185) from:

```javascript
  if (selected.length === 0) {
```

to:

```javascript
  if (selected.length === 0 && tab !== 'reportCard') {
```

Then, because `stats` is `null` when `selected.length === 0`, make the
`frontBack` read in the main render null-safe. Change (line 201):

```javascript
  const fb = stats.frontBack;
```

to:

```javascript
  const fb = stats?.frontBack ?? null;
```

(`fbHoles` on the next line already guards with `fb ? …`. The aggregate tab
bodies — `tab === 'overview'`, `'form'`, `'breakdown'`, `'shots'` — never run
while `tab === 'reportCard'`, so they still see a non-null `stats`.)

- [ ] **Step 7: Verify**

Run: `npx jest src/store/__tests__/` (all store tests still green)
Run: `npx eslint src/screens/MyStatsScreen.js`
Expected: exit 0, no errors.

Manual check: open the app → My Stats. The screen opens on the **Report Card**
tab showing the most recent round. The dropdown switches rounds. Other tabs
(Overview/Form/Breakdown/Shots) still work.

- [ ] **Step 8: Commit**

```bash
git add src/screens/MyStatsScreen.js
git commit -m "feat: Report Card tab in MyStatsScreen"
```

---

## Task 6: Redirect to the Report Card after finishing a round

After a non-official round is finished, route to the Report Card for that round
instead of the round summary.

**Files:**
- Modify: `src/screens/ScorecardScreen.js` — `handleFinish`, around lines 878-883.

- [ ] **Step 1: Confirm the navigation route name**

Run: `grep -rn "MyStats" src/ --include=*.js | grep -i "name\|component\|navigate"`
Expected: a navigator registration for the `MyStats` route and existing
`navigation.navigate('MyStats')` calls (e.g. from `HomeScreen.js`). Confirm the
route name is exactly `MyStats` before editing.

- [ ] **Step 2: Add the redirect**

In `src/screens/ScorecardScreen.js`, inside `handleFinish`, find `goToSummary`
(currently lines 878-883):

```javascript
    const goToSummary = () => {
      navigation.navigate('RoundSummary', {
        tournamentId: t.id,
        roundId: r.id,
      });
    };
```

Replace it with:

```javascript
    const goToSummary = () => {
      // Non-official rounds: drop the finisher into their personal Report
      // Card for the round just played. collectMyRounds keys rounds as
      // `${tournamentId}:${roundIndex}` — match that here.
      if (!official && t.kind !== 'official') {
        navigation.navigate('MyStats', {
          tab: 'reportCard',
          roundKey: `${t.id}:${roundIndex}`,
        });
        return;
      }
      navigation.navigate('RoundSummary', {
        tournamentId: t.id,
        roundId: r.id,
      });
    };
```

- [ ] **Step 3: Verify**

Run: `npx eslint src/screens/ScorecardScreen.js`
Expected: exit 0, no errors.

Manual check: play and finish a casual/game round → after the "round complete"
celebration the app lands on My Stats → Report Card showing that round. Official
rounds still land on the round summary.

- [ ] **Step 4: Commit**

```bash
git add src/screens/ScorecardScreen.js
git commit -m "feat: finish a round into its Report Card"
```

---

## Done

All six tasks complete: a tested pure module, a presentational component, the
new default tab, and the post-round redirect. Run the full store test suite once
more (`npx jest src/store/__tests__/`) and do the two manual checks before
finishing the branch.
```
