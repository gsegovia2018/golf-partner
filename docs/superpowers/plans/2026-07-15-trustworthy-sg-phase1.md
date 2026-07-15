# Trustworthy Strokes Gained (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the My Stats strokes-gained data trustworthy and progress-visible: a real off-the-tee category, accurate approach lies, per-round trend, personal-baseline deltas, score reconciliation, and sample-size gating.

**Architecture:** Pure-function store modules (`src/store/`) compute everything; screens/components only render. New SG math goes into `statsEngine.js` + `strokesGainedBaseline.js`, assembly into `personalStats.computeMyStats`, UI into `src/components/mystats/`. Spec: `docs/superpowers/specs/2026-07-15-sg-coach-improvements-design.md` (Phase 1 sections).

**Tech Stack:** Expo SDK 54 / React Native 0.81 / React 19, Jest (jest-expo), @testing-library/react-native, react-native-svg.

## Global Constraints

- **Never use `hole.distance` / course tee distances** — the group's course library has none (spec non-goal).
- All distances are **metres**.
- Everything deterministic and offline — no network, no LLM, no `Date.now()` in stats math.
- Store modules stay pure functions; no React imports in `src/store/`.
- Run tests with `npx jest <path>` from the repo root; full suite `npm test`; lint `npm run lint` (CI-blocking).
- If a full-suite run picks up tests under `.claude/worktrees/` or `.worktrees/`, ignore those failures — known environment artifact (they are copies, not this work).
- Commit after every task with the message given in the task.

---

### Task 1: Drive buckets + benchmark constants in the baseline module

**Files:**
- Modify: `src/store/strokesGainedBaseline.js`
- Test: `src/store/__tests__/strokesGainedBaseline.test.js`

**Interfaces:**
- Consumes: existing `AMATEUR_ANCHOR_HANDICAP` (14), `BUCKETS` object.
- Produces (used by Task 2):
  - `BUCKETS.driveDist` — `{ '0-150': 135, '150-180': 165, '180-210': 195, '210-240': 225, '240+': 255 }`
  - `PAR_ANCHOR_DISTANCE` — `{ 4: 340, 5: 470 }` (export)
  - `benchmarkDriveDistance(targetHandicap = 0) → number` (export)

- [ ] **Step 1: Write the failing tests**

Append to `src/store/__tests__/strokesGainedBaseline.test.js` (it already imports from `../strokesGainedBaseline`; extend the import line with `benchmarkDriveDistance, PAR_ANCHOR_DISTANCE, BUCKETS`):

```js
describe('drive benchmark constants', () => {
  test('driveDist bucket midpoints', () => {
    expect(BUCKETS.driveDist).toEqual({
      '0-150': 135, '150-180': 165, '180-210': 195, '210-240': 225, '240+': 255,
    });
  });
  test('par anchors', () => {
    expect(PAR_ANCHOR_DISTANCE).toEqual({ 4: 340, 5: 470 });
  });
  test('benchmarkDriveDistance blends 230 (scratch) to 200 (14 hcp) and clamps', () => {
    expect(benchmarkDriveDistance(0)).toBe(230);
    expect(benchmarkDriveDistance(14)).toBe(200);
    expect(benchmarkDriveDistance(7)).toBe(215);
    expect(benchmarkDriveDistance(28)).toBe(170);
    expect(benchmarkDriveDistance(50)).toBe(170); // clamped at t = 2
    expect(benchmarkDriveDistance()).toBe(230);   // default scratch
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/store/__tests__/strokesGainedBaseline.test.js`
Expected: FAIL — `BUCKETS.driveDist` undefined, `benchmarkDriveDistance is not a function`.

- [ ] **Step 3: Implement**

In `src/store/strokesGainedBaseline.js`:

Extend the `BUCKETS` export (currently `firstPutt` + `approach`):

```js
// Bucket midpoints in METERS.
export const BUCKETS = {
  firstPutt: { '0-1': 0.5, '1-2': 1.5, '2-3': 2.5, '3-6': 4.5, '6+': 9 },
  approach:  { '0-50': 25, '50-100': 75, '100-150': 125, '150-200': 175, '200+': 230 },
  // '0-150' uses 135, not the arithmetic midpoint: real drives logged in
  // that bucket cluster near its top, and 75 would fabricate a huge miss.
  driveDist: { '0-150': 135, '150-180': 165, '180-210': 195, '210-240': 225, '240+': 255 },
};
```

Append at the end of the file:

```js
// ── Off-the-tee benchmark (see spec §1.2) ──
// The OTT model compares a drive against the *benchmark drive* for the
// target handicap on a typical hole, so it needs no course distances.
// Anchor hole lengths per par; par 3s have no tee category.
export const PAR_ANCHOR_DISTANCE = { 4: 340, 5: 470 };

const SCRATCH_DRIVE_DISTANCE = 230;
const AMATEUR_DRIVE_DISTANCE = 200;

// Typical drive distance for a target handicap, blended the same way as the
// baseline tables: t = hcp / 14, clamped to [0, 2].
export function benchmarkDriveDistance(targetHandicap = 0) {
  const t = Math.max(0, Math.min(2, (targetHandicap ?? 0) / AMATEUR_ANCHOR_HANDICAP));
  return SCRATCH_DRIVE_DISTANCE + t * (AMATEUR_DRIVE_DISTANCE - SCRATCH_DRIVE_DISTANCE);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/store/__tests__/strokesGainedBaseline.test.js`
Expected: PASS (all, including pre-existing).

- [ ] **Step 5: Commit**

```bash
git add src/store/strokesGainedBaseline.js src/store/__tests__/strokesGainedBaseline.test.js
git commit -m "feat(sg): drive distance buckets + benchmark-drive constants"
```

---

### Task 2: `sgOffTheTee` in statsEngine

**Files:**
- Modify: `src/store/statsEngine.js` (add after `sgPenalties`, ~line 2524)
- Test: `src/store/__tests__/statsEngine.test.js`

**Interfaces:**
- Consumes: `expectedStrokes(lie, distance, targetHandicap)`, `BUCKETS.driveDist`, `PAR_ANCHOR_DISTANCE`, `benchmarkDriveDistance` from `./strokesGainedBaseline` (extend the existing import on line 3).
- Produces:
  - `driveLieFromDetail(detail) → 'fairway' | 'rough' | 'sand' | 'trouble' | null` (export)
  - `sgOffTheTee(round, playerId, targetHandicap = 0) → { perHole, total, sampleHoles }` (export; same shape as `sgApproach`)

The test fixture `makeRound(holes, details)` already exists at the top of `statsEngine.test.js` (line ~200).

- [ ] **Step 1: Write the failing tests**

Add `sgOffTheTee, driveLieFromDetail` to the test file's import from `../statsEngine`, then append:

```js
describe('driveLieFromDetail', () => {
  test('explicit driveLie wins over direction', () => {
    expect(driveLieFromDetail({ drive: 'fairway', driveLie: 'sand' })).toBe('sand');
  });
  test('fairway/super direction implies fairway lie', () => {
    expect(driveLieFromDetail({ drive: 'fairway' })).toBe('fairway');
    expect(driveLieFromDetail({ drive: 'super' })).toBe('fairway');
  });
  test('miss directions default to rough', () => {
    expect(driveLieFromDetail({ drive: 'left' })).toBe('rough');
    expect(driveLieFromDetail({ drive: 'right' })).toBe('rough');
    expect(driveLieFromDetail({ drive: 'short' })).toBe('rough');
  });
  test('null without any drive info', () => {
    expect(driveLieFromDetail({})).toBeNull();
    expect(driveLieFromDetail(null)).toBeNull();
  });
});

describe('sgOffTheTee', () => {
  // Scratch benchmark on a par 4: E(fairway, 340-230=110) = 2.84873
  test('fairway drive slightly shorter than scratch benchmark ≈ 0', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }],
      [{ drive: 'fairway', driveDistBucket: '210-240' }],
    );
    // actual: E(fairway, 340-225=115) = 2.86183 → 2.84873 - 2.86183
    const r = sgOffTheTee(round, 'me');
    expect(r.perHole[0]).toBeCloseTo(-0.01, 2);
    expect(r.sampleHoles).toBe(1);
  });
  test('rough drive at 180-210 costs about a third of a stroke vs scratch', () => {
    const round = makeRound(
      [{ par: 4, strokes: 5 }],
      [{ drive: 'left', driveLie: 'rough', driveDistBucket: '180-210' }],
    );
    // actual: E(rough, 340-195=145) = 3.16827 → 2.84873 - 3.16827
    expect(sgOffTheTee(round, 'me').perHole[0]).toBeCloseTo(-0.32, 2);
  });
  test('trouble maps to the recovery table', () => {
    const round = makeRound(
      [{ par: 4, strokes: 6 }],
      [{ drive: 'right', driveLie: 'trouble', driveDistBucket: '150-180' }],
    );
    // actual: E(recovery, 340-165=175) = 3.53085 → 2.84873 - 3.53085
    expect(sgOffTheTee(round, 'me').perHole[0]).toBeCloseTo(-0.68, 2);
  });
  test('par 5 uses the 470 m anchor', () => {
    const round = makeRound(
      [{ par: 5, strokes: 5 }],
      [{ drive: 'fairway', driveDistBucket: '240+' }],
    );
    // bench: E(fairway, 470-230=240) = 3.78481; actual: E(fairway, 470-255=215) = 3.58692
    expect(sgOffTheTee(round, 'me').perHole[0]).toBeCloseTo(0.20, 2);
  });
  test('same drive is positive against a 14-handicap benchmark', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }],
      [{ drive: 'fairway', driveDistBucket: '210-240' }],
    );
    // bench(14): E_blend(fairway, 340-200=140) = 3.34328; actual: E_blend(fairway, 115) = 3.21336
    expect(sgOffTheTee(round, 'me', 14).perHole[0]).toBeCloseTo(0.13, 2);
  });
  test('derived rough lie from a miss direction without explicit driveLie', () => {
    const round = makeRound(
      [{ par: 4, strokes: 5 }],
      [{ drive: 'left', driveDistBucket: '180-210' }],
    );
    expect(sgOffTheTee(round, 'me').perHole[0]).toBeCloseTo(-0.32, 2);
  });
  test('null on par 3s, legacy holes without a distance bucket, and untracked holes', () => {
    const round = makeRound(
      [{ par: 3, strokes: 3 }, { par: 4, strokes: 4 }, { par: 4, strokes: 4 }],
      [
        { drive: 'fairway', driveDistBucket: '180-210' }, // par 3 → null
        { drive: 'fairway' },                              // no bucket → null
        {},                                                // no drive info → null
      ],
    );
    const r = sgOffTheTee(round, 'me');
    expect(r.perHole).toEqual([null, null, null]);
    expect(r.sampleHoles).toBe(0);
    expect(r.total).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/store/__tests__/statsEngine.test.js -t "sgOffTheTee"`
