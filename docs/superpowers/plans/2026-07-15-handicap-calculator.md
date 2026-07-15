# WHS Handicap Calculator + Selection Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new "Handicap" tab in My Stats that computes the user's WHS Handicap Index from played rounds (with course-handicap preview and apply-to-profile), plus a fix so the My Stats round-selection sheet keeps its selections across app restarts.

**Architecture:** WHS math lives in a new pure store module `src/store/handicapIndex.js` (repo pattern: domain logic in stores, UI in components). The tab component `HandicapTab` mirrors the existing My Stats tab components and is wired into `MyStatsScreen`. The persistence fix changes `MyStatsScreen`'s AsyncStorage load/save of the round-override map.

**Tech Stack:** React Native (Expo 54), Jest via jest-expo, @testing-library/react-native, AsyncStorage.

**Spec:** `docs/superpowers/specs/2026-07-15-handicap-calculator-design.md`

## Global Constraints

- All domain logic in `src/store/`, UI in `src/components/` / `src/screens/` (CLAUDE.md).
- `npm test` (~330 tests) and `npm run lint` must pass after every task.
- If jest picks up tests under `.claude/worktrees/` or `.worktrees/`, those are stale nested-worktree copies — ignore those failures (see project memory) but never break tests under `src/`.
- Handicap index display: one decimal, capped at 54.0; profile writes clamp to ≥ 0 (profile validation rejects negatives).
- Never auto-update the profile handicap — only via the explicit button.

## Existing APIs the tasks rely on (all already in the repo)

- `collectMyRounds(tournaments, userId, displayName)` → `MyRound[]` chronological (oldest→newest), each: `{ key, round, tournamentId, tournamentName, tournamentDate, courseName, roundIndex, playerId, player, completed, isComplete, holesPlayed, points }`. Scramble rounds already excluded. `round.scores[playerId]` maps hole number → gross strokes; `round.holes` is `[{ number, par, strokeIndex }]`. (`src/store/personalStats.js`)
- `getPlayingHandicap(round, player)` → integer playing handicap. (`src/store/scoring.js`)
- `calcExtraShots(playingHandicap, strokeIndex)` → extra shots on a hole (handles plus handicaps). (`src/store/scoring.js`)
- `resolveRoundTee(round, playerId)` → `{ slope, rating }` from the player's tee snapshot, falling back to round-level legacy fields. (`src/store/scoring.js`)
- `calcPlayingHandicap(index, slope, rating, par)` and `totalParFromHoles(holes)` and `STANDARD_SLOPE = 113`. (`src/store/scoring.js`)
- `fetchCourses()` / `getCachedCourses()` → normalized courses `{ id, name, holes: [{number, par, strokeIndex}], tees: [{ id, label, rating, slope, ratingWomen, slopeWomen }] }`. (`src/store/libraryStore.js`)
- `resolveTeeForPlayer(tee, gender)` → `{ label, rating, slope }` picking women's ratings for `gender === 'female'`. (`src/store/tees.js`)
- `loadProfile()` → `{ handicap, targetHandicap, gender, displayName, ... }`; `upsertProfile(fields)` merges. (`src/store/profileStore.js`)
- `SectionCard` (`src/components/mystats/SectionCard.js`) — card wrapper with `title`, `infoKey`, `onInfo` props, used by every tab.
- `statExplainers` (`src/components/mystats/statExplainers.js`) — `{ [infoKey]: { title, subtitle, explainer } }` feeding `StatDetailSheet`.

---

### Task 1: `roundDifferential` — WHS score differential for one round

**Files:**
- Create: `src/store/handicapIndex.js`
- Test: `src/store/__tests__/handicapIndex.test.js`

**Interfaces:**
- Consumes: `getPlayingHandicap`, `calcExtraShots`, `resolveRoundTee`, `STANDARD_SLOPE` from `./scoring`.
- Produces: `roundDifferential(myRound)` → `{ key, differential, ags, slope, rating, courseName, date } | null`. Task 2 builds on it; Task 3 renders its fields.

- [ ] **Step 1: Write the failing tests**

Create `src/store/__tests__/handicapIndex.test.js`:

```js
import { roundDifferential } from '../handicapIndex';

// 18 identical holes: par 4, SI = hole number. Total par 72.
const holes = Array.from({ length: 18 }, (_, i) => ({
  number: i + 1, par: 4, strokeIndex: i + 1,
}));

// Every hole scored `gross`; playerTees carries slope/rating; playerHandicaps
// stores the playing handicap so getPlayingHandicap reads it directly.
function makeMyRound({ gross = 5, slope = 113, rating = 72, playingHandicap = 18, scores } = {}) {
  const scoreMap = scores
    ?? Object.fromEntries(holes.map((h) => [h.number, gross]));
  return {
    key: 't1:0',
    courseName: 'Test Course',
    tournamentDate: '2026-07-01T00:00:00Z',
    playerId: 'p1',
    player: { id: 'p1', handicap: playingHandicap },
    isComplete: true,
    round: {
      holes,
      scores: { p1: scoreMap },
      playerTees: { p1: { slope, rating } },
      playerHandicaps: { p1: playingHandicap },
    },
  };
}

describe('roundDifferential', () => {
  it('computes (113/slope) × (AGS − rating) to one decimal', () => {
    // 18 bogeys = 90 gross, hcp 18 → net double bogey cap is par+2+1=7,
    // no hole capped. Differential = (113/113) × (90 − 72) = 18.0
    const d = roundDifferential(makeMyRound({ gross: 5 }));
    expect(d).toMatchObject({ differential: 18, ags: 90, slope: 113, rating: 72 });
  });

  it('applies the slope factor', () => {
    // (113/126) × (90 − 70.5) = 17.488… → 17.5
    const d = roundDifferential(makeMyRound({ gross: 5, slope: 126, rating: 70.5 }));
    expect(d.differential).toBe(17.5);
  });

  it('caps holes at net double bogey', () => {
    // hcp 18 → 1 extra shot per hole → cap 4+2+1 = 7. A 10 counts as 7.
    const scores = Object.fromEntries(holes.map((h) => [h.number, h.number === 1 ? 10 : 5]));
    const d = roundDifferential(makeMyRound({ scores }));
    expect(d.ags).toBe(17 * 5 + 7); // 92
  });

  it('respects plus-handicap stroke giving in the cap', () => {
    // hcp -2 → gives a stroke back on the two easiest holes (SI 17, 18):
    // cap there is par+2−1 = 5, elsewhere par+2 = 6.
    const scores = Object.fromEntries(holes.map((h) => [h.number, 9]));
    const d = roundDifferential(makeMyRound({ scores, playingHandicap: -2 }));
    expect(d.ags).toBe(16 * 6 + 2 * 5); // 106
  });

  it('returns null for incomplete rounds', () => {
    const r = makeMyRound();
    r.isComplete = false;
    expect(roundDifferential(r)).toBeNull();
  });

  it('returns null for non-18-hole rounds', () => {
    const r = makeMyRound();
    r.round = { ...r.round, holes: holes.slice(0, 9) };
    expect(roundDifferential(r)).toBeNull();
  });

  it('returns null when slope or rating is missing', () => {
    expect(roundDifferential(makeMyRound({ slope: null, rating: 72 }))).toBeNull();
    expect(roundDifferential(makeMyRound({ slope: 113, rating: null }))).toBeNull();
  });

  it('returns null for null/undefined input', () => {
    expect(roundDifferential(null)).toBeNull();
    expect(roundDifferential(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/store/__tests__/handicapIndex.test.js`
Expected: FAIL — `Cannot find module '../handicapIndex'`.

- [ ] **Step 3: Write the implementation**

Create `src/store/handicapIndex.js`:

```js
// ============================================================================
// WHS Handicap Index math (pure, no IO).
// ============================================================================
//
// Computes World Handicap System (2020) score differentials and the Handicap
// Index from the user's MyRound records (see personalStats.collectMyRounds).
// PCC (playing conditions), soft/hard caps and exceptional-score reduction
// are intentionally out of scope — the app has no data for them.

import {
  getPlayingHandicap, calcExtraShots, resolveRoundTee, STANDARD_SLOPE,
} from './scoring';

const round1 = (n) => Math.round(n * 10) / 10;

// WHS score differential for one MyRound, or null when the round doesn't
// qualify: must be a complete 18-hole round with a numeric slope > 0 and a
// numeric course rating (from the player's tee snapshot, with round-level
// legacy fallback). Gross scores are capped per hole at net double bogey
// (par + 2 + extra shots) before the differential is computed.
export function roundDifferential(myRound) {
  if (!myRound?.isComplete) return null;
  const { round, player, playerId } = myRound;
  const holes = round?.holes ?? [];
  if (holes.length !== 18) return null;
  const { slope, rating } = resolveRoundTee(round, playerId);
  const sv = parseInt(slope, 10) || 0;
  const cr = parseFloat(rating);
  if (sv <= 0 || !Number.isFinite(cr)) return null;
  const scores = round?.scores?.[playerId] ?? {};
  const playingHandicap = getPlayingHandicap(round, player);
  let ags = 0;
  for (const h of holes) {
    const gross = scores[h.number];
    if (gross == null) return null;
    const cap = h.par + 2 + calcExtraShots(playingHandicap, h.strokeIndex);
    ags += Math.min(gross, cap);
  }
  return {
    key: myRound.key,
    differential: round1((STANDARD_SLOPE / sv) * (ags - cr)),
    ags,
    slope: sv,
    rating: cr,
    courseName: myRound.courseName,
    date: myRound.tournamentDate ?? null,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/store/__tests__/handicapIndex.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/store/handicapIndex.js src/store/__tests__/handicapIndex.test.js
git commit -m "feat(handicap): WHS score differential for a round"
```

---

### Task 2: `computeHandicapIndex` — best-of-last-20 WHS index

**Files:**
- Modify: `src/store/handicapIndex.js`
- Test: `src/store/__tests__/handicapIndex.test.js` (append)

**Interfaces:**
- Consumes: `roundDifferential` (Task 1).
- Produces: `computeHandicapIndex(myRounds)` → `{ index: number|null, usedCount, windowCount, eligibleCount, totalCount, differentials: [{ ...differential, counting: boolean }] }`. Also exports `MIN_DIFFERENTIALS = 3` and `MAX_INDEX = 54`. Task 3 renders this object verbatim.

- [ ] **Step 1: Write the failing tests**

In `src/store/__tests__/handicapIndex.test.js`, replace the import line with:

```js
import { roundDifferential, computeHandicapIndex } from '../handicapIndex';
```

then append:

