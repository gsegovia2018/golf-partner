# Strokes Gained per Handicap + Target Comparison — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parametrize the Strokes Gained framework by a user-chosen target handicap so users compare against a settable golfer reference (default = scratch), and migrate all SG distance units from imperial to metric.

**Architecture:** Adds a nullable `target_handicap` column to `profiles`. Threads an optional `targetHandicap = 0` parameter from `MyStatsScreen` through `computeMyStats` to each SG engine function and finally to `expectedStrokes(lie, distance, targetHandicap)`. A new private `blendedExpected` helper linearly interpolates between `BASELINES_SCRATCH` and `BASELINES_AMATEUR` (Broadie's ~14-handicap table). Default value of 0 preserves Phase B behavior bit-for-bit at every layer. Metric conversion is a single coordinated retrofit task.

**Tech Stack:** React Native (Expo SDK 54) · React 19 · Supabase (Postgres + Auth) · Jest (`jest-expo`) + `@testing-library/react-native` for tests.

**Spec:** [`docs/superpowers/specs/2026-05-20-strokes-gained-per-handicap-target-design.md`](../specs/2026-05-20-strokes-gained-per-handicap-target-design.md)

---

## Task 1: Supabase migration — add `target_handicap` column

**Files:**
- Create: `supabase/migrations/20260520000001_target_handicap.sql`

- [ ] **Step 1: Create the migration**

```sql
-- supabase/migrations/20260520000001_target_handicap.sql
-- Phase C: add target handicap for Strokes Gained comparison.
alter table profiles
  add column target_handicap numeric
    check (target_handicap is null or target_handicap >= 0);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260520000001_target_handicap.sql
git commit -m "feat(db): add profiles.target_handicap column"
```

> Note: timestamp `20260520000001` sits after the existing same-day `20260520000000_sync_player_avatar.sql`.

---

## Task 2: Extend `profileStore` with target-handicap read/write

**Files:**
- Modify: `src/store/profileStore.js`
- Test: `src/store/__tests__/profileStore.test.js` (create if absent)

- [ ] **Step 1: Write the failing test**

If `src/store/__tests__/profileStore.test.js` doesn't exist, create it. Append:

```js
import { loadProfile, upsertProfile } from '../profileStore';
import { supabase } from '../../lib/supabase';

jest.mock('../../lib/supabase', () => {
  const chain = {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(),
    upsert: jest.fn().mockReturnThis(),
  };
  return {
    supabase: {
      ...chain,
      auth: { getUser: jest.fn() },
    },
  };
});

describe('profileStore — target_handicap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b' } } });
  });

  test('loadProfile exposes target_handicap as targetHandicap', async () => {
    supabase.maybeSingle.mockResolvedValueOnce({
      data: { user_id: 'u1', target_handicap: 12.5, handicap: 18 },
      error: null,
    });
    const profile = await loadProfile();
    expect(profile.targetHandicap).toBe(12.5);
  });

  test('loadProfile returns targetHandicap=null when not set', async () => {
    supabase.maybeSingle.mockResolvedValueOnce({
      data: { user_id: 'u1', target_handicap: null, handicap: 18 },
      error: null,
    });
    const profile = await loadProfile();
    expect(profile.targetHandicap).toBeNull();
  });

  test('upsertProfile writes target_handicap when provided', async () => {
    supabase.upsert.mockResolvedValueOnce({ error: null });
    await upsertProfile({ targetHandicap: 14 });
    const call = supabase.upsert.mock.calls[0][0];
    expect(call.target_handicap).toBe(14);
  });

  test('upsertProfile writes null to clear target_handicap', async () => {
    supabase.upsert.mockResolvedValueOnce({ error: null });
    await upsertProfile({ targetHandicap: null });
    const call = supabase.upsert.mock.calls[0][0];
    expect(call.target_handicap).toBeNull();
  });

  test('upsertProfile does not touch target_handicap when key omitted', async () => {
    supabase.upsert.mockResolvedValueOnce({ error: null });
    await upsertProfile({ displayName: 'Marcos' });
    const call = supabase.upsert.mock.calls[0][0];
    expect(call).not.toHaveProperty('target_handicap');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=profileStore`
Expected: FAIL — `target_handicap` missing from select / upsert / mapping.

- [ ] **Step 3: Extend `loadProfile`**

In `src/store/profileStore.js`, update the existing `.select(...)` call to also fetch `target_handicap`:

```js
.select('user_id, username, display_name, handicap, target_handicap, avatar_color, avatar_url, updated_at')
```

And the returned object literal:

```js
return {
  userId: user.id,
  email: user.email,
  username: data?.username ?? '',
  displayName: data?.display_name ?? '',
  handicap: data?.handicap ?? null,
  targetHandicap: data?.target_handicap ?? null,
  avatarColor: data?.avatar_color ?? null,
  avatarUrl: data?.avatar_url ?? null,
  updatedAt: data?.updated_at ?? null,
};
```

- [ ] **Step 4: Extend `upsertProfile`**

In the same file, inside `upsertProfile(fields)`, add a parallel branch to the existing `handicap` handler:

```js
if (fields.targetHandicap !== undefined) {
  row.target_handicap = fields.targetHandicap === '' || fields.targetHandicap == null
    ? null
    : Number(fields.targetHandicap);
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -- --testPathPattern=profileStore`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/store/profileStore.js src/store/__tests__/profileStore.test.js
git commit -m "feat(profile-store): round-trip target_handicap"
```

---

## Task 3: Retrofit `BASELINES_SCRATCH` distances to meters

**Files:**
- Modify: `src/store/strokesGainedBaseline.js`
- Test: `src/store/__tests__/strokesGainedBaseline.test.js`

- [ ] **Step 1: Rename `BASELINES` → `BASELINES_SCRATCH` and convert all distances to meters**

Open `src/store/strokesGainedBaseline.js`. Replace the `BASELINES` export with:

```js
// All distances in METERS for non-green lies and METERS for green.
// (Phase B used yards for non-green and feet for green; this is a clean
// retrofit before Phase B sees significant real-world data.)
export const BASELINES_SCRATCH = {
  tee: [
    { distance:  91.4, expected: 2.79 },   // 100y
    { distance: 137.2, expected: 2.91 },   // 150y
    { distance: 182.9, expected: 3.12 },   // 200y
    { distance: 228.6, expected: 3.41 },   // 250y
    { distance: 274.3, expected: 3.71 },   // 300y
    { distance: 320.0, expected: 4.00 },   // 350y
    { distance: 365.8, expected: 4.29 },   // 400y
    { distance: 411.5, expected: 4.55 },   // 450y
    { distance: 457.2, expected: 4.78 },   // 500y
    { distance: 502.9, expected: 5.00 },   // 550y
  ],
  fairway: [
    { distance:  45.7, expected: 2.55 },   // 50y
    { distance:  91.4, expected: 2.80 },   // 100y
    { distance: 137.2, expected: 2.92 },   // 150y
    { distance: 182.9, expected: 3.32 },   // 200y
    { distance: 228.6, expected: 3.70 },   // 250y
    { distance: 274.3, expected: 4.04 },   // 300y
  ],
  rough: [
    { distance:  45.7, expected: 2.74 },
    { distance:  91.4, expected: 2.98 },
    { distance: 137.2, expected: 3.10 },
    { distance: 182.9, expected: 3.50 },
    { distance: 228.6, expected: 3.91 },
  ],
  sand: [
    { distance:   9.1, expected: 2.42 },
    { distance:  18.3, expected: 2.55 },
    { distance:  27.4, expected: 2.70 },
    { distance:  45.7, expected: 2.93 },
    { distance:  91.4, expected: 3.25 },
  ],
  recovery: [
    { distance:  45.7, expected: 2.85 },
    { distance:  91.4, expected: 3.05 },
    { distance: 137.2, expected: 3.20 },
    { distance: 182.9, expected: 3.60 },
  ],
  green: [
    { distance:  0.91, expected: 1.05 },   // 3 ft
    { distance:  1.83, expected: 1.50 },   // 6 ft
    { distance:  3.05, expected: 1.70 },   // 10 ft
    { distance:  4.57, expected: 1.83 },   // 15 ft
    { distance:  6.10, expected: 1.91 },   // 20 ft
    { distance:  9.14, expected: 2.10 },   // 30 ft
    { distance: 15.24, expected: 2.40 },   // 50 ft
  ],
};

// Backward-compatibility export so existing callers keep working
// until they're migrated. Will be removed in a follow-up.
export const BASELINES = BASELINES_SCRATCH;
```

- [ ] **Step 2: Update existing tests that reference the renamed export**

In `src/store/__tests__/strokesGainedBaseline.test.js`:

Update the import line to add `BASELINES_SCRATCH`:

```js
import {
  BASELINES, BASELINES_SCRATCH, BUCKETS,
  expectedStrokes, expectedFromBucket,
} from '../strokesGainedBaseline';
```

Update the "returns exact row when distance matches" test:

```js
test('returns exact row when distance matches', () => {
  const fairway150m = BASELINES_SCRATCH.fairway.find((r) => Math.abs(r.distance - 137.2) < 0.1);
  expect(expectedStrokes('fairway', 137.2)).toBeCloseTo(fairway150m.expected);
});
```

Update the "maps bucket key to midpoint then to expected" test to use an approach bucket (which will still exist after Task 6):

```js
test('maps bucket key to midpoint then to expected', () => {
  const v = expectedFromBucket('approach', '100-150');
  expect(v).toBeCloseTo(expectedStrokes('fairway', 125));
});
```

Other tests in this file ("sorted ascending", "interpolates between rows", "clamps below/above", "unknown lie returns null") work as-is.

- [ ] **Step 3: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=strokesGainedBaseline`
Expected: PASS (7 tests).

- [ ] **Step 4: Run full statsEngine suite — Phase B regression check**

Run: `npm test -- --testPathPattern=statsEngine.test.js`
Expected: SOME FAIL — `sgPutting`, `sgAroundGreen`, `sgApproach`, `sgOffTheTee` tests reference imperial bucket midpoints. **This is expected.** Task 6 fixes them.

- [ ] **Step 5: Commit**

```bash
git add src/store/strokesGainedBaseline.js src/store/__tests__/strokesGainedBaseline.test.js
git commit -m "feat(sg): convert BASELINES_SCRATCH distances to meters; rename from BASELINES"
```

---

## Task 4: Add `BASELINES_AMATEUR` and `AMATEUR_ANCHOR_HANDICAP`

**Files:**
- Modify: `src/store/strokesGainedBaseline.js`
- Test: `src/store/__tests__/strokesGainedBaseline.test.js`

- [ ] **Step 1: Write the failing test**

Append to `src/store/__tests__/strokesGainedBaseline.test.js`:

```js
import { BASELINES_AMATEUR, AMATEUR_ANCHOR_HANDICAP } from '../strokesGainedBaseline';

describe('BASELINES_AMATEUR', () => {
  test('every category is sorted ascending by distance', () => {
    Object.entries(BASELINES_AMATEUR).forEach(([_lie, rows]) => {
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].distance).toBeGreaterThan(rows[i - 1].distance);
      }
    });
  });
  test('amateur values are worse than scratch at same distance', () => {
    expect(BASELINES_AMATEUR.fairway[0].expected)
      .toBeGreaterThan(BASELINES_SCRATCH.fairway[0].expected);
    expect(BASELINES_AMATEUR.green[2].expected)
      .toBeGreaterThan(BASELINES_SCRATCH.green[2].expected);
  });
  test('AMATEUR_ANCHOR_HANDICAP is 14', () => {
    expect(AMATEUR_ANCHOR_HANDICAP).toBe(14);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=strokesGainedBaseline`
Expected: FAIL — `BASELINES_AMATEUR is not defined`.

- [ ] **Step 3: Add the export**

Append to `src/store/strokesGainedBaseline.js` (after `BASELINES_SCRATCH`):

```js
// Mark Broadie "average amateur" (~14 hcp) baselines from Every Shot
// Counts (Putnam 2014) and follow-up papers, distances in meters.
// Values are approximate; verify against published tables when refining.
export const BASELINES_AMATEUR = {
  tee: [
    { distance:  91.4, expected: 2.85 },
    { distance: 137.2, expected: 3.10 },
    { distance: 182.9, expected: 3.42 },
    { distance: 228.6, expected: 3.78 },
    { distance: 274.3, expected: 4.18 },
    { distance: 320.0, expected: 4.55 },
    { distance: 365.8, expected: 4.92 },
    { distance: 411.5, expected: 5.27 },
    { distance: 457.2, expected: 5.58 },
    { distance: 502.9, expected: 5.86 },
  ],
  fairway: [
    { distance:  45.7, expected: 2.85 },
    { distance:  91.4, expected: 3.10 },
    { distance: 137.2, expected: 3.32 },
    { distance: 182.9, expected: 3.70 },
    { distance: 228.6, expected: 4.10 },
    { distance: 274.3, expected: 4.50 },
  ],
  rough: [
    { distance:  45.7, expected: 3.10 },
    { distance:  91.4, expected: 3.30 },
    { distance: 137.2, expected: 3.55 },
    { distance: 182.9, expected: 3.95 },
    { distance: 228.6, expected: 4.40 },
  ],
  sand: [
    { distance:   9.1, expected: 2.75 },
    { distance:  18.3, expected: 2.90 },
    { distance:  27.4, expected: 3.05 },
    { distance:  45.7, expected: 3.30 },
    { distance:  91.4, expected: 3.65 },
  ],
  recovery: [
    { distance:  45.7, expected: 3.20 },
    { distance:  91.4, expected: 3.40 },
    { distance: 137.2, expected: 3.60 },
    { distance: 182.9, expected: 4.00 },
  ],
  green: [
    { distance:  0.91, expected: 1.10 },
    { distance:  1.83, expected: 1.65 },
    { distance:  3.05, expected: 1.85 },
    { distance:  4.57, expected: 1.96 },
    { distance:  6.10, expected: 2.03 },
    { distance:  9.14, expected: 2.20 },
    { distance: 15.24, expected: 2.50 },
  ],
};

export const AMATEUR_ANCHOR_HANDICAP = 14;
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPattern=strokesGainedBaseline`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/strokesGainedBaseline.js src/store/__tests__/strokesGainedBaseline.test.js
git commit -m "feat(sg): add Broadie amateur (~14 hcp) baseline table"
```

---

## Task 5: Extend `expectedStrokes` and `expectedFromBucket` with `targetHandicap`

**Files:**
- Modify: `src/store/strokesGainedBaseline.js`
- Test: `src/store/__tests__/strokesGainedBaseline.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `src/store/__tests__/strokesGainedBaseline.test.js`:

```js
describe('expectedStrokes(lie, distance, targetHandicap)', () => {
  test('targetHandicap=0 returns scratch values (Phase B regression)', () => {
    expect(expectedStrokes('fairway', 137.2, 0))
      .toBeCloseTo(BASELINES_SCRATCH.fairway.find((r) => Math.abs(r.distance - 137.2) < 0.1).expected);
  });
  test('targetHandicap=14 returns amateur values', () => {
    expect(expectedStrokes('fairway', 137.2, 14))
      .toBeCloseTo(BASELINES_AMATEUR.fairway.find((r) => Math.abs(r.distance - 137.2) < 0.1).expected);
  });
  test('targetHandicap=7 returns midpoint between scratch and amateur', () => {
    const s = BASELINES_SCRATCH.fairway.find((r) => Math.abs(r.distance - 137.2) < 0.1).expected;
    const a = BASELINES_AMATEUR.fairway.find((r) => Math.abs(r.distance - 137.2) < 0.1).expected;
    expect(expectedStrokes('fairway', 137.2, 7)).toBeCloseTo((s + a) / 2, 3);
  });
  test('targetHandicap=28 extrapolates at t=2', () => {
    const s = BASELINES_SCRATCH.fairway.find((r) => Math.abs(r.distance - 137.2) < 0.1).expected;
    const a = BASELINES_AMATEUR.fairway.find((r) => Math.abs(r.distance - 137.2) < 0.1).expected;
    expect(expectedStrokes('fairway', 137.2, 28)).toBeCloseTo(s + 2 * (a - s), 3);
  });
  test('targetHandicap>28 clamps to t=2', () => {
    expect(expectedStrokes('fairway', 137.2, 50))
      .toBeCloseTo(expectedStrokes('fairway', 137.2, 28));
  });
  test('targetHandicap default is 0 (no arg)', () => {
    expect(expectedStrokes('fairway', 137.2))
      .toBeCloseTo(expectedStrokes('fairway', 137.2, 0));
  });
});

describe('expectedFromBucket(category, bucketKey, targetHandicap)', () => {
  test('passes targetHandicap through to expectedStrokes', () => {
    const direct = expectedStrokes('fairway', 125, 10);
    const via = expectedFromBucket('approach', '100-150', 10);
    expect(via).toBeCloseTo(direct);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=strokesGainedBaseline`
Expected: FAIL — function signature doesn't accept third arg.

- [ ] **Step 3: Implement**

In `src/store/strokesGainedBaseline.js`, replace `expectedStrokes` and `expectedFromBucket` with:

```js
// Private: look up a single table by distance using binary search + linear
// interpolation with endpoint clamping. Returns null for unknown lie.
function lookupOne(table, lie, distance) {
  const rows = table[lie];
  if (!rows || rows.length === 0) return null;
  if (distance <= rows[0].distance) return rows[0].expected;
  if (distance >= rows[rows.length - 1].distance) return rows[rows.length - 1].expected;
  let lo = 0, hi = rows.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].distance <= distance) lo = mid; else hi = mid;
  }
  const a = rows[lo], b = rows[hi];
  const t = (distance - a.distance) / (b.distance - a.distance);
  return a.expected + t * (b.expected - a.expected);
}

// Private: blend scratch and amateur tables by target handicap.
// t = 0 returns scratch; t = 1 returns amateur; t = 2 extrapolates and clamps.
function blendedExpected(lie, distance, targetHandicap) {
  const t = Math.max(0, Math.min(2, (targetHandicap ?? 0) / AMATEUR_ANCHOR_HANDICAP));
  const a = lookupOne(BASELINES_SCRATCH, lie, distance);
  const b = lookupOne(BASELINES_AMATEUR, lie, distance);
  if (a == null || b == null) return null;
  return a + t * (b - a);
}

export function expectedStrokes(lie, distance, targetHandicap = 0) {
  return blendedExpected(lie, distance, targetHandicap);
}

export function expectedFromBucket(category, bucketKey, targetHandicap = 0) {
  const midpoint = BUCKETS[category]?.[bucketKey];
  if (midpoint == null) return null;
  const lie = category === 'firstPutt' ? 'green' : 'fairway';
  return expectedStrokes(lie, midpoint, targetHandicap);
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPattern=strokesGainedBaseline`
Expected: PASS — all old tests still pass (default arg preserves Phase B), all new tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/store/strokesGainedBaseline.js src/store/__tests__/strokesGainedBaseline.test.js
git commit -m "feat(sg): expectedStrokes accepts optional targetHandicap (blended baseline)"
```

---

## Task 6: Metric bucket retrofit — coordinated update across capture + engine + tests

This is the big atomic task. Changes bucket keys, midpoints, labels, iteration lists, and updates every test assertion that depends on the old imperial bucket midpoints.

**Files:**
- Modify: `src/screens/ScorecardScreen.js`
- Modify: `src/store/strokesGainedBaseline.js`
- Modify: `src/store/statsEngine.js`
- Modify: `src/components/mystats/tabs/ShotsTab.js`
- Modify: `src/store/__tests__/statsEngine.test.js`

- [ ] **Step 1: Update `BUCKETS` in `strokesGainedBaseline.js`**

Replace the existing `BUCKETS` export with:

```js
// Bucket midpoints in METERS.
export const BUCKETS = {
  firstPutt: { '0-1': 0.5, '1-2': 1.5, '2-3': 2.5, '3-6': 4.5, '6+': 9 },
  approach:  { '0-50': 25, '50-100': 75, '100-150': 125, '150-200': 175, '200+': 230 },
};
```

- [ ] **Step 2: Update `ScorecardScreen.js` capture constants**

Replace `FIRST_PUTT_BUCKETS` and `FIRST_PUTT_LABELS`:

```js
const FIRST_PUTT_BUCKETS = ['0-1', '1-2', '2-3', '3-6', '6+'];
const FIRST_PUTT_LABELS = {
  '0-1': '0-1m', '1-2': '1-2m', '2-3': '2-3m',
  '3-6': '3-6m', '6+': '6+m',
};

const APPROACH_BUCKETS = ['0-50', '50-100', '100-150', '150-200', '200+'];
const APPROACH_LABELS = {
  '0-50': '0-50m', '50-100': '50-100m', '100-150': '100-150m',
  '150-200': '150-200m', '200+': '200+m',
};
```

(`APPROACH_BUCKETS` keys are unchanged; only labels change from `'0-50y'` to `'0-50m'` etc.)

- [ ] **Step 3: Update the (?) explainer bodies in `ScorecardScreen.js`**

Find the explainer body strings for `firstPuttBucket` and `approachBucket`. Replace mentions of feet/yards with meters:

```js
// firstPuttBucket explainer body:
'How far away your first putt was (in meters). Lets us measure how well you lag long putts and how well you convert short ones.'

// approachBucket explainer body:
'How far you played your approach into the green from (in meters). Drives Strokes Gained Approach.'
```

- [ ] **Step 4: Update `FIRST_PUTT_BUCKETS_LIST` in `statsEngine.js`**

```js
const FIRST_PUTT_BUCKETS_LIST = ['0-1', '1-2', '2-3', '3-6', '6+'];
```

- [ ] **Step 5: Update `ShotsTab.js` bucket iteration**

In `src/components/mystats/tabs/ShotsTab.js`, find the bucket iteration in the "Putts by first-putt distance" section:

```jsx
{['0-1', '1-2', '2-3', '3-6', '6+'].map((bucket) => {
  // … existing rendering, but label suffix changes from `ft` to `m`
```

Update the row label from "{bucket} ft" to "{bucket} m" (or whatever the existing label component renders — replace "ft" with "m").

- [ ] **Step 6: Update test fixtures in `statsEngine.test.js`**

In `src/store/__tests__/statsEngine.test.js`, perform these search-and-replaces:

- `firstPuttBucket: '6-10'` → `firstPuttBucket: '2-3'` (every occurrence)
- `firstPuttBucket: '0-3'` → `firstPuttBucket: '0-1'` (every occurrence)
- `firstPuttBucket: '10-20'` → `firstPuttBucket: '3-6'` (every occurrence)
- `sample.perBucket['6-10']` → `sample.perBucket['2-3']`
- `avgPuttsByBucket['6-10']` → `avgPuttsByBucket['2-3']`

Update the per-test SG assertions (existing values were anchored to imperial midpoints):

- `sgPutting` test currently asserts `toBeCloseTo(-0.40, 1)` (or similar 8ft-based value) → change to `toBeCloseTo(-0.39, 1)` (new 2.5m midpoint → expected ≈ 1.61, SG ≈ −0.39).
- `sgAroundGreen` test currently asserts `toBeCloseTo(0.50, 1)` → change to `toBeCloseTo(0.53, 1)`. Math:
  - start = expectedStrokes('sand', 20) — sand rows 9.1(2.42), 18.3(2.55), 27.4(2.70). At 20m: t = (20-18.3)/(27.4-18.3) ≈ 0.187, expected ≈ 2.578.
  - end = expectedFromBucket('firstPutt', '0-1') = expectedStrokes('green', 0.5) clamps to 1.05.
  - SG = 2.578 - 1.05 - 1 ≈ 0.53.
- `sgApproach` test currently asserts `toBeCloseTo(0.03, 1)` → change to `toBeCloseTo(0.06, 1)`. Math:
  - start = expectedStrokes('fairway', 125) ≈ 2.888.
  - end = expectedFromBucket('firstPutt', '3-6') = expectedStrokes('green', 4.5) ≈ 1.824.
  - SG = 2.888 - 1.824 - 1 ≈ 0.06.
- `sgOffTheTee` fairway-drive test currently asserts `toBeCloseTo(0.43, 1)` → change to `toBeCloseTo(0.60, 1)`. Math:
  - expected(tee, 400) — tee rows 365.8(4.29), 411.5(4.55). At 400: t ≈ 0.749, expected ≈ 4.485.
  - expected(fairway, 125) ≈ 2.888.
  - SG = 4.485 - 2.888 - 1 ≈ 0.60.
- `sgOffTheTee` penalty test asserts `toBeLessThan(-0.5)` — no change needed; check the value still satisfies the inequality. Math: 4.485 - rough(125) - 1 - 1 = 4.485 - 3.068 - 2 ≈ -0.583. Still < -0.5. ✓

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: ALL PASS. If anything fails, look for a missed bucket-key reference in the test file.

- [ ] **Step 8: Commit**

```bash
git add src/screens/ScorecardScreen.js src/store/strokesGainedBaseline.js src/store/statsEngine.js src/components/mystats/tabs/ShotsTab.js src/store/__tests__/statsEngine.test.js src/store/__tests__/strokesGainedBaseline.test.js
git commit -m "feat(sg): retrofit bucket keys + midpoints + labels to metric"
```

---

## Task 7: Extend `sgPutting` with `targetHandicap`

**Files:**
- Modify: `src/store/statsEngine.js`
- Test: `src/store/__tests__/statsEngine.test.js`

- [ ] **Step 1: Write the failing test**

Append to `src/store/__tests__/statsEngine.test.js`:

```js
describe('sgPutting with targetHandicap', () => {
  test('default targetHandicap=0 matches Phase B', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }],
      [{ putts: 2, firstPuttBucket: '2-3' }],
    );
    expect(sgPutting(round, 'me').perHole[0])
      .toBeCloseTo(sgPutting(round, 'me', 0).perHole[0]);
  });
  test('higher targetHandicap → less-negative SG (bar is lower)', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }],
      [{ putts: 2, firstPuttBucket: '2-3' }],
    );
    const scratchSG = sgPutting(round, 'me', 0).perHole[0];
    const amateurSG = sgPutting(round, 'me', 14).perHole[0];
    expect(amateurSG).toBeGreaterThan(scratchSG);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=statsEngine.test.js -t 'sgPutting with targetHandicap'`
Expected: FAIL.

- [ ] **Step 3: Update `sgPutting` signature**

In `src/store/statsEngine.js`, replace the existing `sgPutting` with:

```js
export function sgPutting(round, playerId, targetHandicap = 0) {
  const byHole = round?.shotDetails?.[playerId];
  const perHole = (round?.holes ?? []).map((hole) => {
    const d = byHole?.[hole.number];
    if (!d || d.putts == null || !d.firstPuttBucket) return null;
    const expected = expectedFromBucket('firstPutt', d.firstPuttBucket, targetHandicap);
    if (expected == null) return null;
    return expected - d.putts;
  });
  const sample = perHole.filter((x) => x != null);
  const total = sample.reduce((a, x) => a + x, 0);
  return { perHole, total, sampleHoles: sample.length };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPattern=statsEngine.test.js -t sgPutting`
Expected: PASS — both new tests and all Phase B sgPutting tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/store/statsEngine.js src/store/__tests__/statsEngine.test.js
git commit -m "feat(sg): sgPutting accepts optional targetHandicap"
```

---

## Task 8: Extend `sgAroundGreen` with `targetHandicap`

**Files:**
- Modify: `src/store/statsEngine.js`
- Test: `src/store/__tests__/statsEngine.test.js`

- [ ] **Step 1: Write the failing test**

```js
describe('sgAroundGreen with targetHandicap', () => {
  test('default targetHandicap=0 matches Phase B', () => {
    const round = makeRound(
      [{ par: 4, strokes: 5 }],
      [{ putts: 1, sandShots: 1, firstPuttBucket: '0-1', recoveryOutcome: 'sand-save' }],
    );
    expect(sgAroundGreen(round, 'me').perHole[0])
      .toBeCloseTo(sgAroundGreen(round, 'me', 0).perHole[0]);
  });
  test('higher targetHandicap shifts SG toward less-negative', () => {
    const round = makeRound(
      [{ par: 4, strokes: 5 }],
      [{ putts: 1, sandShots: 1, firstPuttBucket: '0-1', recoveryOutcome: 'sand-save' }],
    );
    const scratchSG = sgAroundGreen(round, 'me', 0).perHole[0];
    const amateurSG = sgAroundGreen(round, 'me', 14).perHole[0];
    expect(amateurSG).toBeGreaterThan(scratchSG);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=statsEngine.test.js -t 'sgAroundGreen with targetHandicap'`
Expected: FAIL.

- [ ] **Step 3: Update `sgAroundGreen` signature**

Replace the existing `sgAroundGreen` with:

```js
export function sgAroundGreen(round, playerId, targetHandicap = 0) {
  const byHole = round?.shotDetails?.[playerId];
  const perHole = (round?.holes ?? []).map((hole) => {
    const d = byHole?.[hole.number];
    if (!d) return null;
    const strokes = round?.scores?.[playerId]?.[hole.number];
    const gir = isGIR({ strokes, putts: d.putts, par: hole.par });
    if (gir !== false) return null;
    const lie = (d.sandShots ?? 0) >= 1 ? 'sand' : 'recovery';
    const start = expectedStrokes(lie, AROUND_GREEN_START_DISTANCE, targetHandicap);
    let end;
    if (d.putts === 0) {
      end = 0;
    } else if (d.firstPuttBucket) {
      end = expectedFromBucket('firstPutt', d.firstPuttBucket, targetHandicap);
    } else {
      return null;
    }
    return start - end - 1;
  });
  const sample = perHole.filter((x) => x != null);
  const total = sample.reduce((a, x) => a + x, 0);
  return { perHole, total, sampleHoles: sample.length };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPattern=statsEngine.test.js -t sgAroundGreen`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/statsEngine.js src/store/__tests__/statsEngine.test.js
git commit -m "feat(sg): sgAroundGreen accepts optional targetHandicap"
```

---

## Task 9: Extend `sgApproach` with `targetHandicap`

**Files:**
- Modify: `src/store/statsEngine.js`
- Test: `src/store/__tests__/statsEngine.test.js`

- [ ] **Step 1: Write the failing test**

```js
describe('sgApproach with targetHandicap', () => {
  test('default targetHandicap=0 matches Phase B', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }],
      [{ putts: 2, approachBucket: '100-150', firstPuttBucket: '3-6' }],
    );
    expect(sgApproach(round, 'me').perHole[0])
      .toBeCloseTo(sgApproach(round, 'me', 0).perHole[0]);
  });
  test('higher targetHandicap shifts SG toward zero or positive', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }],
      [{ putts: 2, approachBucket: '100-150', firstPuttBucket: '3-6' }],
    );
    const scratchSG = sgApproach(round, 'me', 0).perHole[0];
    const amateurSG = sgApproach(round, 'me', 14).perHole[0];
    expect(amateurSG).toBeGreaterThan(scratchSG);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=statsEngine.test.js -t 'sgApproach with targetHandicap'`
Expected: FAIL.

- [ ] **Step 3: Update `sgApproach` signature**

Replace the existing `sgApproach` with:

```js
export function sgApproach(round, playerId, targetHandicap = 0) {
  const byHole = round?.shotDetails?.[playerId];
  const perHole = (round?.holes ?? []).map((hole) => {
    if (hole.par === 3) return null;
    const d = byHole?.[hole.number];
    if (!d || !d.approachBucket) return null;
    const startDist = BUCKETS.approach[d.approachBucket];
    if (startDist == null) return null;
    const start = expectedStrokes('fairway', startDist, targetHandicap);
    const strokes = round?.scores?.[playerId]?.[hole.number];
    const gir = isGIR({ strokes, putts: d.putts, par: hole.par });
    let end;
    if (gir === true && d.firstPuttBucket) {
      end = expectedFromBucket('firstPutt', d.firstPuttBucket, targetHandicap);
    } else if (gir === false) {
      const lie = (d.sandShots ?? 0) >= 1 ? 'sand' : 'recovery';
      end = expectedStrokes(lie, AROUND_GREEN_START_DISTANCE, targetHandicap);
    } else {
      return null;
    }
    return start - end - 1;
  });
  const sample = perHole.filter((x) => x != null);
  const total = sample.reduce((a, x) => a + x, 0);
  return { perHole, total, sampleHoles: sample.length };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPattern=statsEngine.test.js -t sgApproach`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/statsEngine.js src/store/__tests__/statsEngine.test.js
git commit -m "feat(sg): sgApproach accepts optional targetHandicap"
```

---

## Task 10: Extend `sgOffTheTee` with `targetHandicap`

**Files:**
- Modify: `src/store/statsEngine.js`
- Test: `src/store/__tests__/statsEngine.test.js`

- [ ] **Step 1: Write the failing test**

```js
describe('sgOffTheTee with targetHandicap', () => {
  test('default targetHandicap=0 matches Phase B', () => {
    const round = {
      holes: [{ number: 1, par: 4, strokeIndex: 1, distance: 400 }],
      scores: { me: { 1: 4 } },
      shotDetails: { me: { 1: { drive: 'fairway', teePenalties: 0, approachBucket: '100-150' } } },
    };
    expect(sgOffTheTee(round, 'me').perHole[0])
      .toBeCloseTo(sgOffTheTee(round, 'me', 0).perHole[0]);
  });
  test('higher targetHandicap shifts SG up', () => {
    const round = {
      holes: [{ number: 1, par: 4, strokeIndex: 1, distance: 400 }],
      scores: { me: { 1: 4 } },
      shotDetails: { me: { 1: { drive: 'fairway', teePenalties: 0, approachBucket: '100-150' } } },
    };
    const scratchSG = sgOffTheTee(round, 'me', 0).perHole[0];
    const amateurSG = sgOffTheTee(round, 'me', 14).perHole[0];
    expect(amateurSG).toBeGreaterThan(scratchSG);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=statsEngine.test.js -t 'sgOffTheTee with targetHandicap'`
Expected: FAIL.

- [ ] **Step 3: Update `sgOffTheTee` signature**

Replace the existing `sgOffTheTee` with:

```js
export function sgOffTheTee(round, playerId, targetHandicap = 0) {
  const byHole = round?.shotDetails?.[playerId];
  const perHole = (round?.holes ?? []).map((hole) => {
    const d = byHole?.[hole.number];
    if (!d || d.drive == null) return null;
    const teeDistance = hole.distance ?? PAR_DEFAULT_DISTANCE[hole.par] ?? 400;
    const start = expectedStrokes('tee', teeDistance, targetHandicap);

    let endLie = 'fairway';
    let residualDistance;
    if (d.drive === 'short') {
      residualDistance = teeDistance * 0.40;
      endLie = 'fairway';
    } else if (d.approachBucket) {
      residualDistance = BUCKETS.approach[d.approachBucket];
      endLie = (d.drive === 'left' || d.drive === 'right') ? 'rough' : 'fairway';
    } else {
      residualDistance = PAR_TYPICAL_RESIDUAL[hole.par] ?? 150;
      endLie = (d.drive === 'left' || d.drive === 'right') ? 'rough' : 'fairway';
    }
    const end = expectedStrokes(endLie, residualDistance, targetHandicap);
    const penalty = d.teePenalties ?? 0;
    return start - end - 1 - penalty;
  });
  const sample = perHole.filter((x) => x != null);
  const total = sample.reduce((a, x) => a + x, 0);
  return { perHole, total, sampleHoles: sample.length };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPattern=statsEngine.test.js -t sgOffTheTee`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/statsEngine.js src/store/__tests__/statsEngine.test.js
git commit -m "feat(sg): sgOffTheTee accepts optional targetHandicap"
```

---

## Task 11: Extend `sgTotal` with `targetHandicap`

**Files:**
- Modify: `src/store/statsEngine.js`
- Test: `src/store/__tests__/statsEngine.test.js`

- [ ] **Step 1: Write the failing test**

```js
describe('sgTotal with targetHandicap', () => {
  test('threads targetHandicap into all four categories', () => {
    const round = {
      holes: [{ number: 1, par: 4, strokeIndex: 1, distance: 400 }],
      scores: { me: { 1: 4 } },
      shotDetails: { me: { 1: {
        drive: 'fairway', teePenalties: 0, approachBucket: '100-150',
        putts: 2, firstPuttBucket: '3-6', sandShots: 0,
      } } },
    };
    const r0 = sgTotal(round, 'me', 0);
    const r14 = sgTotal(round, 'me', 14);
    expect(r14.total).toBeGreaterThan(r0.total);
    expect(r14.total).toBeCloseTo(
      r14.byCategory.tee + r14.byCategory.approach
      + r14.byCategory.aroundGreen + r14.byCategory.putting,
      5,
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=statsEngine.test.js -t 'sgTotal with targetHandicap'`
Expected: FAIL.

- [ ] **Step 3: Update `sgTotal` signature**

Replace the existing `sgTotal` with:

```js
export function sgTotal(round, playerId, targetHandicap = 0) {
  const tee         = sgOffTheTee(round, playerId, targetHandicap);
  const approach    = sgApproach(round, playerId, targetHandicap);
  const aroundGreen = sgAroundGreen(round, playerId, targetHandicap);
  const putting     = sgPutting(round, playerId, targetHandicap);
  const byCategory = {
    tee:         tee.total,
    approach:    approach.total,
    aroundGreen: aroundGreen.total,
    putting:     putting.total,
  };
  const total = byCategory.tee + byCategory.approach + byCategory.aroundGreen + byCategory.putting;
  const sampleHoles = Math.max(
    tee.sampleHoles, approach.sampleHoles,
    aroundGreen.sampleHoles, putting.sampleHoles,
  );
  return { total, byCategory, sampleHoles };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPattern=statsEngine.test.js -t sgTotal`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/statsEngine.js src/store/__tests__/statsEngine.test.js
git commit -m "feat(sg): sgTotal accepts optional targetHandicap"
```

---

## Task 12: Extend `sgSeason` with `targetHandicap`

**Files:**
- Modify: `src/store/statsEngine.js`
- Test: `src/store/__tests__/statsEngine.test.js`

- [ ] **Step 1: Write the failing test**

```js
describe('sgSeason with targetHandicap', () => {
  test('threads targetHandicap through sgTotal', () => {
    const mkRound = () => ({
      holes: Array.from({ length: 18 }, (_, i) => ({
        number: i + 1, par: 4, strokeIndex: i + 1, distance: 400,
      })),
      scores: { me: Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, 4])) },
      shotDetails: { me: Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, {
        drive: 'fairway', teePenalties: 0, approachBucket: '100-150',
        putts: 2, firstPuttBucket: '3-6', sandShots: 0,
      }])) },
    });
    const r0 = sgSeason([mkRound(), mkRound()], 'me', 0);
    const r14 = sgSeason([mkRound(), mkRound()], 'me', 14);
    expect(r14.total).toBeGreaterThan(r0.total);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=statsEngine.test.js -t 'sgSeason with targetHandicap'`
Expected: FAIL.

- [ ] **Step 3: Update `sgSeason` signature**

Replace the existing `sgSeason` with:

```js
export function sgSeason(rounds, playerId, targetHandicap = 0) {
  const byCategory = { tee: 0, approach: 0, aroundGreen: 0, putting: 0 };
  let total = 0;
  let sampleHoles = 0;
  const perRound = [];
  rounds.forEach((round, i) => {
    const r = sgTotal(round, playerId, targetHandicap);
    if (r.sampleHoles === 0) return;
    byCategory.tee         += r.byCategory.tee;
    byCategory.approach    += r.byCategory.approach;
    byCategory.aroundGreen += r.byCategory.aroundGreen;
    byCategory.putting     += r.byCategory.putting;
    total += r.total;
    sampleHoles += r.sampleHoles;
    perRound.push({ index: i, total: r.total, sampleHoles: r.sampleHoles });
  });
  if (sampleHoles < SG_SEASON_MIN_SAMPLE) {
    return { total: null, byCategory: null, sampleHoles, perRound };
  }
  const denom = perRound.length;
  return {
    total: total / denom,
    byCategory: {
      tee:         byCategory.tee         / denom,
      approach:    byCategory.approach    / denom,
      aroundGreen: byCategory.aroundGreen / denom,
      putting:     byCategory.putting     / denom,
    },
    sampleHoles,
    perRound,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPattern=statsEngine.test.js -t sgSeason`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/statsEngine.js src/store/__tests__/statsEngine.test.js
git commit -m "feat(sg): sgSeason accepts optional targetHandicap"
```

---

## Task 13: Extend `computeMyStats` with `{ targetHandicap }` option

**Files:**
- Modify: `src/store/personalStats.js`
- Test: `src/store/__tests__/personalStats.test.js`

- [ ] **Step 1: Write the failing test**

Append to `src/store/__tests__/personalStats.test.js`:

```js
test('computeMyStats accepts targetHandicap and threads it to sgSeason', () => {
  const mkMyRound = () => ({
    key: 't1#0',
    courseName: 'Test',
    tournamentName: 'T',
    tournamentDate: '2026-05-20',
    completed: true,
    playerId: 'me',
    player: { id: 'me', name: 'Me' },
    round: {
      holes: Array.from({ length: 18 }, (_, i) => ({
        number: i + 1, par: 4, strokeIndex: i + 1, distance: 400,
      })),
      scores: { me: Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, 4])) },
      shotDetails: { me: Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, {
        drive: 'fairway', teePenalties: 0, approachBucket: '100-150',
        putts: 2, firstPuttBucket: '3-6', sandShots: 0,
      }])) },
      playerHandicaps: { me: 18 },
    },
  });
  const rounds = [mkMyRound(), mkMyRound()];
  const s0 = computeMyStats(rounds, { targetHandicap: 0 });
  const s14 = computeMyStats(rounds, { targetHandicap: 14 });
  expect(s14.strokesGained.total).toBeGreaterThan(s0.strokesGained.total);
});

test('computeMyStats default targetHandicap=0 matches no-arg call', () => {
  const round = {
    key: 't1#0',
    courseName: 'Test',
    tournamentName: 'T',
    tournamentDate: '2026-05-20',
    completed: true,
    playerId: 'me',
    player: { id: 'me', name: 'Me' },
    round: {
      holes: [{ number: 1, par: 4, strokeIndex: 1 }],
      scores: { me: { 1: 4 } },
      shotDetails: { me: { 1: { putts: 2 } } },
      playerHandicaps: { me: 18 },
    },
  };
  const sNoArg = computeMyStats([round]);
  const sZero = computeMyStats([round], { targetHandicap: 0 });
  expect(sNoArg.strokesGained).toEqual(sZero.strokesGained);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=personalStats.test.js -t targetHandicap`
Expected: FAIL.

- [ ] **Step 3: Update `computeMyStats` signature**

In `src/store/personalStats.js`, change the function signature from `({ n = 5 } = {})` to `({ n = 5, targetHandicap = 0 } = {})` and update the `strokesGained:` line:

```js
export function computeMyStats(selectedRounds, { n = 5, targetHandicap = 0 } = {}) {
  const rounds = selectedRounds || [];
  const synthetic = buildSyntheticTournament(rounds);
  return {
    // ... existing keys unchanged ...
    strokesGained: sgSeason(synthetic.rounds, CANON_ID, targetHandicap),
  };
}
```

(Find the existing `strokesGained:` line and pass `targetHandicap` as the third argument.)

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPattern=personalStats.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/personalStats.js src/store/__tests__/personalStats.test.js
git commit -m "feat(personal-stats): computeMyStats accepts targetHandicap option"
```

---

## Task 14: Create `TargetHandicapPicker` component

**Files:**
- Create: `src/components/mystats/TargetHandicapPicker.js`
- Test: `src/components/mystats/__tests__/TargetHandicapPicker.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// src/components/mystats/__tests__/TargetHandicapPicker.test.js
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import { TargetHandicapPicker } from '../TargetHandicapPicker';

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('TargetHandicapPicker', () => {
  test('renders current value when one is set', () => {
    const { getByDisplayValue } = render(wrap(
      <TargetHandicapPicker
        visible
        currentValue={12.5}
        currentHandicap={18}
        onSave={() => {}}
        onCancel={() => {}}
      />
    ));
    expect(getByDisplayValue('12.5')).toBeTruthy();
  });

  test('renders empty input when currentValue is null', () => {
    const { queryByDisplayValue } = render(wrap(
      <TargetHandicapPicker
        visible
        currentValue={null}
        currentHandicap={18}
        onSave={() => {}}
        onCancel={() => {}}
      />
    ));
    expect(queryByDisplayValue('12.5')).toBeNull();
  });

  test('preset button fills input from currentHandicap', () => {
    const { getByText, getByDisplayValue } = render(wrap(
      <TargetHandicapPicker
        visible
        currentValue={null}
        currentHandicap={15.4}
        onSave={() => {}}
        onCancel={() => {}}
      />
    ));
    fireEvent.press(getByText(/Use my current handicap/));
    expect(getByDisplayValue('15.4')).toBeTruthy();
  });

  test('Save calls onSave with parsed numeric value', () => {
    const onSave = jest.fn();
    const { getByText } = render(wrap(
      <TargetHandicapPicker
        visible
        currentValue={10}
        currentHandicap={18}
        onSave={onSave}
        onCancel={() => {}}
      />
    ));
    fireEvent.press(getByText('Save'));
    expect(onSave).toHaveBeenCalledWith(10);
  });

  test('Cancel calls onCancel and does not call onSave', () => {
    const onSave = jest.fn();
    const onCancel = jest.fn();
    const { getByText } = render(wrap(
      <TargetHandicapPicker
        visible
        currentValue={10}
        currentHandicap={18}
        onSave={onSave}
        onCancel={onCancel}
      />
    ));
    fireEvent.press(getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern=TargetHandicapPicker`
Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Create the component**

```js
// src/components/mystats/TargetHandicapPicker.js
import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, Pressable } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

export function TargetHandicapPicker({
  visible,
  currentValue,        // number | null
  currentHandicap,     // number | null — the user's actual handicap (for the preset button)
  onSave,              // (value: number | null) => void
  onCancel,            // () => void
}) {
  const { theme } = useTheme();
  const [text, setText] = useState(
    currentValue == null ? '' : String(currentValue)
  );

  useEffect(() => {
    if (visible) setText(currentValue == null ? '' : String(currentValue));
  }, [visible, currentValue]);

  const handleSave = () => {
    const trimmed = text.trim();
    if (trimmed === '') {
      onSave(null);
      return;
    }
    const n = parseFloat(trimmed);
    if (Number.isNaN(n) || n < 0 || n > 36) {
      return;
    }
    onSave(n);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 }}
        onPress={onCancel}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{ backgroundColor: theme.bg.card, borderRadius: 12, padding: 20 }}
        >
          <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text.primary, marginBottom: 12 }}>
            Set your target
          </Text>

          <TextInput
            value={text}
            onChangeText={setText}
            keyboardType="decimal-pad"
            placeholder="e.g. 12.5"
            placeholderTextColor={theme.text.muted}
            style={{
              borderWidth: 1,
              borderColor: theme.border.default,
              borderRadius: 8,
              padding: 10,
              fontSize: 18,
              color: theme.text.primary,
            }}
          />

          <Text style={{ marginTop: 12, color: theme.text.secondary, fontSize: 13 }}>
            {text.trim() === ''
              ? 'Leave blank to compare against scratch.'
              : `Compared against a handicap-${text.trim()} golfer.`}
          </Text>

          {currentHandicap != null && (
            <TouchableOpacity
              onPress={() => setText(String(currentHandicap))}
              style={{ marginTop: 12 }}
            >
              <Text style={{ color: theme.accent.primary, fontSize: 13 }}>
                ⓘ Use my current handicap ({currentHandicap})
              </Text>
            </TouchableOpacity>
          )}

          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 20, gap: 12 }}>
            <TouchableOpacity onPress={onCancel}>
              <Text style={{ color: theme.text.secondary, fontSize: 14, fontWeight: '600', padding: 8 }}>
                Cancel
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleSave}>
              <Text style={{ color: theme.accent.primary, fontSize: 14, fontWeight: '600', padding: 8 }}>
                Save
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPattern=TargetHandicapPicker`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/mystats/TargetHandicapPicker.js src/components/mystats/__tests__/TargetHandicapPicker.test.js
git commit -m "feat(my-stats): TargetHandicapPicker modal component"
```

---

## Task 15: Add "Target handicap" row to ProfileScreen

**Files:**
- Modify: `src/screens/ProfileScreen.js`

- [ ] **Step 1: Add state + load**

In the ProfileScreen component, alongside `const [handicap, setHandicap] = useState('');`, add:

```js
const [targetHandicap, setTargetHandicap] = useState(null);
const [pickerOpen, setPickerOpen] = useState(false);
```

In the load effect (search for `setHandicap(p?.handicap …`), add:

```js
setTargetHandicap(p?.targetHandicap ?? null);
```

- [ ] **Step 2: Add the row JSX**

Find where the handicap input is rendered. Below it, add:

```jsx
<View style={{ marginTop: 16 }}>
  <Text style={s.label}>Target handicap</Text>
  <TouchableOpacity
    style={s.input}
    onPress={() => setPickerOpen(true)}
  >
    <Text style={{ color: targetHandicap == null ? theme.text.muted : theme.text.primary }}>
      {targetHandicap == null ? 'Not set' : String(targetHandicap)}
    </Text>
  </TouchableOpacity>
</View>
```

(Reuse the existing `s.label` and `s.input` style names — mirror the handicap row's structure.)

- [ ] **Step 3: Wire the picker**

At the bottom of the component's JSX (just before the closing wrapper), add:

```jsx
<TargetHandicapPicker
  visible={pickerOpen}
  currentValue={targetHandicap}
  currentHandicap={handicap === '' ? null : Number(handicap)}
  onSave={async (value) => {
    setTargetHandicap(value);
    setPickerOpen(false);
    await upsertProfile({ targetHandicap: value });
  }}
  onCancel={() => setPickerOpen(false)}
/>
```

Add the import at the top:

```js
import { TargetHandicapPicker } from '../components/mystats/TargetHandicapPicker';
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: All existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/screens/ProfileScreen.js
git commit -m "feat(profile): add target handicap row that opens the picker"
```

---

## Task 16: MyStatsScreen reads `target_handicap` from profile and passes to `computeMyStats`

**Files:**
- Modify: `src/screens/MyStatsScreen.js`

- [ ] **Step 1: Add state + load**

In `src/screens/MyStatsScreen.js`, near the existing state declarations, add:

```js
const [targetHandicap, setTargetHandicap] = useState(null);
const [pickerOpen, setPickerOpen] = useState(false);
```

Add a `useEffect` to load the target handicap:

```js
useEffect(() => {
  let cancelled = false;
  loadProfile().then((p) => {
    if (cancelled) return;
    setTargetHandicap(p?.targetHandicap ?? null);
  }).catch(() => {});
  return () => { cancelled = true; };
}, []);
```

Add the imports:

```js
import { loadProfile, upsertProfile } from '../store/profileStore';
import { TargetHandicapPicker } from '../components/mystats/TargetHandicapPicker';
```

- [ ] **Step 2: Pass `targetHandicap` to `computeMyStats`**

Find the `computeMyStats(...)` call (likely in a `useMemo`). Replace:

```js
const stats = useMemo(() => computeMyStats(selectedRounds), [selectedRounds]);
```

with:

```js
const stats = useMemo(
  () => computeMyStats(selectedRounds, { targetHandicap: targetHandicap ?? 0 }),
  [selectedRounds, targetHandicap]
);
```

- [ ] **Step 3: Pass `targetHandicap` to tab components**

For each tab component (`ShotsTab`, `OverviewTab`) extend the props:

```jsx
<ShotsTab
  stats={stats}
  onInfo={onInfo}
  targetHandicap={targetHandicap}
  onChangeTarget={() => setPickerOpen(true)}
/>
```

Same change for `OverviewTab`. Tasks 17 and 18 will consume these props.

- [ ] **Step 4: Render the picker at the bottom of MyStatsScreen**

```jsx
<TargetHandicapPicker
  visible={pickerOpen}
  currentValue={targetHandicap}
  currentHandicap={/* last-known handicap, or null */ null}
  onSave={async (value) => {
    setTargetHandicap(value);
    setPickerOpen(false);
    await upsertProfile({ targetHandicap: value });
  }}
  onCancel={() => setPickerOpen(false)}
/>
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/screens/MyStatsScreen.js
git commit -m "feat(my-stats): wire target_handicap from profile to computeMyStats"
```

---

## Task 17: ShotsTab — dynamic SG title, pencil icon, one-time nudge

**Files:**
- Modify: `src/components/mystats/tabs/ShotsTab.js`

- [ ] **Step 1: Accept new props**

Change the component signature from:

```js
export function ShotsTab({ stats, onInfo }) {
```

to:

```js
export function ShotsTab({ stats, onInfo, targetHandicap, onChangeTarget }) {
```

- [ ] **Step 2: Compute dynamic title**

Above the SG `SectionCard` rendering, add:

```js
const sgTitle = (targetHandicap == null || targetHandicap === 0)
  ? 'Strokes Gained vs scratch'
  : `Strokes Gained vs ${targetHandicap}-handicap target`;
```

Update the SectionCard:

```jsx
<SectionCard
  title={sgTitle}
  infoKey="strokesGained"
  onInfo={onInfo}
  rightAction={
    onChangeTarget && (
      <TouchableOpacity onPress={onChangeTarget} hitSlop={8}>
        <Feather name="edit-2" size={14} color={theme.text.secondary} />
      </TouchableOpacity>
    )
  }
>
  {/* existing card body */}
</SectionCard>
```

If `SectionCard` doesn't yet accept a `rightAction` prop, add support: open `src/components/mystats/SectionCard.js`, find the title row, and render `{rightAction}` next to the title text. If the SectionCard refactor is non-trivial, place the pencil button as the first element inside the card body instead — same UX, simpler change.

Add imports as needed:

```js
import { TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
```

- [ ] **Step 3: One-time nudge**

Inside the SG card body (after the existing content), add:

```jsx
{stats?.strokesGained?.sampleHoles >= 18
  && (targetHandicap == null || targetHandicap === 0)
  && <SGTargetNudge onTap={onChangeTarget} />}
```

Create the nudge as a small inline component at the bottom of the same file:

```js
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const NUDGE_KEY = 'sgTargetNudgeDismissed';

function SGTargetNudge({ onTap }) {
  const { theme } = useTheme();
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(NUDGE_KEY).then((v) => {
      if (!cancelled) setDismissed(v === '1');
    });
    return () => { cancelled = true; };
  }, []);
  if (dismissed) return null;
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', marginTop: 12, padding: 10,
      backgroundColor: theme.bg.subtle ?? theme.bg.card, borderRadius: 8,
    }}>
      <TouchableOpacity onPress={onTap} style={{ flex: 1 }}>
        <Text style={{ color: theme.text.primary, fontSize: 13 }}>
          ⓘ Tip: set a target handicap to see where you'd improve most.
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={async () => {
          await AsyncStorage.setItem(NUDGE_KEY, '1');
          setDismissed(true);
        }}
        hitSlop={8}
        style={{ paddingHorizontal: 8 }}
      >
        <Text style={{ color: theme.text.secondary, fontSize: 16 }}>×</Text>
      </TouchableOpacity>
    </View>
  );
}
```

Confirm `useTheme` is imported.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/mystats/tabs/ShotsTab.js src/components/mystats/SectionCard.js
git commit -m "feat(my-stats): ShotsTab dynamic SG title + pencil + one-time nudge"
```

(Include `SectionCard.js` in the commit only if you modified it to support `rightAction`.)

---

## Task 18: OverviewTab — dynamic SG snapshot title + pencil icon

**Files:**
- Modify: `src/components/mystats/tabs/OverviewTab.js`

- [ ] **Step 1: Accept new props**

Change the component signature:

```js
export function OverviewTab({ stats, onInfo, targetHandicap, onChangeTarget }) {
```

- [ ] **Step 2: Compute dynamic title**

Above the SG snapshot SectionCard, add:

```js
const sgSnapshotTitle = (targetHandicap == null || targetHandicap === 0)
  ? 'Strokes Gained vs scratch'
  : `Strokes Gained vs handicap ${targetHandicap}`;
```

Update the SectionCard title and add the pencil:

```jsx
<SectionCard
  title={sgSnapshotTitle}
  infoKey="strokesGained"
  onInfo={onInfo}
  rightAction={
    onChangeTarget && (
      <TouchableOpacity onPress={onChangeTarget} hitSlop={8}>
        <Feather name="edit-2" size={14} color={theme.text.secondary} />
      </TouchableOpacity>
    )
  }
>
  {/* existing snapshot body */}
</SectionCard>
```

Update the inner subtitle to be dynamic:

```jsx
<Text style={s.sgSubtle}>
  per round {(targetHandicap == null || targetHandicap === 0) ? 'vs scratch' : `vs hcp ${targetHandicap}`}
</Text>
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/mystats/tabs/OverviewTab.js
git commit -m "feat(my-stats): OverviewTab dynamic SG snapshot title + pencil"
```

---

## Task 19: statExplainers — dynamic `strokesGained` content

**Files:**
- Modify: `src/components/mystats/statExplainers.js`
- Modify: `src/screens/MyStatsScreen.js` (or wherever `statExplainers[infoKey]` is consumed)

- [ ] **Step 1: Convert `strokesGained` to a function**

In `src/components/mystats/statExplainers.js`, replace the static `strokesGained` entry with a function:

```js
// At the top or alongside other exports:
const strokesGainedExplainer = (targetHandicap) => {
  const isScratch = targetHandicap == null || targetHandicap === 0;
  const title = isScratch
    ? 'Strokes Gained'
    : `Strokes Gained vs handicap ${targetHandicap}`;
  const subtitle = isScratch
    ? 'How you compare to a scratch golfer'
    : `How you compare to a handicap-${targetHandicap} golfer`;
  return {
    title,
    subtitle,
    explainer: '/* KEEP the existing Phase B body string here, verbatim — do not change wording */',
  };
};

export const statExplainers = {
  // ... existing entries unchanged ...
  strokesGained: strokesGainedExplainer,
};
```

**Important:** copy the existing `strokesGained.explainer` body verbatim from the current file. Do not change the wording.

- [ ] **Step 2: Consume the function form**

Find where `statExplainers[infoKey]` is read (likely in `MyStatsScreen.js`, in the section that prepares `StatDetailSheet` props). Replace:

```js
const explainer = statExplainers[infoKey];
```

with:

```js
const rawExplainer = statExplainers[infoKey];
const explainer = typeof rawExplainer === 'function'
  ? rawExplainer(targetHandicap)
  : rawExplainer;
```

Other static explainer entries continue to work because the `typeof` check falls through.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/mystats/statExplainers.js src/screens/MyStatsScreen.js
git commit -m "feat(my-stats): statExplainers.strokesGained reflects current target"
```

---

## Task 20: Final test sweep + Phase C PR

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: ALL PASS. Phase C adds ≥15 new tests (signature regressions + interpolation + picker behaviour).

(`npm run lint` is broken upstream due to a pre-existing missing-typescript peer dep — skip unless you've installed `typescript` to fix the local environment.)

- [ ] **Step 2: Manual cross-platform sweep**

For each row, verify the result on both Web (`npm run web`) and Android (EAS preview build or local dev client):

| Check | Web | Android |
|---|---|---|
| Fresh state: target unset → SG card identical to Phase B. |  |  |
| Log 18+ SG-eligible holes with target null → nudge appears. Dismiss → never reappears. |  |  |
| Tap pencil on SG card → picker opens with empty input. Type 14, Save → card title becomes "Strokes Gained vs 14-handicap target". |  |  |
| Tap "Use my current handicap" preset → input fills with the user's most recent handicap. |  |  |
| Set target → 0 → card reverts to "vs scratch" framing. |  |  |
| Cross-device: change target on Web → Android picks up new value within ~1s of focus. |  |  |
| ProfileScreen: open "Target handicap" row → picker opens, Save persists, reflected on MyStatsScreen. |  |  |
| First-putt bucket UI shows meter labels: "0-1m", "1-2m", "2-3m", "3-6m", "6+m". |  |  |
| Approach bucket UI shows meter labels: "0-50m", "50-100m", "100-150m", "150-200m", "200+m". |  |  |

- [ ] **Step 3: Push & open Phase C PR**

```bash
git push
gh pr create --title "feat: Phase C — Strokes Gained per handicap + target comparison (and metric retrofit)" --body "$(cat <<'EOF'
Phase C of the Strokes Gained framework. Parametrizes SG against a user-
chosen target handicap and ships the full imperial → metric retrofit.

## What ships

- `profiles.target_handicap` (nullable numeric column).
- `BASELINES_AMATEUR` (Broadie ~14-handicap baseline, in meters).
- `expectedStrokes(lie, distance, targetHandicap = 0)` blends linearly
  between scratch and amateur baselines via `t = targetHandicap / 14`,
  clamped at `t = 2` (≈ handicap 28). Default 0 preserves Phase B exactly.
- The six SG engine functions and `computeMyStats` thread `targetHandicap`
  through with default 0.
- `<TargetHandicapPicker>` modal with "Use my current handicap" preset.
- ProfileScreen + MyStatsScreen (pencil icons on Shots and Overview SG
  cards) entry points.
- One-time dismissible nudge once user has ≥18 SG-eligible holes and no
  target set.
- Imperial-to-metric retrofit: bucket keys + UI labels + Broadie baseline
  distances all in meters now. No data migration (Phase B just shipped).

## Stats
- 20 commits, 19 implementation tasks
- ~15 new tests added vs Phase B (signature regressions + interpolation
  + picker behaviour)
- Default-arg discipline preserves Phase B SG values bit-for-bit at every
  layer

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

(If `gh` CLI is not installed locally, push and open the PR from
https://github.com/gsegovia2018/golf-partner/pull/new/feature/strokes-gained-spec.)

---

## Self-review

- **Spec coverage:** Every section in `2026-05-20-strokes-gained-per-handicap-target-design.md` maps to at least one task:
  - Data model (migration + baseline tables + bucket retrofit) → Tasks 1, 3, 4, 6.
  - Baseline blending math → Task 5.
  - Settings UI + onboarding (picker + entry points + nudge) → Tasks 14, 15, 16, 17, 18.
  - Code structure (file changes, signatures, data flow) → Tasks 5, 7–13, 16.
  - UI specifics (card title parametrization, pencil, nudge) → Tasks 17, 18.
  - Backward compat (default 0 preserves Phase B) → Tasks 5, 7–13 each verify default-arg regression.
  - Testing (unit + integration + manual) → Tasks 2, 3, 4, 5, 7–13, 14, 20.
- **Placeholder scan:** No "TBD" / "TODO" / "implement appropriately" / vague handling. Every step shows actual code. The "amateur values are approximate; verify before refining" note is acknowledged in the spec as a refinement task for the implementer — not a placeholder in this plan.
- **Type consistency:** Field names (`targetHandicap`, `target_handicap`) used consistently — camelCase in JS, snake_case at the DB layer. Function names (`expectedStrokes`, `expectedFromBucket`, `blendedExpected`, all six `sg*` functions, `computeMyStats`) match between definition and call sites. Constant names (`BASELINES_SCRATCH`, `BASELINES_AMATEUR`, `AMATEUR_ANCHOR_HANDICAP`, `BUCKETS`, `FIRST_PUTT_BUCKETS_LIST`) consistent throughout.
