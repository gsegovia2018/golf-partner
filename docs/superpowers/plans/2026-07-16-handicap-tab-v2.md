# Handicap Tab v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an index-evolution chart, per-round include/exclude toggles (persisted), and eligibility-transparency rows to the Handicap tab.

**Architecture:** All math stays in the pure `src/store/handicapIndex.js` (new: `roundEligibility`, `handicapIndexSeries`, exclusion support in `computeHandicapIndex`, shared `indexFromDifferentials` helper). `HandicapTab` renders the chart via the existing `TrendLineChart` and grows three row states; `MyStatsScreen` owns exclusion persistence exactly the way it owns the round-selection overrides.

**Tech Stack:** React Native (Expo 54), Jest via jest-expo, @testing-library/react-native, AsyncStorage.

**Spec:** `docs/superpowers/specs/2026-07-16-handicap-tab-v2-design.md`

## Global Constraints

- Domain logic in `src/store/`, UI in components/screens (CLAUDE.md).
- TDD per task; `npx jest src` + `npm run lint` green before every commit.
- Ignore jest failures from `.claude/worktrees/` / `.worktrees/` paths (stale copies).
- Exclusions are removed from the eligible list BEFORE the last-20 windowing.
- Exclusion storage: `@handicap_round_exclusions:<userId>` with `local` fallback + sign-in migration, no pruning — the exact scheme `@mystats_round_selection` uses.
- Exclusions never affect any other stats tab or the "rounds counted" selector.
- One interface refinement vs the spec (documented here, intentional): `handicapIndexSeries` returns `{ key, value, date, courseName }` per point — no `label`; the component builds the label with its existing `fmtDate`, keeping locale formatting out of the store.

## Current state (all shipped @ 0a51976 + 4341ea7)

- `src/store/handicapIndex.js` exports `roundDifferential(myRound)`, `computeHandicapIndex(myRounds)`, `MIN_DIFFERENTIALS = 3`, `MAX_INDEX = 54`; internal `whsCounting(n)` and `round1(n)`.
- `src/components/mystats/tabs/HandicapTab.js` props: `{ myRounds, profileHandicap, onInfo, onApplied }`; hero card + differentials list; helpers `fmtDate(iso)` and `fmt1(n)`.
- `src/components/mystats/__tests__/HandicapTab.test.js` has helpers `holes` (18 par-4s, SI = number) and `myRound(key, diff)` (complete round with differential = diff, slope 113, rating 72, playing handicap 54) and `renderTab(props)` which spreads overrides; mocks `profileStore` only.
- `src/store/__tests__/handicapIndex.test.js` has helpers `holes`, `makeMyRound({...})`, and `makeRounds(diffs)` (N complete rounds with exact differentials, keys `t:0…t:N-1`).
- `src/screens/MyStatsScreen.js` owns the round-selection persistence (`SELECTION_PREFIX`, `storageKey` ~line 97, load/migrate block ~127-141, `persistOverrides` ~185) and renders `<HandicapTab myRounds={myRounds} profileHandicap={profileHandicap} gender={profileGender} onInfo={onInfo} onApplied={setProfileHandicap} />` — `gender` is a leftover prop the component no longer declares; Task 5 removes it.
- `src/components/mystats/TrendLineChart.js`: props `{ series: [{label, value}], color, formatValue, caption, variant, dropGaps }`.

---

### Task 1: Eligibility reasons + exclusions in the store

**Files:**
- Modify: `src/store/handicapIndex.js`
- Test: `src/store/__tests__/handicapIndex.test.js` (append)

**Interfaces:**
- Consumes: existing `roundDifferential`, `whsCounting`, `round1`, `MIN_DIFFERENTIALS`, `MAX_INDEX`.
- Produces:
  - `roundEligibility(myRound)` → `{ eligible: true } | { eligible: false, reason: 'partial' | 'nine-holes' | 'no-rating' }`
  - `computeHandicapIndex(myRounds, { excludedKeys } = {})` — `excludedKeys` is a `Set<string>` of MyRound keys; result gains `excluded` (differentials of excluded eligible rounds, chronological), `ineligible` (`[{ key, courseName, date, reason, holesPlayed }]`, chronological), `excludedCount`. `eligibleCount` still counts ALL eligible rounds (included + excluded); `windowCount`/`differentials` reflect included rounds only.
  - Internal `indexFromDifferentials(diffs)` → `{ index, usedCount, windowCount, countingKeys, window }` (not exported; Task 2 reuses it).

- [ ] **Step 1: Write the failing tests**