```js
// N complete rounds whose differentials are exactly the `diffs` values:
// slope 113, rating 72, par-72 course → differential = gross − 72.
// Playing handicap 54 keeps net double bogey caps out of the way.
function makeRounds(diffs) {
  return diffs.map((d, i) => {
    const r = makeMyRound({ playingHandicap: 54 });
    r.key = `t:${i}`;
    const total = 72 + d;
    const base = Math.floor(total / 18);
    const extra = total - base * 18; // first `extra` holes get one more stroke
    r.round.scores.p1 = Object.fromEntries(
      holes.map((h, j) => [h.number, base + (j < extra ? 1 : 0)]),
    );
    return r;
  });
}

describe('computeHandicapIndex', () => {
  it('returns null index with fewer than 3 eligible rounds', () => {
    const res = computeHandicapIndex(makeRounds([10, 12]));
    expect(res.index).toBeNull();
    expect(res.eligibleCount).toBe(2);
    expect(res.windowCount).toBe(2);
  });

  it('3 rounds: lowest 1 minus 2.0', () => {
    const res = computeHandicapIndex(makeRounds([10, 14, 12]));
    expect(res.index).toBe(8);         // 10 − 2
    expect(res.usedCount).toBe(1);
    expect(res.differentials.filter((d) => d.counting)).toHaveLength(1);
    expect(res.differentials.find((d) => d.counting).differential).toBe(10);
  });

  it('4 rounds: lowest 1 minus 1.0', () => {
    expect(computeHandicapIndex(makeRounds([10, 14, 12, 16])).index).toBe(9);
  });

  it('5 rounds: lowest 1, no adjustment', () => {
    expect(computeHandicapIndex(makeRounds([10, 14, 12, 16, 18])).index).toBe(10);
  });

  it('6 rounds: average of lowest 2 minus 1.0', () => {
    // lowest two: 10, 12 → avg 11 → 10.0
    expect(computeHandicapIndex(makeRounds([10, 14, 12, 16, 18, 20])).index).toBe(10);
  });

  it('8 rounds: average of lowest 2', () => {
    expect(computeHandicapIndex(makeRounds([10, 14, 12, 16, 18, 20, 22, 24])).index).toBe(11);
  });

  it('20 rounds: average of lowest 8, only last 20 count', () => {
    // 21 rounds: the first (differential 1) falls outside the window.
    // Window = 20 rounds with diffs 2..21 → lowest 8 = 2..9 → avg 5.5
    const res = computeHandicapIndex(makeRounds([1, ...Array.from({ length: 20 }, (_, i) => i + 2)]));
    expect(res.index).toBe(5.5);
    expect(res.usedCount).toBe(8);
    expect(res.windowCount).toBe(20);
    expect(res.eligibleCount).toBe(21);
    expect(res.differentials).toHaveLength(20);
  });

  it('caps the index at 54', () => {
    const res = computeHandicapIndex(makeRounds([60, 61, 62, 63, 64]));
    expect(res.index).toBe(54);
  });

  it('skips ineligible rounds but keeps eligible ones', () => {
    const rounds = makeRounds([10, 12, 14, 16]);
    rounds[1].isComplete = false; // drops the 12
    const res = computeHandicapIndex(rounds);
    expect(res.eligibleCount).toBe(3);
    expect(res.index).toBe(8);   // 3-round rule: lowest (10) − 2
    expect(res.totalCount).toBe(4);
  });

  it('handles empty/null input', () => {
    expect(computeHandicapIndex([]).index).toBeNull();
    expect(computeHandicapIndex(null).index).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx jest src/store/__tests__/handicapIndex.test.js`
Expected: FAIL — `computeHandicapIndex` is not exported. Task 1 tests still PASS.

- [ ] **Step 3: Write the implementation**

Append to `src/store/handicapIndex.js`:

```js
// WHS "number of differentials → how many count + adjustment" table (2020).
function whsCounting(n) {
  if (n <= 3) return { use: 1, adj: -2 };
  if (n === 4) return { use: 1, adj: -1 };
  if (n === 5) return { use: 1, adj: 0 };
  if (n === 6) return { use: 2, adj: -1 };
  if (n <= 8) return { use: 2, adj: 0 };
  if (n <= 11) return { use: 3, adj: 0 };
  if (n <= 14) return { use: 4, adj: 0 };
  if (n <= 16) return { use: 5, adj: 0 };
  if (n <= 18) return { use: 6, adj: 0 };
  if (n === 19) return { use: 7, adj: 0 };
  return { use: 8, adj: 0 };
}

export const MIN_DIFFERENTIALS = 3;
export const MAX_INDEX = 54;

// Handicap Index from ALL of the user's rounds (chronological). Uses the
// last 20 eligible differentials — deliberately independent of the My Stats
// round selector, because WHS always uses the most recent scores.
export function computeHandicapIndex(myRounds) {
  const eligible = (myRounds ?? []).map(roundDifferential).filter(Boolean);
  const window = eligible.slice(-20);
  const base = {
    windowCount: window.length,
    eligibleCount: eligible.length,
    totalCount: (myRounds ?? []).length,
  };
  if (window.length < MIN_DIFFERENTIALS) {
    return {
      ...base,
      index: null,
      usedCount: 0,
      differentials: window.map((d) => ({ ...d, counting: false })),
    };
  }
  const { use, adj } = whsCounting(window.length);
  const sorted = [...window].sort((a, b) => a.differential - b.differential);
  const countingKeys = new Set(sorted.slice(0, use).map((d) => d.key));
  const avg = sorted.slice(0, use).reduce((s, d) => s + d.differential, 0) / use;
  return {
    ...base,
    index: Math.min(MAX_INDEX, round1(avg + adj)),
    usedCount: use,
    differentials: window.map((d) => ({ ...d, counting: countingKeys.has(d.key) })),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/store/__tests__/handicapIndex.test.js`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/store/handicapIndex.js src/store/__tests__/handicapIndex.test.js
