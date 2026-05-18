# Sindicato Scoring Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Sindicato" — a 3-player per-hole points scoring mode — as a first-class mode with bespoke scorecard and home-screen UI.

**Architecture:** All Sindicato scoring math (per-hole points, round tally, tournament leaderboard, tournament clinch) is added to the pure `src/store/scoring.js` module so it is unit-testable without AsyncStorage. `tournamentStore.js` re-exports the new functions and delegates its `tournamentPlayerClinched` to the pure clinch helper. The mode is registered in `scoringModes.js`; pair-building across the three setup screens is unified through `scoringModeUsesTeams`; and `ScorecardScreen` / `HomeScreen` gain `sindicato` UI branches mirroring Match Play.

**Tech Stack:** React Native 0.81, Expo 54, jest + jest-expo. No React Native Testing Library — pure logic is TDD'd; UI is verified with a structured manual checklist.

**Spec:** `docs/superpowers/specs/2026-05-17-sindicato-mode-design.md`

**Note — placement refinement vs spec:** The spec located `tournamentSindicatoLeaderboard` and the clinch logic in `tournamentStore.js`. This plan instead places all four pure functions in `scoring.js` (`tournamentStore.js` re-exports them and delegates), because `scoring.js` is import-clean for jest while `tournamentStore.js` pulls in AsyncStorage/Supabase. This honors the spec's intent (separate path, fully unit-tested, no risk to the shared `roundTotals` path) and improves testability.

---

## File Structure

- **`src/store/scoring.js`** (modify) — add `sindicatoHolePoints`, `sindicatoRoundTally`, `tournamentSindicatoLeaderboard`, `tournamentSindicatoClinched`.
- **`src/store/__tests__/scoring.test.js`** (modify) — append Sindicato test suites.
- **`src/components/scoringModes.js`** (modify) — add the `sindicato` mode entry.
- **`src/components/__tests__/scoringModes.test.js`** (modify) — update the category test for the new Head-to-head entry.
- **`src/store/tournamentStore.js`** (modify) — import + re-export the new scoring functions; add a `sindicato` branch to `tournamentPlayerClinched`.
- **`src/screens/SetupScreen.js`**, **`EditTournamentScreen.js`**, **`NextRoundScreen.js`** (modify) — unify pair-building via `scoringModeUsesTeams`.
- **`src/screens/ScorecardScreen.js`** (modify) — per-hole points, grid, and a live `SindicatoPanel`.
- **`src/screens/HomeScreen.js`** (modify) — `SindicatoRoundCard`, round-card branch, leaderboard branch, overview-card exclusion.

---

## Task 1: Sindicato per-hole and per-round scoring

**Files:**
- Modify: `src/store/scoring.js`
- Test: `src/store/__tests__/scoring.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `src/store/__tests__/scoring.test.js`. First add `sindicatoHolePoints` and `sindicatoRoundTally` to the existing top-of-file `import { ... } from '../scoring';` block. Then append:

```js
describe('sindicatoHolePoints', () => {
  // Handicap 0 for all → net strokes equal gross, so gross controls rank.
  const players = [
    { id: 'a', name: 'A', handicap: 0 },
    { id: 'b', name: 'B', handicap: 0 },
    { id: 'c', name: 'C', handicap: 0 },
  ];
  const hole = { number: 1, par: 4, strokeIndex: 5 };

  test('three distinct results split 4 / 2 / 0', () => {
    const scores = { a: { 1: 4 }, b: { 1: 5 }, c: { 1: 6 } };
    expect(sindicatoHolePoints(hole, players, scores, {})).toEqual({ a: 4, b: 2, c: 0 });
  });
  test('one winner, two tied behind split 4 / 1 / 1', () => {
    const scores = { a: { 1: 4 }, b: { 1: 5 }, c: { 1: 5 } };
    expect(sindicatoHolePoints(hole, players, scores, {})).toEqual({ a: 4, b: 1, c: 1 });
  });
  test('two tied for the win split 3 / 3 / 0', () => {
    const scores = { a: { 1: 4 }, b: { 1: 4 }, c: { 1: 5 } };
    expect(sindicatoHolePoints(hole, players, scores, {})).toEqual({ a: 3, b: 3, c: 0 });
  });
  test('all three tied split 2 / 2 / 2', () => {
    const scores = { a: { 1: 5 }, b: { 1: 5 }, c: { 1: 5 } };
    expect(sindicatoHolePoints(hole, players, scores, {})).toEqual({ a: 2, b: 2, c: 2 });
  });
  test('the four point values always sum to 6', () => {
    const scores = { a: { 1: 4 }, b: { 1: 5 }, c: { 1: 6 } };
    const pts = sindicatoHolePoints(hole, players, scores, {});
    expect(pts.a + pts.b + pts.c).toBe(6);
  });
  test('returns null when a player has not scored the hole', () => {
    const scores = { a: { 1: 4 }, b: { 1: 5 } };
    expect(sindicatoHolePoints(hole, players, scores, {})).toBeNull();
  });
  test('returns null when not exactly 3 players', () => {
    const scores = { a: { 1: 4 }, b: { 1: 5 } };
    expect(sindicatoHolePoints(hole, players.slice(0, 2), scores, {})).toBeNull();
  });
  test('ranks by net strokes — a handicap stroke flips equal gross', () => {
    // a gets one stroke on this hole (handicap 18, any strokeIndex → +1),
    // so a's net 4 beats b's net 5 despite both carding gross 5.
    const scores = { a: { 1: 5 }, b: { 1: 5 }, c: { 1: 6 } };
    const handicaps = { a: 18, b: 0, c: 0 };
    expect(sindicatoHolePoints(hole, players, scores, handicaps)).toEqual({ a: 4, b: 2, c: 0 });
  });
});