Expected: FAIL — `sgOffTheTee is not a function`. Also run `-t "driveLieFromDetail"`, same failure mode.

- [ ] **Step 3: Implement**

Extend line 3 of `statsEngine.js`:

```js
import {
  expectedFromBucket, expectedStrokes, BUCKETS,
  PAR_ANCHOR_DISTANCE, benchmarkDriveDistance,
} from './strokesGainedBaseline';
```

Add after `sgPenalties` (after line ~2524):

```js
// ── Strokes Gained: Off the Tee ──

// Which baseline table a drive lie reads from.
const DRIVE_LIE_TABLE = { fairway: 'fairway', rough: 'rough', sand: 'sand', trouble: 'recovery' };

// A drive's lie: the explicit driveLie field when logged, otherwise derived
// from the direction chip — fairway/super hit the fairway; any miss
// direction defaults to rough (the most common miss).
export function driveLieFromDetail(detail) {
  if (!detail) return null;
  if (detail.driveLie && DRIVE_LIE_TABLE[detail.driveLie]) return detail.driveLie;
  if (detail.drive === 'fairway' || detail.drive === 'super') return 'fairway';
  if (detail.drive === 'left' || detail.drive === 'right' || detail.drive === 'short') return 'rough';
  return null;
}

// Never let "remaining to the green" collapse below a normal wedge — a 240+
// drive on the 340 m anchor still leaves a real shot.
const MIN_REMAINING_DISTANCE = 30;

// Benchmark-drive model (spec §1.2): compare the drive's end position against
// the end position of the target handicap's typical drive (fairway lie) on a
// fixed anchor-length hole. Both sides spend exactly one stroke, so no -1
// term. Penalty strokes stay in sgPenalties — not double-counted here.
export function sgOffTheTee(round, playerId, targetHandicap = 0) {
  const byHole = round?.shotDetails?.[playerId];
  const perHole = (round?.holes ?? []).map((hole) => {
    const anchor = hole.par === 4 ? PAR_ANCHOR_DISTANCE[4]
      : hole.par >= 5 ? PAR_ANCHOR_DISTANCE[5] : null;
    if (anchor == null) return null;
    const d = byHole?.[hole.number];
    const lie = driveLieFromDetail(d);
    const dist = BUCKETS.driveDist[d?.driveDistBucket];
    if (lie == null || dist == null) return null;
    const bench = expectedStrokes(
      'fairway',
      Math.max(MIN_REMAINING_DISTANCE, anchor - benchmarkDriveDistance(targetHandicap)),
      targetHandicap,
    );
    const actual = expectedStrokes(
      DRIVE_LIE_TABLE[lie],
      Math.max(MIN_REMAINING_DISTANCE, anchor - dist),
      targetHandicap,
    );
    if (bench == null || actual == null) return null;
    return bench - actual;
  });
  const sample = perHole.filter((x) => x != null);
  const total = sample.reduce((a, x) => a + x, 0);
  return { perHole, total, sampleHoles: sample.length };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/store/__tests__/statsEngine.test.js`
Expected: PASS (new and all pre-existing).

- [ ] **Step 5: Commit**

```bash
git add src/store/statsEngine.js src/store/__tests__/statsEngine.test.js
git commit -m "feat(sg): off-the-tee strokes gained via benchmark-drive model"
```

---

### Task 3: Approach SG uses its own lie

**Files:**
- Modify: `src/store/statsEngine.js` — `sgApproach` (~line 2482) and `approachTargetGaps` (~line 2582)
- Test: `src/store/__tests__/statsEngine.test.js`

**Interfaces:**
- Consumes: shot detail field `approachLie` (`'fairway' | 'rough' | 'sand' | null`; null ⇒ fairway). Logged by Task 7's UI.
- Produces: unchanged signatures; only the start-lie lookup changes. **Existing behavior when `approachLie` is null must be bit-identical.**

- [ ] **Step 1: Write the failing tests**

Append inside the test file:

```js
describe('sgApproach with approachLie', () => {
  const holes = [{ par: 4, strokes: 4 }];
  const base = { putts: 2, approachBucket: '100-150', approachResult: 'green', firstPuttBucket: '3-6' };
  // end state for all three: E(green, 4.5) = 1.82401

  test('null approachLie behaves exactly like fairway (legacy)', () => {
    const nullLie = sgApproach(makeRound(holes, [{ ...base }]), 'me');
    const fairway = sgApproach(makeRound(holes, [{ ...base, approachLie: 'fairway' }]), 'me');
    expect(nullLie.perHole[0]).toBeCloseTo(fairway.perHole[0], 10);
    // E(fairway, 125) = 2.88803 → 2.88803 - 1.82401 - 1
    expect(nullLie.perHole[0]).toBeCloseTo(0.06, 2);
  });
  test('rough start lie raises the expected strokes, so the same shot gains more', () => {
    const r = sgApproach(makeRound(holes, [{ ...base, approachLie: 'rough' }]), 'me');
    // E(rough, 125) = 3.06803 → 3.06803 - 1.82401 - 1
    expect(r.perHole[0]).toBeCloseTo(0.24, 2);
  });
  test('sand start lie uses the sand table (clamped at its 91.4 m endpoint)', () => {
    const r = sgApproach(makeRound(holes, [{ ...base, approachLie: 'sand' }]), 'me');
    // E(sand, 125) clamps to 3.25 → 3.25 - 1.82401 - 1
    expect(r.perHole[0]).toBeCloseTo(0.43, 2);
  });
  test('par 3 ignores approachLie — start is always the tee', () => {
    const p3 = [{ par: 3, strokes: 3 }];
    const withLie = sgApproach(makeRound(p3, [{ ...base, approachLie: 'rough' }]), 'me');
    const without = sgApproach(makeRound(p3, [{ ...base }]), 'me');
    expect(withLie.perHole[0]).toBeCloseTo(without.perHole[0], 10);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/store/__tests__/statsEngine.test.js -t "approachLie"`
Expected: FAIL — the rough/sand tests get the fairway value (0.06) instead of 0.24 / 0.43.

- [ ] **Step 3: Implement**

Add near `DRIVE_LIE_TABLE` (Task 2):

```js
const APPROACH_LIES = new Set(['fairway', 'rough', 'sand']);

// The approach's own start lie — the logged shot aimed at the green may be
// played from anywhere (the drive's lie says nothing about it after a
// punch-out or lay-up). Null means fairway: the legacy assumption.
function approachStartLie(d, isPar3) {
  if (isPar3) return 'tee';
  return APPROACH_LIES.has(d?.approachLie) ? d.approachLie : 'fairway';
}
```

In `sgApproach`, replace:

```js
    const startLie = isPar3 ? 'tee' : 'fairway';
```

with:

```js
    const startLie = approachStartLie(d, isPar3);
```

In `approachTargetGaps`, replace:

```js
      const startLie = hole.par === 3 ? 'tee' : 'fairway';
```

with:

```js
      const startLie = approachStartLie(d, hole.par === 3);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/store/__tests__/statsEngine.test.js`
