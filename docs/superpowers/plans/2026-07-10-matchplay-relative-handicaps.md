# Match Play Relative Handicaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Match play (1v1 and pairs duels) hands out strokes from the handicap *difference* — the duel's better player plays off 0, the opponent gets the gap on the hardest holes (lowest stroke index).

**Architecture:** Relativization happens inside the two net-comparison functions in `src/store/scoring.js` (`matchPlayHolePts`, `duelNetWinner`), so every tally/standings/scorecard consumer inherits the rule with no call-site changes. A new exported helper `matchPlayEffectiveHandicaps(mode, round, players)` gives the scorecard UI the same per-duel map so the strokes-received dots and pickup hints match scoring. `round.playerHandicaps` keeps storing full playing handicaps — stats, sync, and all other modes untouched.

**Tech Stack:** React Native (Expo), Jest (`jest-expo`), `@testing-library/react-native`.

**Spec:** `docs/superpowers/specs/2026-07-10-matchplay-relative-handicaps-design.md`

## Global Constraints

- Reference is **per duel** (never best-of-all-four): lower handicap of the duel → 0, opponent → difference at 100% allowance.
- Applies to modes `matchplay` and `pairsmatchplay` only; every other mode's behavior must not change.
- `round.playerHandicaps` continues to store full playing handicaps; never write relative values into it.
- `statsEngine.js` is intentionally NOT modified — personal stats stay on full handicaps.
- Relativization must be idempotent (already-relative inputs re-relativize to themselves) so scoring functions and UI can both apply it safely.
- Run `npx jest <file>` for single suites; the full suite is `npx jest --silent` (~2066 tests, all must stay green).
- ESLint is CI-blocking: `npm run lint` must pass before each commit.

---

### Task 1: `matchPlayEffectiveHandicaps` helper

**Files:**
- Modify: `src/store/scoring.js` (Pairs Match Play section, after `pairsMatchDuels`, ~line 531)
- Modify: `src/store/tournamentStore.js` (re-export block, after `matchPlayRoundTally,` ~line 599)
- Test: `src/store/__tests__/scoring.test.js`

**Interfaces:**
- Consumes: existing `pairsMatchDuels(pairs)` in the same file.
- Produces: `duelRelative(hA, hB)` (module-internal, returns `[number, number]`) used by Tasks 2–3, and exported `matchPlayEffectiveHandicaps(mode, round, players)` returning `{ [playerId]: number }`, re-exported from `tournamentStore` and used by Task 4.

- [ ] **Step 1: Write the failing tests**

Add `matchPlayEffectiveHandicaps` to the existing `from '../scoring'` import list at the top of `src/store/__tests__/scoring.test.js`, then append this describe block at the end of the file:

```js
describe('matchPlayEffectiveHandicaps', () => {
  const P = (id, handicap = 0) => ({ id, name: id, handicap });

  test('matchplay: lower player plays off 0, opponent gets the difference', () => {
    const players = [P('a'), P('b')];
    const round = { playerHandicaps: { a: 12, b: 5 } };
    expect(matchPlayEffectiveHandicaps('matchplay', round, players))
      .toEqual({ a: 7, b: 0 });
  });

  test('matchplay: equal handicaps → both play off 0', () => {
    const players = [P('a'), P('b')];
    const round = { playerHandicaps: { a: 10, b: 10 } };
    expect(matchPlayEffectiveHandicaps('matchplay', round, players))
      .toEqual({ a: 0, b: 0 });
  });

  test('matchplay: falls back to player.handicap when the round map is missing an entry', () => {
    const players = [P('a', 9), P('b', 4)];
    const round = { playerHandicaps: {} };
    expect(matchPlayEffectiveHandicaps('matchplay', round, players))
      .toEqual({ a: 5, b: 0 });
  });

  test('pairsmatchplay: each duel relativizes independently (never best-of-four)', () => {
    // Duels are index-matched: a-c and b-d.
    const round = {
      pairs: [[P('a', 15), P('b', 3)], [P('c', 5), P('d', 20)]],
      playerHandicaps: { a: 15, b: 3, c: 5, d: 20 },
    };
    expect(matchPlayEffectiveHandicaps('pairsmatchplay', round, [P('a'), P('b'), P('c'), P('d')]))
      .toEqual({ a: 10, c: 0, b: 0, d: 17 });
  });

  test('idempotent: an already-relative map relativizes to itself', () => {
    const players = [P('a'), P('b')];
    const round = { playerHandicaps: { a: 7, b: 0 } };
    expect(matchPlayEffectiveHandicaps('matchplay', round, players))
      .toEqual({ a: 7, b: 0 });
  });

  test('other modes: returns the stored map unchanged', () => {
    const stored = { a: 12, b: 5 };
    const round = { playerHandicaps: stored };
    expect(matchPlayEffectiveHandicaps('stableford', round, [P('a'), P('b')])).toBe(stored);
  });

  test('matchplay with wrong player count or pairsmatchplay without valid pairs → stored map', () => {
    const stored = { a: 12 };
    expect(matchPlayEffectiveHandicaps('matchplay', { playerHandicaps: stored }, [P('a')]))
      .toBe(stored);
    expect(matchPlayEffectiveHandicaps('pairsmatchplay', { playerHandicaps: stored, pairs: [[P('a')]] }, [P('a')]))
      .toBe(stored);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/store/__tests__/scoring.test.js -t matchPlayEffectiveHandicaps`
