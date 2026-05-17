# Round Scores Format + Me-First Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revert the ROUND SCORES rows to a labeled stat-cell layout with no winner highlight, and order players "me-first" in both the ROUND SCORES card and the scorecard.

**Architecture:** A new pure `src/lib/playerOrder.js` provides `playersMeFirst` / `pairsMeFirst` display-ordering helpers (unit-tested). `RoundScoreboard` is rewritten to render `GameOverviewCard`-style POINTS/STROKES/VS-PAR stat cells (reusing existing `gameStat*` styles), ordered me-first; `RankedRow` is deleted. `ScorecardScreen`'s `orderedPlayers` arrays gain me-first ordering.

**Tech Stack:** React Native 0.81, Expo 54, jest + jest-expo. No React Native Testing Library — the pure helper is TDD'd; UI is verified by the jest suite staying green plus a manual + Playwright checklist.

**Spec:** `docs/superpowers/specs/2026-05-17-round-scores-format-me-first-design.md`

---

## File Structure

- **`src/lib/playerOrder.js`** (new) — pure display-ordering helpers `playersMeFirst`, `pairsMeFirst`.
- **`src/lib/__tests__/playerOrder.test.js`** (new) — unit tests.
- **`src/screens/HomeScreen.js`** (modify) — rewrite `RoundScoreboard`; thread `meId`; delete `RankedRow` + `ranked*` styles.
- **`src/screens/ScorecardScreen.js`** (modify) — me-first `orderedPlayers` in `HolePage` and `GridView`.

---

## Task 1: `playerOrder.js` ordering helpers

**Files:**
- Create: `src/lib/playerOrder.js`
- Test: `src/lib/__tests__/playerOrder.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/playerOrder.test.js`:

```js
import { playersMeFirst, pairsMeFirst } from '../playerOrder';

const A = { id: 'a', name: 'A' };
const B = { id: 'b', name: 'B' };
const C = { id: 'c', name: 'C' };
const D = { id: 'd', name: 'D' };

describe('playersMeFirst', () => {
  test('moves the me player to the front, others keep relative order', () => {
    expect(playersMeFirst([A, B, C], 'c')).toEqual([C, A, B]);
  });
  test('me already first → order unchanged', () => {
    expect(playersMeFirst([A, B, C], 'a')).toEqual([A, B, C]);
  });
  test('meId null → order unchanged', () => {
    expect(playersMeFirst([A, B, C], null)).toEqual([A, B, C]);
  });
  test('meId matches nobody → order unchanged', () => {
    expect(playersMeFirst([A, B, C], 'z')).toEqual([A, B, C]);
  });
  test('does not mutate the input array', () => {
    const input = [A, B, C];
    playersMeFirst(input, 'c');
    expect(input).toEqual([A, B, C]);
  });
  test('empty / non-array input → empty array', () => {
    expect(playersMeFirst([], 'a')).toEqual([]);
    expect(playersMeFirst(undefined, 'a')).toEqual([]);
  });
});

describe('pairsMeFirst', () => {
  test('puts the me-pair first and me first within it, flattened', () => {
    expect(pairsMeFirst([[A, B], [C, D]], 'd')).toEqual([D, C, A, B]);
  });
  test('me in the first pair → pair order unchanged, me first within', () => {
    expect(pairsMeFirst([[A, B], [C, D]], 'b')).toEqual([B, A, C, D]);
  });
  test('meId null → flattened in original order', () => {
    expect(pairsMeFirst([[A, B], [C, D]], null)).toEqual([A, B, C, D]);
  });
  test('meId matches nobody → flattened in original order', () => {
    expect(pairsMeFirst([[A, B], [C, D]], 'z')).toEqual([A, B, C, D]);
  });
  test('non-array input → empty array', () => {
    expect(pairsMeFirst(undefined, 'a')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest playerOrder --verbose`
Expected: FAIL — `Cannot find module '../playerOrder'`.

- [ ] **Step 3: Create the module**

Create `src/lib/playerOrder.js`:

```js
// Pure display-ordering helpers. These reorder players ONLY for rendering —
// never pass their output to scoring functions that label results by array
// index (matchPlayRoundTally, sindicatoHolePoints, etc.).

// Returns a new array with the `meId` player moved to the front; every other
// player keeps its existing relative order. A null/unknown `meId` yields the
// players in their original order (still a fresh copy).
export function playersMeFirst(players, meId) {
  if (!Array.isArray(players)) return [];
  const me = players.find((p) => p.id === meId);
  if (!me) return [...players];
  return [me, ...players.filter((p) => p.id !== meId)];
}

// Flattens `pairs` (an array of player-arrays) for display: the pair that
// contains `meId` comes first, `playersMeFirst` is applied within every pair,
// and the result is a single flat player array. A null/unknown `meId` yields
// the pairs flattened in their original order.
export function pairsMeFirst(pairs, meId) {
  if (!Array.isArray(pairs)) return [];
  const mePairIdx = pairs.findIndex((pr) => pr.some((p) => p.id === meId));
  const seq = mePairIdx > 0
    ? [pairs[mePairIdx], ...pairs.filter((_, i) => i !== mePairIdx)]
    : pairs;
  return seq.flatMap((pr) => playersMeFirst(pr, meId));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest playerOrder --verbose`