Expected: PASS — including every pre-existing `sgApproach` test (they log no `approachLie`, so values are unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/store/statsEngine.js src/store/__tests__/statsEngine.test.js
git commit -m "feat(sg): approach SG starts from the logged approach lie"
```

---

### Task 4: Fifth category in `sgTotal` / `sgSeason` + per-round category series

**Files:**
- Modify: `src/store/statsEngine.js` — `sgTotal` (~line 2619), `SG_CATEGORIES` const (~line 2646), `sgSeason` (~line 2648)
- Test: `src/store/__tests__/statsEngine.test.js`

**Interfaces:**
- Consumes: `sgOffTheTee` (Task 2).
- Produces (relied on by Tasks 5, 6, 9, 10, 12):
  - `sgTotal(...)` → `byCategory` / `sampleHolesByCategory` gain an `offTheTee` key; `total` includes it.
  - `sgSeason(...)` → additionally returns `roundsByCategory` (`{ offTheTee, approach, aroundGreen, putting, penalties }` — rounds contributing to each category) and each `perRound[i]` gains `byCategory` (that round's raw per-category totals).

- [ ] **Step 1: Write the failing tests**

```js
describe('sgTotal with offTheTee', () => {
  test('offTheTee joins byCategory and the headline total', () => {
    const round = makeRound(
      [{ par: 4, strokes: 5 }],
      [{
        drive: 'left', driveLie: 'rough', driveDistBucket: '180-210',
        putts: 2, approachBucket: '100-150', approachResult: 'green', firstPuttBucket: '3-6',
      }],
    );
    const r = sgTotal(round, 'me');
    expect(r.byCategory.offTheTee).toBeCloseTo(-0.32, 2);
    expect(r.sampleHolesByCategory.offTheTee).toBe(1);
    const sum = r.byCategory.offTheTee + r.byCategory.approach
      + r.byCategory.aroundGreen + r.byCategory.putting + r.byCategory.penalties;
    expect(r.total).toBeCloseTo(sum, 10);
  });
});

describe('sgSeason with offTheTee', () => {
  // 18 tracked holes so the season min-sample gate opens.
  const holes18 = Array.from({ length: 18 }, () => ({ par: 4, strokes: 4 }));
  const detail = {
    drive: 'fairway', driveDistBucket: '210-240',
    putts: 2, approachBucket: '100-150', approachResult: 'green', firstPuttBucket: '3-6',
  };
  const details18 = Array.from({ length: 18 }, () => ({ ...detail }));
  const round = makeRound(holes18, details18);

  test('per-category average, roundsByCategory, and perRound.byCategory', () => {
    const season = sgSeason([round], 'me');
    expect(season.byCategory.offTheTee).toBeCloseTo(18 * -0.0131, 1);
    expect(season.roundsByCategory).toEqual({
      offTheTee: 1, approach: 1, aroundGreen: 0, putting: 1, penalties: 1,
    });
    expect(season.perRound[0].byCategory.offTheTee).toBeCloseTo(18 * -0.0131, 1);
    expect(season.perRound[0].byCategory.putting).toBeDefined();
  });
  test('legacy rounds without drive buckets leave offTheTee unsampled', () => {
    const legacy = makeRound(holes18, Array.from({ length: 18 }, () => ({
      putts: 2, approachBucket: '100-150', approachResult: 'green', firstPuttBucket: '3-6',
    })));
    const season = sgSeason([legacy], 'me');
    expect(season.roundsByCategory.offTheTee).toBe(0);
    expect(season.byCategory.offTheTee).toBe(0);
    expect(season.sampleHolesByCategory.offTheTee).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/store/__tests__/statsEngine.test.js -t "offTheTee"`
Expected: FAIL — `byCategory.offTheTee` undefined, `roundsByCategory` undefined.

- [ ] **Step 3: Implement**

In `sgTotal`, add the category (keep existing ordering conventions):

```js
export function sgTotal(round, playerId, targetHandicap = 0) {
  const offTheTee   = sgOffTheTee(round, playerId, targetHandicap);
  const approach    = sgApproach(round, playerId, targetHandicap);
  const aroundGreen = sgAroundGreen(round, playerId, targetHandicap);
  const putting     = sgPutting(round, playerId, targetHandicap);
  const penalties   = sgPenalties(round, playerId);
  const byCategory = {
    offTheTee:   offTheTee.total,
    approach:    approach.total,
    aroundGreen: aroundGreen.total,
    putting:     putting.total,
    penalties:   penalties.total,
  };
  const total = byCategory.offTheTee + byCategory.approach + byCategory.aroundGreen
    + byCategory.putting + byCategory.penalties;
  const sampleHoles = Math.max(
    offTheTee.sampleHoles, approach.sampleHoles, aroundGreen.sampleHoles,
    putting.sampleHoles, penalties.sampleHoles,
  );
  const sampleHolesByCategory = {
    offTheTee:   offTheTee.sampleHoles,
    approach:    approach.sampleHoles,
    aroundGreen: aroundGreen.sampleHoles,
    putting:     putting.sampleHoles,
    penalties:   penalties.sampleHoles,
  };
  return { total, byCategory, sampleHoles, sampleHolesByCategory };
}
```

Update the category list:

```js
const SG_CATEGORIES = ['offTheTee', 'approach', 'aroundGreen', 'putting', 'penalties'];
```

In `sgSeason`: initialize `byCategory`, `categoryRounds`, `sampleHolesByCategory` with the five keys (add `offTheTee: 0` to each literal); include the per-round categories in `perRound`:

```js
    perRound.push({ index: i, total: r.total, sampleHoles: r.sampleHoles, byCategory: r.byCategory });
```

add `offTheTee` to the `perCategory` literal:

```js
  const perCategory = {
    offTheTee:   categoryRounds.offTheTee > 0 ? byCategory.offTheTee / categoryRounds.offTheTee : 0,
    approach:    categoryRounds.approach > 0 ? byCategory.approach / categoryRounds.approach : 0,
    aroundGreen: categoryRounds.aroundGreen > 0 ? byCategory.aroundGreen / categoryRounds.aroundGreen : 0,
    putting:     categoryRounds.putting > 0 ? byCategory.putting / categoryRounds.putting : 0,
    penalties:   categoryRounds.penalties > 0 ? byCategory.penalties / categoryRounds.penalties : 0,
  };
```

and expose the denominators in **both** return statements (the early `total: null` return and the full one): add `roundsByCategory: categoryRounds` to each.

- [ ] **Step 4: Run the store suites**

Run: `npx jest src/store/__tests__/statsEngine.test.js src/store/__tests__/personalStats.test.js src/store/__tests__/coachInsights.test.js`
Expected: statsEngine PASS. If personalStats/coachInsights tests assert exact `byCategory` shapes, update those assertions to include `offTheTee` (value 0 / sample 0 for fixtures without drive buckets) — do NOT weaken them to partial matches.

- [ ] **Step 5: Commit**

```bash
git add src/store/statsEngine.js src/store/__tests__/
git commit -m "feat(sg): offTheTee joins sgTotal/sgSeason; per-round category series"
```

---

### Task 5: `sgReconciliation` — where the strokes go

**Files:**
- Modify: `src/store/statsEngine.js` (add after `sgSeason`)
- Test: `src/store/__tests__/statsEngine.test.js`

**Interfaces:**
- Consumes: `sgTotal` (Task 4), `SG_CATEGORIES` const, `round.isComplete` (stamped by `buildSyntheticTournament`).
- Produces (used by Tasks 6 and 11):

```js
sgReconciliation(rounds, playerId, targetHandicap = 0) → {
  rounds: number,                 // complete rounds with any SG sample
  expectedAvg, actualAvg, gapAvg, // per-round averages (null when rounds === 0)
  byCategoryAvg,                  // { offTheTee, approach, aroundGreen, putting, penalties } | null
  residualAvg,                    // gapAvg − Σ byCategoryAvg (null when rounds === 0)
  perRound: [{ index, expected, actual, gap, byCategory, residual }],
}
```

Sign convention: `gap = expected − actual` — negative when the player took more strokes than the target. Invariant: `gap = Σ byCategory + residual` per round AND for the averages.

- [ ] **Step 1: Write the failing tests**

```js
describe('sgReconciliation', () => {
  const detail = {
    drive: 'fairway', driveDistBucket: '210-240',
    putts: 2, approachBucket: '100-150', approachResult: 'green', firstPuttBucket: '3-6',
  };

  test('expected = par + hcp·(holes/18); residual makes categories sum exactly', () => {
    const round = { ...makeRound([{ par: 4, strokes: 5 }], [{ ...detail }]), isComplete: true };
    const r = sgReconciliation([round], 'me', 0);
    expect(r.rounds).toBe(1);
    expect(r.perRound[0].expected).toBeCloseTo(4, 10);
    expect(r.perRound[0].actual).toBe(5);
    expect(r.perRound[0].gap).toBeCloseTo(-1, 10);
    const catSum = Object.values(r.perRound[0].byCategory).reduce((a, x) => a + x, 0);
    expect(r.perRound[0].residual).toBeCloseTo(r.perRound[0].gap - catSum, 10);
    expect(r.gapAvg).toBeCloseTo(
      Object.values(r.byCategoryAvg).reduce((a, x) => a + x, 0) + r.residualAvg, 10,
    );
  });
  test('target handicap scales with holes played', () => {
    const round = { ...makeRound([{ par: 4, strokes: 4 }], [{ ...detail }]), isComplete: true };
    const r = sgReconciliation([round], 'me', 18);
    // 1 hole of 18 → expected = 4 + 18·(1/18) = 5
    expect(r.perRound[0].expected).toBeCloseTo(5, 10);
    expect(r.perRound[0].gap).toBeCloseTo(1, 10);
  });
  test('skips incomplete rounds and rounds without any SG sample', () => {
    const incomplete = { ...makeRound([{ par: 4, strokes: 5 }], [{ ...detail }]), isComplete: false };
    const noDetail = { ...makeRound([{ par: 4, strokes: 5 }], []), isComplete: true };
    const r = sgReconciliation([incomplete, noDetail], 'me', 0);
    expect(r.rounds).toBe(0);
    expect(r.gapAvg).toBeNull();
    expect(r.byCategoryAvg).toBeNull();
  });
});
```

Note on the third test: `makeRound([...], [])` produces an empty `shotDetails` map for the player, so every SG function sees no detail object and returns null per hole (`sgPenalties` included — no detail means "unknown", per its comment), giving `sampleHoles === 0`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/store/__tests__/statsEngine.test.js -t "sgReconciliation"`
Expected: FAIL — `sgReconciliation is not a function`.

- [ ] **Step 3: Implement**

Add after `sgSeason`:

```js
// ── SG Reconciliation ──
// "Where the strokes go": ties SG categories back to real scores. Expected
// score = par + targetHandicap (scaled by holes played) — the plain meaning
// of playing to a handicap; needs no course data. The residual absorbs
// everything the categories don't measure (lay-ups, punch-outs, holes with
// partial detail), so the panel always sums exactly instead of pretending
// full attribution.
export function sgReconciliation(rounds, playerId, targetHandicap = 0) {
  const perRound = [];
  (rounds ?? []).forEach((round, index) => {
    if (!round?.isComplete) return;
    const r = sgTotal(round, playerId, targetHandicap);
    if (r.sampleHoles === 0) return;
    let parPlayed = 0;
    let actual = 0;
    let holesPlayed = 0;
    (round.holes ?? []).forEach((hole) => {
      const sc = round.scores?.[playerId]?.[hole.number];
      if (sc == null) return;
      parPlayed += hole.par;
      actual += sc;
      holesPlayed += 1;
    });
    if (holesPlayed === 0) return;
    const expected = parPlayed + targetHandicap * (holesPlayed / 18);
    const gap = expected - actual;
    const explained = SG_CATEGORIES.reduce((sum, c) => sum + r.byCategory[c], 0);
    perRound.push({
      index, expected, actual, gap,
      byCategory: r.byCategory,
      residual: gap - explained,
    });
  });
  const n = perRound.length;
  if (n === 0) {
    return {
      rounds: 0, perRound,
      expectedAvg: null, actualAvg: null, gapAvg: null,
      byCategoryAvg: null, residualAvg: null,
    };
  }
  const avg = (pick) => perRound.reduce((sum, r) => sum + pick(r), 0) / n;
  const byCategoryAvg = Object.fromEntries(
    SG_CATEGORIES.map((c) => [c, avg((r) => r.byCategory[c])]),
  );
  return {
    rounds: n,
    perRound,
    expectedAvg: avg((r) => r.expected),
    actualAvg: avg((r) => r.actual),
    gapAvg: avg((r) => r.gap),
    byCategoryAvg,
    residualAvg: avg((r) => r.residual),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/store/__tests__/statsEngine.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/statsEngine.js src/store/__tests__/statsEngine.test.js
git commit -m "feat(sg): reconciliation vs par+handicap with exact-sum residual"
```

---

### Task 6: Wire personal deltas + reconciliation into `computeMyStats`; teach the coach the fifth category

**Files:**
- Modify: `src/store/personalStats.js`
- Modify: `src/store/coachInsights.js`
- Test: `src/store/__tests__/personalStats.test.js`, `src/store/__tests__/coachInsights.test.js`

**Interfaces:**
- Consumes: `sgSeason` (with `roundsByCategory`), `sgReconciliation` from `./statsEngine`; `MIN_FORM_HISTORY_ROUNDS` (module-local const, 3); `buildSyntheticTournament`, `CANON_ID`.
- Produces:
  - `computeSgFormDelta(myRounds, { n = 5, targetHandicap = 0 }) → { [category]: { recent, previous, delta, direction } } | null` (export from personalStats)
  - `computeMyStats(...).strokesGained` gains `.personalDelta` (result above) and `.reconciliation` (Task 5's result).
  - `buildActionPlan` labels `offTheTee` as `'Off the tee'`.
  - `coachInsights`: `SG_CATEGORY_TITLES.offTheTee = 'Off the tee'`; the `isRemovedDrivingSgAction` guard is **deleted** (driving SG is a real category again).

- [ ] **Step 1: Write the failing tests**

Append to `src/store/__tests__/personalStats.test.js` (reuse its existing fixture helpers if it has round builders; otherwise build MyRound records inline as below — each entry only needs `{ round, playerId, player, isComplete, holesPlayed }` for `buildSyntheticTournament`):

```js
import { computeSgFormDelta } from '../personalStats';

// 18-hole round where every hole is a 2-putt (or 1-putt) from the 2-3 m bucket.
// E(green, 2.5 m, scratch) = 1.60984 → 2-putt SG/hole = -0.39016, 1-putt = +0.60984.
function puttingRound(putts) {
  const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
  return {
    round: {
      holes,
      scores: { p1: Object.fromEntries(holes.map((h) => [h.number, 2 + putts])) },
      shotDetails: { p1: Object.fromEntries(holes.map((h) => [h.number, { putts, firstPuttBucket: '2-3' }])) },
    },
    playerId: 'p1',
    player: { id: 'p1', name: 'Me', handicap: 10 },
    isComplete: true,
    holesPlayed: 18,
  };
}

describe('computeSgFormDelta', () => {
  test('putting delta = recent SG/round − previous SG/round', () => {
    const history = [puttingRound(2), puttingRound(2), puttingRound(2)];
    const recent = [puttingRound(1)];
    const deltas = computeSgFormDelta([...history, ...recent], { n: 1, targetHandicap: 0 });
    // previous: 18·(-0.39016) = -7.023; recent: 18·(+0.60984) = +10.977
    expect(deltas.putting.previous).toBeCloseTo(-7.02, 1);
    expect(deltas.putting.recent).toBeCloseTo(10.98, 1);
    expect(deltas.putting.delta).toBeCloseTo(18.0, 1);
    expect(deltas.putting.direction).toBe('up');
  });
  test('null with fewer than 3 history rounds', () => {
    expect(computeSgFormDelta([puttingRound(2), puttingRound(1)], { n: 1 })).toBeNull();
  });
  test('categories without data on either side get null delta', () => {
    const history = [puttingRound(2), puttingRound(2), puttingRound(2)];
    const deltas = computeSgFormDelta([...history, puttingRound(1)], { n: 1 });
    expect(deltas.offTheTee.delta).toBeNull();
    expect(deltas.offTheTee.direction).toBe('flat');
  });
});

describe('computeMyStats strokesGained extensions', () => {
  test('personalDelta and reconciliation ride on strokesGained', () => {
    const rounds = [puttingRound(2), puttingRound(2), puttingRound(2), puttingRound(1)];
    const stats = computeMyStats(rounds, { n: 1, targetHandicap: 0 });
    expect(stats.strokesGained.personalDelta.putting.direction).toBe('up');
    expect(stats.strokesGained.reconciliation.rounds).toBe(4);
    // Reconciliation invariant survives assembly.
    const rec = stats.strokesGained.reconciliation;
    const catSum = Object.values(rec.byCategoryAvg).reduce((a, x) => a + x, 0);
    expect(rec.gapAvg).toBeCloseTo(catSum + rec.residualAvg, 10);
  });
});
```

Append to `src/store/__tests__/coachInsights.test.js`:

```js
describe('offTheTee category insights', () => {
  test('a strong offTheTee leak lands in the board with a Driving area', () => {
    const stats = {
      strokesGained: {
        byCategory: { offTheTee: -1.2, approach: 0, aroundGreen: 0, putting: 0, penalties: 0 },
        sampleHolesByCategory: { offTheTee: 30, approach: 30, aroundGreen: 30, putting: 30, penalties: 30 },
        sampleHoles: 30,
      },
    };
    const { board } = buildCoachInsights(stats);
    const insight = board.fixFirst.find((i) => i.title === 'Off the tee');
    expect(insight).toBeDefined();
    expect(insight.area).toBe('driving');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/store/__tests__/personalStats.test.js src/store/__tests__/coachInsights.test.js`
Expected: FAIL — `computeSgFormDelta` not exported; coach board has no 'Off the tee' insight (missing title mapping).

- [ ] **Step 3: Implement**

`personalStats.js` — extend the statsEngine import with `sgReconciliation`; add after `computeRecentVsHistory`:

```js
// ── computeSgFormDelta ──
// Per-category SG "recent vs previous" — same disjoint split (and the same
// MIN_FORM_HISTORY_ROUNDS guard) as computeRecentVsHistory, but over
// sgSeason. A side without enough SG sample (sgSeason returns byCategory:
// null under 18 holes) yields null deltas rather than fabricated ones.
const SG_DELTA_CATEGORIES = ['offTheTee', 'approach', 'aroundGreen', 'putting', 'penalties'];

export function computeSgFormDelta(myRounds, { n = 5, targetHandicap = 0 } = {}) {
  const all = myRounds || [];
  const recentRounds = all.slice(-n);
  const historyRounds = all.slice(0, Math.max(0, all.length - n));
  if (historyRounds.length < MIN_FORM_HISTORY_ROUNDS) return null;
  const recent = sgSeason(buildSyntheticTournament(recentRounds).rounds, CANON_ID, targetHandicap);
  const previous = sgSeason(buildSyntheticTournament(historyRounds).rounds, CANON_ID, targetHandicap);
  return Object.fromEntries(SG_DELTA_CATEGORIES.map((category) => {
    const recentVal = recent.byCategory?.[category] ?? null;
    const previousVal = previous.byCategory?.[category] ?? null;
    const bothSampled = recentVal != null && previousVal != null
      && (recent.roundsByCategory?.[category] ?? 0) > 0
      && (previous.roundsByCategory?.[category] ?? 0) > 0;
    const delta = bothSampled ? +(recentVal - previousVal).toFixed(2) : null;
    let direction = 'flat';
    if (delta != null && delta !== 0) direction = delta > 0 ? 'up' : 'down';
    return [category, {
      recent: recentVal, previous: previousVal, delta, direction,
    }];
  }));
}
```

In `computeMyStats`, replace the `strokesGained` line:

```js
  const strokesGained = {
    ...sgSeason(synthetic.rounds, CANON_ID, targetHandicap),
    personalDelta: computeSgFormDelta(rounds, { n, targetHandicap }),
    reconciliation: sgReconciliation(synthetic.rounds, CANON_ID, targetHandicap),
  };
```

(`buildActionPlan` and `baseStats.strokesGained` keep receiving the same object — the two extra keys are additive.)

In `buildActionPlan`'s label map add the new category:

```js
    const label = {
      offTheTee: 'Off the tee',
      approach: 'Approach',
      aroundGreen: 'Around the green',
      putting: 'Putting',
    }[key] ?? key;
```

`coachInsights.js`:

1. Add to `SG_CATEGORY_TITLES`: `offTheTee: 'Off the tee',`
2. Delete the `isRemovedDrivingSgAction` function (lines ~87-90) and its call in `actionItemInsight` (`if (isRemovedDrivingSgAction(item)) return null;`) — that guard existed to suppress a *removed* driving SG feature; off-the-tee SG is now a first-class category. If `coachInsights.test.js` has a test asserting driving SG actions are suppressed, delete that test (cite this task in the commit body).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/store/__tests__/personalStats.test.js src/store/__tests__/coachInsights.test.js src/store/__tests__/statsEngine.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/personalStats.js src/store/coachInsights.js src/store/__tests__/
git commit -m "feat(sg): personal deltas + reconciliation in computeMyStats; coach learns offTheTee"
```

---

### Task 7: Shot-detail logging — drive lie, drive distance, approach lie

**Files:**
- Modify: `src/components/scorecard/constants.js`
- Modify: `src/components/scorecard/ShotDetailPanel.js`
- Create: `src/components/scorecard/__tests__/ShotDetailPanel.test.js`

**Interfaces:**
- Consumes: `BucketSegment` and chip-row patterns already in `ShotDetailPanel.js`; `onChange(patch)` merges patches into the hole's detail.
- Produces: `DEFAULT_SHOT` gains `driveLie: null`, `driveDistBucket: null`, `approachLie: null`. New constant exports: `DRIVE_DIST_BUCKETS`, `DRIVE_DIST_LABELS`, `DRIVE_MISS_LIES`, `DRIVE_MISS_LIE_LABELS`, `APPROACH_LIES`, `APPROACH_LIE_LABELS`. None of the new fields are strokes — `shotDetailStrokeCount` is intentionally untouched.

- [ ] **Step 1: Write the failing tests**

Create `src/components/scorecard/__tests__/ShotDetailPanel.test.js` (theme mock copied from `HolePage.test.js`):

```js
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ShotDetailPanel } from '../ShotDetailPanel';

jest.mock('../../../theme/ThemeContext', () => ({
  useTheme: () => {
    const { light, semantic, typography, fonts, spacing, radius } = jest.requireActual('../../../theme/tokens');
    return {
      theme: {
        ...light,
        semantic,
        masters: semantic.masters,
        destructive: semantic.destructive.light,
        scoreColor: (level) => semantic.score[level].light,
        typography,
        fonts,
        spacing,
        radius,
        mode: 'light',
        isDark: false,
      },
    };
  },
}));

const par4 = { number: 1, par: 4, strokeIndex: 5 };
const par3 = { number: 2, par: 3, strokeIndex: 9 };

describe('ShotDetailPanel drive + approach lie inputs', () => {
  test('drive distance row renders on par 4/5, not on par 3', () => {
    const p4 = render(<ShotDetailPanel hole={par4} detail={{}} onChange={jest.fn()} strokes={null} />);
    expect(p4.getByText('Drive distance')).toBeTruthy();
    const p3 = render(<ShotDetailPanel hole={par3} detail={{}} onChange={jest.fn()} strokes={null} />);
    expect(p3.queryByText('Drive distance')).toBeNull();
  });
  test('miss-lie chips appear only after a miss direction', () => {
    const fairway = render(
      <ShotDetailPanel hole={par4} detail={{ drive: 'fairway' }} onChange={jest.fn()} strokes={null} />,
    );
    expect(fairway.queryByText('Drive finished in')).toBeNull();
    const miss = render(
      <ShotDetailPanel hole={par4} detail={{ drive: 'left' }} onChange={jest.fn()} strokes={null} />,
    );
    expect(miss.getByText('Drive finished in')).toBeTruthy();
  });
  test('selecting a drive lie patches driveLie; changing direction clears it', () => {
    const onChange = jest.fn();
    const miss = render(
      <ShotDetailPanel hole={par4} detail={{ drive: 'left' }} onChange={onChange} strokes={null} />,
    );
    fireEvent.press(miss.getByLabelText('Drive lie Sand'));
    expect(onChange).toHaveBeenCalledWith({ driveLie: 'sand' });
    fireEvent.press(miss.getByLabelText('Driver Fairway'));
    expect(onChange).toHaveBeenCalledWith({ drive: 'fairway', driveLie: null });
  });
  test('approach lie chips show once a bucket is picked; default reads fairway', () => {
    const noBucket = render(
      <ShotDetailPanel hole={par4} detail={{}} onChange={jest.fn()} strokes={null} />,
    );
    expect(noBucket.queryByText('Approach lie')).toBeNull();
    const onChange = jest.fn();
    const withBucket = render(
      <ShotDetailPanel
        hole={par4}
        detail={{ approachBucket: '100-150' }}
        onChange={onChange}
        strokes={null}
      />,
    );
    expect(withBucket.getByText('Approach lie')).toBeTruthy();
    expect(withBucket.getByLabelText('Approach lie Fairway').props.accessibilityState.selected).toBe(true);
    fireEvent.press(withBucket.getByLabelText('Approach lie Rough'));
    expect(onChange).toHaveBeenCalledWith({ approachLie: 'rough' });
  });
  test('approach lie hidden on par 3s', () => {
    const p3 = render(
      <ShotDetailPanel hole={par3} detail={{ approachBucket: '100-150' }} onChange={jest.fn()} strokes={null} />,
    );
    expect(p3.queryByText('Approach lie')).toBeNull();
  });
  test('clearing the approach bucket clears approachLie too', () => {
    const onChange = jest.fn();
    const r = render(
      <ShotDetailPanel
        hole={par4}
        detail={{ approachBucket: '100-150', approachLie: 'rough' }}
        onChange={onChange}
        strokes={null}
      />,
    );
    fireEvent.press(r.getByLabelText('Approach 100-150'));
    expect(onChange).toHaveBeenCalledWith({ approachBucket: null, approachResult: null, approachLie: null });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/components/scorecard/__tests__/ShotDetailPanel.test.js`
Expected: FAIL — 'Drive distance' / 'Drive finished in' / 'Approach lie' not found.

- [ ] **Step 3: Implement constants**

In `src/components/scorecard/constants.js`, extend `DEFAULT_SHOT`:

```js
export const DEFAULT_SHOT = {
  putts: null,
  drive: null,
  driveLie: null,               // 'fairway' | 'rough' | 'sand' | 'trouble' | null (derived from drive when null)
  driveDistBucket: null,        // '0-150' | '150-180' | '180-210' | '210-240' | '240+' | null (metres)
  teePenalties: 0,
  otherPenalties: 0,
  sandShots: 0,
  recoveryOutcome: null,        // 'up-and-down' | 'sand-save' | 'none' | null
  firstPuttBucket: null,        // '0-1' | '1-2' | '2-3' | '3-6' | '6+' | null
  approachBucket: null,         // '0-50' | '50-100' | '100-150' | '150-200' | '200+' | null
  approachResult: null,         // 'green' | 'miss' | null
  approachLie: null,            // 'fairway' | 'rough' | 'sand' | null (null = fairway)
};
```

Add after `APPROACH_LABELS`:

```js
export const DRIVE_DIST_BUCKETS = ['0-150', '150-180', '180-210', '210-240', '240+'];
export const DRIVE_DIST_LABELS = {
  '0-150': '<150', '150-180': '150-180', '180-210': '180-210',
  '210-240': '210-240', '240+': '240+',
};

// Where a missed drive finished. Fairway hits need no lie — the direction
// chip already says fairway; the engine derives rough for unset misses.
export const DRIVE_MISS_LIES = ['rough', 'sand', 'trouble'];
export const DRIVE_MISS_LIE_LABELS = { rough: 'Rough', sand: 'Sand', trouble: 'Trouble' };

export const APPROACH_LIES = ['fairway', 'rough', 'sand'];
export const APPROACH_LIE_LABELS = { fairway: 'Fairway', rough: 'Rough', sand: 'Sand' };
```

- [ ] **Step 4: Implement the panel rows**

In `ShotDetailPanel.js`:

Extend the constants import with `DRIVE_DIST_BUCKETS, DRIVE_DIST_LABELS, DRIVE_MISS_LIES, DRIVE_MISS_LIE_LABELS, APPROACH_LIES, APPROACH_LIE_LABELS`.

Add a generic chip row component next to `ApproachResultRow` (same `outcomeChip` styling):

```js
// A labelled row of mutually-exclusive chips. `effectiveValue` drives the
// selected state so a derived default (e.g. approach lie = fairway) can show
// as selected without being stored.
function LieChipRow({ label, a11yPrefix, options, labels, effectiveValue, onSelect, theme, s, explainer, isLast = false }) {
  return (
    <View style={[s.shotRow, isLast && s.shotRowLast]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={s.shotRowLabel}>{label}</Text>
        {explainer}
      </View>
      <View style={s.driveBtns}>
        {options.map((key) => {
          const active = effectiveValue === key;
          return (
            <TouchableOpacity
              key={key}
              style={[s.outcomeChip, active && s.outcomeChipActive]}
              onPress={() => onSelect(key, active)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`${a11yPrefix} ${labels[key]}`}
              accessibilityState={{ selected: active }}
            >
              <Text style={[s.outcomeChipLabel, active && { color: theme.text.inverse }]}>
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

Inside the component body add `const driveMissed = d.drive === 'left' || d.drive === 'right' || d.drive === 'short';`

In the Driver row's `onPress`, clear the stored lie whenever the direction changes (stale sand/trouble from a previous choice must not survive a re-pick):

```js
                  onPress={() => onChange({ drive: active ? null : key, driveLie: null })}
```

After the Driver row (still inside `!isPar3`), add:

```js
      {!isPar3 && driveMissed && (
        <LieChipRow
          label="Drive finished in"
          a11yPrefix="Drive lie"
          options={DRIVE_MISS_LIES}
          labels={DRIVE_MISS_LIE_LABELS}
          effectiveValue={d.driveLie ?? 'rough'}
          onSelect={(key) => onChange({ driveLie: key })}
          theme={theme}
          s={s}
          explainer={
            <ShotDetailExplainer
              rowKey="driveLie"
              title="Drive lie"
              body="Where the tee shot finished. Rough is assumed for a miss unless you say otherwise; Trouble means trees, deep stuff, or anywhere you could only chip out."
            />
          }
        />
      )}
      {!isPar3 && (
        <BucketSegment
          label="Drive distance"
          value={d.driveDistBucket}
          buckets={DRIVE_DIST_BUCKETS}
          labels={DRIVE_DIST_LABELS}
          onSelect={(key) => onChange({ driveDistBucket: key })}
          theme={theme}
          s={s}
          hint="metres"
          explainer={
            <ShotDetailExplainer
              rowKey="driveDistBucket"
              title="Drive distance"
              body="Roughly how far the tee shot went. Powers the off-the-tee strokes gained category — no course measurements needed."
            />
          }
        />
      )}
```

In the existing approach `BucketSegment`'s `onSelect`, also clear the lie when the bucket clears:

```js
        onSelect={(key) => onChange({
          approachBucket: key,
          ...(key == null ? { approachResult: null, approachLie: null } : {}),
        })}
```

After the `ApproachResultRow` block, add:

```js
      {!isPar3 && d.approachBucket && (
        <LieChipRow
          label="Approach lie"
          a11yPrefix="Approach lie"
          options={APPROACH_LIES}
          labels={APPROACH_LIE_LABELS}
          effectiveValue={d.approachLie ?? 'fairway'}
          onSelect={(key) => onChange({ approachLie: key === 'fairway' ? null : key })}
          theme={theme}
          s={s}
          explainer={
            <ShotDetailExplainer
              rowKey="approachLie"
              title="Approach lie"
              body="Where you played the shot aimed at the green from. Fairway is assumed — only change it when you attacked the green from rough or sand."
            />
          }
        />
      )}
```

Storing `null` for fairway keeps old rounds and skipped inputs byte-identical (spec §1.1). Check the `isLast` props on neighboring rows still produce a clean bottom border (the last visible row should carry `isLast`); adjust the existing `isLast` expressions if the new rows change which row is last.

- [ ] **Step 5: Run tests**

Run: `npx jest src/components/scorecard/__tests__/`
Expected: PASS — new file and all pre-existing scorecard tests.

- [ ] **Step 6: Commit**

```bash
git add src/components/scorecard/
git commit -m "feat(scorecard): log drive lie + distance and approach lie for SG"
```

---

### Task 8: Fifth category in shotMetrics + PerformanceSnapshot

**Files:**
- Modify: `src/components/mystats/shotMetrics.js`
- Modify: `src/components/mystats/PerformanceSnapshot.js` (~line 96, the SGBar block)
- Test: `src/components/mystats/__tests__/CoachComponents.test.js` (only if it snapshots these — update snapshots via `npx jest -u` after inspecting the diff)

**Interfaces:**
- Consumes: `stats.strokesGained.byCategory.offTheTee` (Task 4).
- Produces: `SG_CATEGORIES` (shotMetrics) gains a first entry `{ key: 'offTheTee', label: 'Off the tee', area: 'Driving', signalTitle: 'Tee shots' }`; also export `MIN_SG_CATEGORY_SAMPLE = 10` (used by Task 9).

- [ ] **Step 1: Implement shotMetrics**

```js
const SG_CATEGORIES = [
  { key: 'offTheTee', label: 'Off the tee', area: 'Driving', signalTitle: 'Tee shots' },
  { key: 'approach', label: 'Approach', area: 'Approach', signalTitle: 'Approach shots' },
  { key: 'aroundGreen', label: 'Around green', area: 'Short game' },
  { key: 'putting', label: 'Putting', area: 'Putting', signalTitle: 'Putting performance' },
  { key: 'penalties', label: 'Penalties', area: 'Scoring', signalTitle: 'Other penalties' },
];

// Below this many contributing holes a category shows "needs N more holes"
// instead of a number (spec §1.7).
const MIN_SG_CATEGORY_SAMPLE = 10;
```

Add `MIN_SG_CATEGORY_SAMPLE` to the export list.

- [ ] **Step 2: Implement PerformanceSnapshot**

Add before the Approach bar (line ~96):

```js
          <SGBar label="Off the tee" value={strokesGained.byCategory?.offTheTee} />
```

- [ ] **Step 3: Run the mystats component suites**

Run: `npx jest src/components/mystats/__tests__/`
Expected: PASS (update any snapshot that legitimately gained the new bar; inspect the diff first).

- [ ] **Step 4: Commit**

```bash
git add src/components/mystats/
git commit -m "feat(sg-ui): off-the-tee category in shotMetrics and snapshot card"
```

---

### Task 9: ShotDashboard — gated category rows with personal-delta badges

**Files:**
- Modify: `src/components/mystats/ShotDashboard.js`
- Test: `src/components/mystats/__tests__/ShotDashboard.test.js` (create)

**Interfaces:**
- Consumes: `stats.strokesGained` — `byCategory`, `sampleHolesByCategory`, `personalDelta` (Task 6), `SG_CATEGORIES` + `MIN_SG_CATEGORY_SAMPLE` (Task 8), `SGBar`.
- Produces: internal `CategoryRow` component; Evidence panel copy `"<weakest label>: needs N more holes"` when any category is under-sampled, else `"All five categories sampled."`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/mystats/__tests__/ShotDashboard.test.js` with the same ThemeContext mock as Task 7's test file (copy the `jest.mock('../../../theme/ThemeContext', ...)` block verbatim — the relative path is the same depth from `mystats/__tests__/`), then:

```js
import React from 'react';
import { render } from '@testing-library/react-native';
import ShotDashboard from '../ShotDashboard';

const baseSG = {
  total: -1.2,
  sampleHoles: 36,
  byCategory: { offTheTee: -0.4, approach: -0.5, aroundGreen: 0.1, putting: -0.4, penalties: 0 },
  sampleHolesByCategory: { offTheTee: 4, approach: 30, aroundGreen: 12, putting: 30, penalties: 36 },
  roundsByCategory: { offTheTee: 1, approach: 2, aroundGreen: 2, putting: 2, penalties: 2 },
  personalDelta: {
    putting: { recent: -0.4, previous: -1.0, delta: 0.6, direction: 'up' },
    offTheTee: { recent: null, previous: null, delta: null, direction: 'flat' },
    approach: { recent: -0.5, previous: -0.5, delta: 0, direction: 'flat' },
    aroundGreen: { recent: 0.1, previous: 0.1, delta: 0, direction: 'flat' },
    penalties: { recent: 0, previous: 0, delta: 0, direction: 'flat' },
  },
  reconciliation: { rounds: 0, perRound: [], expectedAvg: null, actualAvg: null, gapAvg: null, byCategoryAvg: null, residualAvg: null },
  perRound: [],
};

function renderDash(sg = baseSG) {
  return render(<ShotDashboard stats={{ strokesGained: sg }} targetHandicap={0} onInfo={jest.fn()} />);
}

describe('ShotDashboard category gating and deltas', () => {
  test('under-sampled category renders needs-more-holes instead of a bar', () => {
    const r = renderDash();
    expect(r.getAllByText('Off the tee: needs 6 more holes').length).toBeGreaterThan(0);
  });
  test('well-sampled categories show a delta badge when history exists', () => {
    const r = renderDash();
    expect(r.getByText('▲ +0.6 vs your last stretch')).toBeTruthy();
  });
  test('no delta badge without personalDelta', () => {
    const r = renderDash({ ...baseSG, personalDelta: null });
    expect(r.queryByText(/vs your last stretch/)).toBeNull();
  });
});
```

(The gated-row copy appears twice when Off the tee is also the weakest category — hence `getAllByText`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/components/mystats/__tests__/ShotDashboard.test.js`
Expected: FAIL — texts not found.

- [ ] **Step 3: Implement**

In `ShotDashboard.js`, import `MIN_SG_CATEGORY_SAMPLE` from `./shotMetrics` and add:

```js
function CategoryRow({ category, strokesGained }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const sample = strokesGained?.sampleHolesByCategory?.[category.key] ?? 0;
  if (sample < MIN_SG_CATEGORY_SAMPLE) {
    return (
      <Text style={s.gatedRow}>
        {`${category.label}: needs ${MIN_SG_CATEGORY_SAMPLE - sample} more holes`}
      </Text>
    );
  }
  const delta = strokesGained?.personalDelta?.[category.key];
  const showDelta = delta?.delta != null && delta.delta !== 0;
  const up = delta?.direction === 'up';
  return (
    <View style={s.categoryRow}>
      <SGBar label={category.label} value={strokesGained.byCategory?.[category.key]} />
      <View style={s.categoryMeta}>
        {showDelta ? (
          <Text style={[s.deltaBadge, { color: up ? theme.scoreColor('good') : theme.destructive }]}>
            {`${up ? '▲' : '▼'} ${delta.delta > 0 ? '+' : ''}${delta.delta} vs your last stretch`}
          </Text>
        ) : <View />}
        <Text style={s.sampleChip}>{sampleText(sample, 'holes')}</Text>
      </View>
    </View>
  );
}
```

Replace the `sgBlock` mapping:

```js
      {strokesGained?.byCategory ? (
        <View style={s.sgBlock}>
          {SG_CATEGORIES.map((category) => (
            <CategoryRow key={category.key} category={category} strokesGained={strokesGained} />
          ))}
          {TargetNudge && strokesGained.sampleHoles >= 18
            && (targetHandicap == null || targetHandicap === 0)
            && <TargetNudge onTap={onChangeTarget} />}
        </View>
      ) : null}
```

Evidence panel: keep `panelValue` as-is; replace its `panelMeta` line with:

```js
          <Text style={s.panelMeta}>{evidenceMeta(strokesGained)}</Text>
```

with the helper:

```js
// Weakest-category call-out: name the thinnest sample when anything is still
// gated, otherwise confirm the tracked base.
function evidenceMeta(strokesGained) {
  const samples = strokesGained?.sampleHolesByCategory;
  if (!samples) return 'Bucketed from logged shots.';
  const gated = SG_CATEGORIES
    .map((c) => ({ label: c.label, sample: samples[c.key] ?? 0 }))
    .filter((c) => c.sample < MIN_SG_CATEGORY_SAMPLE)
    .sort((a, b) => a.sample - b.sample);
  if (gated.length === 0) return 'All five categories sampled.';
  return `${gated[0].label}: needs ${MIN_SG_CATEGORY_SAMPLE - gated[0].sample} more holes`;
}
```

Styles to add in `makeStyles`:

```js
    categoryRow: { gap: 2, paddingVertical: 2 },
    categoryMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    deltaBadge: { ...theme.typography.tiny, fontWeight: '800' },
    sampleChip: { ...theme.typography.tiny, color: theme.text.muted },
    gatedRow: { ...theme.typography.caption, color: theme.text.muted, fontStyle: 'italic', paddingVertical: 6 },
```

- [ ] **Step 4: Run tests**

Run: `npx jest src/components/mystats/__tests__/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/mystats/
git commit -m "feat(sg-ui): sample-gated category rows with personal-delta badges"
```

---

### Task 10: SG trend chart

**Files:**
- Create: `src/components/mystats/SGTrendCard.js`
- Modify: `src/components/mystats/tabs/ShotsTab.js` (render after `<ShotDashboard …/>`)
- Test: `src/components/mystats/__tests__/SGTrendCard.test.js` (create)

**Interfaces:**
- Consumes: `stats.strokesGained.perRound` (`[{ index, total, sampleHoles, byCategory }]`, Task 4), `TrendLineChart` (`series: [{label, value}]`, `variant`, `caption`, `formatValue`), `SectionCard`, `SG_CATEGORIES`.
- Produces: `export default function SGTrendCard({ strokesGained })`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/mystats/__tests__/SGTrendCard.test.js` (same ThemeContext mock block as Task 9):

```js
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import SGTrendCard from '../SGTrendCard';

const perRound = [
  { index: 0, total: -2.1, sampleHoles: 18, byCategory: { offTheTee: -0.5, approach: -1, aroundGreen: 0, putting: -0.6, penalties: 0 } },
  { index: 1, total: 0.4, sampleHoles: 18, byCategory: { offTheTee: 0.2, approach: 0.1, aroundGreen: 0, putting: 0.1, penalties: 0 } },
];

describe('SGTrendCard', () => {
  test('renders a chip per category plus Total and defaults to Total', () => {
    const r = render(<SGTrendCard strokesGained={{ perRound }} />);
    expect(r.getByText('Total')).toBeTruthy();
    expect(r.getByText('Off the tee')).toBeTruthy();
    expect(r.getByText('Putting')).toBeTruthy();
    expect(r.getByLabelText('SG trend Total').props.accessibilityState.selected).toBe(true);
  });
  test('switching chips switches the plotted series', () => {
    const r = render(<SGTrendCard strokesGained={{ perRound }} />);
    fireEvent.press(r.getByLabelText('SG trend Putting'));
    expect(r.getByLabelText('SG trend Putting').props.accessibilityState.selected).toBe(true);
  });
  test('renders nothing with fewer than 2 sampled rounds', () => {
    const r = render(<SGTrendCard strokesGained={{ perRound: [perRound[0]] }} />);
    expect(r.toJSON()).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/components/mystats/__tests__/SGTrendCard.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/components/mystats/SGTrendCard.js`:

```js
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import SectionCard from './SectionCard';
import TrendLineChart from './TrendLineChart';
import { SG_CATEGORIES } from './shotMetrics';

const CHIPS = [{ key: 'total', label: 'Total' }, ...SG_CATEGORIES.map(({ key, label }) => ({ key, label }))];

// Per-round strokes-gained trend. Answers "am I actually getting better?"
// per category — the season averages on the dashboard can't show direction.
export default function SGTrendCard({ strokesGained }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [active, setActive] = useState('total');
  const perRound = strokesGained?.perRound ?? [];
  if (perRound.length < 2) return null;

  const series = perRound.map((entry) => ({
    label: `R${entry.index + 1}`,
    value: active === 'total'
      ? entry.total
      : (entry.byCategory?.[active] ?? null),
  }));

  return (
    <SectionCard title="SG Trend">
      <View style={s.chipRow}>
        {CHIPS.map((chip) => {
          const selected = chip.key === active;
          return (
            <TouchableOpacity
              key={chip.key}
              style={[s.chip, selected && s.chipActive]}
              onPress={() => setActive(chip.key)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`SG trend ${chip.label}`}
              accessibilityState={{ selected }}
            >
              <Text style={[s.chipText, selected && s.chipTextActive]}>{chip.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <TrendLineChart
        series={series}
        color={theme.accent.primary}
        labelColor={theme.text.secondary}
        caption="Strokes gained per round vs target"
        formatValue={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`}
      />
    </SectionCard>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs, marginBottom: theme.spacing.sm },
    chip: {
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 5,
      borderRadius: theme.radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border.default,
      backgroundColor: theme.bg.secondary,
    },
    chipActive: { backgroundColor: theme.accent.primary, borderColor: theme.accent.primary },
    chipText: { ...theme.typography.caption, color: theme.text.secondary, fontWeight: '700' },
    chipTextActive: { color: theme.text.inverse },
  });
}
```

Wire into `ShotsTab.js` — import `SGTrendCard from '../SGTrendCard'` and render directly under `<ShotDashboard …/>`:

```js
      <SGTrendCard strokesGained={stats.strokesGained} />
```

- [ ] **Step 4: Run tests**

Run: `npx jest src/components/mystats/__tests__/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/mystats/
git commit -m "feat(sg-ui): per-round SG trend chart with category chips"
```

---

### Task 11: Reconciliation card — "Where your strokes go"

**Files:**
- Create: `src/components/mystats/SGReconciliationCard.js`
- Modify: `src/components/mystats/tabs/ShotsTab.js` (render after `<SGTrendCard …/>`)
- Test: `src/components/mystats/__tests__/SGReconciliationCard.test.js` (create)

**Interfaces:**
- Consumes: `stats.strokesGained.reconciliation` (Task 6), `SG_CATEGORIES`, `formatSignedFixed`, `SectionCard`.
- Produces: `export default function SGReconciliationCard({ reconciliation, targetHandicap })`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/mystats/__tests__/SGReconciliationCard.test.js` (same ThemeContext mock block as Task 9):

```js
import React from 'react';
import { render } from '@testing-library/react-native';
import SGReconciliationCard from '../SGReconciliationCard';

const reconciliation = {
  rounds: 6,
  expectedAvg: 90,
  actualAvg: 94.3,
  gapAvg: -4.3,
  byCategoryAvg: { offTheTee: -0.8, approach: -1.4, aroundGreen: 0.3, putting: -2.1, penalties: -1.2 },
  residualAvg: 0.9,
  perRound: [],
};

describe('SGReconciliationCard', () => {
  test('shows expected vs actual and every category plus the residual', () => {
    const r = render(<SGReconciliationCard reconciliation={reconciliation} targetHandicap={18} />);
    expect(r.getByText(/Expected for an 18-handicap: 90.0/)).toBeTruthy();
    expect(r.getByText(/You: 94.3/)).toBeTruthy();
    expect(r.getByText('Putting')).toBeTruthy();
    expect(r.getByText('-2.10')).toBeTruthy();
    expect(r.getByText('In-between & untracked')).toBeTruthy();
    expect(r.getByText('+0.90')).toBeTruthy();
    expect(r.getByText(/6 rounds/)).toBeTruthy();
  });
  test('renders nothing without reconciled rounds', () => {
    const r = render(
      <SGReconciliationCard
        reconciliation={{ rounds: 0, perRound: [], expectedAvg: null, actualAvg: null, gapAvg: null, byCategoryAvg: null, residualAvg: null }}
        targetHandicap={0}
      />,
    );
    expect(r.toJSON()).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/components/mystats/__tests__/SGReconciliationCard.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/components/mystats/SGReconciliationCard.js`:

```js
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import SectionCard from './SectionCard';
import { SG_CATEGORIES, formatSignedFixed } from './shotMetrics';

// Ties the SG categories back to real scores: expected (par + target
// handicap) vs actual strokes, split into the five categories plus an
// honest residual. The rows always sum to the gap — that invariant is the
// card's whole point (spec §1.6).
export default function SGReconciliationCard({ reconciliation, targetHandicap }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  if (!reconciliation || reconciliation.rounds === 0) return null;

  const targetLabel = targetHandicap == null || targetHandicap === 0
    ? 'Expected for scratch'
    : `Expected for an ${targetHandicap}-handicap`;
  const rows = [
    ...SG_CATEGORIES.map((c) => ({
      key: c.key, label: c.label, value: reconciliation.byCategoryAvg[c.key],
    })),
    { key: 'residual', label: 'In-between & untracked', value: reconciliation.residualAvg, muted: true },
  ];

  return (
    <SectionCard title="Where your strokes go">
      <Text style={s.headline}>
        {`${targetLabel}: ${reconciliation.expectedAvg.toFixed(1)} · You: ${reconciliation.actualAvg.toFixed(1)}`}
      </Text>
      <Text style={s.meta}>
        {`Average per round across ${reconciliation.rounds} rounds. The rows below sum to the ${formatSignedFixed(reconciliation.gapAvg)} gap.`}
      </Text>
      {rows.map((row) => (
        <View key={row.key} style={s.row}>
          <Text style={[s.rowLabel, row.muted && { color: theme.text.muted }]}>{row.label}</Text>
          <Text
            style={[
              s.rowValue,
              { color: row.value >= 0 ? theme.scoreColor('good') : theme.destructive },
              row.muted && { color: theme.text.muted },
            ]}
          >
            {formatSignedFixed(row.value)}
          </Text>
        </View>
      ))}
    </SectionCard>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    headline: { ...theme.typography.subhead, color: theme.text.primary, fontWeight: '800' },
    meta: { ...theme.typography.caption, color: theme.text.secondary, marginBottom: theme.spacing.sm },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 6,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border.subtle,
    },
    rowLabel: { ...theme.typography.body, color: theme.text.primary },
    rowValue: { ...theme.typography.body, fontWeight: '800' },
  });
}
```

Wire into `ShotsTab.js` under the trend card:

```js
      <SGReconciliationCard
        reconciliation={stats.strokesGained?.reconciliation}
        targetHandicap={targetHandicap}
      />
```

- [ ] **Step 4: Run tests**

Run: `npx jest src/components/mystats/__tests__/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/mystats/
git commit -m "feat(sg-ui): reconciliation card ties SG categories to real scores"
```

---

### Task 12: Signals list in per-round units

**Files:**
- Modify: `src/components/mystats/ShotDashboard.js` — `buildShotSignals` (bottom of file)
- Test: `src/components/mystats/__tests__/ShotDashboard.test.js`

**Interfaces:**
- Consumes: `stats.strokesGained.roundsByCategory` (Task 4), `stats.puttingTarget.buckets[*].{sgPerPutt, attempts}`, `stats.approachTarget.buckets[*].{avgSg, holes}`.
- Produces: every signal's `metric` reads `"<signed> SG/rnd"` and its `score` is the per-round impact, so category and bucket signals rank on the same scale.

- [ ] **Step 1: Write the failing test**

Append to `ShotDashboard.test.js`:

```js
import { buildShotSignals } from '../ShotDashboard';

describe('buildShotSignals per-round units', () => {
  test('putt bucket impact = sgPerPutt · attempts / puttingRounds', () => {
    const stats = {
      strokesGained: {
        byCategory: { offTheTee: 0, approach: 0, aroundGreen: 0, putting: 0, penalties: 0 },
        sampleHolesByCategory: { offTheTee: 20, approach: 20, aroundGreen: 20, putting: 20, penalties: 20 },
        sampleHoles: 20,
        roundsByCategory: { offTheTee: 4, approach: 4, aroundGreen: 4, putting: 4, penalties: 4 },
      },
      puttingTarget: {
        buckets: { '6+': { attempts: 16, sgPerPutt: -0.2, avgPutts: 2.4, expectedPutts: 2.1 } },
      },
    };
    const { bad } = buildShotSignals(stats);
    const putt = bad.find((sig) => sig.id === 'putt-6+');
    // -0.2 · 16 / 4 = -0.8 per round
    expect(putt.score).toBeCloseTo(-0.8, 5);
    expect(putt.metric).toBe('-0.80 SG/rnd');
  });
  test('bucket signals without a rounds denominator are skipped', () => {
    const stats = {
      strokesGained: { byCategory: null, sampleHoles: 0, roundsByCategory: null },
      puttingTarget: { buckets: { '6+': { attempts: 16, sgPerPutt: -0.2 } } },
    };
    const { bad } = buildShotSignals(stats);
    expect(bad.find((sig) => sig.id === 'putt-6+')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/components/mystats/__tests__/ShotDashboard.test.js`
Expected: FAIL — metric is `'-0.2 SG'`, score `-0.2`.

- [ ] **Step 3: Implement**

In `buildShotSignals`, replace the `PUTT_BUCKETS` and `APPROACH_BUCKETS` loops:

```js
  const puttingRounds = stats?.strokesGained?.roundsByCategory?.putting ?? 0;
  PUTT_BUCKETS.forEach((bucket) => {
    const row = stats?.puttingTarget?.buckets?.[bucket];
    if (!row || row.attempts === 0 || row.sgPerPutt == null || puttingRounds === 0) return;
    const perRound = (row.sgPerPutt * row.attempts) / puttingRounds;
    push({
      id: `putt-${bucket}`,
      area: 'Putting',
      title: `${bucket} m putts`,
      metric: `${formatSignedFixed(perRound)} SG/rnd`,
      detail: `${row.avgPutts} avg vs ${row.expectedPutts} target · ${sampleText(row.attempts, 'putts')}`,
      score: perRound,
    });
  });

  const approachRounds = stats?.strokesGained?.roundsByCategory?.approach ?? 0;
  APPROACH_BUCKETS.forEach((bucket) => {
    const row = stats?.approachTarget?.buckets?.[bucket];
    if (!row || row.holes === 0 || row.avgSg == null || approachRounds === 0) return;
    const perRound = (row.avgSg * row.holes) / approachRounds;
    push({
      id: `approach-${bucket}`,
      area: 'Approach',
      title: `${bucket} m approaches`,
      metric: `${formatSignedFixed(perRound)} SG/rnd`,
      detail: `${row.greenRate ?? row.girRate}% green · ${sampleText(row.holes, 'shots')}`,
      score: perRound,
    });
  });
```

In the `SG_CATEGORIES` loop of the same function, change the metric to match the unit label: `` metric: `${formatSignedFixed(value)} SG/rnd`, `` (the value is already per-round). Remove the now-unused `signed` import if nothing else in the file uses it.

- [ ] **Step 4: Run tests**

Run: `npx jest src/components/mystats/__tests__/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/mystats/
git commit -m "feat(sg-ui): signals ranked in comparable SG-per-round units"
```

---

### Task 13: Explainer copy — how strokes gained works here

**Files:**
- Modify: `src/components/mystats/statExplainers.js` — `strokesGainedExplainer` (top of file)

**Interfaces:** none new — same `(targetHandicap) → { title, subtitle, explainer }` shape, consumed by `SectionCard infoKey="strokesGained"`.

- [ ] **Step 1: Implement**

Replace the `explainer` string in `strokesGainedExplainer`'s return with:

```js
    explainer: `Strokes Gained tells you how your game compares to ${reference} from the same spots `
      + `on the course. Positive means you played that part of the game better than ${positiveCmp}; `
      + 'negative means worse.\n\n'
      + 'Five categories: Off the tee compares each logged drive (distance + lie) against the typical '
      + 'drive for your target on a standard-length hole — no course measurements needed. Approach, '
      + 'short game and putting use the distance buckets you log; penalties count penalty strokes '
      + 'directly.\n\n'
      + 'Recovery shots and lay-ups between the drive and the approach are not attributed to a '
      + 'category — the "Where your strokes go" card shows them honestly as "In-between & untracked" '
      + 'so everything always adds up to your real scores.\n\n'
      + 'A category only shows a number once it has enough logged holes behind it. Because you log '
      + "buckets instead of exact yardage, numbers are estimates built on Mark Broadie's published "
      + 'baselines — accurate to about ±0.2 strokes per round.',
```

- [ ] **Step 2: Verify nothing broke**

Run: `npx jest src/components/mystats/__tests__/`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/mystats/statExplainers.js
git commit -m "docs(sg): explainer covers five categories, benchmark drives, residual"
```

---

### Task 14: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all suites pass (~1830+ tests). Failures inside `.claude/worktrees/` / `.worktrees/` copies are environment noise — ignore those paths only.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: zero new errors/warnings in touched files.

- [ ] **Step 3: Runtime smoke check (if running interactively)**

Use the project's `verify` skill (Playwright against `npm run web`) to: open a round's scorecard → confirm the new Drive distance / Drive finished in / Approach lie inputs appear on a par 4 and not on a par 3; open My Stats → Shots and confirm the five category bars, trend card, and reconciliation card render without errors.

- [ ] **Step 4: Confirm clean tree**

```bash
git status --short
```

Expected: clean tree. Phase 1 complete — Phase 2 (coach) is a separate plan.