Append to `src/store/__tests__/handicapIndex.test.js`. Update the import line to:

```js
import { roundDifferential, computeHandicapIndex, roundEligibility } from '../handicapIndex';
```

Then append:

```js
describe('roundEligibility', () => {
  it('flags partial rounds', () => {
    const r = makeMyRound();
    r.isComplete = false;
    r.holesPlayed = 14;
    expect(roundEligibility(r)).toEqual({ eligible: false, reason: 'partial' });
  });

  it('flags non-18-hole rounds', () => {
    const r = makeMyRound();
    r.round = { ...r.round, holes: holes.slice(0, 9) };
    expect(roundEligibility(r)).toEqual({ eligible: false, reason: 'nine-holes' });
  });

  it('flags missing slope/rating', () => {
    expect(roundEligibility(makeMyRound({ slope: null, rating: 72 })))
      .toEqual({ eligible: false, reason: 'no-rating' });
    expect(roundEligibility(makeMyRound({ slope: 113, rating: null })))
      .toEqual({ eligible: false, reason: 'no-rating' });
  });

  it('accepts a qualifying round', () => {
    expect(roundEligibility(makeMyRound())).toEqual({ eligible: true });
  });
});

describe('computeHandicapIndex with exclusions', () => {
  it('excluding a windowed round pulls the 21st back into the window', () => {
    // 21 rounds, diffs 1..21. Without exclusions: window 2..21, best 8 = 2..9 → 5.5.
    // Excluding diff 2 (key t:1): included = 20 diffs [1,3..21] → window = all,
    // best 8 = 1,3,4,5,6,7,8,9 → 43/8 = 5.375 → 5.4.
    const rounds = makeRounds(Array.from({ length: 21 }, (_, i) => i + 1));
    const res = computeHandicapIndex(rounds, { excludedKeys: new Set(['t:1']) });
    expect(res.index).toBe(5.4);
    expect(res.windowCount).toBe(20);
    expect(res.excludedCount).toBe(1);
    expect(res.excluded).toHaveLength(1);
    expect(res.excluded[0]).toMatchObject({ key: 't:1', differential: 2 });
    expect(res.eligibleCount).toBe(21); // includes the excluded one
    expect(res.differentials.some((d) => d.key === 't:1')).toBe(false);
  });

  it('drops below the minimum when exclusions leave fewer than 3 rounds', () => {
    const rounds = makeRounds([10, 12, 14]);
    const res = computeHandicapIndex(rounds, { excludedKeys: new Set(['t:0']) });
    expect(res.index).toBeNull();
    expect(res.windowCount).toBe(2);
    expect(res.excluded).toHaveLength(1);
  });

  it('reports ineligible rounds with reasons', () => {
    const rounds = makeRounds([10, 12, 14]);
    const partial = makeMyRound();
    partial.key = 'p:0';
    partial.isComplete = false;
    partial.holesPlayed = 14;
    const res = computeHandicapIndex([...rounds, partial]);
    expect(res.ineligible).toHaveLength(1);
    expect(res.ineligible[0]).toMatchObject({ key: 'p:0', reason: 'partial', holesPlayed: 14 });
    expect(res.totalCount).toBe(4);
    expect(res.eligibleCount).toBe(3);
  });

  it('an excluded ineligible round appears only in ineligible', () => {
    const partial = makeMyRound();
    partial.key = 'p:0';
    partial.isComplete = false;
    const res = computeHandicapIndex([partial], { excludedKeys: new Set(['p:0']) });
    expect(res.ineligible).toHaveLength(1);
    expect(res.excluded).toHaveLength(0);
    expect(res.excludedCount).toBe(0);
  });

  it('no second argument behaves as before with empty new fields', () => {
    const res = computeHandicapIndex(makeRounds([10, 14, 12]));
    expect(res.index).toBe(8);
    expect(res.excluded).toEqual([]);
    expect(res.ineligible).toEqual([]);
    expect(res.excludedCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx jest src/store/__tests__/handicapIndex.test.js`
Expected: new tests FAIL (`roundEligibility` not exported; `excluded`/`ineligible` undefined). All pre-existing tests PASS.

- [ ] **Step 3: Implement**

In `src/store/handicapIndex.js`:

Add after `roundDifferential`:

