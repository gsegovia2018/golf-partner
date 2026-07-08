# Per-Round Scoring Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each round of a tournament can use its own scoring mode (`round.scoringMode` overriding the tournament default), with a Stableford-total leaderboard for mixed tournaments.

**Architecture:** One helper — `roundScoringMode(tournament, round)` — becomes the single source of truth for a round's effective mode; every round-scoped consumer (scorecard, reveal, team editor, per-round leaderboard values, stats) switches to it. A new `round.setScoringMode` mutation writes per-round overrides; the tournament settings sheet keeps meaning "set default + reset all rounds". Mixed tournaments rank by a new `tournamentStablefordLeaderboard` (individual Stableford; scramble rounds contribute per-player team Stableford), which also replaces the broken Stableford alternate view for scramble tournaments.

**Tech Stack:** Expo SDK 54 / React Native 0.81, plain JS stores, Jest (jest-expo).

**Spec:** `docs/superpowers/specs/2026-07-08-per-round-scoring-modes-design.md`

## Global Constraints

- Tests: `npm test` (Jest, 910 tests at branch time). Lint: `npm run lint` — 0 errors, warnings must not exceed 49. Both pass at every commit.
- Domain logic in `src/store/` / pure modules, never in screens (CLAUDE.md).
- `round.scoringMode` is OPTIONAL: absent → `tournament.settings.scoringMode` → `'stableford'`. Legacy tournaments (no round field) behave byte-identically to today.
- Rounds are ALWAYS editable (user decision): changing a scored round's mode reinterprets scores; nothing is deleted.
- Mixed-tournament overall board = individual Stableford summed across rounds; scramble rounds contribute each player's TEAM Stableford points/strokes.
- `bestBallValue`/`worstBallValue`/`fixedTeams`/`manualTeams` stay tournament-level.
- Official tournaments untouched (separate format system).
- Work on branch `feature/per-round-scoring-modes` (create from master at start). SHARED-CHECKOUT WARNING: another session may commit to this repo concurrently — implementers stage ONLY their own files explicitly (never `git add -A`/`commit -a`), and the controller verifies `git log` after each task.
- All quoted line anchors are from master @ 99e1556 — re-locate by content if drifted.

---

**Verified anchors (master @ 99e1556):** `buildTeamsForMode` scoring.js:270; `tournamentScrambleLeaderboard` scoring.js:559 (uses `teamOfPlayer`, `isRoundPlayed(round, index, tournament)`); `tournamentPairsMatchStandings` scoring.js:582; `tournamentLeaderboard` tournamentStore.js:1363; `roundTotals` tournamentStore.js:947; `setScoringModeRoundPatches` tournamentStore.js:877 (+`buildPairsForModeChange`:859, add/remove builders reading `oldMode` at 732/807); DEFAULT_SETTINGS tournamentStore.js:918; mutate.js `metaPathFor`:9-79 / `tournament.setScoringMode` case:205 / `pairs.set` case:127; HomeScreen `leaderboard` useMemo:843, `saveScoringMode`:746, per-round "Round N" sheet:1860-1877 (`renderTeamsMenuItem`:915, `openRoundEdit`:906), `getSelectedRoundValue`:1426, `strokesByPlayer`:1422, draft seeding:1980; SetupScreen `renderScoringStep`:684, `handleStart` round build:352-406, wizard round shape:86-88/269, per-round control pattern `renderTeesStep`:699; StatsScreen gating:132-143, scramble placeholder:160-183, `showH2H`:542, round scope:98-100/146-150; personalStats `collectMyRounds`:177-218 (tournament-level scramble skip at 183); HoleView rawMode:131 + ternary:251-255 + RoundSummary:275; GridView rawMode:372-378; ScorecardScreen:823/839/1060/1070; NextRoundScreen `buildPairsForRound`:63-76, mode block:175-189; EditTeamsScreen:54.

### Task 1: Core helpers — effective mode, mixed detection, team shape

**Files:**
- Modify: `src/store/scoring.js`
- Test: `src/store/__tests__/roundScoringMode.test.js` (create)

**Interfaces:**
- Produces (consumed by every later task):
  - `roundScoringMode(tournament, round): string` — `round?.scoringMode ?? tournament?.settings?.scoringMode ?? 'stableford'`
  - `tournamentHasMixedModes(tournament): boolean` — true when ≥2 rounds have different effective modes
  - `teamShapeOf(mode): 'solo' | '2x2' | '3+1' | '1x4'` — individual/matchplay/sindicato → 'solo'; stableford/bestball/scramblepairs/pairsmatchplay → '2x2'; scramble3v1 → '3+1'; scramble4 → '1x4'

- [ ] **Step 1: Write failing tests** — create `src/store/__tests__/roundScoringMode.test.js`:

```js
import { roundScoringMode, tournamentHasMixedModes, teamShapeOf } from '../scoring';

describe('roundScoringMode', () => {
  const t = { settings: { scoringMode: 'stableford' } };
  it('round override wins', () => {
    expect(roundScoringMode(t, { scoringMode: 'scramblepairs' })).toBe('scramblepairs');
  });
  it('falls back to the tournament default', () => {
    expect(roundScoringMode(t, {})).toBe('stableford');
    expect(roundScoringMode(t, undefined)).toBe('stableford');
  });
  it('falls back to stableford with no settings', () => {
    expect(roundScoringMode({}, {})).toBe('stableford');
    expect(roundScoringMode(undefined, undefined)).toBe('stableford');
  });
});

describe('tournamentHasMixedModes', () => {
  it('false for uniform and legacy tournaments', () => {
    expect(tournamentHasMixedModes({
      settings: { scoringMode: 'stableford' },
      rounds: [{}, {}],
    })).toBe(false);
    expect(tournamentHasMixedModes({
      settings: { scoringMode: 'matchplay' },
      rounds: [{ scoringMode: 'matchplay' }, {}],
    })).toBe(false);
  });
  it('true when any two rounds differ', () => {
    expect(tournamentHasMixedModes({
      settings: { scoringMode: 'stableford' },
      rounds: [{}, { scoringMode: 'scramblepairs' }],
    })).toBe(true);
  });
  it('false for zero/one round', () => {
    expect(tournamentHasMixedModes({ settings: { scoringMode: 'stableford' }, rounds: [] })).toBe(false);
    expect(tournamentHasMixedModes({ settings: { scoringMode: 'stableford' } })).toBe(false);
  });
});

describe('teamShapeOf', () => {
  it.each([
    ['individual', 'solo'], ['matchplay', 'solo'], ['sindicato', 'solo'],
    ['stableford', '2x2'], ['bestball', '2x2'], ['scramblepairs', '2x2'], ['pairsmatchplay', '2x2'],
    ['scramble3v1', '3+1'], ['scramble4', '1x4'],
  ])('%s → %s', (mode, shape) => {
    expect(teamShapeOf(mode)).toBe(shape);
  });
  it('unknown mode → solo', () => {
    expect(teamShapeOf('nonsense')).toBe('solo');
  });
});
```

- [ ] **Step 2:** `npx jest roundScoringMode` → FAIL (not exported).
- [ ] **Step 3: Implement** in `src/store/scoring.js` (near `buildTeamsForMode`, ~line 270):

```js
// ── Per-round scoring modes ─────────────────────────────────────────────────
// A round may override the tournament's default mode. This helper is the
// single source of truth for a round's effective mode — every round-scoped
// consumer reads it instead of settings.scoringMode.
export function roundScoringMode(tournament, round) {
  return round?.scoringMode ?? tournament?.settings?.scoringMode ?? 'stableford';
}

// True when the tournament's rounds do not all share one effective mode.
// Mixed tournaments rank by the Stableford total board.
export function tournamentHasMixedModes(tournament) {
  const rounds = tournament?.rounds ?? [];
  if (rounds.length < 2) return false;
  const first = roundScoringMode(tournament, rounds[0]);
  return rounds.some((r) => roundScoringMode(tournament, r) !== first);
}

// The team shape a mode's pairs take. fixedTeams reuses partnerships only
// across rounds whose modes share a shape.
export function teamShapeOf(mode) {
  if (mode === 'scramble4') return '1x4';
  if (mode === 'scramble3v1') return '3+1';
  if (mode === 'stableford' || mode === 'bestball'
    || mode === 'scramblepairs' || mode === 'pairsmatchplay') return '2x2';
  return 'solo';
}
```

- [ ] **Step 4:** `npx jest roundScoringMode` → PASS. Re-export all three from `src/store/tournamentStore.js` via the existing `export { ... } from './scoring';` block.
- [ ] **Step 5: Commit** — `feat(modes): roundScoringMode effective-mode helpers`

### Task 2: `round.setScoringMode` mutation + uniform-reset clears overrides

**Files:**
- Modify: `src/store/mutate.js` (`metaPathFor`:9-79, `applyToTournament`:84-217)
- Test: `src/store/__tests__/roundModeMutation.test.js` (create)

**Interfaces:**
- Consumes: existing mutation pipeline (`applyToTournament(t, m)` mutates in place; `metaPathFor(m)` returns path(s)).
- Produces:
  - Mutation `{ type: 'round.setScoringMode', roundId, scoringMode, pairs }` — sets `round.scoringMode` and `round.pairs`; `round.revealed` untouched.
  - `tournament.setScoringMode` additionally DELETES `round.scoringMode` on every patched round (uniform reset), and its meta paths include `rounds.${roundId}.scoringMode` per patch.

- [ ] **Step 1: Write failing tests** — create `src/store/__tests__/roundModeMutation.test.js` (mirror `noteMutation.test.js` style — `applyToTournament` on plain fixtures):