Expected: PASS — all `playersMeFirst` and `pairsMeFirst` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/playerOrder.js src/lib/__tests__/playerOrder.test.js
git commit -m "feat: playerOrder helpers — playersMeFirst, pairsMeFirst"
```

---

## Task 2: Rewrite `RoundScoreboard`, delete `RankedRow`

**Files:**
- Modify: `src/screens/HomeScreen.js`

No unit test (RN UI) — verified by the jest suite staying green plus grep.

- [ ] **Step 1: Import `playersMeFirst`**

In `src/screens/HomeScreen.js`, add an import for the new helper. After the existing `import { ... } from '../store/tournamentStore';` block, add:
```js
import { playersMeFirst } from '../lib/playerOrder';
```

- [ ] **Step 2: Rewrite the `RoundScoreboard` component**

Find the `RoundScoreboard` component (`const RoundScoreboard = React.memo(function RoundScoreboard(...) { ... });`). Replace the ENTIRE component definition with:

```js
// Universal round card — identical in every scoring mode. Shows a holes-played
// progress bar, then each player (me first, then join order) with POINTS /
// STROKES / VS PAR stat cells. No rank badge or winner highlight — the green
// LEADERBOARD card is where standings are shown.
const RoundScoreboard = React.memo(function RoundScoreboard({ round, players, meId, theme, s, showRunning = true }) {
  const holes = round?.holes ?? [];
  const totalHoles = holes.length || 18;

  const totals = roundTotals(round, players);
  const totalsById = Object.fromEntries(totals.map((t) => [t.player.id, t]));
  const rows = playersMeFirst(players, meId).map((player) => {
    const ps = round?.scores?.[player.id] ?? {};
    let strokes = 0;
    let parThrough = 0;
    let played = 0;
    for (const hole of holes) {
      const sc = ps[hole.number];
      if (sc) { strokes += sc; parThrough += hole.par ?? 0; played++; }
    }
    return {
      player,
      points: totalsById[player.id]?.totalPoints ?? 0,
      strokes,
      played,
      vsPar: strokes - parThrough,
    };
  });

  const holesPlayed = rows.length ? Math.max(...rows.map((r) => r.played)) : 0;
  const progressPct = totalHoles > 0 ? Math.min(100, Math.round((holesPlayed / totalHoles) * 100)) : 0;

  const vsParText = (r) => {
    if (r.played === 0) return '—';
    if (r.vsPar === 0) return 'E';
    return r.vsPar > 0 ? `+${r.vsPar}` : `${r.vsPar}`;
  };
  const vsParColor = (r) => {
    if (r.played === 0) return theme.text.muted;
    if (r.vsPar < 0) return theme.scoreColor('excellent');
    if (r.vsPar === 0) return theme.scoreColor('good');
    return theme.scoreColor('poor');
  };

  return (
    <>
      <View style={s.roundProgressRow}>
        <View style={s.roundProgressTrack}>
          <View style={[s.roundProgressFill, { width: `${progressPct}%` }]} />
        </View>
        <Text style={s.roundProgressText}>{holesPlayed} / {totalHoles}</Text>
      </View>
      <View style={{ gap: 10 }}>
        {rows.map((r) => (
          <View key={r.player.id} style={s.gamePlayerCard}>
            <Text style={s.gamePlayerName} numberOfLines={1}>{r.player.name}</Text>
            <View style={[s.gameStatsRow, { marginTop: 10 }]}>
              <View style={s.gameStatCell}>
                <Text style={s.gameStatValue}>{showRunning ? r.points : '—'}</Text>
                <Text style={s.gameStatLabel}>Points</Text>
              </View>
              <View style={s.gameStatDivider} />
              <View style={s.gameStatCell}>
                <Text style={s.gameStatValue}>
                  {showRunning && r.played > 0 ? r.strokes : '—'}
                </Text>
                <Text style={s.gameStatLabel}>Strokes</Text>
              </View>
              <View style={s.gameStatDivider} />
              <View style={s.gameStatCell}>
                <Text style={[s.gameStatValue, showRunning && { color: vsParColor(r) }]}>
                  {showRunning ? vsParText(r) : '—'}
                </Text>
                <Text style={s.gameStatLabel}>vs Par</Text>
              </View>
            </View>
          </View>
        ))}
      </View>
    </>
  );
});
```

The `gamePlayerCard`, `gamePlayerName`, `gameStatsRow`, `gameStatCell`, `gameStatDivider`, `gameStatValue`, `gameStatLabel` styles already exist in `makeStyles` (kept when `GameOverviewCard` was retired) — confirm by grepping; if any is missing, STOP and report BLOCKED.

- [ ] **Step 3: Thread `meId` into `RoundPage` → `RoundScoreboard`**

In `RoundPage`, add `meId` to its destructured props. Its current signature is approximately:
```js
const RoundPage = React.memo(function RoundPage({
  round, index, width, hasPrev, hasNext, revealed,
  players, theme, s,
  onGoToRound, onOpenEdit, isSingleRound, showRunning = true,
}) {
```
Add `meId` to that prop list (e.g. after `players,`). Then find where `RoundPage` renders `<RoundScoreboard ... />` and add the `meId` prop:
```js
        <RoundScoreboard round={round} players={players} meId={meId} theme={theme} s={s} showRunning={showRunning} />
```

Then both `<RoundPage ... />` call sites in `HomeScreen` must pass `meId`. There are two (one in the `isGame` branch, one in the `tournament.rounds.map(...)`). Add `meId={tournament.meId}` to each `<RoundPage>` element.

- [ ] **Step 4: Delete `RankedRow` and its styles**

`RankedRow` is now referenced by nothing (the LEADERBOARD card uses its own `mastersRow` markup; `RoundScoreboard` no longer uses it). Run `grep -n "RankedRow" src/screens/HomeScreen.js` — it should appear only in its own definition. If it appears anywhere else, STOP and report BLOCKED.

Delete the entire `const RankedRow = React.memo(function RankedRow(...) { ... });` definition (including its preceding comment block).

Then delete these now-unused style entries from `makeStyles`: `rankedRow`, `rankedRowFirst`, `rankBadge`, `rankText`, `rankedNameCol`, `rankedName`, `rankedPrimary`, `rankedSub`, `rankedSub2`. (Grep each name first — each should appear only in its own style definition. If any appears elsewhere, keep that one and report it as a concern.)

- [ ] **Step 5: Verify**

Run: `npx jest`
Expected: PASS — full suite green (no test imports `HomeScreen.js`).

Run: `grep -nE "RankedRow|rankedRow|rankBadge|rankedSub" src/screens/HomeScreen.js`
Expected: no matches.

- [ ] **Step 6: Commit**

```bash
git add src/screens/HomeScreen.js
git commit -m "feat: RoundScoreboard stat-cell rows, me-first order; remove RankedRow"
```

---

## Task 3: Me-first ordering in the scorecard

**Files:**
- Modify: `src/screens/ScorecardScreen.js`

No unit test (RN UI) — verified by the jest suite staying green plus the manual checklist.

- [ ] **Step 1: Import the ordering helpers**

In `src/screens/ScorecardScreen.js`, add after the existing imports:
```js
import { playersMeFirst, pairsMeFirst } from '../lib/playerOrder';
```

- [ ] **Step 2: Me-first `orderedPlayers` in `HolePage`**

In `HolePage`, the `orderedPlayers` computation currently reads:
```js
  const orderedPlayers = !useHeroCards && pairs.length === 2
    ? [...pairs[0], ...pairs[1]].map((pp) => players.find((p) => p.id === pp.id)).filter(Boolean)
    : players;
```
Replace it with:
```js
  const orderedPlayers = !useHeroCards && pairs.length === 2
    ? pairsMeFirst(pairs, meId).map((pp) => players.find((p) => p.id === pp.id)).filter(Boolean)
    : playersMeFirst(players, meId);
```
Confirm `meId` is in scope inside `HolePage` (it is a prop of `HolePage`). If `meId` is NOT a `HolePage` prop, STOP and report BLOCKED.

- [ ] **Step 3: Me-first `orderedPlayers` in `GridView`**

In `GridView`, the `orderedPlayers` computation currently reads:
```js
            const orderedPlayers = hasPairs
              ? [...pairs[0], ...pairs[1]].map((pp) => players.find((p) => p.id === pp.id)).filter(Boolean)
              : players;
```
Replace it with:
```js
            const orderedPlayers = hasPairs
              ? pairsMeFirst(pairs, meId).map((pp) => players.find((p) => p.id === pp.id)).filter(Boolean)
              : playersMeFirst(players, meId);
```
Confirm `meId` is in scope where this runs inside `GridView`. If `GridView` does NOT receive `meId`, add `meId` to `GridView`'s destructured props and pass `meId={meId}` at the `<GridView ... />` call site (the surrounding component has `meId` available — it is `tournament?.meId`). Report which you did.

- [ ] **Step 4: Verify**

Run: `npx jest`
Expected: PASS — full suite green.

Confirm only display order changed: run `grep -n "matchPlayHolePts\|sindicatoHolePoints\|matchPlayRoundTally" src/screens/ScorecardScreen.js` and spot-check that every such call still receives the original `players` array (NOT `orderedPlayers`) — `orderedPlayers` must be used only for rendering `.map` loops, never passed to a scoring function. If any scoring call receives `orderedPlayers`, STOP and report BLOCKED.

- [ ] **Step 5: Manual verification**

Start the app (or use the running web build). For a tournament/game where you are one of the players (`tournament.meId` set):
- The ROUND SCORES card shows each player as a card with the name and three labeled cells — POINTS, STROKES, VS PAR — no rank badge, no gold highlight, no award icon.
- "You" are the first row in the ROUND SCORES card; the others follow in join order.
- On the scorecard (hole view and grid), "you" are the first player shown.
- Best Ball: pairs stay visually grouped, with your pair first and you first within it.
- vs-par is colored (under par positive, over par muted/warn); the progress bar still shows at the top of the ROUND SCORES card.
- Verified in light and dark mode.

- [ ] **Step 6: Commit**

```bash
git add src/screens/ScorecardScreen.js
git commit -m "feat: me-first player ordering on the scorecard"
```

---

## Self-Review Notes

- **Spec coverage:** `playersMeFirst` + `pairsMeFirst` pure helpers, TDD'd (Task 1) ✓; `RoundScoreboard` reverted to POINTS/STROKES/VS-PAR stat cells, no rank badge / highlight / award (Task 2) ✓; me-first order in the ROUND SCORES card via `playersMeFirst` (Task 2) ✓; `meId` threaded `HomeScreen → RoundPage → RoundScoreboard` (Task 2) ✓; `RankedRow` + `ranked*` styles deleted (Task 2) ✓; me-first order on the scorecard hero + grid layouts, Best Ball pair-grouping preserved (Task 3) ✓; progress bar retained (Task 2) ✓; scoring functions still receive original `players` order (Task 3 Step 4 guard) ✓; LEADERBOARD card unchanged ✓.
- **Type consistency:** `playersMeFirst(players, meId)` → `Player[]`; `pairsMeFirst(pairs, meId)` → flat `Player[]`. `RoundScoreboard` props `{ round, players, meId, theme, s, showRunning }` — `RoundPage` passes all six. `meId` is `tournament.meId` everywhere.
- **No placeholders:** every code step contains complete, runnable code.
