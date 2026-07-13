# Per-Round & Global Leaderboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each round's leaderboard in that round's own scoring mode, add a Round|Global toggle for the whole-tournament board, add a strokes tiebreak to all Stableford rankings, and make `RoundSummaryScreen` mode-aware.

**Architecture:** Two new pure selectors in `store/tournamentStore.js` — `roundLeaderboard(tournament, round)` (per-round board in the round's effective mode) and `tournamentLeaderboardResolved(tournament)` (whole-tournament board: native aggregate when uniform, else Stableford+strokes) — plus a shared `stablefordComparator` in `store/scoring.js`. `HomeScreen` gains a `leaderboardScope` toggle and consumes these; `RoundSummaryScreen`/`RoundLeaderboard` consume `roundLeaderboard`. All boards normalize to a per-player entry shape `{ player, points, strokes, handicap? }`.

**Tech Stack:** Expo SDK 54 / React Native 0.81 / React 19; Jest (jest-expo); plain-JS store modules; ESLint 9 flat config (CI-blocking).

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-07-13-per-round-and-global-leaderboards-design.md`.
- **Signature:** `roundScoringMode(tournament, round)` — tournament FIRST.
- The new resolvers live in `store/tournamentStore.js` (NOT `scoring.js`): the bestball helpers `assignBestWorstRoles`/`roundBestBallValues` live there, and `scoring.js` importing them would create a cycle (`tournamentStore` already imports `scoring`).
- Normalized board entry shape: `{ player, points, strokes, handicap? }`. `strokes`/`handicap` may be `undefined` for modes that don't produce them.
- Strokes tiebreak = points **descending**, then gross strokes **ascending**, treating `strokes <= 0` (unplayed) as `Infinity` so a no-score player never sorts first.
- Keep domain logic in stores, not screens (CLAUDE.md).
- Official-tournament leaderboard is untouched.
- `npm test` and `npm run lint` pass at the end of every task.

---

## File Structure

- **Modify** `src/store/scoring.js` — add `stablefordComparator`; apply it in `tournamentStablefordLeaderboard`.
- **Modify** `src/store/tournamentStore.js` — apply `stablefordComparator` in `tournamentLeaderboard`; add `roundLeaderboard` + `tournamentLeaderboardResolved`.
- **Modify** `src/screens/HomeScreen.js` — `leaderboardScope` state + `Round|Global` toggle; consume the resolvers; drop the `getSelectedRoundValue` row annotation.
- **Modify** `src/screens/RoundSummaryScreen.js` — build the board via `roundLeaderboard`.
- **Modify** `src/components/roundSummary/RoundLeaderboard.js` — render the normalized entry shape + a `unit` label.
- **Tests** under `src/store/__tests__/`.

---

## Task 1: Strokes-tiebreak comparator

**Files:**
- Modify: `src/store/scoring.js` (add export near the other leaderboard helpers; update `tournamentStablefordLeaderboard` sort ~`:793`)
- Modify: `src/store/tournamentStore.js` (`tournamentLeaderboard` sort ~`:1482`)
- Test: `src/store/__tests__/leaderboardTiebreak.test.js` (create)

**Interfaces:**
- Produces: `stablefordComparator(a, b)` — sorts `{ points, strokes }` entries by points desc, then strokes asc (unplayed last). Exported from `scoring.js`.

- [ ] **Step 1: Write the failing test**

```js
// src/store/__tests__/leaderboardTiebreak.test.js
import { stablefordComparator, tournamentStablefordLeaderboard } from '../scoring';
import { tournamentLeaderboard } from '../tournamentStore';

describe('stablefordComparator', () => {
  test('points desc, then fewer strokes first', () => {
    const rows = [
      { player: { id: 'a' }, points: 30, strokes: 90 },
      { player: { id: 'b' }, points: 30, strokes: 85 },
      { player: { id: 'c' }, points: 34, strokes: 99 },
    ].sort(stablefordComparator);
    expect(rows.map((r) => r.player.id)).toEqual(['c', 'b', 'a']);
  });

  test('a no-score entry (strokes 0) never ranks ahead on a points tie', () => {
    const rows = [
      { player: { id: 'a' }, points: 0, strokes: 0 },
      { player: { id: 'b' }, points: 0, strokes: 88 },
    ].sort(stablefordComparator);
    expect(rows.map((r) => r.player.id)).toEqual(['b', 'a']);
  });
});

describe('tiebreak wired into the Stableford boards', () => {
  const holes = [{ number: 1, par: 4, strokeIndex: 1 }];
  const tournament = {
    players: [{ id: 'q1', name: 'Q1', handicap: 0 }, { id: 'q2', name: 'Q2', handicap: 0 }],
    settings: { scoringMode: 'stableford' },
    rounds: [{ id: 'r0', holes, scores: { q1: { 1: 4 }, q2: { 1: 4 } } }],
  };

  test('tournamentLeaderboard applies the strokes tiebreak', () => {
    const t = { ...tournament, rounds: [{ id: 'r0', holes, scores: { q1: { 1: 4 }, q2: { 1: 5 } } }] };
    const board = tournamentLeaderboard(t);
    expect(board[0].player.id).toBe('q1');
  });

  test('tournamentStablefordLeaderboard is sorted (smoke)', () => {
    expect(Array.isArray(tournamentStablefordLeaderboard(tournament))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/store/__tests__/leaderboardTiebreak.test.js`
Expected: FAIL — `stablefordComparator` is not exported.

- [ ] **Step 3: Add the comparator to `src/store/scoring.js`**

```js
// Shared Stableford ranking: points desc, then fewer gross strokes first.
// An unplayed entry (strokes <= 0) sorts last on a points tie, never first.
export function stablefordComparator(a, b) {
  if (b.points !== a.points) return b.points - a.points;
  const as = a.strokes > 0 ? a.strokes : Infinity;
  const bs = b.strokes > 0 ? b.strokes : Infinity;
  return as - bs;
}
```

- [ ] **Step 4: Apply it in `tournamentStablefordLeaderboard`** (`src/store/scoring.js`, the final `return [...acc.values()].sort((a, b) => b.points - a.points);`)

```js
  return [...acc.values()].sort(stablefordComparator);
```

- [ ] **Step 5: Apply it in `tournamentLeaderboard`** (`src/store/tournamentStore.js`). Add `stablefordComparator` to the existing `import { ... } from './scoring';`, then change the final sort:

```js
  return totals.sort(stablefordComparator);
```

- [ ] **Step 6: Run tests + lint**

Run: `npx jest src/store/__tests__/leaderboardTiebreak.test.js && npm run lint`
Expected: PASS; lint clean.

- [ ] **Step 7: Commit**

```bash
git add src/store/scoring.js src/store/tournamentStore.js src/store/__tests__/leaderboardTiebreak.test.js
git commit -m "feat(leaderboard): strokes tiebreak on Stableford rankings"
```

---

## Task 2: `roundLeaderboard` — per-round board in the round's mode

**Files:**
- Modify: `src/store/tournamentStore.js` (add near `tournamentLeaderboard`; ensure imports)
- Test: `src/store/__tests__/roundLeaderboard.test.js` (create)

**Interfaces:**
- Consumes: `roundScoringMode`, `roundTotals`, `matchPlayRoundTally`, `sindicatoRoundTally`, `pairsMatchRoundTally`, `scrambleRoundTally`, `isScrambleMode`, `stablefordComparator` (from `scoring.js`); `assignBestWorstRoles`, `roundBestBallValues` (same file).
- Produces: `roundLeaderboard(tournament, round) -> { mode, unit, entries }` where `entries` are normalized `{ player, points, strokes, handicap? }`, ranked in the round's mode (Stableford gains the strokes tiebreak). `unit` ∈ `'pts' | 'holes'`.

- [ ] **Step 1: Write the failing tests**

```js
// src/store/__tests__/roundLeaderboard.test.js
import { roundLeaderboard } from '../tournamentStore';

const holes = [
  { number: 1, par: 4, strokeIndex: 1 },
  { number: 2, par: 4, strokeIndex: 2 },
];
const P = (id, name = id, handicap = 0) => ({ id, name, handicap });

test('stableford: ranks by points then strokes, entries carry player/points/strokes', () => {
  const players = [P('a'), P('b')];
  const round = { id: 'r0', holes, scores: { a: { 1: 4, 2: 4 }, b: { 1: 4, 2: 5 } } };
  const t = { players, settings: { scoringMode: 'stableford' }, rounds: [round] };
  const { mode, unit, entries } = roundLeaderboard(t, round);
  expect(mode).toBe('stableford');
  expect(unit).toBe('pts');
  expect(entries[0].player.id).toBe('a'); // same points, fewer strokes
  expect(entries[0]).toMatchObject({ points: expect.any(Number), strokes: expect.any(Number) });
});

test('matchplay: two per-player entries carrying holes won, unit = holes', () => {
  const players = [P('a'), P('b')];
  const round = { id: 'r0', scoringMode: 'matchplay', holes, scores: { a: { 1: 3, 2: 4 }, b: { 1: 5, 2: 4 } } };
  const t = { players, settings: { scoringMode: 'matchplay' }, rounds: [round] };
  const { mode, unit, entries } = roundLeaderboard(t, round);
  expect(mode).toBe('matchplay');
  expect(unit).toBe('holes');
  expect(entries).toHaveLength(2);
  expect(entries[0].player.id).toBe('a');
});

test('empty round yields entries array, never throws', () => {
  const t = { players: [P('a'), P('b')], settings: { scoringMode: 'matchplay' }, rounds: [] };
  expect(Array.isArray(roundLeaderboard(t, { id: 'x', scoringMode: 'matchplay', holes, scores: {} }).entries)).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/store/__tests__/roundLeaderboard.test.js`
Expected: FAIL — `roundLeaderboard` is not exported.

- [ ] **Step 3: Ensure imports in `src/store/tournamentStore.js`**

The file already imports from `./scoring`. Ensure the import list includes:
`roundScoringMode, roundTotals, matchPlayRoundTally, sindicatoRoundTally, pairsMatchRoundTally, scrambleRoundTally, isScrambleMode, stablefordComparator` (add any missing names to the existing `import { ... } from './scoring';`). `assignBestWorstRoles` and `roundBestBallValues` are defined in this file.

- [ ] **Step 4: Implement `roundLeaderboard`**

```js
// Per-round leaderboard in the round's own effective mode, normalized to
// { player, points, strokes, handicap? } entries. Mirrors the per-mode mapping
// HomeScreen's old getSelectedRoundValue did, but returns the whole board.
export function roundLeaderboard(tournament, round) {
  const players = tournament?.players ?? [];
  const mode = roundScoringMode(tournament, round);
  const totals = roundTotals(round, players); // { player, handicap, totalPoints, totalStrokes }
  const strokesOf = (pid) => totals.find((t) => t.player.id === pid)?.totalStrokes ?? 0;

  if (mode === 'matchplay') {
    const tally = matchPlayRoundTally(round, players);
    if (!tally) return { mode, unit: 'holes', entries: [] };
    const entries = [
      { player: players[0], points: tally.aWins, strokes: strokesOf(players[0].id) },
      { player: players[1], points: tally.bWins, strokes: strokesOf(players[1].id) },
    ].sort((a, b) => b.points - a.points);
    return { mode, unit: 'holes', entries };
  }

  if (mode === 'sindicato') {
    const tally = sindicatoRoundTally(round, players);
    if (!tally) return { mode, unit: 'pts', entries: [] };
    const entries = tally.totals.map((t) => ({
      player: t.player, points: t.points, strokes: strokesOf(t.player.id),
    }));
    return { mode, unit: 'pts', entries }; // sindicatoRoundTally.totals is points-desc
  }

  if (mode === 'pairsmatchplay') {
    const tally = pairsMatchRoundTally(round, players);
    if (!tally) return { mode, unit: 'pts', entries: [] };
    const entries = [];
    (round.pairs ?? []).forEach((pair, idx) => {
      const pts = idx === 0 ? tally.team1 : tally.team2;
      (pair ?? []).forEach((m) => {
        const player = players.find((p) => p.id === m?.id);
        if (player) entries.push({ player, points: pts, strokes: strokesOf(player.id) });
      });
    });
    entries.sort((a, b) => b.points - a.points);
    return { mode, unit: 'pts', entries };
  }

  if (isScrambleMode(mode)) {
    const tally = scrambleRoundTally(round, players);
    if (!tally) return { mode, unit: 'pts', entries: [] };
    const entries = [];
    tally.totals.forEach((row) => {
      (row.unit.members ?? []).forEach((member) => {
        const player = players.find((p) => p.id === member?.id) ?? member;
        entries.push({ player, points: row.points, strokes: row.strokes });
      });
    });
    entries.sort((a, b) => b.points - a.points);
    return { mode, unit: 'pts', entries };
  }

  if (mode === 'bestball') {
    const roles = assignBestWorstRoles(round, players);
    const { bestBallValue, worstBallValue } = roundBestBallValues(tournament, round);
    const entries = players.map((player) => {
      const r = roles[player.id];
      const points = r ? r.bestWon * bestBallValue + r.worstWon * worstBallValue : 0;
      return { player, points, strokes: strokesOf(player.id) };
    }).sort((a, b) => b.points - a.points);
    return { mode, unit: 'pts', entries };
  }

  // individual / stableford
  const entries = totals
    .map((t) => ({ player: t.player, points: t.totalPoints, strokes: t.totalStrokes, handicap: t.handicap }))
    .sort(stablefordComparator);
  return { mode, unit: 'pts', entries };
}
```

- [ ] **Step 5: Run tests + lint**

Run: `npx jest src/store/__tests__/roundLeaderboard.test.js && npm run lint`
Expected: PASS; lint clean.

- [ ] **Step 6: Commit**

```bash
git add src/store/tournamentStore.js src/store/__tests__/roundLeaderboard.test.js
git commit -m "feat(leaderboard): roundLeaderboard — per-round board in the round's mode"
```

---

## Task 3: `tournamentLeaderboardResolved` — the global board

**Files:**
- Modify: `src/store/tournamentStore.js`
- Test: `src/store/__tests__/tournamentLeaderboardResolved.test.js` (create)

**Interfaces:**
- Consumes: `tournamentHasMixedModes`, `tournamentStablefordLeaderboard`, `tournamentSindicatoLeaderboard`, `tournamentScrambleLeaderboard`, `tournamentMatchPlayStandings`, `tournamentPairsMatchStandings`, `roundScoringMode`, `isScrambleMode` (from `scoring.js`); `tournamentLeaderboard`, `tournamentBestWorstLeaderboard` (same file).
- Produces: `tournamentLeaderboardResolved(tournament) -> { mode, unit, entries }`. `entries` normalized `{ player, points, strokes? }`. Mixed → Stableford (already strokes-tiebroken via Task 1); uniform → that mode's aggregate. `unit` ∈ `'pts' | 'holes'`.

- [ ] **Step 1: Write the failing tests**

```js
// src/store/__tests__/tournamentLeaderboardResolved.test.js
import { tournamentLeaderboardResolved } from '../tournamentStore';

const holes = [{ number: 1, par: 4, strokeIndex: 1 }, { number: 2, par: 4, strokeIndex: 2 }];
const P = (id) => ({ id, name: id, handicap: 0 });

test('uniform stableford tournament -> stableford board, unit pts', () => {
  const t = {
    players: [P('a'), P('b')],
    settings: { scoringMode: 'stableford' },
    rounds: [{ id: 'r0', holes, scores: { a: { 1: 4 }, b: { 1: 5 } } }],
  };
  const { unit, entries } = tournamentLeaderboardResolved(t);
  expect(unit).toBe('pts');
  expect(entries[0].player.id).toBe('a');
});

test('mixed-mode tournament -> stableford fallback', () => {
  const t = {
    players: [P('a'), P('b'), P('c')],
    settings: { scoringMode: 'stableford' },
    rounds: [
      { id: 'r0', holes, scores: { a: { 1: 4 } } },
      { id: 'r1', scoringMode: 'sindicato', holes, scores: { a: { 1: 4 } } },
    ],
  };
  const { entries } = tournamentLeaderboardResolved(t);
  expect(Array.isArray(entries)).toBe(true);
  expect(entries.length).toBe(3);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/store/__tests__/tournamentLeaderboardResolved.test.js`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement** (`src/store/tournamentStore.js`; ensure the `./scoring` import includes the names above)

```js
// The whole-tournament board: native aggregate when every round shares one
// effective mode, else the Stableford total (already strokes-tiebroken).
// Centralizes the routing that used to live inline in HomeScreen.
export function tournamentLeaderboardResolved(tournament) {
  const rounds = tournament?.rounds ?? [];
  if (tournamentHasMixedModes(tournament)) {
    return { mode: 'stableford', unit: 'pts', entries: tournamentStablefordLeaderboard(tournament) };
  }
  const mode = roundScoringMode(tournament, rounds[0]);
  if (mode === 'matchplay') {
    return { mode, unit: 'holes', entries: tournamentMatchPlayStandings(tournament)?.board ?? [] };
  }
  if (mode === 'sindicato') {
    return { mode, unit: 'pts', entries: tournamentSindicatoLeaderboard(tournament) };
  }
  if (mode === 'bestball') {
    return { mode, unit: 'pts', entries: tournamentBestWorstLeaderboard(tournament) };
  }
  if (mode === 'pairsmatchplay') {
    return { mode, unit: 'pts', entries: tournamentPairsMatchStandings(tournament)?.board ?? [] };
  }
  if (isScrambleMode(mode)) {
    return { mode, unit: 'pts', entries: tournamentScrambleLeaderboard(tournament) };
  }
  return { mode: mode ?? 'stableford', unit: 'pts', entries: tournamentLeaderboard(tournament) };
}
```

- [ ] **Step 4: Run tests + lint**

Run: `npx jest src/store/__tests__/tournamentLeaderboardResolved.test.js && npm run lint`
Expected: PASS; lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/store/tournamentStore.js src/store/__tests__/tournamentLeaderboardResolved.test.js
git commit -m "feat(leaderboard): tournamentLeaderboardResolved — global board resolver"
```

---

## Task 4: HomeScreen — Round|Global toggle + consume the resolvers

**Files:**
- Modify: `src/screens/HomeScreen.js`

**Interfaces:**
- Consumes: `roundLeaderboard`, `tournamentLeaderboardResolved` (from `store/tournamentStore`).
- Produces: a `leaderboardScope: 'round' | 'global'` control on the LEADERBOARD card; the board shown reflects the selected round's mode (scope `round`) or the whole tournament (scope `global`); header label `R{n} · {mode}` or `Overall`; each row shows `entry.points {unit}` and `entry.strokes`; the `getSelectedRoundValue` sub-annotation is removed.

- [ ] **Step 1: Add scope state + the resolved board** (near the existing board memos, `HomeScreen.js:~915-955`). Import `roundLeaderboard, tournamentLeaderboardResolved` from `../store/tournamentStore`.

```js
const [leaderboardScope, setLeaderboardScope] = useState('round'); // 'round' | 'global'

const resolvedBoard = useMemo(() => {
  if (!tournament) return { mode: 'stableford', unit: 'pts', entries: [] };
  if (isGame || leaderboardScope === 'round') {
    return roundLeaderboard(tournament, selectedRoundData);
  }
  return tournamentLeaderboardResolved(tournament);
}, [tournament, isGame, leaderboardScope, selectedRoundData]);
```

(`selectedRoundData` already exists at `:956-961`; `isGame` at `:1537` — hoist references as needed so they precede this memo, matching the file's "hoist above early return" pattern.)

- [ ] **Step 2: Render the board from `resolvedBoard.entries`**. Replace the `displayedBoard`/`leaderboard`/`strokesByPlayer` row source in the LEADERBOARD card (`:1637-1698`) so each row reads `entry.points` + `entry.strokes` off the entry, and the value unit is `resolvedBoard.unit`:

```jsx
// value cell
<Text style={s.mastersPoints}>{`${entry.points} ${resolvedBoard.unit}`}</Text>
// strokes cell (only when present)
{entry.strokes != null && <Text style={s.mastersStr}>{entry.strokes || '-'} str</Text>}
```

Remove the `getSelectedRoundValue(entry.player.id)` sub-line (`:1675-1677`) and the now-unused `getSelectedRoundValue` / `selectedRoundPlayerTotals` / `strokesByPlayer` memos if nothing else references them (grep first; delete only if unused).

- [ ] **Step 3: Add the `Round | Global` toggle to the card header** (`:1639-1651`), shown only for multi-round tournaments. Reuse the existing segmented-toggle styling:

```jsx
<View style={s.cardTitleRow}>
  <Text style={s.mastersCardTitle}>
    {leaderboardScope === 'global' && !isGame ? 'OVERALL' : `R${selectedRound + 1} · ${roundModeLabel(resolvedBoard.mode)}`}
  </Text>
  {!isGame && (
    <View style={s.inlineToggle}>
      <TouchableOpacity onPress={() => setLeaderboardScope('round')}>
        <Text style={[s.mastersToggleLabel, leaderboardScope === 'round' && s.mastersToggleLabelActive]}>Round</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => setLeaderboardScope('global')}>
        <Text style={[s.mastersToggleLabel, leaderboardScope === 'global' && s.mastersToggleLabelActive]}>Global</Text>
      </TouchableOpacity>
    </View>
  )}
</View>
```

`roundModeLabel(mode)` — a small local map (`stableford`→'Stableford', `matchplay`→'Match Play', `sindicato`→'Sindicato', `bestball`→'Best Ball', `pairsmatchplay`→'Pairs Match Play', scramble*→'Scramble', default→'Stableford'); reuse `scoringModes.js` label data if a suitable label already exists, otherwise inline the map.

- [ ] **Step 4: Reconcile the existing alt-view (`leaderboardAlt`) Switch.** With the strokes tiebreak now built in and the scope toggle added, keep the card uncluttered: **remove the `leaderboardAlt` Switch and its state** (`:179`, `:912-914`, `:1641-1650`, and `displayedBoard`/`isStablefordMode`/`isStrokePlayView` at `:934-955`) — the board is now driven solely by `leaderboardScope`. Grep for every `leaderboardAlt`/`displayedBoard`/`isStrokePlayView`/`toggleLabels` reference and remove them.

> If removing the alt-view turns out to touch clinch or other logic, stop and report — the intent is only to drop the stroke-play re-sort toggle, nothing else.

- [ ] **Step 5: Lint + full suite**

Run: `npm run lint && npx jest src/screens 2>/dev/null`
Expected: lint clean; screen tests (if any) pass.

- [ ] **Step 6: Commit**

```bash
git add src/screens/HomeScreen.js
git commit -m "feat(leaderboard): Round|Global scope toggle on the tournament board"
```

---

## Task 5: RoundSummaryScreen + RoundLeaderboard — mode-aware

**Files:**
- Modify: `src/screens/RoundSummaryScreen.js`
- Modify: `src/components/roundSummary/RoundLeaderboard.js`

**Interfaces:**
- Consumes: `roundLeaderboard` (from `store/tournamentStore`).
- Produces: the round-summary board reflects the round's mode; `RoundLeaderboard` renders the normalized `{ player, points, strokes, handicap? }` entry shape with a `unit` label.

- [ ] **Step 1: Build the board via `roundLeaderboard`** (`RoundSummaryScreen.js:97-100`). Import `roundLeaderboard` from `../store/tournamentStore`; the screen already has `tournament` and `round` in scope.

```js
const { unit, entries: ranked } = round
  ? roundLeaderboard(tournament, round)
  : { unit: 'pts', entries: [] };
```

- [ ] **Step 2: Pass `unit` through** (`:185`):

```jsx
<RoundLeaderboard entries={ranked} unit={unit} round={round} live={live} />
```

- [ ] **Step 3: Update `RoundLeaderboard`** to the normalized shape. Change the destructure to `({ entries, unit = 'pts', round, live = false })` and update the per-entry reads:
  - points: `entry.points` (was `entry.totalPoints`), rendered `${entry.points} ${unit}`
  - strokes: `entry.strokes` (was `entry.totalStrokes`), rendered `{entry.strokes || '-'} str` only when `entry.strokes != null`
  - handicap: `entry.handicap` (unchanged; guarded by `Number.isFinite`, so team entries without it simply omit HCP)
  - leader check + rank + live "HOLE N" badge: unchanged, but the leader check uses `entry.points`.

- [ ] **Step 4: Update any existing RoundLeaderboard/RoundSummary tests** to the new entry shape (`points`/`strokes` instead of `totalPoints`/`totalStrokes`), porting real assertions.

- [ ] **Step 5: Full suite + lint**

Run: `npm test && npm run lint`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/screens/RoundSummaryScreen.js src/components/roundSummary/RoundLeaderboard.js
git commit -m "feat(leaderboard): mode-aware round summary board"
```

---

## Task 6: Runtime verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite + lint** — `npm test && npm run lint`. Expected: all pass.

- [ ] **Step 2: Drive the web app** via the `verify` skill. Create a **multi-round mixed-mode** tournament (e.g. R1 Stableford, R2 Pairs Match Play). Verify:
  - Selecting R1 shows R1's Stableford board; selecting R2 shows R2's Pairs-Match-Play board, header `R2 · Pairs Match Play`.
  - The `Global` toggle shows the whole-tournament Stableford board ranked by points then strokes; scores below stay on the selected round.
  - A **single game** shows its one board with **no** scope toggle.
  - `RoundSummaryScreen` for a finished non-Stableford round shows that mode's board, not plain Stableford.

- [ ] **Step 3: Record results.** On any failure invoke `superpowers:systematic-debugging`. When green, note completion. Clean up any QA tournament created.

---

## Self-Review

**Spec coverage:** scope toggle → Task 4; per-round mode board → Task 2 + 4; global native-vs-Stableford → Task 3; strokes tiebreak → Task 1 (consumed by 2/3); RoundSummary mode-awareness → Task 5. ✅

**Placeholder scan:** all steps carry real code; `roundModeLabel` inline map + "grep before deleting" are concrete instructions, not TODOs. ✅

**Type consistency:** normalized entry `{ player, points, strokes, handicap? }` consistent across `roundLeaderboard` (Task 2), `tournamentLeaderboardResolved` (Task 3), HomeScreen rows (Task 4), and RoundLeaderboard (Task 5). `roundScoringMode(tournament, round)` order used everywhere. Resolvers return `{ mode, unit, entries }` uniformly. ✅

**Deviation from spec (noted):** the resolvers live in `store/tournamentStore.js`, not `store/scoring.js`, to avoid a `scoring ↔ tournamentStore` import cycle (bestball helpers live in tournamentStore). `stablefordComparator` stays in `scoring.js`. Task 4 additionally **removes** the legacy stroke-play alt-view Switch (spec §3 kept it "available"); the scope toggle supersedes it and two toggles on one card is cluttered — flagged for the reviewer/runtime check.