```js
import { applyToTournament, metaPathFor } from '../mutate';

const P = (id) => ({ id, name: id });
const PAIRS = [[P('a'), P('b')], [P('c'), P('d')]];

describe('round.setScoringMode mutation', () => {
  it('sets the round override and pairs, preserving revealed', () => {
    const t = { rounds: [{ id: 'r1', pairs: [], revealed: false }] };
    applyToTournament(t, {
      type: 'round.setScoringMode', roundId: 'r1',
      scoringMode: 'scramblepairs', pairs: PAIRS,
    });
    expect(t.rounds[0].scoringMode).toBe('scramblepairs');
    expect(t.rounds[0].pairs).toEqual(PAIRS);
    expect(t.rounds[0].revealed).toBe(false);
  });

  it('leaves a revealed round revealed', () => {
    const t = { rounds: [{ id: 'r1', pairs: [], revealed: true }] };
    applyToTournament(t, {
      type: 'round.setScoringMode', roundId: 'r1',
      scoringMode: 'matchplay', pairs: [[P('a')], [P('b')]],
    });
    expect(t.rounds[0].revealed).toBe(true);
  });

  it('meta paths cover mode and pairs', () => {
    expect(metaPathFor({ type: 'round.setScoringMode', roundId: 'r1', scoringMode: 'x', pairs: [] }))
      .toEqual(['rounds.r1.scoringMode', 'rounds.r1.pairs']);
  });
});

describe('tournament.setScoringMode clears per-round overrides', () => {
  it('deletes round.scoringMode on patched rounds', () => {
    const t = {
      settings: { scoringMode: 'stableford' },
      rounds: [
        { id: 'r0', scoringMode: 'scramblepairs', pairs: [] },
        { id: 'r1', scoringMode: 'pairsmatchplay', pairs: [] },
      ],
    };
    applyToTournament(t, {
      type: 'tournament.setScoringMode', scoringMode: 'bestball',
      roundPatches: [{ roundId: 'r1', pairs: PAIRS }],
    });
    expect(t.settings.scoringMode).toBe('bestball');
    expect(t.rounds[1].scoringMode).toBeUndefined();
    expect(t.rounds[1].pairs).toEqual(PAIRS);
    // Unpatched (already played) round keeps its override.
    expect(t.rounds[0].scoringMode).toBe('scramblepairs');
  });

  it('meta paths include per-round scoringMode for patched rounds', () => {
    const paths = metaPathFor({
      type: 'tournament.setScoringMode', scoringMode: 'bestball',
      roundPatches: [{ roundId: 'r1', pairs: PAIRS }],
    });
    expect(paths).toEqual(expect.arrayContaining([
      'settings.scoringMode', 'rounds.r1.pairs', 'rounds.r1.scoringMode',
    ]));
  });
});
```
(If `metaPathFor` is not currently exported from mutate.js, export it.)

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** in `src/store/mutate.js`:

(a) `applyToTournament` — new case after `pairs.set`:

```js
    case 'round.setScoringMode': {
      const round = t.rounds?.find((r) => r.id === m.roundId);
      if (!round) return;
      // Per-round mode override. Teams are rebuilt by the caller for the
      // new shape; revealed is preserved — changing a future round's mode
      // must not spoil its reveal.
      round.scoringMode = m.scoringMode;
      if (m.pairs) round.pairs = m.pairs;
      break;
    }
```

(b) `tournament.setScoringMode` case — clear overrides on patched rounds:

```js
    case 'tournament.setScoringMode': {
      t.settings = { ...(t.settings ?? {}), scoringMode: m.scoringMode };
      for (const patch of (m.roundPatches ?? [])) {
        const round = t.rounds?.find((r) => r.id === patch.roundId);
        if (!round) continue;
        if (patch.pairs) round.pairs = patch.pairs;
        // The tournament-wide setter makes the tournament uniform again:
        // per-round overrides on the patched (future) rounds are cleared.
        delete round.scoringMode;
      }
      break;
    }
```

(c) `metaPathFor` — new case + extend the existing `tournament.setScoringMode` case:

```js
    case 'round.setScoringMode':
      return [`rounds.${m.roundId}.scoringMode`, `rounds.${m.roundId}.pairs`];
```
and inside the existing `tournament.setScoringMode` branch, push `` `rounds.${patch.roundId}.scoringMode` `` for every patch (alongside the existing pairs path).

- [ ] **Step 4:** `npx jest roundModeMutation pairsSetMutation` → PASS; full `npm test` → PASS.
- [ ] **Step 5: Commit** — `feat(modes): round.setScoringMode mutation and uniform reset`

### Task 3: Boards — Stableford total + per-round gating

**Files:**
- Modify: `src/store/scoring.js` (boards at :559, :582, sindicato board, match-play standings), `src/store/tournamentStore.js` (`tournamentLeaderboard`:1363, re-exports)
- Test: `src/store/__tests__/mixedModeLeaderboard.test.js` (create), extend `scramble.test.js`/`pairsMatchplay.test.js` gating cases