git commit -m "feat(handicap): WHS handicap index from best-of-last-20 differentials"
```

---

### Task 3: `HandicapTab` — index hero, differentials list, apply button

**Files:**
- Create: `src/components/mystats/tabs/HandicapTab.js`
- Modify: `src/components/mystats/statExplainers.js` (add `handicapIndex` entry to the `statExplainers` object)
- Test: `src/components/mystats/__tests__/HandicapTab.test.js`

**Interfaces:**
- Consumes: `computeHandicapIndex(myRounds)` + `MIN_DIFFERENTIALS` (Task 2); `SectionCard`; `upsertProfile` from `store/profileStore`.
- Produces: `export default function HandicapTab({ myRounds, profileHandicap, gender, onInfo, onApplied })`. Task 5 mounts it with these exact props. `onApplied(value)` is called after a successful profile write. The course preview section is Task 4 — this task ships the tab without it.

- [ ] **Step 1: Write the failing test**

Create `src/components/mystats/__tests__/HandicapTab.test.js`:

```js
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import HandicapTab from '../tabs/HandicapTab';
import { upsertProfile } from '../../../store/profileStore';

jest.mock('../../../store/profileStore', () => ({
  upsertProfile: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../../store/libraryStore', () => ({
  fetchCourses: jest.fn(() => Promise.resolve([])),
  getCachedCourses: jest.fn(() => Promise.resolve([])),
}));

const holes = Array.from({ length: 18 }, (_, i) => ({
  number: i + 1, par: 4, strokeIndex: i + 1,
}));

// Complete par-72 round with differential = gross total − 72 (slope 113).
function myRound(key, diff) {
  const total = 72 + diff;
  const base = Math.floor(total / 18);
  const extra = total - base * 18;
  return {
    key,
    courseName: `Course ${key}`,
    tournamentDate: '2026-07-01T00:00:00Z',
    playerId: 'p1',
    player: { id: 'p1', handicap: 54 },
    isComplete: true,
    round: {
      holes,
      scores: { p1: Object.fromEntries(holes.map((h, j) => [h.number, base + (j < extra ? 1 : 0)])) },
      playerTees: { p1: { slope: 113, rating: 72 } },
      playerHandicaps: { p1: 54 },
    },
  };
}

const renderTab = (props = {}) => render(
  <ThemeProvider>
    <HandicapTab
      myRounds={[myRound('a', 10), myRound('b', 14), myRound('c', 12)]}
      profileHandicap={20}
      gender={null}
      onInfo={jest.fn()}
      onApplied={jest.fn()}
      {...props}
    />
  </ThemeProvider>,
);