Expected: FAIL — `matchPlayEffectiveHandicaps` is not exported / not a function.

- [ ] **Step 3: Implement the helper**

In `src/store/scoring.js`, directly after the `pairsMatchDuels` function (ends ~line 531), add:

```js
// Match play plays off the DIFFERENCE: the duel's lower handicap becomes 0
// and the opponent keeps the gap, taken on the hardest holes first.
// Idempotent — relativizing an already-relative pair is a no-op.
function duelRelative(hA, hB) {
  const base = Math.min(hA, hB);
  return [hA - base, hB - base];
}

// Effective per-player handicaps for a round as MATCH PLAY scores them:
// per-duel relative in matchplay/pairsmatchplay, the stored map otherwise.
// Used by the scorecard so strokes-received dots and pickup hints show the
// same strokes the net comparison actually grants.
export function matchPlayEffectiveHandicaps(mode, round, players) {
  const stored = round?.playerHandicaps ?? {};
  const resolve = (p) => stored[p.id] ?? p.handicap ?? 0;
  if (mode === 'matchplay' && players?.length === 2) {
    const [a, b] = players;
    const [rA, rB] = duelRelative(resolve(a), resolve(b));
    return { [a.id]: rA, [b.id]: rB };
  }
  if (mode === 'pairsmatchplay') {
    const duels = pairsMatchDuels(round?.pairs);
    if (duels) {
      const out = {};
      for (const [a, b] of duels) {
        const [rA, rB] = duelRelative(resolve(a), resolve(b));
        out[a.id] = rA;
        out[b.id] = rB;
      }
      return out;
    }
  }
  return stored;
}
```

In `src/store/tournamentStore.js`, add `matchPlayEffectiveHandicaps,` to the re-export block immediately after `matchPlayRoundTally,` (~line 599).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/store/__tests__/scoring.test.js -t matchPlayEffectiveHandicaps`
Expected: PASS (7 tests).

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/store/scoring.js src/store/tournamentStore.js src/store/__tests__/scoring.test.js
git commit -m "feat(scoring): add matchPlayEffectiveHandicaps per-duel relative helper"
```

---

### Task 2: 1v1 match play nets use the difference

**Files:**
- Modify: `src/store/scoring.js:162-175` (`matchPlayHolePts`)
- Test: `src/store/__tests__/scoring.test.js` (existing `matchPlayHolePts` describe, ~line 302)

**Interfaces:**
- Consumes: `duelRelative(hA, hB)` from Task 1 (same module).
- Produces: unchanged signature `matchPlayHolePts(hole, playerId, players, scores, playerHandicapsByPlayerId)` — now relativizes internally. `matchPlayRoundTally`, `tournamentMatchPlayStandings`, and `scoreModel.holePoints` inherit the rule with no changes.

- [ ] **Step 1: Write the failing tests**

Add inside the existing `describe('matchPlayHolePts', ...)` block in `src/store/__tests__/scoring.test.js`:

```js
  test('relative handicaps: only the difference gives strokes (SI within the gap)', () => {
    // a hcp 12, b hcp 5 → relative 7 / 0. SI 5 is inside the gap, so only
    // a strokes. Under full handicaps BOTH would stroke here and b (net 3)
    // would win; relative makes it a halve.
    const hole = { number: 1, par: 4, strokeIndex: 5 };
    const players = [{ id: 'a', handicap: 0 }, { id: 'b', handicap: 0 }];
    const scores = { a: { 1: 5 }, b: { 1: 4 } };
    const handicaps = { a: 12, b: 5 };
    expect(matchPlayHolePts(hole, 'b', players, scores, handicaps)).toBe(0);
    expect(matchPlayHolePts(hole, 'a', players, scores, handicaps)).toBe(0);
  });

  test('relative handicaps: no strokes outside the gap', () => {
    // Relative 7 / 0: SI 8 is outside the gap → nobody strokes. Under full
    // handicaps a (hcp 12) would stroke SI 8 and win; relative halves it.
    const hole = { number: 1, par: 4, strokeIndex: 8 };
    const players = [{ id: 'a', handicap: 0 }, { id: 'b', handicap: 0 }];
    const scores = { a: { 1: 5 }, b: { 1: 5 } };
    const handicaps = { a: 12, b: 5 };
    expect(matchPlayHolePts(hole, 'a', players, scores, handicaps)).toBe(0);
    expect(matchPlayHolePts(hole, 'b', players, scores, handicaps)).toBe(0);
  });

  test('relative handicaps: the stroke flips the hole inside the gap', () => {
    // Equal gross 4s on SI 5 → a's relative stroke wins the hole.
    const hole = { number: 1, par: 4, strokeIndex: 5 };
    const players = [{ id: 'a', handicap: 0 }, { id: 'b', handicap: 0 }];
    const scores = { a: { 1: 4 }, b: { 1: 4 } };
    const handicaps = { a: 12, b: 5 };
    expect(matchPlayHolePts(hole, 'a', players, scores, handicaps)).toBe(1);
    expect(matchPlayHolePts(hole, 'b', players, scores, handicaps)).toBe(0);
  });

  test('equal handicaps play pure gross', () => {
    const hole = { number: 1, par: 4, strokeIndex: 1 };
    const players = [{ id: 'a', handicap: 0 }, { id: 'b', handicap: 0 }];
    const scores = { a: { 1: 4 }, b: { 1: 5 } };
    const handicaps = { a: 18, b: 18 };
    expect(matchPlayHolePts(hole, 'a', players, scores, handicaps)).toBe(1);
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx jest src/store/__tests__/scoring.test.js -t matchPlayHolePts`
Expected: the three "relative handicaps" tests FAIL (current code strokes off full handicaps); "equal handicaps play pure gross" may already pass.

- [ ] **Step 3: Relativize inside `matchPlayHolePts`**

In `src/store/scoring.js`, replace lines 168-171:

```js
  const hA = playerHandicapsByPlayerId?.[a.id] ?? a.handicap ?? 0;
  const hB = playerHandicapsByPlayerId?.[b.id] ?? b.handicap ?? 0;
  const netA = strA - calcExtraShots(hA, hole.strokeIndex);
  const netB = strB - calcExtraShots(hB, hole.strokeIndex);
```

with:

```js
  const hA = playerHandicapsByPlayerId?.[a.id] ?? a.handicap ?? 0;
  const hB = playerHandicapsByPlayerId?.[b.id] ?? b.handicap ?? 0;
  // Match play is scored off the handicap DIFFERENCE (best player off 0).
  const [rA, rB] = duelRelative(hA, hB);
  const netA = strA - calcExtraShots(rA, hole.strokeIndex);
  const netB = strB - calcExtraShots(rB, hole.strokeIndex);
```

Also update the section comment above `matchPlayHolePts` (line 158, "Match Play: 2 players, per-hole 1-vs-1...") to note nets use the relative handicap.

- [ ] **Step 4: Run the whole suite for this file**

