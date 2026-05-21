# Unified Scorecard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the scorecard render an identical structure for every game mode — only the bottom summary differs — with a team "halo", a collapsible decluttered shot-detail panel, and a rock-solid score stepper.

**Architecture:** Extract the presentational layer of the 4,769-line `src/screens/ScorecardScreen.js` into a focused `src/components/scorecard/` module (pure `scoreModel.js`/`teamModel.js`, plus `PlayerCard`, `HolePage`, `HoleView`, `GridView`, `RoundSummary`, `ShotDetailSection`, `ShotDetailPanel`, shared `styles.js`/`constants.js`). The screen keeps data loading, `mutate` calls, official-mode mapping, and modals. Each task extracts or rewires one piece and is verified by the full Jest suite before commit.

**Tech Stack:** Expo SDK 54, React Native 0.81, React 19, `react-native-web`. Tests: Jest (`jest-expo`). Lint: ESLint 9 flat config. Theme via `src/theme/ThemeContext.js`.

**Reference spec:** `docs/superpowers/specs/2026-05-21-unified-scorecard-design.md`

**Conventions for this plan:**
- Component-extraction tasks **move existing code** out of `ScorecardScreen.js`. "Move verbatim" means copy the named function(s) unchanged except for adding imports and an `export`. Redesign deltas are spelled out explicitly.
- After every task: `npm test` must pass (~422 tests) and `npm run lint` must be clean before committing.
- Run `npm test -- --watchman=false` if watchman is unavailable.

---

## Task 1: Extract `constants.js`

**Files:**
- Create: `src/components/scorecard/constants.js`
- Modify: `src/screens/ScorecardScreen.js` (remove inline constant definitions, add import)

- [ ] **Step 1: Create the constants file**

Move these definitions verbatim out of `ScorecardScreen.js` into the new file and `export` each: `DEFAULT_SHOT` (currently line 88), `DRIVE_ORDER` (127), `DRIVE_META` (128), `FIRST_PUTT_BUCKETS` (136), `FIRST_PUTT_LABELS` (137), `APPROACH_BUCKETS` (142), `APPROACH_LABELS` (143), `CELEBRATION_TIERS` (2613), and the `celebrationFor` function (77).

`src/components/scorecard/constants.js`:

```js
// Shared constants for the scorecard module: shot-detail schema, driver and
// distance-bucket option sets, and birdie/eagle celebration tiers.

// One per-hole shot-detail record. firstPuttBucket / approachBucket use the
// metre ranges in FIRST_PUTT_BUCKETS / APPROACH_BUCKETS.
export const DEFAULT_SHOT = {
  putts: null,
  drive: null,
  teePenalties: 0,
  otherPenalties: 0,
  sandShots: 0,
  recoveryOutcome: null,        // 'up-and-down' | 'sand-save' | 'none' | null
  firstPuttBucket: null,        // see FIRST_PUTT_BUCKETS
  approachBucket: null,         // see APPROACH_BUCKETS
};

// Driver direction, in display order.
export const DRIVE_ORDER = ['left', 'fairway', 'right', 'short', 'super'];
export const DRIVE_META = {
  left: { label: 'Left', icon: 'arrow-up-left' },
  fairway: { label: 'Fairway', icon: 'circle' },
  right: { label: 'Right', icon: 'arrow-up-right' },
  short: { label: 'Short', icon: 'arrow-down' },
  super: { label: 'Super', icon: 'star' },
};

export const FIRST_PUTT_BUCKETS = ['0-1', '1-2', '2-3', '3-6', '6+'];
export const FIRST_PUTT_LABELS = {
  '0-1': '0-1', '1-2': '1-2', '2-3': '2-3', '3-6': '3-6', '6+': '6+',
};

export const APPROACH_BUCKETS = ['0-50', '50-100', '100-150', '150-200', '200+'];
export const APPROACH_LABELS = {
  '0-50': '0-50', '50-100': '50-100', '100-150': '100-150',
  '150-200': '150-200', '200+': '200+',
};

export const CELEBRATION_TIERS = {
  BIRDIE: { eyebrow: 'A BIRDIE', accent: '#f0c419', glow: 'rgba(240,196,25,0.35)', icon: 'star' },
  EAGLE: { eyebrow: 'AN EAGLE', accent: '#ffd700', glow: 'rgba(255,215,0,0.45)', icon: 'award' },
  ALBATROSS: { eyebrow: 'AN ALBATROSS', accent: '#ffffff', glow: 'rgba(255,255,255,0.55)', icon: 'star' },
  'HOLE IN ONE': { eyebrow: 'A HOLE IN ONE', accent: '#ffd700', glow: 'rgba(255,215,0,0.65)', icon: 'target' },
};

// Celebration label for a hole result, or null when it isn't notable.
export function celebrationFor(par, strokes) {
  if (!par || !strokes) return null;
  if (strokes === 1 && par > 1) return 'HOLE IN ONE';
  const diff = par - strokes;
  if (diff >= 3) return 'ALBATROSS';
  if (diff === 2) return 'EAGLE';
  if (diff === 1) return 'BIRDIE';
  return null;
}
```

> Verify the `celebrationFor` body and `FIRST_PUTT_LABELS`/`APPROACH_LABELS` exact values against `ScorecardScreen.js` lines 77-146 before saving — copy them exactly if they differ from the above.

- [ ] **Step 2: Rewire `ScorecardScreen.js`**

Delete the inline definitions listed in Step 1 from `ScorecardScreen.js`. Add near the other imports (after line 43):

```js
import {
  DEFAULT_SHOT, DRIVE_ORDER, DRIVE_META,
  FIRST_PUTT_BUCKETS, FIRST_PUTT_LABELS,
  APPROACH_BUCKETS, APPROACH_LABELS,
  CELEBRATION_TIERS, celebrationFor,
} from '../components/scorecard/constants';
```

- [ ] **Step 3: Verify**

Run: `npm test` — Expected: PASS (~422 tests).
Run: `npm run lint` — Expected: clean (no unused vars, no undefined refs).

- [ ] **Step 4: Commit**

```bash
git add src/components/scorecard/constants.js src/screens/ScorecardScreen.js
git commit -m "refactor(scorecard): extract shot-detail and celebration constants"
```