describe('HandicapTab', () => {
  it('shows the calculated index and the counting basis', async () => {
    const { findByText } = renderTab();
    // 3 differentials → lowest (10.0) − 2 = 8.0
    expect(await findByText('8.0')).toBeTruthy();
    expect(await findByText(/Best 1 of last 3/i)).toBeTruthy();
  });

  it('lists differentials with course names', async () => {
    const { findByText } = renderTab();
    expect(await findByText(/Course a/)).toBeTruthy();
    expect(await findByText('10.0')).toBeTruthy();
  });

  it('applies the index to the profile on tap', async () => {
    const onApplied = jest.fn();
    const { findByText } = renderTab({ onApplied });
    fireEvent.press(await findByText(/Set as my handicap/i));
    await waitFor(() => expect(upsertProfile).toHaveBeenCalledWith({ handicap: 8 }));
    expect(onApplied).toHaveBeenCalledWith(8);
  });

  it('shows the empty state below 3 eligible rounds', async () => {
    const { findByText } = renderTab({ myRounds: [myRound('a', 10)] });
    expect(await findByText(/2 more/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/mystats/__tests__/HandicapTab.test.js`
Expected: FAIL — `Cannot find module '../tabs/HandicapTab'`.

- [ ] **Step 3: Add the explainer entry**

In `src/components/mystats/statExplainers.js`, add to the `statExplainers` object (before its closing brace):

```js
  handicapIndex: {
    title: 'Handicap Index',
    subtitle: 'Your WHS index from real rounds',
    explainer: 'Calculated with World Handicap System math from your complete 18-hole rounds. '
      + 'Each round becomes a score differential: your gross score (capped at net double bogey '
      + 'per hole) compared to the course rating, scaled by slope. Your index averages the best '
      + '8 of your last 20 differentials — with fewer rounds, WHS uses fewer differentials and '
      + 'a small safety deduction.\n\n'
      + 'This always uses your most recent rounds, regardless of the rounds selected for the '
      + 'other stats tabs. Rounds only qualify when they are complete 18-hole, non-scramble '
      + 'rounds on a tee with a slope and course rating.\n\n'
      + 'Playing-conditions adjustments, caps against your historical low index, and 9-hole '
      + 'differentials are not applied — treat this as a strong estimate, not an official index.',
  },
```

- [ ] **Step 4: Write the component**

Create `src/components/mystats/tabs/HandicapTab.js`:

```js
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../../theme/ThemeContext';
import SectionCard from '../SectionCard';
import { computeHandicapIndex, MIN_DIFFERENTIALS } from '../../../store/handicapIndex';
import { upsertProfile } from '../../../store/profileStore';

// "12 May" — short date for a differential row.
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const fmt1 = (n) => n.toFixed(1);

export default function HandicapTab({ myRounds, profileHandicap, gender, onInfo, onApplied }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const result = useMemo(() => computeHandicapIndex(myRounds), [myRounds]);
  const [applyState, setApplyState] = useState('idle'); // idle | saving | done | error

  // Profile writes clamp at 0 — the profile validator rejects plus (negative)
  // indexes. The hero still displays the true value.
  const applyValue = result.index == null ? null : Math.max(0, result.index);
  const isPlus = result.index != null && result.index < 0;

  const onApply = async () => {
    if (applyValue == null || applyState === 'saving') return;
    setApplyState('saving');
    try {
      await upsertProfile({ handicap: applyValue });
      setApplyState('done');
      onApplied?.(applyValue);
    } catch (_) {
      setApplyState('error');
    }
  };

  if (result.index == null) {
    const missing = Math.max(0, MIN_DIFFERENTIALS - result.windowCount);
    return (
      <View style={s.wrap}>
        <SectionCard title="Handicap Index" infoKey="handicapIndex" onInfo={onInfo}>
          <Text style={s.emptyTitle}>Not enough qualifying rounds yet</Text>
          <Text style={s.note}>
            {`You need ${MIN_DIFFERENTIALS} qualifying rounds to calculate an index — ${missing} more to go. `}
            {'A round qualifies when it is a complete 18-hole round (no scrambles) on a tee with a slope and course rating.'}
          </Text>
        </SectionCard>
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      <SectionCard title="Handicap Index" infoKey="handicapIndex" onInfo={onInfo}>
        <Text style={s.hero}>{fmt1(result.index)}</Text>
        <Text style={s.heroSub}>
          {`Best ${result.usedCount} of last ${result.windowCount} differentials`}
        </Text>
        {isPlus && (
          <Text style={s.note}>A negative index means you play better than scratch.</Text>
        )}
        <TouchableOpacity
          style={[s.applyBtn, applyState === 'saving' && s.applyBtnDisabled]}
          onPress={onApply}
          disabled={applyState === 'saving'}
          accessibilityRole="button"
        >
          <Text style={s.applyText}>
            {applyState === 'done' ? 'Saved to profile ✓' : `Set as my handicap${isPlus ? ' (0.0)' : ''}`}
          </Text>
        </TouchableOpacity>
        {applyState === 'error' && (
          <Text style={s.errorText}>Could not save — try again.</Text>
        )}
        <Text style={s.profileNote}>
          {profileHandicap != null
            ? `Profile handicap today: ${profileHandicap}`
            : 'No handicap on your profile yet.'}
        </Text>
      </SectionCard>

      <SectionCard title="Score differentials" infoKey="handicapIndex" onInfo={onInfo}>
        <Text style={s.caption}>Last {result.windowCount} qualifying rounds · lowest count</Text>
        {[...result.differentials].reverse().map((d) => (
          <View key={d.key} style={[s.row, d.counting && s.rowCounting]}>
            <View style={s.rowMain}>
              <Text style={s.rowTitle} numberOfLines={1}>{d.courseName}</Text>
              <Text style={s.rowSub}>{`${fmtDate(d.date)} · adjusted gross ${d.ags}`}</Text>
            </View>
            <Text style={[s.rowValue, d.counting && s.rowValueCounting]}>
              {fmt1(d.differential)}
            </Text>
          </View>
        ))}
      </SectionCard>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { gap: theme.spacing.lg },
    hero: { ...theme.typography.display, color: theme.text.primary, textAlign: 'center' },
    heroSub: { ...theme.typography.caption, color: theme.text.muted, textAlign: 'center' },
    note: { ...theme.typography.caption, color: theme.text.muted, marginTop: theme.spacing.sm },
    emptyTitle: { ...theme.typography.subhead, color: theme.text.primary },
    caption: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '700', marginBottom: theme.spacing.xs },
    applyBtn: {
      marginTop: theme.spacing.md, paddingVertical: theme.spacing.sm,
      borderRadius: theme.radius.pill, backgroundColor: theme.accent.primary,
      alignItems: 'center',
    },
    applyBtnDisabled: { opacity: 0.6 },
    applyText: { ...theme.typography.subhead, color: theme.text.inverse },
    errorText: { ...theme.typography.caption, color: theme.destructive, textAlign: 'center', marginTop: theme.spacing.xs },
    profileNote: { ...theme.typography.tiny, color: theme.text.muted, textAlign: 'center', marginTop: theme.spacing.sm },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm,
      paddingVertical: theme.spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border.default,
    },
    rowCounting: { backgroundColor: theme.accent.light, borderRadius: theme.radius.sm, paddingHorizontal: theme.spacing.sm },
    rowMain: { flex: 1 },
    rowTitle: { ...theme.typography.body, color: theme.text.primary },
    rowSub: { ...theme.typography.tiny, color: theme.text.muted },
    rowValue: { ...theme.typography.subhead, color: theme.text.muted, fontVariant: ['tabular-nums'] },
    rowValueCounting: { color: theme.accent.primary, fontWeight: '700' },
  });
}
```

Note for the implementer: check `src/theme/` for the exact typography tokens — if `theme.typography.display` does not exist, use the largest existing heading token (grep for what the SG hero in `ShotsTab.js` uses) and match it. Same for `theme.destructive` — if the theme names its error color differently (check `makeStyles` in `FormTab.js`/`MyStatsScreen.js`), use that name.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest src/components/mystats/__tests__/HandicapTab.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Lint and commit**

```bash
npm run lint
git add src/components/mystats/tabs/HandicapTab.js src/components/mystats/__tests__/HandicapTab.test.js src/components/mystats/statExplainers.js
git commit -m "feat(handicap): Handicap tab with WHS index hero and differentials"
```

---

### Task 4: Course handicap preview inside `HandicapTab`

**Files:**
- Modify: `src/components/mystats/tabs/HandicapTab.js`
- Test: `src/components/mystats/__tests__/HandicapTab.test.js` (append)

**Interfaces:**
- Consumes: `fetchCourses`/`getCachedCourses` (`store/libraryStore`), `resolveTeeForPlayer` (`store/tees`), `calcPlayingHandicap` + `totalParFromHoles` (`store/scoring`), the `gender` prop (Task 3).
- Produces: a "Course handicap" `SectionCard` at the bottom of the tab. No new exports.

- [ ] **Step 1: Write the failing tests**

In `src/components/mystats/__tests__/HandicapTab.test.js`, replace the `jest.mock('../../../store/libraryStore', ...)` block from Task 3 with one that returns a course (keep both function names):

```js
const COURSES = [{
  id: 'c1',
  name: 'Villaitana Levante',
  holes: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 })),
  tees: [
    { id: 'tee-y', label: 'Yellow', rating: 71.5, slope: 128, ratingWomen: null, slopeWomen: null },
    { id: 'tee-r', label: 'Red', rating: 69.0, slope: 118, ratingWomen: 71.0, slopeWomen: 124 },
  ],
}];
jest.mock('../../../store/libraryStore', () => ({
  fetchCourses: jest.fn(() => Promise.resolve(COURSES)),
  getCachedCourses: jest.fn(() => Promise.resolve([])),
}));
```

(If jest complains about referencing `COURSES` inside the mock factory, name it `mockCourses` — jest allows `mock*`-prefixed references.)

Then append the tests:

```js
describe('course handicap preview', () => {
  it('shows the playing handicap for the selected course and tee', async () => {
    const { findByText } = renderTab();
    fireEvent.press(await findByText('Villaitana Levante'));
    fireEvent.press(await findByText('Yellow'));
    // index 8.0 → round(8 × 128/113 + (71.5 − 72)) = round(8.56) = 9
    expect(await findByText(/you'd play off 9/i)).toBeTruthy();
  });

  it('uses women’s ratings for female players', async () => {
    const { findByText } = renderTab({ gender: 'female' });
    fireEvent.press(await findByText('Villaitana Levante'));
    fireEvent.press(await findByText('Red'));
    // index 8.0 → round(8 × 124/113 + (71.0 − 72)) = round(7.78) = 8
    expect(await findByText(/you'd play off 8/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx jest src/components/mystats/__tests__/HandicapTab.test.js`
Expected: the two new tests FAIL (course name never rendered); Task 3 tests PASS.

- [ ] **Step 3: Implement the preview section**

In `src/components/mystats/tabs/HandicapTab.js`:

Merge into existing imports:

```js
import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { fetchCourses, getCachedCourses } from '../../../store/libraryStore';
import { resolveTeeForPlayer } from '../../../store/tees';
import { calcPlayingHandicap, totalParFromHoles } from '../../../store/scoring';
```

Inside the component, after the existing state:

```js
  const [courses, setCourses] = useState(null); // null = loading
  const [courseId, setCourseId] = useState(null);
  const [teeId, setTeeId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let list = [];
      try {
        list = await fetchCourses();
      } catch (_) {
        list = await getCachedCourses();
      }
      if (!cancelled) setCourses(list.filter((c) => (c.tees ?? []).some((t) => t.slope)));
    })();
    return () => { cancelled = true; };
  }, []);

  const course = courses?.find((c) => c.id === courseId) ?? null;
  const tee = course?.tees?.find((t) => t.id === teeId) ?? null;
  // Preview off the calculated index; fall back to the profile handicap so
  // the section still works before 3 qualifying rounds exist.
  const previewIndex = result.index ?? profileHandicap;
  const resolved = tee ? resolveTeeForPlayer(tee, gender) : null;
  const courseHandicap = (resolved?.slope && previewIndex != null)
    ? calcPlayingHandicap(previewIndex, resolved.slope, resolved.rating, totalParFromHoles(course.holes))
    : null;
```

The early `if (result.index == null)` return must NOT skip the preview when a
profile handicap exists — build the card once and render it in both branches:

```js
  const previewCard = (courses && courses.length > 0 && previewIndex != null) ? (
    <SectionCard title="Course handicap" infoKey="handicapIndex" onInfo={onInfo}>
      <Text style={s.caption}>What you'd play off, per course and tee</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={s.chips}>
          {courses.map((c) => (
            <TouchableOpacity
              key={c.id}
              style={[s.chip, courseId === c.id && s.chipOn]}
              onPress={() => { setCourseId(c.id); setTeeId(null); }}
              accessibilityRole="button"
              accessibilityState={{ selected: courseId === c.id }}
            >
              <Text style={[s.chipText, courseId === c.id && s.chipTextOn]}>{c.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
      {course && (
        <View style={s.chips}>
          {course.tees.filter((t) => t.slope).map((t) => (
            <TouchableOpacity
              key={t.id}
              style={[s.chip, teeId === t.id && s.chipOn]}
              onPress={() => setTeeId(t.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: teeId === t.id }}
            >
              <Text style={[s.chipText, teeId === t.id && s.chipTextOn]}>{t.label || 'Standard'}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {courseHandicap != null && (
        <Text style={s.previewResult}>
          {`With index ${fmt1(previewIndex)} you'd play off ${courseHandicap} here.`}
        </Text>
      )}
    </SectionCard>
  ) : null;
```

Render `{previewCard}` as the last child of the top-level `<View style={s.wrap}>` in BOTH the empty-state branch and the main branch.

Add styles to `makeStyles`:

```js
    chips: { flexDirection: 'row', flexWrap: 'nowrap', gap: 6, marginTop: theme.spacing.sm },
    chip: {
      paddingHorizontal: theme.spacing.md, paddingVertical: 6,
      borderRadius: theme.radius.pill, backgroundColor: theme.bg.secondary,
      borderWidth: 1, borderColor: theme.border.default,
    },
    chipOn: { backgroundColor: theme.accent.primary, borderColor: theme.accent.primary },
    chipText: { ...theme.typography.caption, color: theme.text.muted, fontWeight: '700' },
    chipTextOn: { color: theme.text.inverse },
    previewResult: { ...theme.typography.body, color: theme.text.primary, marginTop: theme.spacing.md },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/components/mystats/__tests__/HandicapTab.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/components/mystats/tabs/HandicapTab.js src/components/mystats/__tests__/HandicapTab.test.js
git commit -m "feat(handicap): course handicap preview with course and tee pickers"
```

---

### Task 5: Wire the Handicap tab into MyStatsScreen

**Files:**
- Modify: `src/screens/MyStatsScreen.js`
- Test: `src/screens/__tests__/MyStatsScreen.test.js` (append)

**Interfaces:**
- Consumes: `HandicapTab` (Tasks 3–4) with props `{ myRounds, profileHandicap, gender, onInfo, onApplied }`.
- Produces: a sixth My Stats tab, key `'handicap'`, label `'Handicap'`.

- [ ] **Step 1: Write the failing test**

Append to `src/screens/__tests__/MyStatsScreen.test.js`. Read the file first and reuse its existing render pattern and helpers. Add a mock next to the existing `RoundReportCard` mock:

```js
jest.mock('../../components/mystats/tabs/HandicapTab', () => function MockHandicapTab({ myRounds, profileHandicap }) {
  const { Text } = require('react-native');
  return <Text>{`Handicap tab: ${myRounds.length} rounds, profile ${profileHandicap}`}</Text>;
});
```

Update the file's `profileStore` mock so `loadProfile` resolves `{ displayName: 'Marco', targetHandicap: 14, handicap: 12, gender: null }` (add the two new fields).

Add the test (adapting render/query helpers to the file's existing style):

```js
it('shows the Handicap tab and passes all rounds plus the profile handicap', async () => {
  const view = renderScreen();
  const tabs = await view.findAllByText('Handicap');
  fireEvent.press(tabs[0]);
  expect(await view.findByText(/Handicap tab: 1 rounds, profile 12/)).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/__tests__/MyStatsScreen.test.js`
Expected: the new test FAILS (no Handicap tab); existing tests PASS.

- [ ] **Step 3: Wire the tab**

In `src/screens/MyStatsScreen.js`:

1. Import: `import HandicapTab from '../components/mystats/tabs/HandicapTab';`
2. Add to `ALL_TABS` (after breakdown): `{ key: 'handicap', label: 'Handicap' },`
3. New state next to `targetHandicap`:
   ```js
   const [profileHandicap, setProfileHandicap] = useState(null);
   const [profileGender, setProfileGender] = useState(null);
   ```
4. In the load effect where `setTargetHandicap(profile?.targetHandicap ?? null)` runs, also:
   ```js
   if (!cancelled) {
     setProfileHandicap(profile?.handicap ?? null);
     setProfileGender(profile?.gender ?? null);
   }
   ```
   and in the focus listener that reloads the profile, update both the same way.
5. The "every round deselected" early return currently fires for every tab except `reportCard`; the Handicap tab is selection-independent, so exclude it too:
   ```js
   if (selected.length === 0 && tab !== 'reportCard' && tab !== 'handicap') {
   ```
6. Render inside the main ScrollView with the other tabs:
   ```js
   {tab === 'handicap' && (
     <HandicapTab
       myRounds={myRounds}
       profileHandicap={profileHandicap}
       gender={profileGender}
       onInfo={onInfo}
       onApplied={setProfileHandicap}
     />
   )}
   ```
   Note: the selection-empty early return happens BEFORE the main return — with the
   exclusion in item 5, the handicap tab reaches the main return even when
   `selected.length === 0`, which is exactly what we want.

- [ ] **Step 4: Run the full screen test file, then the whole suite**

Run: `npx jest src/screens/__tests__/MyStatsScreen.test.js`
Expected: PASS.
Run: `npx jest src`
Expected: PASS (no regressions).

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/screens/MyStatsScreen.js src/screens/__tests__/MyStatsScreen.test.js
git commit -m "feat(handicap): Handicap tab wired into My Stats"
```

---

### Task 6: Round-selection persistence — investigate, then fix

This task is investigation-first (systematic debugging): confirm which failure mode is real before changing behavior. Both suspected defects are fixed here because they share one code path.

**Files:**
- Modify: `src/screens/MyStatsScreen.js` (the storage-key derivation and the load effect, currently around lines 91 and 104–140)
- Test: `src/screens/__tests__/MyStatsScreen.test.js` (append)

**Interfaces:**
- Consumes: nothing new — `AsyncStorage`, existing `SELECTION_PREFIX = '@mystats_round_selection:'`.
- Produces: no API changes; behavioral guarantees only.

**Background (current behavior):** `MyStatsScreen` builds `storageKey = user?.id ? SELECTION_PREFIX + user.id : null`. On load it reads the stored override map and PRUNES any key not present in the freshly-loaded round list before putting it in state; `persistOverrides` later writes that (possibly pruned) map back. Defect A: signed-out sessions (`storageKey === null`) never save. Defect B: a partial tournament load prunes overrides in memory, and the next user toggle persists the loss permanently.

- [ ] **Step 1: Write failing reproduction tests**

Append to `src/screens/__tests__/MyStatsScreen.test.js`. First convert the file's AuthContext mock to a mutable holder so individual tests can sign out:

```js
let mockUser = { id: 'user-1' };
const setMockUser = (u) => { mockUser = u; };
jest.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));
```

(reset `mockUser = { id: 'user-1' }` in a global `beforeEach`). Then:

```js
describe('round selection persistence', () => {
  const { collectMyRounds } = require('../../store/personalStats');

  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('keeps stored overrides for rounds missing from the current load', async () => {
    // Stored override deselects round t-2:0, but this load only returns t-1:0
    // (partial load). A toggle during this state must not wipe the override.
    await AsyncStorage.setItem('@mystats_round_selection:user-1', JSON.stringify({ 't-2:0': false }));
    collectMyRounds.mockReturnValue([
      { key: 't-1:0', tournamentId: 't-1', completed: true, round: { id: 'r-1' } },
    ]);

    const view = renderScreen();
    await view.findByText('My Stats');
    // Trigger one persistOverrides write by toggling the visible round via
    // the rounds sheet (open with the "N of M" header button).
    fireEvent.press(view.getByText(/1 of 1/));
    fireEvent.press(await view.findByLabelText(/Round 1/));
    await waitFor(async () => {
      const raw = await AsyncStorage.getItem('@mystats_round_selection:user-1');
      expect(JSON.parse(raw)).toMatchObject({ 't-2:0': false });
    });
  });

  it('persists selection under a device-scoped key when signed out', async () => {
    setMockUser(null);
    const view = renderScreen();
    await view.findByText('My Stats');
    fireEvent.press(view.getByText(/1 of 1/));
    fireEvent.press(await view.findByLabelText(/Round 1/));
    await waitFor(async () => {
      const raw = await AsyncStorage.getItem('@mystats_round_selection:local');
      expect(raw).not.toBeNull();
    });
  });
});
```

Adapt the toggle mechanics to what the file's mocks allow — if `MyStatsRoundSelector` is mocked, forward its `onChange` through a pressable in the mock instead of using accessibility labels. What must stay fixed: seed storage with an override for a round absent from the current load, trigger exactly one `persistOverrides` write, assert the seeded override survives in AsyncStorage; and, signed out, assert a write lands under the `:local` key.

- [ ] **Step 2: Run tests to verify they fail for the RIGHT reason**

Run: `npx jest src/screens/__tests__/MyStatsScreen.test.js -t "persistence"`
Expected: both FAIL — the first because the stored map was pruned before the write, the second because `storageKey` is null so nothing is ever saved. **If either unexpectedly PASSES, stop and investigate before touching the implementation** — the user's real-world bug may be a different mechanism (e.g. unstable round keys across sync: check that `${tournamentId}:${roundIndex}` stays identical for a synced tournament across two loads). Report findings in the task summary rather than proceeding blindly.

- [ ] **Step 3: Implement the fix**

In `src/screens/MyStatsScreen.js`:

1. Device-scoped fallback key (replaces the null key):
   ```js
   const storageKey = `${SELECTION_PREFIX}${user?.id ?? 'local'}`;
   ```
2. In the load effect, replace the storage-read block with a version that
   migrates the local key after sign-in:
   ```js
   let stored = {};
   try {
     let raw = await AsyncStorage.getItem(storageKey);
     if (raw == null && user?.id) {
       // First signed-in load on this device: adopt any signed-out selection.
       const localKey = `${SELECTION_PREFIX}local`;
       const localRaw = await AsyncStorage.getItem(localKey);
       if (localRaw != null) {
         raw = localRaw;
         AsyncStorage.setItem(storageKey, localRaw).catch(() => {});
         AsyncStorage.removeItem(localKey).catch(() => {});
       }
     }
     if (raw) stored = JSON.parse(raw) || {};
   } catch (_) { /* ignore corrupt storage */ }
   ```
3. Remove the destructive prune: delete the `liveKeys` / `clean` block and use
   the stored map directly:
   ```js
   if (!cancelled) {
     setMyRounds(rounds);
     setOverrides(stored);
   }
   ```
   Replace the old pruning comment with why we deliberately keep stale keys:
   `resolveSelection` only consults overrides for rounds that exist, the map
   is bounded by rounds ever played, and pruning on load permanently loses
   selections whenever a load is partial (offline / transient failure).
4. `persistOverrides` needs no change — it writes whatever map it receives,
   which now always contains the stored baseline. The `storageKey` null-check
   inside it becomes dead; remove it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/screens/__tests__/MyStatsScreen.test.js`
Expected: PASS, including both new persistence tests and all pre-existing tests.

- [ ] **Step 5: Full suite, lint, commit**

Run: `npx jest src && npm run lint`
Expected: PASS.

```bash
git add src/screens/MyStatsScreen.js src/screens/__tests__/MyStatsScreen.test.js
git commit -m "fix(mystats): round selection survives restarts, partial loads and signed-out use"
```

---

### Task 7: Manual runtime verification (web)

**Files:** none (verification only).

- [ ] **Step 1: Verify in the running app**

Use the project's `verify` skill (Playwright against the Expo web build) to check:
1. My Stats shows the new Handicap tab; it renders an index (or the empty state) without crashing.
2. The differentials list matches the rounds you'd expect from the seeded account.
3. The course handicap preview computes a plausible number for a library course (e.g. Villaitana Levante).
4. Deselect a round in the "rounds counted" sheet, reload the page (web equivalent of an app restart), reopen the sheet — the round is still deselected.

- [ ] **Step 2: Report**

Summarize what was verified (with screenshots) in the final work summary (project memory: summarize completed implementations).