```js
// Why a round doesn't qualify for a differential. Check order matters: an
// unfinished short round reads as 'partial' (the actionable problem), only a
// finished non-18-hole round reads as 'nine-holes'.
export function roundEligibility(myRound) {
  if (!myRound?.isComplete) return { eligible: false, reason: 'partial' };
  const holes = myRound.round?.holes ?? [];
  if (holes.length !== 18) return { eligible: false, reason: 'nine-holes' };
  const { slope, rating } = resolveRoundTee(myRound.round, myRound.playerId);
  const sv = parseInt(slope, 10) || 0;
  const cr = parseFloat(rating);
  if (sv <= 0 || !Number.isFinite(cr)) return { eligible: false, reason: 'no-rating' };
  return { eligible: true };
}
```

Add above `computeHandicapIndex`:

```js
// Window + WHS table over an already-filtered chronological differential
// list. Shared by computeHandicapIndex and handicapIndexSeries.
function indexFromDifferentials(diffs) {
  const window = diffs.slice(-20);
  if (window.length < MIN_DIFFERENTIALS) {
    return { index: null, usedCount: 0, windowCount: window.length, countingKeys: new Set(), window };
  }
  const { use, adj } = whsCounting(window.length);
  const sorted = [...window].sort((a, b) => a.differential - b.differential);
  const countingKeys = new Set(sorted.slice(0, use).map((d) => d.key));
  const avg = sorted.slice(0, use).reduce((s, d) => s + d.differential, 0) / use;
  return {
    index: Math.min(MAX_INDEX, round1(avg + adj)),
    usedCount: use,
    windowCount: window.length,
    countingKeys,
    window,
  };
}
```

Replace `computeHandicapIndex` with:

```js
// Handicap Index from ALL of the user's rounds (chronological). Uses the
// last 20 eligible differentials — deliberately independent of the My Stats
// round selector, because WHS always uses the most recent scores.
// `excludedKeys` (Set of MyRound keys) removes rounds BEFORE windowing, as
// if they were never played; excluded eligible rounds are returned in
// `excluded` so the UI can offer re-inclusion, and non-qualifying rounds in
// `ineligible` with the reason.
export function computeHandicapIndex(myRounds, { excludedKeys } = {}) {
  const rounds = myRounds ?? [];
  const included = [];
  const excluded = [];
  const ineligible = [];
  rounds.forEach((r) => {
    const d = roundDifferential(r);
    if (!d) {
      const { reason } = roundEligibility(r);
      ineligible.push({
        key: r?.key,
        courseName: r?.courseName,
        date: r?.tournamentDate ?? null,
        reason,
        holesPlayed: r?.holesPlayed ?? 0,
      });
      return;
    }
    if (excludedKeys?.has(d.key)) excluded.push(d);
    else included.push(d);
  });
  const { index, usedCount, windowCount, countingKeys, window } = indexFromDifferentials(included);
  return {
    index,
    usedCount,
    windowCount,
    eligibleCount: included.length + excluded.length,
    totalCount: rounds.length,
    excludedCount: excluded.length,
    differentials: window.map((d) => ({ ...d, counting: countingKeys.has(d.key) })),
    excluded,
    ineligible,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/store/__tests__/handicapIndex.test.js`
Expected: PASS (all v1 tests — including `computeHandicapIndex(null)` and the small-sample-table tests — plus the new ones). If any v1 test broke, the refactor changed behavior: stop and fix before proceeding.

- [ ] **Step 5: Full suite, lint, commit**

Run: `npx jest src && npm run lint` — expected green / 0 errors.

```bash
git add src/store/handicapIndex.js src/store/__tests__/handicapIndex.test.js
git commit -m "feat(handicap): eligibility reasons and round exclusions in index math"
```

---

### Task 2: `handicapIndexSeries` — evolution of the index

**Files:**
- Modify: `src/store/handicapIndex.js`
- Test: `src/store/__tests__/handicapIndex.test.js` (append)

**Interfaces:**
- Consumes: `roundDifferential`, internal `indexFromDifferentials` (Task 1).
- Produces: `handicapIndexSeries(myRounds, { excludedKeys } = {})` → `[{ key, value, date, courseName }]`, chronological, one point per included eligible round from the 3rd onward; `value` is the index (1 decimal) as of that round; never null. Task 3 maps this to TrendLineChart's `{label, value}`.

- [ ] **Step 1: Write the failing tests**

Update the test file's import line to:

```js
import {
  roundDifferential, computeHandicapIndex, roundEligibility, handicapIndexSeries,
} from '../handicapIndex';
```

Append:

```js
describe('handicapIndexSeries', () => {
  it('starts at the 3rd qualifying round and applies small-sample adjustments', () => {
    // diffs [10, 14, 12, 16, 18]:
    //   after 3 rounds: lowest (10) − 2 = 8
    //   after 4 rounds: lowest (10) − 1 = 9
    //   after 5 rounds: lowest (10)     = 10
    const series = handicapIndexSeries(makeRounds([10, 14, 12, 16, 18]));
    expect(series.map((p) => p.value)).toEqual([8, 9, 10]);
    expect(series.map((p) => p.key)).toEqual(['t:2', 't:3', 't:4']);
    expect(series[0]).toHaveProperty('date');
    expect(series[0]).toHaveProperty('courseName');
  });

  it('reflects exclusions', () => {
    // Excluding t:0 (diff 10): included [14, 12, 16, 18] →
    //   after 3: lowest (12) − 2 = 10; after 4: 12 − 1 = 11.
    const series = handicapIndexSeries(makeRounds([10, 14, 12, 16, 18]), {
      excludedKeys: new Set(['t:0']),
    });
    expect(series.map((p) => p.value)).toEqual([10, 11]);
  });

  it('windows to the last 20 within the walk', () => {
    // 21 rounds diffs 1..21. Final point must equal computeHandicapIndex's
    // index for the same rounds: 5.5.
    const rounds = makeRounds(Array.from({ length: 21 }, (_, i) => i + 1));
    const series = handicapIndexSeries(rounds);
    expect(series).toHaveLength(19); // points from the 3rd round onward
    expect(series[series.length - 1].value).toBe(computeHandicapIndex(rounds).index);
  });

  it('returns an empty array below 3 eligible rounds', () => {
    expect(handicapIndexSeries(makeRounds([10, 12]))).toEqual([]);
    expect(handicapIndexSeries([])).toEqual([]);
    expect(handicapIndexSeries(null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx jest src/store/__tests__/handicapIndex.test.js`
Expected: FAIL — `handicapIndexSeries` is not exported. Everything else PASS.

- [ ] **Step 3: Implement**

Append to `src/store/handicapIndex.js`:

```js
// Evolution of the index over the full history: one point per included
// eligible round from the 3rd onward, each valued at the index as it stood
// after that round (the walk re-windows to the last 20 at every step, so
// old differentials age out exactly as they did in reality).
export function handicapIndexSeries(myRounds, { excludedKeys } = {}) {
  const included = (myRounds ?? [])
    .map(roundDifferential)
    .filter(Boolean)
    .filter((d) => !excludedKeys?.has(d.key));
  const points = [];
  for (let i = MIN_DIFFERENTIALS - 1; i < included.length; i += 1) {
    const { index } = indexFromDifferentials(included.slice(0, i + 1));
    points.push({
      key: included[i].key,
      value: index,
      date: included[i].date,
      courseName: included[i].courseName,
    });
  }
  return points;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/store/__tests__/handicapIndex.test.js`
Expected: PASS.

- [ ] **Step 5: Full suite, lint, commit**

Run: `npx jest src && npm run lint` — expected green / 0 errors.

```bash
git add src/store/handicapIndex.js src/store/__tests__/handicapIndex.test.js
git commit -m "feat(handicap): index evolution series"
```

---

### Task 3: Evolution chart card in `HandicapTab`

**Files:**
- Modify: `src/components/mystats/tabs/HandicapTab.js`
- Test: `src/components/mystats/__tests__/HandicapTab.test.js` (append)

**Interfaces:**
- Consumes: `handicapIndexSeries` (Task 2); existing `TrendLineChart` (`src/components/mystats/TrendLineChart.js`, props `{ series: [{label, value}], color, formatValue, caption }`).
- Produces: an "Index evolution" `SectionCard` between the hero and the differentials list, rendered only when the series has ≥ 2 points. New props `excludedKeys` and `onToggleExcluded` added to the signature (threaded to the series here; Task 4 uses them for the toggles) — both default to `undefined` so existing tests/usages need no change.

- [ ] **Step 1: Write the failing tests**

Append to `src/components/mystats/__tests__/HandicapTab.test.js`:

```js
describe('index evolution chart', () => {
  it('renders the evolution card once there are 2+ points (4+ rounds)', async () => {
    const { findByText } = renderTab({
      myRounds: [myRound('a', 10), myRound('b', 14), myRound('c', 12), myRound('d', 16)],
    });
    expect(await findByText('Index evolution')).toBeTruthy();
    expect(await findByText(/After each qualifying round/)).toBeTruthy();
  });

  it('is absent with only one point (3 rounds)', async () => {
    const { findByText, queryByText } = renderTab();
    await findByText('8.0'); // wait for the hero so the tab is fully rendered
    expect(queryByText('Index evolution')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx jest src/components/mystats/__tests__/HandicapTab.test.js`