---

## Task 2: Create `scoreModel.js` (pure scoring) + tests

**Files:**
- Create: `src/components/scorecard/scoreModel.js`
- Test: `src/components/scorecard/__tests__/scoreModel.test.js`

`scoreModel` is the single place that resolves per-mode scoring. It wraps the existing pure functions in `src/store/tournamentStore.js` (which re-exports `src/store/scoring.js`). `mode` is one of `'stableford' | 'matchplay' | 'sindicato' | 'bestball'`. For per-player hole/round points, `'bestball'` behaves like `'stableford'` (Best Ball differences live only in the summary).

- [ ] **Step 1: Write the failing tests**

`src/components/scorecard/__tests__/scoreModel.test.js`:

```js
import { holePoints, roundTotals } from '../scoreModel';

const holes = [
  { number: 1, par: 4, strokeIndex: 5 },
  { number: 2, par: 3, strokeIndex: 11 },
];
const players = [
  { id: 'a', name: 'Ana', handicap: 0 },
  { id: 'b', name: 'Ben', handicap: 0 },
];
const handicaps = { a: 0, b: 0 };

describe('holePoints', () => {
  test('stableford: par = 2 points, birdie = 3', () => {
    const scores = { a: { 1: 4 }, b: { 1: 3 } };
    const pts = holePoints({ mode: 'stableford', hole: holes[0], players, scores, handicaps });
    expect(pts).toEqual({ a: 2, b: 3 });
  });

  test('unscored hole yields null for that player', () => {
    const scores = { a: { 1: 4 } };
    const pts = holePoints({ mode: 'stableford', hole: holes[0], players, scores, handicaps });
    expect(pts.a).toBe(2);
    expect(pts.b).toBeNull();
  });

  test('bestball scores per player exactly like stableford', () => {
    const scores = { a: { 1: 4 }, b: { 1: 3 } };
    expect(holePoints({ mode: 'bestball', hole: holes[0], players, scores, handicaps }))
      .toEqual({ a: 2, b: 3 });
  });

  test('matchplay: hole winner gets 1, loser 0', () => {
    const scores = { a: { 1: 3 }, b: { 1: 5 } };
    const pts = holePoints({ mode: 'matchplay', hole: holes[0], players, scores, handicaps });
    expect(pts).toEqual({ a: 1, b: 0 });
  });
});

describe('roundTotals', () => {
  test('sums strokes, points and par across scored holes', () => {
    const scores = { a: { 1: 4, 2: 3 }, b: { 1: 5 } };
    const round = { holes };
    const totals = roundTotals({ mode: 'stableford', round, players, scores, handicaps });
    expect(totals.get('a')).toEqual({ pts: 4, str: 7, parPlayed: 7 });
    expect(totals.get('b')).toEqual({ pts: 1, str: 5, parPlayed: 4 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- scoreModel` — Expected: FAIL ("Cannot find module '../scoreModel'").

- [ ] **Step 3: Implement `scoreModel.js`**

`src/components/scorecard/scoreModel.js`:

```js
// Pure per-mode scoring for the scorecard. Wraps the scoring engines in
// store/tournamentStore.js so components never branch on mode themselves.
import {
  calcStablefordPoints,
  matchPlayHolePts,
  sindicatoHolePoints,
} from '../../store/tournamentStore';

// Points for every player on one hole. Returns { [playerId]: number|null };
// null means the player has not scored the hole yet.
export function holePoints({ mode, hole, players, scores, handicaps }) {
  const result = {};
  for (const p of players) {
    const str = scores?.[p.id]?.[hole.number];
    if (str == null) { result[p.id] = null; continue; }
    if (mode === 'matchplay') {
      result[p.id] = matchPlayHolePts(hole, p.id, players, scores, handicaps);
    } else if (mode === 'sindicato') {
      result[p.id] = sindicatoHolePoints(hole, players, scores, handicaps)?.[p.id] ?? null;
    } else {
      const hcp = handicaps?.[p.id] ?? p.handicap ?? 0;
      result[p.id] = calcStablefordPoints(hole.par, str, hcp, hole.strokeIndex);
    }
  }
  return result;
}

// Per-player round totals. Returns Map<playerId, { pts, str, parPlayed }>.
export function roundTotals({ mode, round, players, scores, handicaps }) {
  const map = new Map();
  const holes = round?.holes ?? [];
  for (const p of players) {
    let pts = 0;
    let str = 0;
    let parPlayed = 0;
    for (const hole of holes) {
      const sc = scores?.[p.id]?.[hole.number];
      if (sc == null) continue;
      str += sc;
      parPlayed += hole.par;
      const hp = holePoints({ mode, hole, players, scores, handicaps });
      pts += hp[p.id] ?? 0;
    }
    map.set(p.id, { pts, str, parPlayed });
  }
  return map;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- scoreModel` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/scorecard/scoreModel.js src/components/scorecard/__tests__/scoreModel.test.js
git commit -m "feat(scorecard): add pure scoreModel for per-mode hole and round points"
```

---

## Task 3: Add `summaryState` to `scoreModel.js` + tests

`summaryState` produces everything `RoundSummary` needs. It consolidates the math currently spread across `MatchPanel`, `SindicatoPanel`, `StablefordWinnerBanner`, and `SoloTotalsRibbon` in `ScorecardScreen.js`.

**Files:**
- Modify: `src/components/scorecard/scoreModel.js`
- Modify: `src/components/scorecard/__tests__/scoreModel.test.js`

**Contract — `summaryState({ mode, round, players, scores, settings, currentHole, meId })` returns:**

```
{
  variant: 'pairs' | 'players' | 'solo',
  eyebrow: string,                 // e.g. 'MATCH PLAY', 'STABLEFORD', 'ROUND TOTALS'
  // variant 'pairs':
  pairs: [{ index, name, holePts, roundPts, isWinner }],   // length 2
  // variant 'players':
  chips: [{ id, name, points, isLeader, isMe, isWinner }], // me first
  // variant 'solo':
  solo: { str, pts, vsParLabel },
  status: string | null,           // e.g. 'Guille leads by 3 · 11 to play'
  decided: boolean,                // result is clinched/complete
}
```

- [ ] **Step 1: Write failing tests**

Append to `scoreModel.test.js`:

```js
import { summaryState } from '../scoreModel';