**Interfaces:**
- Consumes: `roundScoringMode`, `isScrambleMode`, `scrambleRoundTally`, `roundTotals` (tournamentStore:947), `isRoundPlayed`, `teamOfPlayer` (scoring.js, used at :559).
- Produces:
  - `tournamentStablefordLeaderboard(tournament): [{ player, points, strokes }]` — per round: scramble effective mode → each player's team Stableford points/strokes (scrambleRoundTally + teamOfPlayer); any other mode → individual `roundTotals`. Sorted points desc. THIS becomes both the mixed-tournament overall board and HomeScreen's Stableford alternate board (fixing the scramble alt-view 0s).
  - Every mode-specific cumulative board (`tournamentScrambleLeaderboard`, `tournamentPairsMatchStandings`, `tournamentSindicatoLeaderboard`, `tournamentBestWorstLeaderboard`, `tournamentMatchPlayStandings`) skips rounds whose effective mode does not match its mode family (so uniform tournaments are unchanged and stray overrides can't pollute).

- [ ] **Step 1: Write failing tests** — create `src/store/__tests__/mixedModeLeaderboard.test.js`:

```js
import { tournamentStablefordLeaderboard, tournamentScrambleLeaderboard } from '../scoring';

const P = (id, name, handicap = 0) => ({ id, name, handicap });
const players = [P('a', 'Ann'), P('b', 'Bob'), P('c', 'Cam'), P('d', 'Dan')];
const HOLE = { number: 1, par: 4, strokeIndex: 1 };

// Round 1: plain stableford, everyone scores their own ball.
const stablefordRound = {
  id: 'r0',
  holes: [HOLE],
  pairs: players.map((p) => [p]),
  playerHandicaps: {},
  scores: { a: { 1: 3 }, b: { 1: 4 }, c: { 1: 5 }, d: { 1: 4 } }, // 3/2/1/2 pts
};

// Round 2: scramble pairs — team balls under captains a and c.
const scrambleRound = {
  id: 'r1',
  scoringMode: 'scramblepairs',
  holes: [HOLE],
  pairs: [[players[0], players[1]], [players[2], players[3]]],
  playerHandicaps: {},
  scores: { a: { 1: 3 }, c: { 1: 4 } }, // team a/b: 3 pts, team c/d: 2 pts
};

const t = {
  settings: { scoringMode: 'stableford' },
  players,
  rounds: [stablefordRound, scrambleRound],
  currentRound: 1,
};

describe('tournamentStablefordLeaderboard', () => {
  it('sums individual stableford, with team stableford for scramble rounds', () => {
    const board = tournamentStablefordLeaderboard(t);
    const byId = Object.fromEntries(board.map((e) => [e.player.id, e]));
    expect(byId.a.points).toBe(3 + 3); // own 3 + team 3
    expect(byId.b.points).toBe(2 + 3); // own 2 + team 3
    expect(byId.c.points).toBe(1 + 2);
    expect(byId.d.points).toBe(2 + 2);
    expect(board[0].player.id).toBe('a');
  });

  it('scramble rounds contribute team strokes, not zeros', () => {
    const board = tournamentStablefordLeaderboard(t);
    const byId = Object.fromEntries(board.map((e) => [e.player.id, e]));
    expect(byId.b.strokes).toBe(4 + 3); // own 4 + team ball 3
  });
});

describe('mode-family gating of cumulative boards', () => {
  it('tournamentScrambleLeaderboard ignores non-scramble rounds', () => {
    const board = tournamentScrambleLeaderboard(t);
    const byId = Object.fromEntries(board.map((e) => [e.player.id, e]));
    // Only the scramble round contributes.
    expect(byId.a.points).toBe(3);
    expect(byId.c.points).toBe(2);
  });
});
```
(Check `isRoundPlayed(round, index, tournament)`'s semantics FIRST — read it; if it excludes rounds beyond `currentRound`, set `currentRound`/scores in the fixture so both rounds count. Adjust the fixture, not the expectations.)

- [ ] **Step 2:** Run → FAIL (`tournamentStablefordLeaderboard` not exported).
- [ ] **Step 3: Implement.**

(a) In `src/store/scoring.js`:

```js
// Individual Stableford board across all rounds. Scramble rounds have no
// individual balls, so each player contributes their TEAM's Stableford
// points/strokes there. This is the overall board for mixed-mode
// tournaments and the Stableford alternate view everywhere.
export function tournamentStablefordLeaderboard(tournament) {
  const { players = [], rounds = [] } = tournament ?? {};
  const acc = new Map(players.map((p) => [p.id, { player: p, points: 0, strokes: 0 }]));
  rounds.forEach((round, index) => {
    if (!isRoundPlayed(round, index, tournament)) return;
    const mode = roundScoringMode(tournament, round);
    if (isScrambleMode(mode)) {
      const tally = scrambleRoundTally(round, players);
      if (!tally) return;
      const rowByCaptain = new Map(tally.totals.map((r) => [r.unit.id, r]));
      for (const p of players) {
        const team = teamOfPlayer(round, p.id);
        const row = team ? rowByCaptain.get(team[0]?.id) : null;
        if (!row) continue;
        const cur = acc.get(p.id);
        cur.points += row.points;
        cur.strokes += row.strokes;
      }
      return;
    }
    for (const rt of roundTotals(round, players)) {
      const cur = acc.get(rt.player.id);
      if (!cur) continue;
      cur.points += rt.totalPoints;
      cur.strokes += rt.totalStrokes;
    }
  });
  return [...acc.values()].sort((a, b) => b.points - a.points);
}
```
`roundTotals` lives in tournamentStore.js (:947) which imports FROM scoring.js — to avoid a cycle, MOVE `roundTotals` into scoring.js (it only uses `getPlayingHandicap` + `calcStablefordPoints`, both already in scoring.js) and re-export it from tournamentStore.js like the other moved functions (the extraction pattern is documented at tournamentStore.js:914-916).

(b) Gate the mode-family boards — inside each round loop add an effective-mode guard as the FIRST check:
- `tournamentScrambleLeaderboard` (:559): `if (!isScrambleMode(roundScoringMode(tournament, round))) return;`
- `tournamentPairsMatchStandings` (:582): `if (roundScoringMode(tournament, round) !== 'pairsmatchplay') return;`
- `tournamentSindicatoLeaderboard`: `!== 'sindicato'` guard.
- `tournamentMatchPlayStandings`: `!== 'matchplay'` guard (in its rounds loop).
- In tournamentStore.js: `tournamentBestWorstLeaderboard` skips rounds `!== 'bestball'`; `tournamentLeaderboard` (:1363) skips scramble rounds (individual points are meaningless there) — one guard each.

(c) Re-export `tournamentStablefordLeaderboard` (and the moved `roundTotals`) from tournamentStore.js.

- [ ] **Step 4:** `npx jest mixedModeLeaderboard scramble pairsMatchplay` → PASS; full `npm test` → PASS (existing board tests stay green — uniform tournaments hit the guards affirmatively).
- [ ] **Step 5: Commit** — `feat(modes): stableford total board and per-round gating`

### Task 4: Patch builders honor per-round modes

**Files:**
- Modify: `src/store/tournamentStore.js` (`addPlayerRoundPatches`:731, `removePlayerRoundPatches`:806), `src/store/mutate.js` (`tournament.addPlayer`/`tournament.removePlayer` cases + meta paths)
- Test: `src/store/__tests__/addPlayerRoundPatches.test.js`, `src/store/__tests__/removePlayerRoundPatches.test.js` (extend)

**Interfaces:**
- Consumes: `roundScoringMode` semantics (`round.scoringMode ?? nextScoringMode`), `teamShapeOf`, `isScoringModeAllowed`, `buildTeamsForMode`.
- Produces:
  - `addPlayerRoundPatches`/`removePlayerRoundPatches`: per-round patches build pairs from each round's EFFECTIVE mode; when a round's override becomes invalid for the new roster size, the patch carries `clearScoringMode: true`.
  - mutate.js `tournament.addPlayer`/`tournament.removePlayer` cases delete `round.scoringMode` when `patch.clearScoringMode`, and their metaPathFor arrays gain `` `rounds.${patch.roundId}.scoringMode` `` for such patches.

- [ ] **Step 1: Write failing tests** — extend `addPlayerRoundPatches.test.js` / `removePlayerRoundPatches.test.js` (READ their helper factories first and adapt names):

```js
describe('per-round mode overrides', () => {
  it('builds each future round with its own effective mode', () => {
    const t = makeTournament({
      players: [p('a'), p('b'), p('c')],
      mode: 'individual',
      rounds: [
        makeRound({ id: 'r0' }),
        { ...makeRound({ id: 'r1' }), scoringMode: 'scramble3v1' },
      ],
      currentRound: 0,
    });
    const { patches } = addPlayerRoundPatches(t, p('d'));
    const r1 = patches.find((x) => x.roundId === 'r1');
    // scramble3v1 valid at 4 players → 3+1 shape
    expect(r1.pairs.map((x) => x.length).sort()).toEqual([1, 3]);
  });

  it('clears an override that the new roster invalidates', () => {
    const t = makeTournament({
      players: [p('a'), p('b'), p('c'), p('d')],
      mode: 'individual',
      rounds: [{ ...makeRound({ id: 'r0' }), scoringMode: 'scramblepairs' }],
      currentRound: 0,
    });
    const { patches } = removePlayerRoundPatches(t, 'd'); // 3 players left
    const r0 = patches.find((x) => x.roundId === 'r0');
    expect(r0.clearScoringMode).toBe(true);
    // pairs rebuilt for the fallback (default) mode
    expect(r0.pairs.flat()).toHaveLength(3);
  });
});
```
(The remove call's second argument is whatever the real API takes — read the signature.) Also add a mutate-level test in `roundModeMutation.test.js`: an addPlayer/removePlayer mutation whose patch has `clearScoringMode: true` deletes `round.scoringMode`.

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.** In both builders' round loops (currently building pairs once from the single `nextScoringMode`):
  - `const roundMode = round.scoringMode ?? nextScoringMode;`
  - `const valid = isScoringModeAllowed(roundMode, newCount);`
  - effective rebuild mode = `valid ? roundMode : nextScoringMode`; when `!valid && round.scoringMode`, set `patch.clearScoringMode = true`.
  - build pairs with the per-round effective mode (read `buildPairsForAddedPlayer`/`buildPairsForRemovedPlayer` and thread the mode per round; preserve the existing `fixedTeams` once-per-mutation pairs reuse but scope the cached pairs PER `teamShapeOf(effective mode)` — a `Map(shape → pairs)` in place of the single cached value).
  In mutate.js `tournament.addPlayer`/`tournament.removePlayer` cases: `if (patch.clearScoringMode && round) delete round.scoringMode;`; extend both metaPathFor branches with the per-patch scoringMode path when `patch.clearScoringMode`.
- [ ] **Step 4:** `npx jest addPlayerRoundPatches removePlayerRoundPatches roundModeMutation setScoringModeRoundPatches` → PASS; full suite PASS.
- [ ] **Step 5: Commit** — `feat(modes): roster patches honor per-round modes`

### Task 5: Round-scoped screens read the effective mode

**Files:**
- Modify: `src/screens/ScorecardScreen.js` (:823, :839, :1060, :1070), `src/components/scorecard/HoleView.js` (:131, :149, :251-255, :275), `src/components/scorecard/GridView.js` (:372), `src/screens/EditTeamsScreen.js` (:54), `src/screens/NextRoundScreen.js` (:63-76, :175-189)
- Modify: `src/store/scoring.js` (one new pure helper), Test: `src/store/__tests__/roundScoringMode.test.js` (extend)

**Interfaces:**
- Consumes: `roundScoringMode`, `teamShapeOf`, `buildTeamsForMode` (Task 1 / existing).
- Produces: `pairsForNextRound(tournament, targetRound): pairs` — pure extraction of NextRoundScreen's build logic: when `settings.fixedTeams`, copy partnerships from the most recent earlier round whose effective mode shares `teamShapeOf` with the target round's AND whose flattened pair ids equal the roster ids; else `buildTeamsForMode(effectiveMode, players)`.

- [ ] **Step 1: Write failing tests** for `pairsForNextRound` (append to roundScoringMode.test.js; `const P4 = (id) => ({ id, name: id });`):

```js
import { pairsForNextRound } from '../scoring';

describe('pairsForNextRound', () => {
  const players = [P4('a'), P4('b'), P4('c'), P4('d')];
  it('fixedTeams copies from the latest same-shape round', () => {
    const prevPairs = [[players[0], players[1]], [players[2], players[3]]];
    const t = {
      settings: { scoringMode: 'scramblepairs', fixedTeams: true },
      players,
      rounds: [
        { id: 'r0', pairs: prevPairs, scoringMode: 'scramblepairs' },
        { id: 'r1', scoringMode: 'pairsmatchplay' }, // 2x2 too — copies r0
      ],
    };
    const pairs = pairsForNextRound(t, t.rounds[1]);
    expect(pairs.map((pr) => pr.map((p) => p.id))).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('fixedTeams does NOT copy across different shapes', () => {
    const t = {
      settings: { scoringMode: 'scramblepairs', fixedTeams: true },
      players,
      rounds: [
        { id: 'r0', pairs: [[players[0], players[1]], [players[2], players[3]]], scoringMode: 'scramblepairs' },
        { id: 'r1', scoringMode: 'scramble3v1' }, // 3+1 — fresh build
      ],
    };
    const pairs = pairsForNextRound(t, t.rounds[1]);
    expect(pairs.map((x) => x.length).sort()).toEqual([1, 3]);
  });

  it('no fixedTeams → fresh build from the round mode', () => {
    const t = {
      settings: { scoringMode: 'stableford', fixedTeams: false },
      players,
      rounds: [{ id: 'r0', scoringMode: 'scramble4' }],
    };
    expect(pairsForNextRound(t, t.rounds[0])).toHaveLength(1);
  });
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** `pairsForNextRound` in scoring.js:

```js
// Pairs for a round about to be revealed/started. fixedTeams reuses the
// most recent earlier round's partnerships when the team SHAPES match and
// the roster is unchanged; otherwise the round gets a fresh build from its
// own effective mode.
export function pairsForNextRound(tournament, targetRound) {
  const players = tournament?.players ?? [];
  const mode = roundScoringMode(tournament, targetRound);
  if (tournament?.settings?.fixedTeams) {
    const rosterIds = players.map((p) => p.id).sort().join(',');
    const rounds = tournament?.rounds ?? [];
    const targetIdx = rounds.indexOf(targetRound);
    const searchEnd = targetIdx >= 0 ? targetIdx : rounds.length;
    for (let i = searchEnd - 1; i >= 0; i--) {
      if (teamShapeOf(roundScoringMode(tournament, rounds[i])) !== teamShapeOf(mode)) continue;
      const pairIds = (rounds[i].pairs ?? []).flat().map((p) => p.id).sort().join(',');
      if (pairIds && pairIds === rosterIds) {
        return rounds[i].pairs.map((pr) => [...pr]);
      }
    }
  }
  return buildTeamsForMode(mode, players);
}
```
Re-export from tournamentStore.js.

- [ ] **Step 4: Wire the screens** (each is a one-expression substitution — import `roundScoringMode`/`pairsForNextRound` following each file's existing import source for scoring symbols):
  - ScorecardScreen :823 — replace `tournament?.settings?.scoringMode` with `roundScoringMode(tournament, round)` (identify the displayed round variable in scope near each anchor); :839, :1060, :1070 same substitution (the bestball checks become `roundScoringMode(tournament, round) === 'bestball'`).
  - HoleView :131 — `const rawMode = round?.scoringMode ?? settings?.scoringMode ?? 'stableford';` (component has `round` + `settings` props, no tournament object); memo dep :149 already includes `round`; apply the same inline fallback as the source of the :251-255 ternary and the :275 RoundSummary `mode`.
  - GridView :372 — same inline fallback for `rawMode`.
  - EditTeamsScreen :54 — `const scoringMode = roundScoringMode(tournament, round);` (round in scope at :53).
  - NextRoundScreen — replace `buildPairsForRound`'s body (:63-76) with a call to `pairsForNextRound(t, <target round>)` (read how the screen resolves the target round — `roundIndex` param vs next-round semantics — and pass that round object); :175 `const mode = roundScoringMode(tournament, round);` (round in scope at :170).
- [ ] **Step 5:** Full `npm test` + `npm run lint` (≤49 warnings). Commit — `feat(modes): round-scoped screens read effective mode`

### Task 6: HomeScreen — mixed board, per-round values, Round Mode sheet item

**Files:**
- Modify: `src/screens/HomeScreen.js` (`leaderboard` useMemo:843, `stablefordBoard`:857, `isStablefordMode`:864, `selectedRoundPlayerTotals`:877, clinch `tournamentMode`:891, `renderTeamsMenuItem`:915, Round N sheet:1860-1877, `strokesByPlayer`:1422, `toggleLabels`:1425, `getSelectedRoundValue`:1426, `saveScoringMode`:746)
- Modify (if needed): `src/components/ScoringModePicker.js` (export the internal `ScoringModeSheet` for reuse)
- Test: engine coverage from Tasks 1–4; HomeScreen harness mocks heavily — document manual traces where it can't reach.

**Interfaces:**
- Consumes: `tournamentHasMixedModes`, `tournamentStablefordLeaderboard`, `roundScoringMode`, `buildTeamsForMode`, mutation `round.setScoringMode` (Task 2), `mutate`, `getScoringMode` (labels).

- [ ] **Step 1: Board routing.** In the `leaderboard` useMemo (:843) add as the FIRST branch:

```js
      if (tournamentHasMixedModes(tournament)) return tournamentStablefordLeaderboard(tournament);
```
Replace `stablefordBoard`'s source (:857-860) with `tournamentStablefordLeaderboard(tournament)` (fixes the scramble alt-view zeros). `isStablefordMode` (:864): mixed counts as stableford (`tournamentHasMixedModes(tournament) || <existing check>`). `toggleLabels` (:1425): `tournamentHasMixedModes(tournament) ? { left: 'Stableford', right: 'Stroke Play' } : leaderboardToggleLabels(settings.scoringMode)`. `strokesByPlayer` (:1422): collapse to `Object.fromEntries(stablefordBoard.map((e) => [e.player.id, e.strokes]))` and delete the scramble special case. Clinch (:891-898): return null/skip when mixed.

- [ ] **Step 2: Per-round values.** `getSelectedRoundValue` (:1426): `const selMode = roundScoringMode(tournament, selectedRoundData);` at the top; replace every `settings.scoringMode` comparison in the function with `selMode`. `selectedRoundPlayerTotals` (:877-890): same substitution for the selected round. `renderTeamsMenuItem` (:915): gate on `scoringModeUsesTeams(roundScoringMode(tournament, tournament.rounds[selectedRound]), tournament.players.length)`.

- [ ] **Step 3: Round Mode item in the per-round sheet.** In the "Round N" sheet (:1860-1877), above `renderTeamsMenuItem`, add a menu row ("Scoring Mode" + the round's effective mode label via `getScoringMode(...).label`, Feather icon 'flag') that opens the mode sheet for that round. Reuse the picker's sheet: export `ScoringModeSheet` from `src/components/ScoringModePicker.js` (it exists internally at :29-91) and render it in HomeScreen with `value={roundScoringMode(tournament, r)}`, `playerCount={tournament.players.length}`. On select of mode `key` for round `r = tournament.rounds[selectedRound]`:

```js
const pairs = buildTeamsForMode(key, tournament.players);
await mutate(tournament, { type: 'round.setScoringMode', roundId: r.id, scoringMode: key, pairs });
await reload();
```
(Match the sheet's open/close state conventions used by the other Home modals.)

- [ ] **Step 4: Uniform reset.** `saveScoringMode` (:746): when building `updated.rounds`, strip the override on every patched round — `pairsByRound.has(r.id) ? { ...r, pairs: pairsByRound.get(r.id), scoringMode: undefined } : r` (JSON.stringify drops undefined keys on save, which is the desired cleared state — verify saveTournament serializes via JSON and note it in the report).
- [ ] **Step 5:** Full `npm test` + lint. Manual trace in the report: mixed tournament board = Stableford totals; per-round column native; Round N sheet mode change switches that round's scorecard. Commit — `feat(modes): per-round mode editing and mixed-mode leaderboard`

### Task 7: Setup wizard per-round mode pickers

**Files:**
- Modify: `src/screens/SetupScreen.js` (`renderScoringStep`:684-697, `handleStart`:352-406)
- Test: no wizard harness — pure logic is covered by Tasks 1/5 helpers; document the manual trace.

**Interfaces:**
- Consumes: `round.scoringMode` field semantics, `buildTeamsForMode`, `teamShapeOf`, `getScoringMode`, `needsManualTeamSetup` (read its signature in src/lib — added with manualTeams).

- [ ] **Step 1: renderScoringStep** (:684): keep the default `ScoringModePicker`. Below it, when `rounds.length > 1`, render one compact row per round (follow `renderTeesStep`'s per-round pattern at :699-720): label `Round ${i + 1} · ${r.courseName || 'Course'}` + a `ScoringModeField` with `value={r.scoringMode ?? settings.scoringMode}`, `playerCount={players.length}`, and `onChange` that stores the override — or clears it when it equals the default:

```js
onChange={(mode) => setRounds((prev) => prev.map((x, j) => (
  j === i ? { ...x, scoringMode: mode === settings.scoringMode ? undefined : mode } : x
)))}
```
Pass no `settings`/`onSettingsChange` to the per-round fields so the fixedTeams/manualTeams/teams extras render only under the default picker (verify ScoringModePicker gates those blocks on `settings && onSettingsChange` — it does at :160/:191/:206).
- [ ] **Step 2: handleStart** (:352-406): per built round `const roundMode = r.scoringMode ?? settings.scoringMode;`; carry `...(r.scoringMode ? { scoringMode: r.scoringMode } : {})` onto the built round object; build pairs from `roundMode`; replace the single `fixedPairs` with a per-shape cache:

```js
const fixedPairsByShape = {};
const pairsFor = (mode) => {
  if (!settings.fixedTeams) return buildTeamsForMode(mode, players);
  const shape = teamShapeOf(mode);
  if (!fixedPairsByShape[shape]) fixedPairsByShape[shape] = buildTeamsForMode(mode, players);
  return fixedPairsByShape[shape].map((pr) => [...pr]);
};
```
Check the `isMatchPlay` special case (:365) and `createTournament` call (:414-426): the matchplay override applies only when the DEFAULT mode is matchplay; per-round overrides don't alter tournament-level fields — note the decision in the report.
- [ ] **Step 3: manualTeams routing** — the post-create routing keys on the tournament mode; adjust its input to round 0's effective mode (`created.rounds[0].scoringMode ?? settings.scoringMode`).
- [ ] **Step 4:** Full `npm test` + lint; manual trace of a 3-round mixed tournament in the report. Commit — `feat(modes): per-round mode pickers in the setup wizard`

### Task 8: Stats — per-round exclusion and gating

**Files:**
- Modify: `src/store/personalStats.js` (`collectMyRounds`:177-218), `src/screens/StatsScreen.js` (:132-143, scramble placeholder :160-183, `showH2H`:542)
- Test: `src/store/__tests__/personalStats.test.js` (extend)

**Interfaces:**
- Consumes: `roundScoringMode` (via the tournamentStore re-export), `isScrambleMode`, `scoringModeUsesTeams`.

- [ ] **Step 1: Write failing test** (extend the personalStats scramble-exclusion test):

```js
it('excludes only the scramble rounds of a mixed tournament', () => {
  const me = { id: 'p1', name: 'Ann Lee', user_id: 'u1' };
  const t = {
    id: 't-mixed', kind: 'tournament', players: [me],
    settings: { scoringMode: 'individual' },
    rounds: [
      { holes: [{ number: 1, par: 4, strokeIndex: 1 }], scores: { p1: { 1: 4 } }, playerHandicaps: {} },
      { scoringMode: 'scramblepairs', holes: [{ number: 1, par: 4, strokeIndex: 1 }], scores: { p1: { 1: 4 } }, playerHandicaps: {} },
    ],
  };
  const rounds = collectMyRounds([t], 'u1', 'Ann Lee');
  expect(rounds).toHaveLength(1);
  expect(rounds[0].roundIndex).toBe(0);
});
```

- [ ] **Step 2:** Run → FAIL (both rounds returned — the tournament default isn't scramble).
- [ ] **Step 3: Implement.** In `collectMyRounds`: DELETE the tournament-level check (:183) and add as the first line inside the per-round `forEach` (:186):

```js
      // Scramble rounds carry a team ball under the captain, not an
      // individual score — exclude per round, not per tournament.
      if (isScrambleMode(roundScoringMode(t, round))) return;
```
The pre-existing all-scramble test must still pass (all rounds skipped ⇒ same observable result).
- [ ] **Step 4: StatsScreen** (:132-143) — derive aggregates and re-gate:

```js
  const roundModes = (tournament.rounds ?? []).map((r) => roundScoringMode(tournament, r));
  const allScramble = roundModes.length > 0 && roundModes.every((m) => isScrambleMode(m));
  const anyTeams = roundModes.some((m) => scoringModeUsesTeams(m, players.length) && !isScrambleMode(m));
```
- Whole-screen scramble placeholder (:160-183): gate on `allScramble`.
- `usesTeams` consumers → `anyTeams` (Pairs tab visible when any round has real team data). Inside PairsTab, filter the rounds feeding pair aggregations to those whose effective mode is a non-scramble team mode (read how `pairPerformance`/`pairHoleWins` receive rounds and apply the least-invasive filter; document the choice).
- `showH2H` (:542): `hasMulti && !anyTeams && !allScramble && roundIndex === null`. Verify `headToHead` tolerates scramble rounds (players without scores are already skipped) — if a scramble round could pollute H2H, filter it out the same way; document.
- [ ] **Step 5:** Full `npm test` + lint. Commit — `feat(modes): per-round stats exclusion and gating`

### Task 9: Full verification + wrap-up

- [ ] **Step 1:** `npm test` (all suites) and `npm run lint` (0 errors, ≤49 warnings).
- [ ] **Step 2:** Invoke the `verify` skill: `npm run web`; create a 3-round tournament (Round 1 Stableford, Round 2 Scramble — Pairs, Round 3 Pairs Match Play) with the wizard's per-round pickers; verify each round's scorecard uses its own mode, the overall leaderboard shows Stableford totals with per-round native values, the Round N sheet changes a round's mode and rebuilds its teams, and a legacy single-mode tournament renders exactly as before. Delete all test data through the app UI afterwards and confirm the remote has no leftovers.
- [ ] **Step 3:** CLAUDE.md Domain Concepts: extend the Tournament line — each round may override the tournament's default scoring mode; mixed tournaments rank by Stableford totals.
- [ ] **Step 4:** Final whole-branch review (most capable model) with the accumulated Minor findings, one fix wave if needed, then superpowers:finishing-a-development-branch.