Run: `npx jest src/store/__tests__/scoring.test.js`
Expected: PASS. (Existing fixtures use handicap 0 or empty maps, which relativize to themselves.)

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/store/scoring.js src/store/__tests__/scoring.test.js
git commit -m "feat(scoring): 1v1 match play nets use relative handicaps"
```

---

### Task 3: Pairs match play duels use the difference

**Files:**
- Modify: `src/store/scoring.js:533-544` (`duelNetWinner`)
- Test: `src/store/__tests__/pairsMatchplay.test.js`

**Interfaces:**
- Consumes: `duelRelative(hA, hB)` from Task 1 (same module).
- Produces: unchanged signatures — `pairsMatchHolePts`, `pairsMatchDuelPts`, `pairsMatchRoundTally`, and team leaderboards inherit the rule.

- [ ] **Step 1: Write the failing tests**

Append to `src/store/__tests__/pairsMatchplay.test.js` (it already imports `pairsMatchDuels`, `pairsMatchHolePts`, and `pairsMatchDuelPts` from `'../scoring'` and defines `P(id, handicap)`):

```js
describe('relative handicaps in duels', () => {
  // Duels are index-matched: a-c (15 vs 5 → relative 10/0) and
  // b-d (3 vs 20 → relative 0/17).
  const hcpPairs = [[P('a', 15), P('b', 3)], [P('c', 5), P('d', 20)]];
  const handicaps = { a: 15, b: 3, c: 5, d: 20 };

  it('strokes come from the per-duel difference, not full handicaps', () => {
    // SI 3, equal gross par 4s in duel a-c. Full handicaps would give BOTH
    // a stroke (halve); relative gives only a (10 vs 0) → a wins the duel.
    const hole = { number: 1, par: 4, strokeIndex: 3 };
    const scores = { a: { 1: 4 }, c: { 1: 4 }, b: { 1: 4 }, d: { 1: 4 } };
    expect(pairsMatchDuelPts(hole, 'a', hcpPairs, scores, handicaps)).toBe(1);
    expect(pairsMatchDuelPts(hole, 'c', hcpPairs, scores, handicaps)).toBe(0);
  });

  it('no strokes above the per-duel gap', () => {
    // SI 12 is outside duel a-c's gap of 10 → gross golf there. Full
    // handicaps would still stroke a (15 ≥ 12).
    const hole = { number: 1, par: 4, strokeIndex: 12 };
    const scores = { a: { 1: 4 }, c: { 1: 4 }, b: { 1: 4 }, d: { 1: 4 } };
    expect(pairsMatchDuelPts(hole, 'a', hcpPairs, scores, handicaps)).toBe(0.5);
    expect(pairsMatchDuelPts(hole, 'c', hcpPairs, scores, handicaps)).toBe(0.5);
  });

  it('each duel relativizes independently', () => {
    // Duel b-d: relative 0/17 → d strokes SI 3, b does not. Equal gross →
    // d wins their duel while a wins theirs: 1 point per team on the hole.
    const hole = { number: 1, par: 4, strokeIndex: 3 };
    const scores = { a: { 1: 4 }, c: { 1: 4 }, b: { 1: 4 }, d: { 1: 4 } };
    expect(pairsMatchDuelPts(hole, 'd', hcpPairs, scores, handicaps)).toBe(1);
    const pts = pairsMatchHolePts(hole, hcpPairs, scores, handicaps);
    expect(pts).toEqual({ team1: 1, team2: 1, decidedDuels: 2 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/store/__tests__/pairsMatchplay.test.js -t "relative handicaps"`
Expected: FAIL — current code strokes both duelists off full handicaps (halves where the tests expect wins).

- [ ] **Step 3: Relativize inside `duelNetWinner`**

In `src/store/scoring.js`, replace lines 538-541:

```js
  const hA = playerHandicaps?.[a.id] ?? a.handicap ?? 0;
  const hB = playerHandicaps?.[b.id] ?? b.handicap ?? 0;
  const netA = strA - calcExtraShots(hA, hole.strokeIndex);
  const netB = strB - calcExtraShots(hB, hole.strokeIndex);
```

with:

```js
  const hA = playerHandicaps?.[a.id] ?? a.handicap ?? 0;
  const hB = playerHandicaps?.[b.id] ?? b.handicap ?? 0;
  // Each duel is its own match: nets use the within-duel difference.
  const [rA, rB] = duelRelative(hA, hB);
  const netA = strA - calcExtraShots(rA, hole.strokeIndex);
  const netB = strB - calcExtraShots(rB, hole.strokeIndex);
```

Also update the section banner comment (~line 524, "Nets use calcExtraShots by stroke index.") to say nets use the per-duel relative handicap.

- [ ] **Step 4: Run the file's full suite**

Run: `npx jest src/store/__tests__/pairsMatchplay.test.js`
Expected: PASS. (The existing "a gets a shot on SI 1 with handicap 18" fixture duels a hcp-0 opponent, so 18 − 0 relativizes to itself.)

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/store/scoring.js src/store/__tests__/pairsMatchplay.test.js
git commit -m "feat(scoring): pairs match play duels use per-duel relative handicaps"
```

---

### Task 4: Scorecard dots and pickup hints show relative strokes

**Files:**
- Modify: `src/components/scorecard/GridView.js` (imports line 9, `ScorecardTable` line 320, dot lanes lines 187-191 and 250-254)
- Modify: `src/components/scorecard/HolePage.js` (imports line 5, handicaps map lines 107-109)
- Test: `src/components/scorecard/__tests__/GridView.test.js`

**Interfaces:**
- Consumes: `matchPlayEffectiveHandicaps(mode, round, players)` re-exported from `'../../store/tournamentStore'` (Task 1).
- Produces: no new exports. Dot `View`s gain `testID={\`hcp-dot-${player.id}-h${h.number}\`}`.

- [ ] **Step 1: Write the failing test**

Append to `src/components/scorecard/__tests__/GridView.test.js` (it already imports `render`, `ThemeProvider`, and `GridView`):

```js
describe('GridView match play stroke dots', () => {
  test('dots follow the relative handicap: only the gap holes stroke, off-gap and better player get none', () => {
    // a hcp 12, b hcp 5 → relative 7 / 0. Hole 1 (SI 1) is inside the gap:
    // a gets a dot. Hole 2 (SI 8) is outside: nobody strokes. b never
    // strokes — under full handicaps b (hcp 5) would dot SI 1.
    const players = [
      { id: 'a', name: 'Ann Lee', handicap: 0 },
      { id: 'b', name: 'Bob Ray', handicap: 0 },
    ];
    const round = {
      holes: [
        { number: 1, par: 4, strokeIndex: 1 },
        { number: 2, par: 4, strokeIndex: 8 },
      ],
      playerHandicaps: { a: 12, b: 5 },
    };

    const { getAllByTestId, queryAllByTestId } = render(
      <ThemeProvider>
        <GridView
          round={round}
          roundIndex={0}
          players={players}
          scores={{}}
          isBestBall={false}
          bbResult={null}
          settings={{ scoringMode: 'matchplay' }}
          onSetScore={() => {}}
          editable={() => false}
          refreshing={false}
          onRefresh={() => {}}
          meId="a"
        />
      </ThemeProvider>
    );

    expect(getAllByTestId('hcp-dot-a-h1').length).toBe(1);
    expect(queryAllByTestId('hcp-dot-a-h2').length).toBe(0);
    expect(queryAllByTestId('hcp-dot-b-h1').length).toBe(0);
    expect(queryAllByTestId('hcp-dot-b-h2').length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/scorecard/__tests__/GridView.test.js -t "match play stroke dots"`
Expected: FAIL — no elements with testID `hcp-dot-*` exist yet (and b would dot SI 1 anyway).

- [ ] **Step 3: Implement the display changes**

In `src/components/scorecard/GridView.js`:

1. Line 9 — add the helper to the existing import:

```js
import { calcExtraShots, scrambleUnits, matchPlayEffectiveHandicaps } from '../../store/tournamentStore';
```

2. Line 320 in `ScorecardTable` — replace:

```js
  const playerHandicaps = handicapsOverride ?? (round.playerHandicaps ?? {});
```

with:

```js
  // Match play modes stroke off the per-duel difference — show the dots
  // where the net comparison actually grants them.
  const playerHandicaps = handicapsOverride
    ?? matchPlayEffectiveHandicaps(mode, round, players);
```

3. Both dot lanes — add a testID to the dot `View`. Points branch (lines 188-190):

```js
                  {extra > 0 && Array.from({ length: Math.min(extra, 2) }).map((_, i) => (
                    <View key={i} testID={`hcp-dot-${player.id}-h${h.number}`} style={[s.soloNineExtraDot, { backgroundColor: theme.accent.primary }]} />
                  ))}
```

Strokes branch (lines 251-253): apply the identical `testID` attribute to its dot `View`.

In `src/components/scorecard/HolePage.js`:

1. Line 5 — add the helper to the existing import:

```js
import { pickupStrokes, scrambleUnits, matchPlayEffectiveHandicaps } from '../../store/tournamentStore';
```

2. Lines 107-109 — replace:

```js
  const handicaps = isScramble
    ? Object.fromEntries(scoringPlayers.map((u) => [u.id, u.handicap]))
    : (round.playerHandicaps ?? {});
```

with:

```js
  const handicaps = isScramble
    ? Object.fromEntries(scoringPlayers.map((u) => [u.id, u.handicap]))
    // Match play modes: per-duel relative map so the extra-shot markers and
    // pickup hint match how the duel is actually scored (identity elsewhere).
    : matchPlayEffectiveHandicaps(mode, round, players);
```

Do NOT change `HoleView.js` or `scoreModel.js` — their match play paths call the tally functions, which relativize internally after Tasks 2-3 (and re-relativizing is idempotent).

- [ ] **Step 4: Run the scorecard suites**

Run: `npx jest src/components/scorecard`
Expected: PASS, including the new dots test.

- [ ] **Step 5: Full suite, lint, commit**

```bash
npx jest --silent
npm run lint
git add src/components/scorecard/GridView.js src/components/scorecard/HolePage.js src/components/scorecard/__tests__/GridView.test.js
git commit -m "feat(scorecard): stroke dots and pickup hints follow match play relative handicaps"
```

Expected: all ~2066+ tests pass, 0 lint errors.