describe('summaryState', () => {
  test('solo variant returns the stat ribbon', () => {
    const round = { holes: [{ number: 1, par: 4, strokeIndex: 1 }] };
    const solo = [{ id: 'a', name: 'Ana', handicap: 0 }];
    const s = summaryState({
      mode: 'stableford', round, players: solo,
      scores: { a: { 1: 3 } }, settings: {}, currentHole: 1, meId: 'a',
    });
    expect(s.variant).toBe('solo');
    expect(s.solo).toEqual({ str: 3, pts: 3, vsParLabel: '-1' });
  });

  test('players variant lists chips, me first, leader flagged', () => {
    const round = { holes: [{ number: 1, par: 4, strokeIndex: 1 }] };
    const players = [
      { id: 'a', name: 'Ana', handicap: 0 },
      { id: 'b', name: 'Ben', handicap: 0 },
    ];
    const s = summaryState({
      mode: 'stableford', round, players,
      scores: { a: { 1: 3 }, b: { 1: 5 } },
      settings: {}, currentHole: 1, meId: 'b',
    });
    expect(s.variant).toBe('players');
    expect(s.chips.map((c) => c.id)).toEqual(['b', 'a']);
    expect(s.chips.find((c) => c.id === 'a').isLeader).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- scoreModel` — Expected: FAIL ("summaryState is not a function").

- [ ] **Step 3: Implement `summaryState`**

Add to `scoreModel.js`. Import the remaining engines at the top:

```js
import {
  calcBestWorstBall,
  roundPairLeaderboard,
  sindicatoRoundTally,
  roundPairClinched,
} from '../../store/tournamentStore';
```

Implement `summaryState` with this logic:

- **`variant: 'solo'`** when `players.length === 1`: `eyebrow: 'ROUND TOTALS'`; `solo` from `roundTotals` — `str`, `pts`, and `vsParLabel` (`parPlayed === 0 → '-'`, else diff `str - parPlayed` formatted `E` / `+n` / `-n`); `status: null`; `decided: false`.
- **`variant: 'pairs'`** when `mode === 'matchplay'` or `mode === 'bestball'`: build the two pairs from `round.pairs`. For Best Ball, hole/round points come from `calcBestWorstBall({ ...round, scores }, players)` and `settings.bestBallValue`/`worstBallValue` (port `holeTeamPts`/`roundTeamPts` from `ScorecardScreen.js` lines 2413-2422). For Match Play, port `MatchPanel`'s math (`ScorecardScreen.js` 2424-2447). `eyebrow` is `'MATCH PLAY'` or `'BEST BALL'`. `decided` from clinch (`roundPairClinched({ ...round, scores }, players, settings, mode === 'bestball' ? 'bestball' : 'stableford')` for Best Ball; for Match Play, lead `>` max remaining catch-up, per `MatchPanel` lines 2441-2447). `isWinner: true` on the leading pair when `decided`. `status`: `'<names> lead by N · M to play'` / `'All square · M to play'`.
- **`variant: 'players'`** for `stableford` and `sindicato` (multi-player): `chips` are `roundTotals` points per player, ordered me-first then points-desc for the rest (use `playersMeFirst` from `src/lib/playerOrder`). For `sindicato`, also use `sindicatoRoundTally({ ...round, scores }, players)` for `status`/`decided`. For `stableford`, `decided` is true only when every player has scored every hole; the winner is the top of `roundPairLeaderboard` when pairs exist, else the top chip. `isLeader` flags the sole points leader; `isWinner` flags the winner only when `decided`. `status` for random-partner Stableford names the leading pair (`roundPairLeaderboard`), otherwise the leading player.

Reuse `roundTotals` from Task 2. Keep `summaryState` pure.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test -- scoreModel` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/scorecard/scoreModel.js src/components/scorecard/__tests__/scoreModel.test.js
git commit -m "feat(scorecard): add summaryState for the unified round summary"
```

---

## Task 4: Create `teamModel.js` + tests

**Files:**
- Create: `src/components/scorecard/teamModel.js`
- Test: `src/components/scorecard/__tests__/teamModel.test.js`

- [ ] **Step 1: Write failing tests**

`src/components/scorecard/__tests__/teamModel.test.js`:

```js
import { hasTeams, teamsByPlayer, teamColor } from '../teamModel';

const theme = { pairA: '#4fae8a', pairB: '#f59e0b' };

test('hasTeams: true only for two multi-member pairs', () => {
  const teamRound = { pairs: [[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }, { id: 'd' }]] };
  expect(hasTeams(teamRound)).toBe(true);
  expect(hasTeams({ pairs: [[{ id: 'a' }], [{ id: 'b' }]] })).toBe(false);
  expect(hasTeams({ pairs: [] })).toBe(false);
  expect(hasTeams({})).toBe(false);
});

test('teamsByPlayer maps each player to a team index and label', () => {
  const teamRound = { pairs: [[{ id: 'a' }, { id: 'b' }], [{ id: 'c' }, { id: 'd' }]] };
  const map = teamsByPlayer(teamRound);
  expect(map.a).toEqual({ index: 0, label: 'Pair A' });
  expect(map.d).toEqual({ index: 1, label: 'Pair B' });
});

test('teamsByPlayer returns {} when there are no teams', () => {
  expect(teamsByPlayer({ pairs: [[{ id: 'a' }]] })).toEqual({});
});

test('teamColor picks pairA for index 0, pairB for index 1', () => {
  expect(teamColor(theme, 0)).toBe('#4fae8a');
  expect(teamColor(theme, 1)).toBe('#f59e0b');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- teamModel` — Expected: FAIL ("Cannot find module '../teamModel'").

- [ ] **Step 3: Implement `teamModel.js`**

```js
// Resolves which team each player is on, for the halo and the summary.
// A team exists only when the round has exactly two multi-member pairs
// (Match Play, Best Ball, random-partner Stableford). Solo, individual
// Stableford and Sindicato have no teams.

export function hasTeams(round) {
  const pairs = round?.pairs ?? [];
  return pairs.length === 2 && pairs.every((p) => Array.isArray(p) && p.length >= 2);
}

// { [playerId]: { index: 0|1, label: 'Pair A'|'Pair B' } }, or {} when no teams.
export function teamsByPlayer(round) {
  if (!hasTeams(round)) return {};
  const map = {};
  round.pairs.forEach((pair, index) => {
    pair.forEach((member) => {
      const id = member?.id ?? member;
      map[id] = { index, label: index === 0 ? 'Pair A' : 'Pair B' };
    });
  });
  return map;
}

// Team colour for a team index, from the theme.
export function teamColor(theme, index) {
  return index === 0 ? theme.pairA : theme.pairB;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test -- teamModel` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/scorecard/teamModel.js src/components/scorecard/__tests__/teamModel.test.js
git commit -m "feat(scorecard): add teamModel for halo team resolution"
```

---

## Task 5: Fix the rapid-tap score bug (spec §6)

**Files:**
- Modify: `src/screens/ScorecardScreen.js` — `setScore` (~746), `stepScore` (~764), `reload` (~244-288), and add a `dirtyCellsRef` + a `mergeScores` helper.
- Test: `src/screens/__tests__/scorecardScores.test.js` (new)

**Root cause:** the optimistic `scores` state and the persisted blob are two sources of truth; the reload guard (`pendingSaveRef`) is sampled before the async `loadTournament()`, so a late reload overwrites newer taps. Also, `setScore`/`stepScore` run side effects inside the `setScores` updater, which React may invoke twice.

- [ ] **Step 1: Write the failing test**

`src/screens/__tests__/scorecardScores.test.js`:

```js
import { mergeScores } from '../ScorecardScreen';

describe('mergeScores', () => {
  test('adopts blob values for clean cells', () => {
    const blob = { a: { 1: 4, 2: 5 } };
    const local = { a: { 1: 4 } };
    const merged = mergeScores(blob, local, new Set());
    expect(merged).toEqual({ a: { 1: 4, 2: 5 } });
  });

  test('keeps the local value for a dirty cell the blob disagrees with', () => {
    const blob = { a: { 1: 4 } };       // stale: missing the newer tap
    const local = { a: { 1: 7 } };      // user tapped up to 7
    const merged = mergeScores(blob, local, new Set(['a:1']));
    expect(merged.a[1]).toBe(7);        // local edit survives the stale reload
  });

  test('a dirty cell the blob now agrees with adopts the blob value', () => {
    const blob = { a: { 1: 7 } };       // save round-tripped
    const local = { a: { 1: 7 } };
    const merged = mergeScores(blob, local, new Set(['a:1']));
    expect(merged.a[1]).toBe(7);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- scorecardScores` — Expected: FAIL ("mergeScores is not a function").

- [ ] **Step 3: Add and export `mergeScores`**

In `ScorecardScreen.js`, add at module scope (near the other top-level helpers) and `export` it:

```js
// Reconcile a reloaded scores blob with the local optimistic state. Clean
// cells take the blob value; a cell marked dirty keeps its local value until
// the blob agrees with it (its save has round-tripped). `dirtyKeys` holds
// `${playerId}:${holeNumber}` strings.
export function mergeScores(blobScores, localScores, dirtyKeys) {
  const out = {};
  const playerIds = new Set([
    ...Object.keys(blobScores ?? {}),
    ...Object.keys(localScores ?? {}),
  ]);
  for (const pid of playerIds) {
    const blobByHole = blobScores?.[pid] ?? {};
    const localByHole = localScores?.[pid] ?? {};
    const holes = new Set([...Object.keys(blobByHole), ...Object.keys(localByHole)]);
    const merged = {};
    for (const h of holes) {
      const key = `${pid}:${h}`;
      const blobVal = blobByHole[h];
      const localVal = localByHole[h];
      if (dirtyKeys.has(key) && blobVal !== localVal) {
        merged[h] = localVal;          // stale reload — protect the local edit
      } else {
        merged[h] = blobVal;           // clean cell, or save has round-tripped
      }
    }
    out[pid] = merged;
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- scorecardScores` — Expected: PASS.

- [ ] **Step 5: Wire `dirtyCellsRef`, deterministic stepping, and merge-on-reload**

Make these changes inside the `ScorecardScreen` component:

1. Add a ref near `scoresRef` (line ~398): `const dirtyCellsRef = useRef(new Set());`
2. Keep the `useEffect` that mirrors `scores` into `scoresRef`, but in the handlers below set `scoresRef.current` *before* calling `setScores` so handlers always read a synchronously-current value.
3. Rewrite `setScore` and `stepScore` so the next value is computed from `scoresRef.current`, `setScores` receives the already-computed object, and side effects (`autoSave`/`officialWrite`, `triggerCelebration`) run **outside** the updater, exactly once. Add each edited cell's `${playerId}:${holeNumber}` to `dirtyCellsRef.current`. Example for `stepScore`:

```js
const stepScore = useCallback((playerId, holeNumber, delta) => {
  haptic('light');
  const anim = getScoreAnim(playerId);
  anim.setValue(1.18);
  Animated.spring(anim, { toValue: 1, friction: 5, useNativeDriver: true }).start();

  const holePar = round?.holes?.find((h) => h.number === holeNumber)?.par ?? 4;
  const cur = scoresRef.current;
  const current = cur[playerId]?.[holeNumber];
  const newStrokes = current == null
    ? (delta > 0 ? holePar : Math.max(1, holePar - 1))
    : Math.max(1, current + delta);
  const next = {
    ...cur,
    [playerId]: { ...cur[playerId], [holeNumber]: newStrokes },
  };
  scoresRef.current = next;                                  // sync source of truth
  dirtyCellsRef.current.add(`${playerId}:${holeNumber}`);
  setScores(next);                                           // pre-computed value

  if (official) officialWrite(playerId, holeNumber, newStrokes);
  else autoSave(next);
  if (newStrokes !== current) {
    const label = celebrationFor(holePar, newStrokes);
    if (label) triggerCelebration(playerId, holeNumber, label);
  }
}, [round, autoSave, triggerCelebration, getScoreAnim, official, officialWrite]);
```

Apply the same pattern to `setScore` (compute `parsed` from `scoresRef.current`, set ref, `setScores(next)`, then side effects once).

4. In `reload` (line ~266), replace `setScores(roundScores)` with the merge:

```js
setScores((prev) => {
  const merged = mergeScores(roundScores, prev, dirtyCellsRef.current);
  // Drop cells the blob has now caught up on.
  for (const key of [...dirtyCellsRef.current]) {
    const [pid, h] = key.split(':');
    if (roundScores?.[pid]?.[h] === merged[pid]?.[h]) dirtyCellsRef.current.delete(key);
  }
  scoresRef.current = merged;
  return merged;
});
```

- [ ] **Step 6: Verify the full suite + manual rapid-tap check**

Run: `npm test` — Expected: PASS.
Run: `npm run lint` — Expected: clean.
Manual (`npm run web`): open a round, tap `+` ten times as fast as possible — the number must land on exactly the expected value and never visibly bounce up/down. Repeat on `-`.

- [ ] **Step 7: Commit**

```bash
git add src/screens/ScorecardScreen.js src/screens/__tests__/scorecardScores.test.js
git commit -m "fix(scorecard): make the +/- stepper deterministic under rapid taps"
```

---

## Task 6: Extract `styles.js`

**Files:**
- Create: `src/components/scorecard/styles.js`
- Modify: `src/screens/ScorecardScreen.js`

- [ ] **Step 1: Move `makeStyles` into the module**

Cut the entire `makeStyles(theme)` function (`ScorecardScreen.js` line ~3292 to the end of its `StyleSheet.create({...})`) into `src/components/scorecard/styles.js`. Rename the export to `makeScorecardStyles`:

```js
import { StyleSheet, Platform } from 'react-native';

// Shared StyleSheet for the scorecard screen and the scorecard/* components.
export function makeScorecardStyles(theme) {
  return StyleSheet.create({
    // ... entire body moved verbatim from ScorecardScreen.js makeStyles ...
  });
}
```

Add whatever imports the moved body needs (`Platform`, etc. — check the cut code).

- [ ] **Step 2: Rewire `ScorecardScreen.js`**

Add an import: `import { makeScorecardStyles } from '../components/scorecard/styles';`
Replace every `makeStyles(theme)` call in `ScorecardScreen.js` with `makeScorecardStyles(theme)`. Delete the now-empty inline `makeStyles`.

- [ ] **Step 3: Verify**

Run: `npm test` — Expected: PASS. Run: `npm run lint` — Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/scorecard/styles.js src/screens/ScorecardScreen.js
git commit -m "refactor(scorecard): extract shared makeScorecardStyles"
```

---

## Task 7: Extract `ShotDetailPanel.js` and declutter the bucket rows

**Files:**
- Create: `src/components/scorecard/ShotDetailPanel.js`
- Modify: `src/components/scorecard/styles.js`
- Modify: `src/screens/ScorecardScreen.js`

- [ ] **Step 1: Move the panel and its rows**

Move `ShotCounterRow` (line ~1758), `BucketRow` (~1790), and `ShotDetailPanel` (~1828) into `ShotDetailPanel.js`. Keep `ShotDetailPanel` a named `export` (its current `export function` form). Add imports it needs:

```js
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { makeScorecardStyles } from './styles';
import { ShotDetailExplainer } from '../ShotDetailExplainer';
import { isGIR, recoveryOutcomeFromState } from '../../store/scoring';
import {
  DEFAULT_SHOT, DRIVE_ORDER, DRIVE_META,
  FIRST_PUTT_BUCKETS, FIRST_PUTT_LABELS,
  APPROACH_BUCKETS, APPROACH_LABELS,
} from './constants';
```

- [ ] **Step 2: Redesign `BucketRow` into a full-width segmented control**

Replace `BucketRow` with a `BucketSegment` that renders the label on its own line, then a full-width segmented control of equal-width cells below it:

```js
// A distance-bucket picker: label on its own line, then a full-width row of
// equal-width segmented cells. Tapping the active cell clears the value.
function BucketSegment({ label, value, buckets, labels, onSelect, theme, s, explainer, hint }) {
  return (
    <View style={s.bucketSegBlock}>
      <View style={s.bucketSegLabelRow}>
        <Text style={s.shotRowLabel}>{label}</Text>
        {explainer}
        {hint ? <Text style={s.bucketSegHint}>{hint}</Text> : null}
      </View>
      <View style={s.bucketSegTrack}>
        {buckets.map((key) => {
          const active = value === key;
          return (
            <TouchableOpacity
              key={key}
              style={[s.bucketSegCell, active && s.bucketSegCellActive]}
              onPress={() => onSelect(active ? null : key)}
              activeOpacity={0.7}
              accessibilityLabel={`${label} ${labels[key]}`}
              accessibilityState={{ selected: active }}
            >
              <Text style={[s.bucketSegCellText, active && s.bucketSegCellTextActive]}>
                {labels[key]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
```

In `ShotDetailPanel`, replace the two `<BucketRow .../>` usages (Approach from, First putt) with `<BucketSegment .../>`, passing `hint="metres"`. Keep `ShotCounterRow`, the Driver row, and the Outcome row unchanged.

- [ ] **Step 3: Add the segmented-control styles**

In `src/components/scorecard/styles.js`, add to the `StyleSheet.create` object:

```js
bucketSegBlock: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border.subtle },
bucketSegLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
bucketSegHint: { marginLeft: 'auto', color: theme.text.muted, fontSize: 11, fontWeight: '600' },
bucketSegTrack: { flexDirection: 'row', backgroundColor: theme.bg.secondary, borderRadius: 10, padding: 3 },
bucketSegCell: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
bucketSegCellActive: { backgroundColor: theme.accent.primary },
bucketSegCellText: { color: theme.text.secondary, fontSize: 12, fontWeight: '700' },
bucketSegCellTextActive: { color: theme.text.inverse },
```

- [ ] **Step 4: Rewire `ScorecardScreen.js`**

Delete the moved functions from `ScorecardScreen.js`. Add: `import { ShotDetailPanel } from '../components/scorecard/ShotDetailPanel';`. Remove the now-unused `ShotDetailExplainer`, `isGIR`, `recoveryOutcomeFromState` imports if nothing else in the screen uses them (check first).

- [ ] **Step 5: Verify**

Run: `npm test` — Expected: PASS. Run: `npm run lint` — Expected: clean.
Manual (`npm run web`): open a round, expand a hole's shot detail — Approach from and First putt now render as full-width segmented controls.

- [ ] **Step 6: Commit**

```bash
git add src/components/scorecard/ShotDetailPanel.js src/components/scorecard/styles.js src/screens/ScorecardScreen.js
git commit -m "refactor(scorecard): extract ShotDetailPanel, declutter bucket rows into segmented controls"
```

---

## Task 8: Create `ShotDetailSection.js` (collapsible wrapper)

**Files:**
- Create: `src/components/scorecard/ShotDetailSection.js`
- Modify: `src/components/scorecard/styles.js`

- [ ] **Step 1: Create the component**

`ShotDetailSection` wraps `ShotDetailPanel` in a tappable collapsible header. Collapse state is **controlled** — owned by `HoleView` (Task 12) so it is one toggle for the whole round.

`src/components/scorecard/ShotDetailSection.js`:

```js
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { makeScorecardStyles } from './styles';
import { ShotDetailPanel } from './ShotDetailPanel';

// Collapsible "Shot detail" section for the "me" card. `collapsed` and
// `onToggle` are controlled by the parent so the choice persists across holes.
export function ShotDetailSection({ hole, detail, onChange, strokes, collapsed, onToggle }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeScorecardStyles(theme), [theme]);
  return (
    <View style={s.shotSection}>
      <TouchableOpacity
        style={s.shotSectionHeader}
        onPress={onToggle}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ expanded: !collapsed }}
        accessibilityLabel={collapsed ? 'Show shot detail' : 'Hide shot detail'}
      >
        <Text style={s.shotSectionTitle}>Shot detail</Text>
        <Feather name={collapsed ? 'chevron-right' : 'chevron-down'} size={16} color={theme.text.muted} />
      </TouchableOpacity>
      {!collapsed && (
        <ShotDetailPanel hole={hole} detail={detail} onChange={onChange} strokes={strokes} />
      )}
    </View>
  );
}
```

- [ ] **Step 2: Add styles**

In `styles.js` add:

```js
shotSection: { marginTop: 10, borderTopWidth: 1, borderTopColor: theme.border.subtle },
shotSectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
shotSectionTitle: { color: theme.text.secondary, fontSize: 13, fontWeight: '700' },
```

- [ ] **Step 3: Verify**

Run: `npm test` — Expected: PASS. Run: `npm run lint` — Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/scorecard/ShotDetailSection.js src/components/scorecard/styles.js
git commit -m "feat(scorecard): add collapsible ShotDetailSection"
```

---

## Task 9: Create `RoundSummary.js` (unified summary)

**Files:**
- Create: `src/components/scorecard/RoundSummary.js`
- Modify: `src/components/scorecard/styles.js`
- Modify: `src/screens/ScorecardScreen.js` (the inline `HoleView` summary branch)

`RoundSummary` replaces `MatchPanel`, `SindicatoPanel`, `SoloTotalsRibbon`, and `StablefordWinnerBanner`. It renders one frame and chooses its inner layout from `summaryState(...).variant`.

- [ ] **Step 1: Create the component**

`src/components/scorecard/RoundSummary.js` — props: `{ mode, round, players, scores, settings, currentHole, meId }`. Compute `const state = useMemo(() => summaryState({ mode, round, players, scores, settings, currentHole, meId }), [...])`. Render:

- **Frame** (always): a card (`s.summaryCard`) with a centered eyebrow (`s.summaryEyebrow`, value `state.eyebrow`).
- **`variant === 'pairs'`**: a `HOLE n` / `ROUND` column header, then two rows — pair name (in `teamColor(theme, index)`), `holePts`, `roundPts`. When `pair.isWinner`, give the row `s.summaryRowWinner` (gold tint) and a trophy (`Feather name="award"`).
- **`variant === 'players'`**: a row of chips (`s.summaryChip`); the leader chip gets `s.summaryChipLeader`; a winner chip (when `decided`) gets `s.summaryRowWinner`.
- **`variant === 'solo'`**: three stat columns — `STROKES` / `POINTS` / `vs PAR`.
- **Status line** (`s.summaryStatus`): `state.status`. When `state.decided`, render it in gold (`s.summaryStatusWinner`).

Use `useTheme()` + `makeScorecardStyles`. Import `summaryState` from `./scoreModel` and `teamColor` from `./teamModel`.

- [ ] **Step 2: Add styles**

In `styles.js` add `summaryCard`, `summaryEyebrow`, `summaryColHeader`, `summaryRow`, `summaryRowWinner` (background `rgba(232,196,95,0.12)`), `summaryName`, `summaryCol`, `summaryChipRow`, `summaryChip`, `summaryChipLeader`, `summaryChipName`, `summaryChipValue`, `summarySolo`, `summarySoloItem`, `summarySoloLabel`, `summarySoloValue`, `summaryStatus`, `summaryStatusWinner` (color `#e8c45f`). Match the existing `totalsStrip`/`matchPanel` spacing so the panel height is consistent.

- [ ] **Step 3: Rewire the inline `HoleView` summary branch**

In `ScorecardScreen.js`, in the inline `HoleView`, replace the four-way summary branch (`ScorecardScreen.js` ~2161-2184: `isBestBall ? <MatchPanel/> : isSindicato ... : <SoloTotalsRibbon/> : <StablefordWinnerBanner/> + totalsStrip`) with a single:

```jsx
<RoundSummary
  mode={settings?.scoringMode ?? 'stableford'}
  round={round}
  players={players}
  scores={scores}
  settings={settings}
  currentHole={currentHole}
  meId={meId}
/>
```

Add `import { RoundSummary } from '../components/scorecard/RoundSummary';`. Leave `MatchPanel`/`SindicatoPanel`/`SoloTotalsRibbon`/`StablefordWinnerBanner`/`WinnerBadge` defined for now (GridView still uses `LiveMatchStrip`; the unused ones are deleted in Task 14).

- [ ] **Step 4: Verify**

Run: `npm test` — Expected: PASS. Run: `npm run lint` — Expected: clean (if the now-unused panel functions trip `no-unused-vars`, leave the removal to Task 14 and add `// eslint-disable-next-line no-unused-vars` above each; do NOT delete them yet).
Manual (`npm run web`): open rounds in Stableford, Match Play, Sindicato, and a solo round — each shows the unified summary; clinch a Match Play round and confirm the gold winner row.

- [ ] **Step 5: Commit**

```bash
git add src/components/scorecard/RoundSummary.js src/components/scorecard/styles.js src/screens/ScorecardScreen.js
git commit -m "feat(scorecard): add unified RoundSummary, replace four mode panels in HoleView"
```

---

## Task 10: Create `PlayerCard.js` (unified card + glow halo)

**Files:**
- Create: `src/components/scorecard/PlayerCard.js`
- Modify: `src/components/scorecard/styles.js`
- Modify: `src/screens/ScorecardScreen.js` (the inline `HolePage` card rendering)

This deletes the Best Ball layout fork: every mode uses the hero card.

- [ ] **Step 1: Create `PlayerCard`**

Extract the hero-card JSX from the inline `HolePage` (`ScorecardScreen.js` ~1483-1631, the `useHeroCards` branch) into `PlayerCard.js`. **Props:**

```
{
  player, hole, strokes, points,            // points from scoreModel.holePoints
  handicap, extraShots, pickup, isPickup,
  team,                                     // { index, label } | null  (from teamModel)
  isMe, canEdit, showRunning, totals,       // totals from scoreModel.roundTotals
  getScoreAnim,
  onStep, onSetScore,
  // me-only shot detail:
  shotDetail, onSetShot, shotCollapsed, onToggleShotDetail,
  // official mode:
  official, officialState, canResolveHere, onOpenDiscrepancy,
}
```

Render: header (avatar in team color or `theme.accent.primary`; name + tee badge; HCP line; **team chip** showing `team.label` when `team` is set; pickup button when `canEdit`), the score stepper row, the points badge, the running-stats row (when `showRunning`), and — when `isMe` — `<ShotDetailSection collapsed={shotCollapsed} onToggle={onToggleShotDetail} .../>`.

**Halo:** when `team` is set, apply a 1.5px border + glow in the team color. Implement the halo as an inline style merged onto the card container:

```js
const haloColor = team ? teamColor(theme, team.index) : null;
const haloStyle = haloColor ? {
  borderWidth: 1.5,
  borderColor: haloColor,
  shadowColor: haloColor,
  shadowOpacity: 0.45,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 5 },
  elevation: 6,
} : null;
// <View style={[s.heroCard, haloStyle]}>
```

Keep the official badges (agreed/waiting/discrepancy), the read-only state (no steppers/pickup when `!canEdit`), and the discrepancy-tap behavior exactly as in the current hero-card branch. Wrap the component in `React.memo`.

- [ ] **Step 2: Add `heroCard` base style**

Ensure `styles.js` has a `heroCard` style (rename/reuse the existing `soloHeroCard`). Keep the existing hero sub-styles (`soloHeroHeader`, `soloScoreRow`, etc.).

- [ ] **Step 3: Rewire the inline `HolePage`**

In `ScorecardScreen.js`'s inline `HolePage`, delete the `useHeroCards` branch entirely (both the hero branch and the compact `playerCard` branch ~1635-1722). Map every player to `<PlayerCard .../>`, computing `points` via `holePoints(...)` from `scoreModel`, `team` via `teamsByPlayer(round)[player.id] ?? null`, and `totals` via `roundTotals(...)`. Add imports for `PlayerCard`, `holePoints`, `roundTotals`, `teamsByPlayer`.

- [ ] **Step 4: Verify**

Run: `npm test` — Expected: PASS. Run: `npm run lint` — Expected: clean.
Manual (`npm run web`): open Best Ball, Match Play, Stableford and solo rounds — every mode shows the same hero card; Match Play and Best Ball show the glow halo in team colors; solo / individual Stableford show no halo.

- [ ] **Step 5: Commit**

```bash
git add src/components/scorecard/PlayerCard.js src/components/scorecard/styles.js src/screens/ScorecardScreen.js
git commit -m "feat(scorecard): unified PlayerCard with team glow halo, remove Best Ball card fork"
```

---

## Task 11: Extract `HolePage.js`

**Files:**
- Create: `src/components/scorecard/HolePage.js`
- Modify: `src/screens/ScorecardScreen.js`

- [ ] **Step 1: Move `HolePage` and `MePicker`**

Move the (now-simplified) inline `HolePage` and `MePicker` into `HolePage.js`. Export both. `HolePage` renders the hole header + the scrollable `PlayerCard` stack. Add the imports it needs (`PlayerCard`, `scoreModel`, `teamModel`, `playersMeFirst`/`pairsMeFirst` from `src/lib/playerOrder`, `useTheme`, `makeScorecardStyles`). Keep `HolePage` wrapped in `React.memo`.

- [ ] **Step 2: Rewire `ScorecardScreen.js`**

Delete the inline `HolePage`/`MePicker`. Add `import { HolePage, MePicker } from '../components/scorecard/HolePage';`.

- [ ] **Step 3: Verify**

Run: `npm test` — Expected: PASS. Run: `npm run lint` — Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/scorecard/HolePage.js src/screens/ScorecardScreen.js
git commit -m "refactor(scorecard): extract HolePage and MePicker"
```

---

## Task 12: Extract `HoleView.js` + own the shot-detail collapse state

**Files:**
- Create: `src/components/scorecard/HoleView.js`
- Modify: `src/screens/ScorecardScreen.js`
- Modify: `src/lib/prefs.js` (add a collapse-state pref)

- [ ] **Step 1: Add the pref**

In `src/lib/prefs.js`, following the existing `getShowRunningScore`/`setShowRunningScore` pattern, add `getShotDetailCollapsed()` / `setShotDetailCollapsed(value)` backed by the same storage (default `false` — expanded).

- [ ] **Step 2: Move `HoleView` and own the collapse state**

Move the inline `HoleView` and `CelebrationOverlay` into `HoleView.js`. Inside `HoleView`, add:

```js
const [shotCollapsed, setShotCollapsed] = useState(false);
useEffect(() => {
  let cancelled = false;
  getShotDetailCollapsed().then((v) => { if (!cancelled) setShotCollapsed(v); }).catch(() => {});
  return () => { cancelled = true; };
}, []);
const toggleShotDetail = useCallback(() => {
  setShotCollapsed((v) => { const next = !v; setShotDetailCollapsed(next).catch(() => {}); return next; });
}, []);
```

Pass `shotCollapsed` and `toggleShotDetail` down through `HolePage` to the "me" `PlayerCard`. Add the `shotCollapsed`/`onToggleShotDetail` props to `HolePage`'s signature and forward them.

- [ ] **Step 3: Rewire `ScorecardScreen.js`**

Delete the inline `HoleView`/`CelebrationOverlay`. Add `import { HoleView } from '../components/scorecard/HoleView';`.

- [ ] **Step 4: Verify**

Run: `npm test` — Expected: PASS. Run: `npm run lint` — Expected: clean.
Manual: collapse shot detail on one hole, swipe to the next hole — it stays collapsed; reopen the round later — the choice is remembered.

- [ ] **Step 5: Commit**

```bash
git add src/components/scorecard/HoleView.js src/screens/ScorecardScreen.js src/lib/prefs.js
git commit -m "refactor(scorecard): extract HoleView, persist shot-detail collapse state"
```

---

## Task 13: Extract and unify `GridView.js`

**Files:**
- Create: `src/components/scorecard/GridView.js`
- Modify: `src/screens/ScorecardScreen.js`

- [ ] **Step 1: Move the grid components**

Move `GridView`, `ScorecardTable`, `NineBlock`, `LiveMatchStrip`, `getSoloColumns`, `shortPlayerLabel`, `pairLabel`, `holeTeamPts`, `roundTeamPts` into `GridView.js`. Export `GridView`.

- [ ] **Step 2: Delete the classic Best Ball grid fork**

In the moved `GridView`, remove the `useClassicGrid` branch entirely (`ScorecardScreen.js` ~3049, ~3088-3259) — the whole horizontally-scrolling classic table. Every mode now renders `<ScorecardTable .../>`. Keep `<LiveMatchStrip .../>` for Best Ball below the table. `ScorecardTable` already supports a pair-combined column when `round.pairs.length === 2` — verify it renders for Best Ball and Match Play; if it currently keys off mode, switch it to key off `hasTeams(round)` from `teamModel`.

- [ ] **Step 3: Route grid scoring through `scoreModel`**

In `NineBlock`/`ScorecardTable`, replace the inline `if (mode === 'matchplay') ... else if (sindicato) ... else stableford` point calculations with `holePoints(...)` / `roundTotals(...)` from `scoreModel`. The grid keeps its own column-layout logic.

- [ ] **Step 4: Rewire `ScorecardScreen.js`**

Delete the moved functions. Add `import { GridView } from '../components/scorecard/GridView';`.

- [ ] **Step 5: Verify**

Run: `npm test` — Expected: PASS. Run: `npm run lint` — Expected: clean.
Manual: toggle to the grid view in Best Ball (4 players), Match Play, Stableford and solo — all use the same front/back-nine layout; Best Ball shows the pair-combined column and the live match strip.

- [ ] **Step 6: Commit**

```bash
git add src/components/scorecard/GridView.js src/screens/ScorecardScreen.js
git commit -m "refactor(scorecard): extract GridView, remove classic Best Ball grid fork"
```

---

## Task 14: Cleanup, dead-code removal, and final verification

**Files:**
- Modify: `src/screens/ScorecardScreen.js`
- Modify: `src/components/scorecard/styles.js`

- [ ] **Step 1: Delete dead code**

From `ScorecardScreen.js` delete every now-unused inline component and helper: `MatchPanel`, `SindicatoPanel`, `SoloTotalsRibbon`, `StablefordWinnerBanner`, `WinnerBadge`, and any helper no longer referenced. Remove now-unused imports and any `eslint-disable` comments added in Task 9.

- [ ] **Step 2: Delete dead styles**

From `styles.js` remove style keys no longer referenced anywhere — notably the compact `playerCard` family and the classic-grid keys (`gridContent`, `gridHeaderRow`, `headerRow`, `holeRow`, `altRow`, `pairCombinedCell`, `pairInline*`, etc., if unused). Verify with a grep for each removed key across `src/`.

- [ ] **Step 3: Full verification**

Run: `npm test` — Expected: PASS (~422+ tests, including the new scoreModel/teamModel/mergeScores tests).
Run: `npm run lint` — Expected: clean.
Run: `npm run build:web` — Expected: success.
Manual smoke test (`npm run web`), for each of solo / Stableford / Match Play / Best Ball / Sindicato:
  - The header, hole header, player cards and grid are visually identical across modes; only the summary differs.
  - The glow halo appears in Match Play / Best Ball, not in solo / individual Stableford / Sindicato.
  - Switching scoring mode mid-round does not make the layout jump.
  - Rapid `+`/`-` taps land on the exact value with no bouncing (spec §6).
  - An official-mode round still loads, shows discrepancy badges, and the read-only cards have no steppers.

- [ ] **Step 4: Commit**

```bash
git add src/screens/ScorecardScreen.js src/components/scorecard/styles.js
git commit -m "refactor(scorecard): remove dead mode-panel and classic-grid code"
```

---

## Self-Review (completed)

- **Spec coverage:** §3 module → Tasks 1,6 + every component task; §4.1 PlayerCard/halo → Task 10; §4.2 ShotDetailSection/buckets → Tasks 7,8; §4.3 GridView → Task 13; §4.4 RoundSummary → Tasks 3,9; §5 scoreModel → Tasks 2,3; §6 input reliability → Task 5; §7 polish (memo, stable mode switch) → Tasks 10,11,13; §8 testing → Tasks 2,3,4,5,14. Official mode (§4.1, §9) preserved in Task 10 and verified in Task 14.
- **Placeholder scan:** none — every code step has concrete code or an exact move instruction.
- **Type consistency:** `holePoints`/`roundTotals`/`summaryState`/`mergeScores`/`teamsByPlayer`/`teamColor`/`hasTeams` signatures are defined once (Tasks 2-5) and consumed with the same shapes in Tasks 9-13. `ShotDetailSection` controlled props (`collapsed`,`onToggle`) match `HoleView`'s `shotCollapsed`/`toggleShotDetail` (Task 12).