Expected: the two new tests FAIL ("Index evolution" not rendered); the 4 existing tests PASS.

- [ ] **Step 3: Implement**

In `src/components/mystats/tabs/HandicapTab.js`:

1. Imports:
   ```js
   import TrendLineChart from '../TrendLineChart';
   import { computeHandicapIndex, handicapIndexSeries, MIN_DIFFERENTIALS } from '../../../store/handicapIndex';
   ```
2. Signature (new props, used further in Task 4):
   ```js
   export default function HandicapTab({
     myRounds, profileHandicap, onInfo, onApplied, excludedKeys, onToggleExcluded,
   }) {
   ```
3. Wire the result and series to exclusions:
   ```js
   const result = useMemo(
     () => computeHandicapIndex(myRounds, { excludedKeys }),
     [myRounds, excludedKeys],
   );
   const series = useMemo(
     () => handicapIndexSeries(myRounds, { excludedKeys }),
     [myRounds, excludedKeys],
   );
   const chartSeries = useMemo(
     () => series.map((p) => ({ label: fmtDate(p.date), value: p.value })),
     [series],
   );
   ```
4. Build the card once, render it between the hero card and the differentials card in the main branch:
   ```js
   const evolutionCard = chartSeries.length >= 2 ? (
     <SectionCard title="Index evolution" infoKey="handicapIndex" onInfo={onInfo}>
       <TrendLineChart
         series={chartSeries}
         color={theme.accent.primary}
         formatValue={fmt1}
         caption="After each qualifying round · oldest → newest"
       />
     </SectionCard>
   ) : null;
   ```
   (The empty-state branch needs no chart: below 3 included rounds the series is empty.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/components/mystats/__tests__/HandicapTab.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Full suite, lint, commit**

Run: `npx jest src && npm run lint` — expected green / 0 errors.

```bash
git add src/components/mystats/tabs/HandicapTab.js src/components/mystats/__tests__/HandicapTab.test.js
git commit -m "feat(handicap): index evolution chart"
```

---

### Task 4: Editable differentials list — include/exclude + ineligible rows

**Files:**
- Modify: `src/components/mystats/tabs/HandicapTab.js`
- Modify: `src/components/mystats/statExplainers.js` (append to the `handicapIndex` entry's `explainer` string)
- Test: `src/components/mystats/__tests__/HandicapTab.test.js` (append)

**Interfaces:**
- Consumes: `result.differentials` / `result.excluded` / `result.ineligible` / `result.excludedCount` (Task 1); props `excludedKeys`, `onToggleExcluded` (Task 3 signature).
- Produces: three row states in the "Score differentials" card; `onToggleExcluded(key)` fired by both toggle buttons (accessibility labels "Exclude round from handicap" / "Include round in handicap"); hero subtitle gains "· N excluded"; the list card renders in the empty-state branch too whenever it has rows.

- [ ] **Step 1: Write the failing tests**

Append to `src/components/mystats/__tests__/HandicapTab.test.js`. First add a partial-round helper next to `myRound`:

```js
// A round with only `played` of 18 holes scored — ineligible ('partial').
function partialRound(key, played) {
  const r = myRound(key, 10);
  r.isComplete = false;
  r.holesPlayed = played;
  r.round = {
    ...r.round,
    scores: { p1: Object.fromEntries(holes.slice(0, played).map((h) => [h.number, 5])) },
  };
  return r;
}
```

Then:

```js
describe('round exclusion toggles', () => {
  it('fires onToggleExcluded with the round key', async () => {
    const onToggleExcluded = jest.fn();
    const { findAllByLabelText } = renderTab({ onToggleExcluded });
    const buttons = await findAllByLabelText('Exclude round from handicap');
    fireEvent.press(buttons[0]);
    expect(onToggleExcluded).toHaveBeenCalledWith(expect.stringMatching(/^(a|b|c)$/));
  });

  it('renders excluded rounds greyed with an include button and updates the hero', async () => {
    const { findByText, findAllByLabelText } = renderTab({
      myRounds: [myRound('a', 10), myRound('b', 14), myRound('c', 12), myRound('d', 16)],
      excludedKeys: new Set(['b']),
      onToggleExcluded: jest.fn(),
    });
    expect(await findByText('Excluded')).toBeTruthy();
    expect(await findAllByLabelText('Include round in handicap')).toHaveLength(1);
    expect(await findByText(/1 excluded/)).toBeTruthy();
  });

  it('shows ineligible rounds with the reason and no toggle', async () => {
    const { findByText, queryAllByLabelText } = renderTab({
      myRounds: [myRound('a', 10), myRound('b', 14), myRound('c', 12), partialRound('p', 14)],
      onToggleExcluded: jest.fn(),
    });
    expect(await findByText(/partial · 14 holes/)).toBeTruthy();
    // 3 included rows have exclude buttons; the partial row has none.
    expect(queryAllByLabelText('Exclude round from handicap')).toHaveLength(3);
  });

  it('keeps excluded rows reachable when exclusions drop the index below 3 rounds', async () => {
    const { findByText, findAllByLabelText } = renderTab({
      excludedKeys: new Set(['a']),
      onToggleExcluded: jest.fn(),
    });
    expect(await findByText(/Not enough qualifying rounds yet/)).toBeTruthy();
    expect(await findByText('Excluded')).toBeTruthy();
    expect(await findAllByLabelText('Include round in handicap')).toHaveLength(1);
  });
});
```

Note: the first test relies on `renderTab`'s default `myRounds` (keys a/b/c) — it needs `onToggleExcluded` passed so the buttons render; verify `renderTab` spreads overrides last (it does).

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx jest src/components/mystats/__tests__/HandicapTab.test.js`
Expected: all four new tests FAIL (no such accessibility labels/texts). Existing tests PASS.

- [ ] **Step 3: Implement**

In `src/components/mystats/tabs/HandicapTab.js`:

1. Add: `import { Feather } from '@expo/vector-icons';`
2. Reason label helper next to `fmtDate`:
   ```js
   const reasonLabel = (row) => (
     row.reason === 'partial' ? `partial · ${row.holesPlayed} holes`
       : row.reason === 'nine-holes' ? '9-hole round'
         : 'no slope/rating'
   );
   ```
3. Merged row model (after `result`):
   ```js
   // Newest-first merged list: the included last-20 window, every excluded
   // round (so it can be re-added), and every ineligible round (so the
   // eligible/total counts are self-explanatory).
   const rows = useMemo(() => {
     const merged = [
       ...result.differentials.map((d) => ({ ...d, type: 'included' })),
       ...result.excluded.map((d) => ({ ...d, type: 'excluded' })),
       ...result.ineligible.map((d) => ({ ...d, type: 'ineligible' })),
     ];
     return merged.sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
   }, [result]);
   ```
4. Build the list card once as `listCard`, replacing the old differentials `SectionCard`:
   ```js
   const listCard = rows.length > 0 ? (
     <SectionCard title="Score differentials" infoKey="handicapIndex" onInfo={onInfo}>
       <Text style={s.caption}>Newest first · grey rounds don't count</Text>
       {rows.map((d) => (
         <View key={d.key} style={[s.row, d.type === 'included' && d.counting && s.rowCounting]}>
           <View style={s.rowMain}>
             <Text
               style={[s.rowTitle, d.type !== 'included' && s.rowTitleMuted]}
               numberOfLines={1}
             >
               {d.courseName}
             </Text>
             <Text style={s.rowSub}>
               {d.type === 'ineligible'
                 ? fmtDate(d.date)
                 : `${fmtDate(d.date)} · adjusted gross ${d.ags}`}
             </Text>
           </View>
           {d.type === 'ineligible' ? (
             <Text style={s.tag}>{reasonLabel(d)}</Text>
           ) : (
             <>
               {d.type === 'excluded' && <Text style={s.tag}>Excluded</Text>}
               <Text style={[
                 s.rowValue,
                 d.type === 'included' && d.counting && s.rowValueCounting,
                 d.type === 'excluded' && s.rowValueMuted,
               ]}
               >
                 {fmt1(d.differential)}
               </Text>
               {onToggleExcluded && (
                 <TouchableOpacity
                   onPress={() => onToggleExcluded(d.key)}
                   accessibilityRole="button"
                   accessibilityLabel={d.type === 'excluded'
                     ? 'Include round in handicap'
                     : 'Exclude round from handicap'}
                   hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                 >
                   <Feather
                     name={d.type === 'excluded' ? 'plus-circle' : 'minus-circle'}
                     size={18}
                     color={d.type === 'excluded' ? theme.accent.primary : theme.text.muted}
                   />
                 </TouchableOpacity>
               )}
             </>
           )}
         </View>
       ))}
     </SectionCard>
   ) : null;
   ```
   Note: the ineligible-row test's `/partial · 14 holes/` assertion is
   satisfied by the right-side tag (`reasonLabel`); `rowSub` stays date-only
   for ineligible rows, as coded above.
5. Empty-state branch: append `{listCard}` inside its `<View style={s.wrap}>`
   after the hero card. Main branch: `{evolutionCard}` then `{listCard}` after
   the hero card.
6. Hero subtitle:
   ```js
   <Text style={s.heroSub}>
     {`Best ${result.usedCount} of last ${result.windowCount} differentials${result.excludedCount > 0 ? ` · ${result.excludedCount} excluded` : ''}`}
   </Text>
   ```
   Also surface exclusions in the empty state: after the existing empty-state
   note, add
   ```js
   {result.excludedCount > 0 && (
     <Text style={s.note}>
       {`${result.excludedCount} excluded round${result.excludedCount === 1 ? ' is' : 's are'} not counted — add them back below.`}
     </Text>
   )}
   ```
7. New styles in `makeStyles`:
   ```js
   rowTitleMuted: { color: theme.text.muted },
   rowValueMuted: { color: theme.text.muted, opacity: 0.7 },
   tag: {
     ...theme.typography.tiny, color: theme.text.muted,
     borderWidth: 1, borderColor: theme.border.default,
     paddingHorizontal: 6, paddingVertical: 2, borderRadius: theme.radius.sm,
     overflow: 'hidden',
   },
   ```
8. In `src/components/mystats/statExplainers.js`, extend the `handicapIndex`
   entry's `explainer` by appending to the string concatenation:
   ```js
     + '\n\nYou can exclude a round from the calculation — it is then treated '
     + 'as never played, and an older round may re-enter the 20-round window. '
     + 'The official WHS index always counts every qualifying round, so an '
     + 'edited calculation is your personal estimate.\n\n'
     + 'Grey rounds do not qualify and show why: partial (not all 18 holes '
     + 'scored), not an 18-hole course, or no slope/course rating on the tee '
     + 'you played. Scramble rounds never appear — they have no individual score.'
   ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/components/mystats/__tests__/HandicapTab.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Full suite, lint, commit**

Run: `npx jest src && npm run lint` — expected green / 0 errors.

```bash
git add src/components/mystats/tabs/HandicapTab.js src/components/mystats/__tests__/HandicapTab.test.js src/components/mystats/statExplainers.js
git commit -m "feat(handicap): editable differentials with exclusions and eligibility reasons"
```

---

### Task 5: Exclusion persistence in `MyStatsScreen`

**Files:**
- Modify: `src/screens/MyStatsScreen.js`
- Test: `src/screens/__tests__/MyStatsScreen.test.js` (append)

**Interfaces:**
- Consumes: `HandicapTab` props `excludedKeys` (Set) + `onToggleExcluded(key)` (Tasks 3–4).
- Produces: exclusions persisted under `@handicap_round_exclusions:<userId|local>` (JSON array of keys), loaded/migrated exactly like the selection overrides; also removes the stale `gender={profileGender}` prop and the now-unused `profileGender` state (the component dropped that prop when the course preview was removed).

- [ ] **Step 1: Write the failing tests**

Append to `src/screens/__tests__/MyStatsScreen.test.js`. Update the existing `HandicapTab` mock so it exposes the new props (match the file's mock style):

```js
jest.mock('../../components/mystats/tabs/HandicapTab', () => function MockHandicapTab({ myRounds, profileHandicap, excludedKeys, onToggleExcluded }) {
  const { Text, TouchableOpacity } = require('react-native');
  return (
    <>
      <Text>{`Handicap tab: ${myRounds.length} rounds, profile ${profileHandicap}`}</Text>
      <Text>{`Excluded count: ${excludedKeys ? excludedKeys.size : 'none'}`}</Text>
      <TouchableOpacity onPress={() => onToggleExcluded('t-1:0')}>
        <Text>Toggle exclusion</Text>
      </TouchableOpacity>
    </>
  );
});
```

Add the tests (reuse the file's render helper, `beforeEach` conventions, and the AsyncStorage mock-store technique the selection-persistence tests already use):

```js
describe('handicap exclusion persistence', () => {
  it('persists a toggled exclusion under the user-scoped key', async () => {
    const view = renderScreen();
    const tabs = await view.findAllByText('Handicap');
    fireEvent.press(tabs[0]);
    fireEvent.press(await view.findByText('Toggle exclusion'));
    await waitFor(async () => {
      const raw = await AsyncStorage.getItem('@handicap_round_exclusions:user-1');
      expect(JSON.parse(raw)).toEqual(['t-1:0']);
    });
  });

  it('restores stored exclusions on load', async () => {
    await AsyncStorage.setItem('@handicap_round_exclusions:user-1', JSON.stringify(['t-1:0']));
    const view = renderScreen();
    const tabs = await view.findAllByText('Handicap');
    fireEvent.press(tabs[0]);
    expect(await view.findByText('Excluded count: 1')).toBeTruthy();
  });
});
```

Adapt seeding/reading to the file's established AsyncStorage test mechanics. The invariants that must hold: toggle → JSON array lands under the exclusions key; seeded array → `excludedKeys.size === 1` reaches the tab.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/screens/__tests__/MyStatsScreen.test.js -t "exclusion"`
Expected: both FAIL — no exclusion key is ever written and `excludedKeys` is undefined.

- [ ] **Step 3: Implement**

In `src/screens/MyStatsScreen.js`:

1. Next to `SELECTION_PREFIX`:
   ```js
   const EXCLUSIONS_PREFIX = '@handicap_round_exclusions:';
   ```
2. Next to `storageKey`:
   ```js
   const exclusionsKey = `${EXCLUSIONS_PREFIX}${user?.id ?? 'local'}`;
   ```
3. State next to `overrides`:
   ```js
   const [handicapExclusions, setHandicapExclusions] = useState(() => new Set());
   ```
4. In the load effect, after the selection-override block (same try/catch style,
   same local-key migration pattern):
   ```js
   let exclusions = new Set();
   try {
     let rawEx = await AsyncStorage.getItem(exclusionsKey);
     if (rawEx == null && user?.id) {
       // First signed-in load on this device: adopt any signed-out exclusions.
       const localExKey = `${EXCLUSIONS_PREFIX}local`;
       const localExRaw = await AsyncStorage.getItem(localExKey);
       if (localExRaw != null) {
         rawEx = localExRaw;
         AsyncStorage.setItem(exclusionsKey, localExRaw).catch(() => {});
         AsyncStorage.removeItem(localExKey).catch(() => {});
       }
     }
     if (rawEx) exclusions = new Set(JSON.parse(rawEx) || []);
   } catch (_) { /* ignore corrupt storage */ }
   ```
   and inside the existing `if (!cancelled)` block add `setHandicapExclusions(exclusions);`.
   Add `exclusionsKey` to the effect's dependency array.
5. Toggle callback next to `persistOverrides` (write-through, same pattern):
   ```js
   const toggleHandicapExclusion = useCallback((key) => {
     setHandicapExclusions((prev) => {
       const next = new Set(prev);
       if (next.has(key)) next.delete(key);
       else next.add(key);
       AsyncStorage.setItem(exclusionsKey, JSON.stringify([...next])).catch(() => {});
       return next;
     });
   }, [exclusionsKey]);
   ```
6. Render:
   ```js
   {tab === 'handicap' && (
     <HandicapTab
       myRounds={myRounds}
       profileHandicap={profileHandicap}
       onInfo={onInfo}
       onApplied={setProfileHandicap}
       excludedKeys={handicapExclusions}
       onToggleExcluded={toggleHandicapExclusion}
     />
   )}
   ```
   — this drops the stale `gender={profileGender}` prop. Then remove the
   `profileGender` state and its two `setProfileGender(...)` call sites (load
   effect + focus listener); nothing else consumes it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/screens/__tests__/MyStatsScreen.test.js`
Expected: PASS — the two new tests plus all pre-existing ones (the existing HandicapTab render test must still pass with the updated mock).

- [ ] **Step 5: Full suite, lint, commit**

Run: `npx jest src && npm run lint` — expected green / 0 errors (removing `profileGender` must not leave unused variables).

```bash
git add src/screens/MyStatsScreen.js src/screens/__tests__/MyStatsScreen.test.js
git commit -m "feat(handicap): persist round exclusions per user"
```

---

### Task 6: Manual runtime verification (web)

**Files:** none (verification only).

- [ ] **Step 1: Verify in the running app**

Use the project's `verify` skill (Expo web + Playwright MCP) to check, on the Handicap tab:
1. The evolution chart appears once the account has 4+ qualifying rounds (or confirm it is absent with fewer, matching the ≥2-points rule).
2. Ineligible rounds are listed greyed with their reason (the QA account's partial round should show "partial · N holes"), and the eligible/total counts now self-explain.
3. Excluding a round updates the index, the hero shows "· 1 excluded", the chart recomputes, and the exclusion survives a full page reload.
4. Re-including restores the previous index.

- [ ] **Step 2: Report**

Summarize what was verified (with a screenshot) in the final work summary.