describe('sindicatoRoundTally', () => {
  const players = [
    { id: 'a', name: 'A', handicap: 0 },
    { id: 'b', name: 'B', handicap: 0 },
    { id: 'c', name: 'C', handicap: 0 },
  ];
  const holes = [
    { number: 1, par: 4, strokeIndex: 1 },
    { number: 2, par: 4, strokeIndex: 2 },
  ];

  test('accumulates points across played holes and sorts descending', () => {
    // Hole 1: 4/5/6 → 4/2/0. Hole 2: 4/5/5 → 4/1/1. Totals a8 b3 c1.
    const round = {
      holes,
      playerHandicaps: {},
      scores: { a: { 1: 4, 2: 4 }, b: { 1: 5, 2: 5 }, c: { 1: 6, 2: 5 } },
    };
    const tally = sindicatoRoundTally(round, players);
    expect(tally.totals.map((t) => [t.player.id, t.points]))
      .toEqual([['a', 8], ['b', 3], ['c', 1]]);
    expect(tally.played).toBe(2);
    expect(tally.holesLeft).toBe(0);
    expect(tally.leaderIdx).toBe(0);
    expect(tally.lead).toBe(5);
  });
  test('counts an unscored hole as not played', () => {
    const round = {
      holes,
      playerHandicaps: {},
      scores: { a: { 1: 4 }, b: { 1: 5 }, c: { 1: 6 } },
    };
    const tally = sindicatoRoundTally(round, players);
    expect(tally.played).toBe(1);
    expect(tally.holesLeft).toBe(1);
  });
  test('leaderIdx is null when the top two are tied', () => {
    const round = {
      holes: [{ number: 1, par: 4, strokeIndex: 1 }],
      playerHandicaps: {},
      scores: { a: { 1: 4 }, b: { 1: 4 }, c: { 1: 5 } },
    };
    const tally = sindicatoRoundTally(round, players);
    expect(tally.leaderIdx).toBeNull();
    expect(tally.clinched).toBe(false);
  });
  test('not clinched when lead equals holesLeft × 4', () => {
    // 1 hole played (4/2/0 → lead 2), 1 hole left → max gain 4. lead 2 ≤ 4.
    const round = {
      holes,
      playerHandicaps: {},
      scores: { a: { 1: 4 }, b: { 1: 5 }, c: { 1: 6 } },
    };
    expect(sindicatoRoundTally(round, players).clinched).toBe(false);
  });
  test('clinched when lead exceeds holesLeft × 4', () => {
    // Both holes played, holesLeft 0, lead 5 > 0 → clinched.
    const round = {
      holes,
      playerHandicaps: {},
      scores: { a: { 1: 4, 2: 4 }, b: { 1: 5, 2: 5 }, c: { 1: 6, 2: 5 } },
    };
    expect(sindicatoRoundTally(round, players).clinched).toBe(true);
  });
  test('returns null when not exactly 3 players', () => {
    expect(sindicatoRoundTally({ holes, scores: {} }, players.slice(0, 2))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest scoring -t sindicato --verbose`
Expected: FAIL — `sindicatoHolePoints` / `sindicatoRoundTally` are not exported.

- [ ] **Step 3: Implement the two functions**

In `src/store/scoring.js`, append after `matchPlayRoundTally` (after line 152, before `pickupStrokes`):

```js
// ── Sindicato ───────────────────────────────────────────────────────────────
// 3-player per-hole points game. Each hole splits 6 points by net-stroke rank:
//   all three net-equal      → 2 / 2 / 2
//   two tied lowest, one up  → 3 / 3 / 0
//   one lowest, two tied up  → 4 / 1 / 1
//   three distinct           → 4 / 2 / 0
// Returns { [playerId]: points }, or null when there are not exactly 3 players
// or any of them has not scored the hole yet.
export function sindicatoHolePoints(hole, players, scores, playerHandicapsByPlayerId) {
  if (!players || players.length !== 3) return null;
  const nets = [];
  for (const p of players) {
    const strokes = scores?.[p.id]?.[hole.number];
    if (strokes == null) return null;
    const h = playerHandicapsByPlayerId?.[p.id] ?? p.handicap ?? 0;
    nets.push({ id: p.id, net: strokes - calcExtraShots(h, hole.strokeIndex) });
  }
  const [lo, mid, hi] = [...nets].sort((a, b) => a.net - b.net);
  if (lo.net === mid.net && mid.net === hi.net) {
    return { [lo.id]: 2, [mid.id]: 2, [hi.id]: 2 };
  }
  if (lo.net === mid.net) {
    return { [lo.id]: 3, [mid.id]: 3, [hi.id]: 0 };
  }
  if (mid.net === hi.net) {
    return { [lo.id]: 4, [mid.id]: 1, [hi.id]: 1 };
  }
  return { [lo.id]: 4, [mid.id]: 2, [hi.id]: 0 };
}

// Cumulative Sindicato points for one round. Returns null for the wrong player
// count. `totals` is sorted points-descending; `leaderIdx` is the index of the
// sole leader within `totals` (null when the top two are tied). A trailing
// player gains at most 4 per hole, so the leader has clinched the round when
// `lead > holesLeft × 4`.
export function sindicatoRoundTally(round, players) {
  if (!players || players.length !== 3) return null;
  const scores = round?.scores ?? {};
  const playerHandicaps = round?.playerHandicaps ?? {};
  const holes = round?.holes ?? [];
  const pointsById = Object.fromEntries(players.map((p) => [p.id, 0]));
  let played = 0;
  for (const hole of holes) {
    const hp = sindicatoHolePoints(hole, players, scores, playerHandicaps);
    if (!hp) continue;
    played++;
    for (const p of players) pointsById[p.id] += hp[p.id];
  }
  const totals = players
    .map((player) => ({ player, points: pointsById[player.id] }))
    .sort((a, b) => b.points - a.points);
  const holesLeft = holes.length - played;
  const lead = totals[0].points - totals[1].points;
  const leaderIdx = totals[0].points > totals[1].points ? 0 : null;
  const clinched = leaderIdx === 0 && lead > holesLeft * 4;
  return { totals, played, holesLeft, leaderIdx, lead, clinched };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest scoring -t sindicato --verbose`
Expected: PASS — all `sindicatoHolePoints` and `sindicatoRoundTally` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/store/scoring.js src/store/__tests__/scoring.test.js
git commit -m "feat: Sindicato per-hole and per-round scoring math"
```

---

## Task 2: Sindicato tournament leaderboard and clinch

**Files:**
- Modify: `src/store/scoring.js`
- Test: `src/store/__tests__/scoring.test.js`

- [ ] **Step 1: Write the failing tests**

Add `tournamentSindicatoLeaderboard` and `tournamentSindicatoClinched` to the test file's `import { ... } from '../scoring';` block. Then append:

```js
describe('tournamentSindicatoLeaderboard', () => {
  const players = [
    { id: 'a', name: 'A', handicap: 0 },
    { id: 'b', name: 'B', handicap: 0 },
    { id: 'c', name: 'C', handicap: 0 },
  ];
  const holes = [{ number: 1, par: 4, strokeIndex: 1 }];

  test('sums Sindicato points across played rounds, sorted descending', () => {
    // Each round: hole 1 scored 4/5/6 → 4/2/0.
    const round = {
      holes, playerHandicaps: {},
      scores: { a: { 1: 4 }, b: { 1: 5 }, c: { 1: 6 } },
    };
    const tournament = { players, rounds: [round, round], currentRound: 1 };
    const lb = tournamentSindicatoLeaderboard(tournament);
    expect(lb.map((e) => [e.player.id, e.points])).toEqual([['a', 8], ['b', 4], ['c', 0]]);
  });
  test('ignores rounds not yet reached', () => {
    const played = {
      holes, playerHandicaps: {},
      scores: { a: { 1: 4 }, b: { 1: 5 }, c: { 1: 6 } },
    };
    const future = { holes, playerHandicaps: {}, scores: {} };
    const tournament = { players, rounds: [played, future], currentRound: 0 };
    const lb = tournamentSindicatoLeaderboard(tournament);
    expect(lb.map((e) => [e.player.id, e.points])).toEqual([['a', 4], ['b', 2], ['c', 0]]);
  });
});

describe('tournamentSindicatoClinched', () => {
  const players = [
    { id: 'a', name: 'A', handicap: 0 },
    { id: 'b', name: 'B', handicap: 0 },
    { id: 'c', name: 'C', handicap: 0 },
  ];

  test('returns the leader id when the lead cannot be overcome', () => {
    // One round, both holes played. a8 b3 c1, lead 5, 0 holes left → clinched.
    const holes = [
      { number: 1, par: 4, strokeIndex: 1 },
      { number: 2, par: 4, strokeIndex: 2 },
    ];
    const round = {
      holes, playerHandicaps: {},
      scores: { a: { 1: 4, 2: 4 }, b: { 1: 5, 2: 5 }, c: { 1: 6, 2: 5 } },
    };
    const tournament = { players, rounds: [round], currentRound: 0 };
    expect(tournamentSindicatoClinched(tournament)).toBe('a');
  });
  test('returns null when remaining holes could still overturn the lead', () => {
    // One hole played (lead 2), one hole left → max gain 4. Not clinched.
    const holes = [
      { number: 1, par: 4, strokeIndex: 1 },
      { number: 2, par: 4, strokeIndex: 2 },
    ];
    const round = {
      holes, playerHandicaps: {},
      scores: { a: { 1: 4 }, b: { 1: 5 }, c: { 1: 6 } },
    };
    const tournament = { players, rounds: [round], currentRound: 0 };
    expect(tournamentSindicatoClinched(tournament)).toBeNull();
  });
  test('returns null before any hole is scored', () => {
    const holes = [{ number: 1, par: 4, strokeIndex: 1 }];
    const tournament = {
      players, rounds: [{ holes, playerHandicaps: {}, scores: {} }], currentRound: 0,
    };
    expect(tournamentSindicatoClinched(tournament)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest scoring -t "tournamentSindicato" --verbose`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement the two functions**

In `src/store/scoring.js`, append immediately after `sindicatoRoundTally` (from Task 1):

```js
// Cumulative Sindicato standings across all played rounds. Returns
// [{ player, points, strokes }] sorted points-descending. `strokes` is the
// player's total gross strokes (kept shape-compatible with tournamentLeaderboard
// so leaderboard UI can render either without branching).
export function tournamentSindicatoLeaderboard(tournament) {
  const { players, rounds } = tournament;
  const pointsById = Object.fromEntries(players.map((p) => [p.id, 0]));
  const strokesById = Object.fromEntries(players.map((p) => [p.id, 0]));
  rounds.forEach((round, index) => {
    if (!isRoundPlayed(round, index, tournament)) return;
    const tally = sindicatoRoundTally(round, players);
    if (!tally) return;
    tally.totals.forEach(({ player, points }) => {
      pointsById[player.id] += points;
    });
    players.forEach((p) => {
      const holeScores = round.scores?.[p.id] ?? {};
      for (const v of Object.values(holeScores)) strokesById[p.id] += (v || 0);
    });
  });
  return players
    .map((player) => ({
      player,
      points: pointsById[player.id],
      strokes: strokesById[player.id],
    }))
    .sort((a, b) => b.points - a.points);
}

// Player id who has clinched a Sindicato tournament, or null. Sums the holes
// still to play across the current round and every future round; a trailing
// player can gain at most 4 per hole, so the leader has clinched when their
// lead over second place exceeds holesRemaining × 4.
export function tournamentSindicatoClinched(tournament) {
  const { players, rounds } = tournament;
  if (!players || players.length !== 3) return null;
  const hasAnyScore = rounds.some((r) => r.scores && Object.keys(r.scores).length > 0);
  if (!hasAnyScore) return null;
  const lb = tournamentSindicatoLeaderboard(tournament);
  let holesRemaining = 0;
  rounds.forEach((round, idx) => {
    const future = idx > (tournament.currentRound ?? 0);
    if (future) {
      holesRemaining += round.holes?.length ?? 0;
      return;
    }
    const tally = sindicatoRoundTally(round, players);
    holesRemaining += tally ? tally.holesLeft : (round.holes?.length ?? 0);
  });
  if (lb[0].points - lb[1].points > holesRemaining * 4) return lb[0].player.id;
  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest scoring --verbose`
Expected: PASS — the full `scoring.test.js` suite, including all Sindicato suites.

- [ ] **Step 5: Commit**

```bash
git add src/store/scoring.js src/store/__tests__/scoring.test.js
git commit -m "feat: Sindicato tournament leaderboard and clinch detection"
```

---

## Task 3: Register the Sindicato mode

**Files:**
- Modify: `src/components/scoringModes.js`
- Test: `src/components/__tests__/scoringModes.test.js`

- [ ] **Step 1: Update the failing test**

In `src/components/__tests__/scoringModes.test.js`, the `scoringModeCategories` suite asserts the Head-to-head section contains only `matchplay`. Update that one assertion and add a Sindicato gating test.

Change this line inside the `groups modes into ordered sections` test:
```js
    expect(sections[1].modes.map((m) => m.key)).toEqual(['matchplay']);
```
to:
```js
    expect(sections[1].modes.map((m) => m.key)).toEqual(['matchplay', 'sindicato']);
```

And add a new test inside the `isScoringModeAllowed` describe block:
```js
  test('sindicato needs exactly 3 players', () => {
    expect(isScoringModeAllowed('sindicato', 2)).toBe(false);
    expect(isScoringModeAllowed('sindicato', 3)).toBe(true);
    expect(isScoringModeAllowed('sindicato', 4)).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest scoringModes --verbose`
Expected: FAIL — the category test expects `['matchplay', 'sindicato']` and the new gating test expects `sindicato` to be a known mode; neither holds yet.

- [ ] **Step 3: Add the mode entry**

In `src/components/scoringModes.js`, insert this object into the `SCORING_MODES` array immediately after the `matchplay` entry (after its closing `},` — keeping the fixed solo → head-to-head → teams ordering):

```js
  {
    key: 'sindicato',
    label: 'Sindicato',
    subtitle: 'Three-way points, hole by hole',
    icon: 'pie-chart',
    category: 'Head-to-head',
    // Each player competes solo — no partners/pairs to assign.
    teams: false,
    // Sindicato splits 6 points per hole between exactly three players.
    isAllowed: (count) => count === 3,
    requirement: 'Requires exactly 3 players',
  },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest scoringModes --verbose`
Expected: PASS — all `scoringModes.test.js` tests, including the updated category test and the new gating test.

- [ ] **Step 5: Commit**

```bash
git add src/components/scoringModes.js src/components/__tests__/scoringModes.test.js
git commit -m "feat: register Sindicato scoring mode"
```

---

## Task 4: Wire Sindicato scoring into tournamentStore

**Files:**
- Modify: `src/store/tournamentStore.js`

This task has no unit test (importing `tournamentStore.js` under jest pulls in AsyncStorage/Supabase). Correctness is verified by the full suite staying green and by the pure functions already tested in Tasks 1–2.

- [ ] **Step 1: Import the new scoring functions**

In `src/store/tournamentStore.js`, the import from `./scoring` (lines 9–24) currently ends with `isRoundPlayed,`. Add the four new functions to that import list:

```js
import {
  STANDARD_SLOPE,
  totalParFromHoles,
  calcPlayingHandicap,
  deriveRoundPlayingHandicap,
  normalizeRoundHandicaps,
  getPlayingHandicap,
  recomputeRoundPlayingHandicaps,
  calcExtraShots,
  calcStablefordPoints,
  matchPlayHolePts,
  matchPlayRoundTally,
  sindicatoHolePoints,
  sindicatoRoundTally,
  tournamentSindicatoLeaderboard,
  tournamentSindicatoClinched,
  pickupStrokes,
  randomPairs,
  isRoundPlayed,
} from './scoring';
```

- [ ] **Step 2: Re-export the UI-facing functions**

The re-export block at lines 411–425 ends with `randomPairs,` then `} from './scoring';`. Add the three functions the screens import:

```js
export {
  STANDARD_SLOPE,
  totalParFromHoles,
  calcPlayingHandicap,
  deriveRoundPlayingHandicap,
  normalizeRoundHandicaps,
  getPlayingHandicap,
  recomputeRoundPlayingHandicaps,
  calcExtraShots,
  calcStablefordPoints,
  matchPlayHolePts,
  matchPlayRoundTally,
  sindicatoHolePoints,
  sindicatoRoundTally,
  tournamentSindicatoLeaderboard,
  pickupStrokes,
  randomPairs,
} from './scoring';
```

(`tournamentSindicatoClinched` is imported for internal use only and is not re-exported.)

- [ ] **Step 3: Delegate the Sindicato clinch in `tournamentPlayerClinched`**

`tournamentPlayerClinched` begins at line 860:
```js
export function tournamentPlayerClinched(tournament, mode) {
  const { players, rounds, settings } = tournament;
  const lb = mode === 'bestball'
```
Insert a delegating early-return as the first statement of the function body:
```js
export function tournamentPlayerClinched(tournament, mode) {
  if (mode === 'sindicato') return tournamentSindicatoClinched(tournament);
  const { players, rounds, settings } = tournament;
  const lb = mode === 'bestball'
```

- [ ] **Step 4: Verify nothing regressed**

Run: `npx jest`
Expected: PASS — full suite green (no test imports `tournamentStore.js`; this confirms the scoring/scoringModes suites still pass).

- [ ] **Step 5: Commit**

```bash
git add src/store/tournamentStore.js
git commit -m "feat: re-export Sindicato scoring and delegate its clinch"
```

---

## Task 5: Unify pair-building for solo modes

**Files:**
- Modify: `src/screens/SetupScreen.js`
- Modify: `src/screens/EditTournamentScreen.js`
- Modify: `src/screens/NextRoundScreen.js`

Sindicato plays solo (`round.pairs` = `[[p1],[p2],[p3]]`). Every non-teams mode uses solo pairs, so each screen's pair-building collapses to one `scoringModeUsesTeams` check. No unit test — verified by the suite staying green and manual checks.

- [ ] **Step 1: SetupScreen — import `scoringModeUsesTeams`**

`SetupScreen.js` imports `ScoringModePicker, { isScoringModeAllowed, fallbackScoringMode } from '../components/ScoringModePicker';`. Add a new import line directly below it:
```js
import { scoringModeUsesTeams } from '../components/scoringModes';
```

- [ ] **Step 2: SetupScreen — unify `buildPairs`**

Inside `handleStart`, this block currently reads:
```js
    const isMatchPlay = settings.scoringMode === 'matchplay';
    const isIndividual = settings.scoringMode === 'individual';
    const buildPairs = () => {
      if (isMatchPlay && players.length === 2) return [[players[0]], [players[1]]];
      if (isIndividual) return players.map((p) => [p]);
      return randomPairs(players);
    };
```
Replace it with:
```js
    const isMatchPlay = settings.scoringMode === 'matchplay';
    const buildPairs = () => (
      scoringModeUsesTeams(settings.scoringMode)
        ? randomPairs(players)
        : players.map((p) => [p])
    );
```
(`isMatchPlay` is still used later for the Match-Play settings override; `isIndividual` was only used here and is removed.)

- [ ] **Step 3: EditTournamentScreen — import `scoringModeUsesTeams`**

`EditTournamentScreen.js` imports `ScoringModePicker, { isScoringModeAllowed, fallbackScoringMode } from '../components/ScoringModePicker';`. Add directly below it:
```js
import { scoringModeUsesTeams } from '../components/scoringModes';
```

- [ ] **Step 4: EditTournamentScreen — unify the round-pair builder**

The `addRound` pair-building block currently reads:
```js
    const pairs = mode === 'individual'
      ? builtPlayers.map((p) => [p])
      : (mode === 'matchplay' && builtPlayers.length === 2)
        ? [[builtPlayers[0]], [builtPlayers[1]]]
        : randomPairs(builtPlayers);
```
Replace it with:
```js
    const pairs = scoringModeUsesTeams(mode)
      ? randomPairs(builtPlayers)
      : builtPlayers.map((p) => [p]);
```

- [ ] **Step 5: NextRoundScreen — unify `buildPairsForRound`**

`NextRoundScreen.js` already imports `scoringModeUsesTeams`. Its `buildPairsForRound` currently reads:
```js
  const buildPairsForRound = (t) => {
    const mode = t?.settings?.scoringMode;
    if (mode === 'individual') return t.players.map((p) => [p]);
    if (mode === 'matchplay' && t.players.length === 2) {
      return [[t.players[0]], [t.players[1]]];
    }
    return randomPairs(t.players);
  };
```
Replace it with:
```js
  const buildPairsForRound = (t) => {
    const mode = t?.settings?.scoringMode;
    return scoringModeUsesTeams(mode)
      ? randomPairs(t.players)
      : t.players.map((p) => [p]);
  };
```

- [ ] **Step 6: Verify**

Run: `npx jest`
Expected: PASS — full suite green.

Manual check: create an `individual` tournament (pairs are `[[p1],…]`), a `matchplay` tournament with 2 players (pairs `[[p1],[p2]]`), and a `stableford` tournament with 3 players (random 2-player pairs). All unchanged from before.

- [ ] **Step 7: Commit**

```bash
git add src/screens/SetupScreen.js src/screens/EditTournamentScreen.js src/screens/NextRoundScreen.js
git commit -m "refactor: unify solo-mode pair building via scoringModeUsesTeams"
```

---

## Task 6: Sindicato scorecard UI

**Files:**
- Modify: `src/screens/ScorecardScreen.js`

No unit test (React Native UI, no RNTL). Verified with the manual checklist in Step 9.

- [ ] **Step 1: Import the Sindicato scoring functions**

`ScorecardScreen.js` imports from `'../store/tournamentStore'`. The import currently includes the line `matchPlayHolePts, calcExtraShots,`. Add `sindicatoHolePoints` and `sindicatoRoundTally` to that import block — change that line to:
```js
  matchPlayHolePts, calcExtraShots,
  sindicatoHolePoints, sindicatoRoundTally,
```

- [ ] **Step 2: Add the `isSindicato` flag**

Find this line (near line 407):
```js
  const isBestBall = settings.scoringMode === 'bestball';
```
Add directly below it:
```js
  const isSindicato = settings.scoringMode === 'sindicato';
```

- [ ] **Step 3: Branch `playerTotalsMap` for Sindicato**

Inside the `playerTotalsMap` `useMemo`, the per-hole accumulation currently reads:
```js
          if (isMatchPlay) {
            pts += matchPlayHolePts(hole, player.id, players, scores, playerHandicaps) ?? 0;
          } else {
            pts += calcStablefordPoints(hole.par, sc, handicap, hole.strokeIndex);
          }
```
Replace it with:
```js
          if (isMatchPlay) {
            pts += matchPlayHolePts(hole, player.id, players, scores, playerHandicaps) ?? 0;
          } else if (isSindicato) {
            pts += sindicatoHolePoints(hole, players, scores, playerHandicaps)?.[player.id] ?? 0;
          } else {
            pts += calcStablefordPoints(hole.par, sc, handicap, hole.strokeIndex);
          }
```

- [ ] **Step 4: Pass `'sindicato'` to `HolePage`**

The `<HolePage>` element sets its `mode` prop (near line 1477):
```js
                mode={settings?.scoringMode === 'matchplay' ? 'matchplay' : isBestBall ? 'bestball' : 'stableford'}
```
Replace it with:
```js
                mode={settings?.scoringMode === 'matchplay' ? 'matchplay'
                  : settings?.scoringMode === 'sindicato' ? 'sindicato'
                  : isBestBall ? 'bestball' : 'stableford'}
```

- [ ] **Step 5: Branch the per-hole points inside `HolePage`**

In `HolePage`, the per-hole points calculation currently reads:
```js
          const pts = strokes == null ? null
            : mode === 'matchplay'
              ? matchPlayHolePts(pageHole, player.id, players, scores, round.playerHandicaps ?? {})
              : calcStablefordPoints(pageHole.par, strokes, handicap, pageHole.strokeIndex);
```
Replace it with:
```js
          const pts = strokes == null ? null
            : mode === 'matchplay'
              ? matchPlayHolePts(pageHole, player.id, players, scores, round.playerHandicaps ?? {})
              : mode === 'sindicato'
                ? (sindicatoHolePoints(pageHole, players, scores, round.playerHandicaps ?? {})?.[player.id] ?? null)
                : calcStablefordPoints(pageHole.par, strokes, handicap, pageHole.strokeIndex);
```

- [ ] **Step 6: Branch the `GridView` mode, helper, totals, and label**

In `GridView`, the local `mode` variable currently reads:
```js
  const mode = settings?.scoringMode === 'matchplay' ? 'matchplay'
    : isBestBall ? 'bestball'
    : 'stableford';
```
Replace it with:
```js
  const mode = settings?.scoringMode === 'matchplay' ? 'matchplay'
    : settings?.scoringMode === 'sindicato' ? 'sindicato'
    : isBestBall ? 'bestball'
    : 'stableford';
```

The `holePts` helper currently reads:
```js
  const holePts = (hole, player, handicap) => {
    const str = scores[player.id]?.[hole.number];
    if (str == null) return null;
    if (mode === 'matchplay') {
      return matchPlayHolePts(hole, player.id, players, scores, playerHandicaps);
    }
    return calcStablefordPoints(hole.par, str, handicap, hole.strokeIndex);
  };
```
Replace it with:
```js
  const holePts = (hole, player, handicap) => {
    const str = scores[player.id]?.[hole.number];
    if (str == null) return null;
    if (mode === 'matchplay') {
      return matchPlayHolePts(hole, player.id, players, scores, playerHandicaps);
    }
    if (mode === 'sindicato') {
      return sindicatoHolePoints(hole, players, scores, playerHandicaps)?.[player.id] ?? null;
    }
    return calcStablefordPoints(hole.par, str, handicap, hole.strokeIndex);
  };
```

The grid totals accumulation currently reads:
```js
      if (mode === 'matchplay') {
        pts += matchPlayHolePts(h, p.id, players, scores, playerHandicaps) ?? 0;
      } else {
        pts += calcStablefordPoints(h.par, v, handicap, h.strokeIndex);
      }
```
Replace it with:
```js
      if (mode === 'matchplay') {
        pts += matchPlayHolePts(h, p.id, players, scores, playerHandicaps) ?? 0;
      } else if (mode === 'sindicato') {
        pts += sindicatoHolePoints(h, players, scores, playerHandicaps)?.[p.id] ?? 0;
      } else {
        pts += calcStablefordPoints(h.par, v, handicap, h.strokeIndex);
      }
```

The totals-header label currently reads:
```js
            <Text style={s.multiTotalLabel}>{mode === 'matchplay' ? 'MATCH PLAY' : 'STABLEFORD'}</Text>
```
Replace it with:
```js
            <Text style={s.multiTotalLabel}>{
              mode === 'matchplay' ? 'MATCH PLAY'
                : mode === 'sindicato' ? 'SINDICATO'
                : 'STABLEFORD'
            }</Text>
```

- [ ] **Step 7: Add the `SindicatoPanel` component**

Add this component definition immediately before `function StablefordWinnerBanner(` (near line 1762):

```js
// Live Sindicato standings, pinned above the bottom controls — mirrors the
// best-ball MatchPanel / Stableford totals strip. Shows each player's running
// points (high to low) and the leader / clinch status.
function SindicatoPanel({ round, players, scores }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const tally = sindicatoRoundTally({ ...round, scores }, players);
  if (!tally) return null;
  const { totals, leaderIdx, lead, clinched, holesLeft } = tally;
  const firstName = (p) => p.name?.split(' ')[0] ?? '—';
  const leader = leaderIdx != null ? totals[leaderIdx].player : null;
  const status = clinched && leader
    ? `${firstName(leader)} has clinched`
    : leader
      ? `${firstName(leader)} leads by ${lead}${holesLeft > 0 ? ` · ${holesLeft} to play` : ''}`
      : `All level${holesLeft > 0 ? ` · ${holesLeft} to play` : ''}`;
  return (
    <View style={s.totalsStrip}>
      <Text style={s.totalStripLabel}>SINDICATO</Text>
      <View style={s.totalStripRow}>
        {totals.map(({ player, points }) => (
          <View key={player.id} style={s.totalStripPlayer}>
            <Text style={s.totalStripName}>{firstName(player)}</Text>
            <Text style={s.totalStripPts}>{points}</Text>
          </View>
        ))}
      </View>
      <Text style={s.sindicatoStatus}>{status}</Text>
    </View>
  );
}
```

- [ ] **Step 8: Render `SindicatoPanel` in the bottom strip and add its style**

`HoleView` receives `settings` as a prop. Near the top of the `HoleView` function body (where other locals are declared) add:
```js
  const isSindicato = settings?.scoringMode === 'sindicato';
```

The bottom totals block currently begins:
```js
      {isBestBall && bbResult ? (
        <MatchPanel bbResult={bbResult} currentHole={currentHole} settings={settings} />
      ) : showRunning && players.length === 1 ? (
```
Insert a Sindicato branch between the best-ball branch and the solo branch:
```js
      {isBestBall && bbResult ? (
        <MatchPanel bbResult={bbResult} currentHole={currentHole} settings={settings} />
      ) : isSindicato && players.length === 3 ? (
        <SindicatoPanel round={round} players={players} scores={scores} />
      ) : showRunning && players.length === 1 ? (
```

In `makeStyles`, add a `sindicatoStatus` entry next to the existing `totalStripLabel` style:
```js
    sindicatoStatus: {
      fontFamily: 'PlusJakartaSans-SemiBold',
      color: theme.text.secondary,
      fontSize: 11,
      textAlign: 'center',
      marginTop: 6,
    },
```

- [ ] **Step 9: Verify**

Run: `npx jest`
Expected: PASS — full suite still green (UI change does not touch tested modules' behavior).

Manual check (start the app, create a 3-player tournament with `Sindicato` selected):
- The hole-by-hole view shows each player's per-hole points (0–4).
- The bottom strip shows the `SINDICATO` panel with three players' running points, sorted high to low, and a leader/clinch status line.
- The landscape grid view shows the `SINDICATO` header label and per-hole points.
- Entering scores so one player is far enough ahead flips the status to "has clinched".

- [ ] **Step 10: Commit**

```bash
git add src/screens/ScorecardScreen.js
git commit -m "feat: Sindicato scorecard UI — per-hole points, grid, live panel"
```

---

## Task 7: Sindicato home-screen UI

**Files:**
- Modify: `src/screens/HomeScreen.js`

No unit test. Verified with the manual checklist in Step 6.

- [ ] **Step 1: Import the Sindicato functions**

`HomeScreen.js` imports from `'../store/tournamentStore'`. That import block contains the line `matchPlayRoundTally, addPlayerRoundPatches,`. Add the Sindicato functions — change that line to:
```js
  matchPlayRoundTally, addPlayerRoundPatches,
  sindicatoRoundTally, tournamentSindicatoLeaderboard,
```

- [ ] **Step 2: Branch the tournament leaderboard for Sindicato**

The `leaderboard` memo currently reads:
```js
  const leaderboard = useMemo(
    () => (tournament ? tournamentLeaderboard(tournament) : []),
    [tournament],
  );
```
Replace it with:
```js
  const leaderboard = useMemo(
    () => {
      if (!tournament) return [];
      return settings.scoringMode === 'sindicato'
        ? tournamentSindicatoLeaderboard(tournament)
        : tournamentLeaderboard(tournament);
    },
    [tournament, settings.scoringMode],
  );
```
(`tournamentSindicatoLeaderboard` returns `{ player, points, strokes }` — the same shape `tournamentLeaderboard` returns — so the leaderboard renderer needs no change.)

- [ ] **Step 3: Include Sindicato in `tournamentMode`**

The `tournamentMode` line currently reads:
```js
  const tournamentMode = settings.scoringMode === 'bestball' ? 'bestball' : 'stableford';
```
Replace it with:
```js
  const tournamentMode = settings.scoringMode === 'bestball' ? 'bestball'
    : settings.scoringMode === 'sindicato' ? 'sindicato'
    : 'stableford';
```
(`tournamentClinchedId` already calls `tournamentPlayerClinched(tournament, tournamentMode)`; Task 4 made that handle `'sindicato'`.)

- [ ] **Step 4: Add the `SindicatoRoundCard` component**

Add this definition immediately after the `MatchPlayRoundCard` component definition (it ends near line 1915, just before the next `const`/`function`):

```js
const SindicatoRoundCard = React.memo(function SindicatoRoundCard({ round, players, theme, s, showRunning = true }) {
  if (!players || players.length !== 3) {
    return <Text style={s.pairMember}>Sindicato needs 3 players</Text>;
  }
  const tally = sindicatoRoundTally(round, players);
  if (!tally) return <Text style={s.pairMember}>No results yet</Text>;

  const { totals, leaderIdx, lead, clinched, holesLeft } = tally;
  const firstName = (p) => p.name?.split(' ')[0] ?? '—';
  const leader = leaderIdx != null ? totals[leaderIdx].player : null;
  const status = clinched && leader
    ? `${firstName(leader)} wins`
    : leader
      ? `${firstName(leader)} leads by ${lead}${holesLeft > 0 ? ` · ${holesLeft} to play` : ''}`
      : `All level${holesLeft > 0 ? ` · ${holesLeft} to play` : ''}`;

  return (
    <>
      {totals.map(({ player, points }, i) => {
        const isLeader = leaderIdx === i;
        return (
          <View key={player.id} style={[s.pairBlock, showRunning && clinched && isLeader && s.winnerBlock]}>
            {showRunning && clinched && isLeader && <Text style={s.winnerBadge}>WINNER</Text>}
            <View style={s.pairHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                <Text style={s.pairNames}>{player.name}</Text>
                {showRunning && clinched && isLeader && <Feather name="award" size={14} color="#ffd700" />}
              </View>
              <Text style={s.pairPoints}>{showRunning ? `${points} ${points === 1 ? 'pt' : 'pts'}` : '—'}</Text>
            </View>
          </View>
        );
      })}
      <Text style={s.pairsPreviewHint}>{showRunning ? status : 'Scores hidden'}</Text>
    </>
  );
});
```

- [ ] **Step 5: Render `SindicatoRoundCard` and exclude Sindicato from the overview card**

The round-card branch currently reads:
```js
      {hasScores ? (
        settings?.scoringMode === 'matchplay'
          ? <MatchPlayRoundCard round={round} players={players} theme={theme} s={s} showRunning={showRunning} />
          : roundBestBall
            ? <BestBallRoundCard round={round} players={players} settings={settings} clinchedPairIdx={clinchedPairIdx} theme={theme} s={s} showRunning={showRunning} />
            : <StablefordRoundCard round={round} players={players} clinchedPairIdx={clinchedPairIdx} theme={theme} s={s} showRunning={showRunning} />
      ) : revealed && hasPairs ? (
```
Replace the inner ternary so Sindicato gets its card:
```js
      {hasScores ? (
        settings?.scoringMode === 'matchplay'
          ? <MatchPlayRoundCard round={round} players={players} theme={theme} s={s} showRunning={showRunning} />
          : settings?.scoringMode === 'sindicato'
            ? <SindicatoRoundCard round={round} players={players} theme={theme} s={s} showRunning={showRunning} />
            : roundBestBall
              ? <BestBallRoundCard round={round} players={players} settings={settings} clinchedPairIdx={clinchedPairIdx} theme={theme} s={s} showRunning={showRunning} />
              : <StablefordRoundCard round={round} players={players} clinchedPairIdx={clinchedPairIdx} theme={theme} s={s} showRunning={showRunning} />
      ) : revealed && hasPairs ? (
```

The `GameOverviewCard` is gated by a condition containing
`settings.scoringMode !== 'matchplay' && settings.scoringMode !== 'bestball'`
which appears **twice** (the `GameOverviewCard` render guard and the paired "ROUND SCORES" guard). In both occurrences, replace:
```js
        && settings.scoringMode !== 'matchplay' && settings.scoringMode !== 'bestball' && (
```
with:
```js
        && settings.scoringMode !== 'matchplay' && settings.scoringMode !== 'bestball' && settings.scoringMode !== 'sindicato' && (
```

- [ ] **Step 6: Verify**

Run: `npx jest`
Expected: PASS — full suite green.

Manual check (3-player Sindicato tournament with some holes scored):
- The Home round card shows three rows — one per player — with each player's points, ordered leader-first.
- The status line reads "X leads by N · M to play", or "X wins" with a `WINNER` badge + gold award icon once clinched.
- The tournament leaderboard ranks the three players by cumulative Sindicato points.
- A single-round Sindicato game shows the round-scores card, not the `GameOverviewCard`.

- [ ] **Step 7: Commit**

```bash
git add src/screens/HomeScreen.js
git commit -m "feat: Sindicato home-screen round card and leaderboard"
```

---

## Self-Review Notes

- **Spec coverage:** Engine `sindicatoHolePoints` + `sindicatoRoundTally` (Task 1) ✓; `tournamentSindicatoLeaderboard` + clinch (Task 2) ✓; mode entry, 3-player gating, Head-to-head category (Task 3) ✓; `tournamentStore` re-export + `tournamentPlayerClinched` branch (Task 4) ✓; solo pair-building across the three screens (Task 5) ✓; `ScorecardScreen` per-hole points, grid, live panel (Task 6) ✓; `HomeScreen` `SindicatoRoundCard`, leaderboard branch, overview-card exclusion (Task 7) ✓. Per-hole color treatment — Sindicato points flow through the existing `HolePage`/`GridView` points rendering, which already colors numeric points; no separate task needed. `roundPairClinched` deliberately untouched (spec §4). The spec's placement of leaderboard/clinch in `tournamentStore.js` is refined to `scoring.js` (documented in the header).
- **Type consistency:** `sindicatoHolePoints` → `{ [id]: number } | null`; `sindicatoRoundTally` → `{ totals: [{player, points}], played, holesLeft, leaderIdx, lead, clinched } | null`; `tournamentSindicatoLeaderboard` → `[{ player, points, strokes }]`; `tournamentSindicatoClinched` → `string | null`. `leaderIdx` indexes into `totals` and is consumed that way in both `SindicatoPanel` and `SindicatoRoundCard`. The `'sindicato'` mode string is used consistently across `scoringModes.js`, `tournamentStore.js`, and both screens.
- **No placeholders:** every code step contains complete, runnable code.
