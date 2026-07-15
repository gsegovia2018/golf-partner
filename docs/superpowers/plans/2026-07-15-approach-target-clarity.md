# Approach & Drive-Distance Target Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make "Approach vs target" read as you-vs-target strokes per bucket (like the putting section), and surface logged drive distance against the benchmark table's driver distance.

**Architecture:** Store-side: `approachTargetGaps` gains per-bucket `targetStrokes`/`yourStrokes` (from the per-entry `start` values it already computes); new `driveDistanceAverage` aggregate in `statsEngine.js`; `personalStats.computeMyStats` exposes `driveDistance`. UI-side: `ShotsTab.js` row builders updated. Spec: user-approved framing "you ≈ X strokes to finish · target ≈ Y".

**Tech Stack:** Plain JS store modules, Jest (jest-expo).

## Global Constraints

- All distances metres; benchmark `driverDistance` values are YARDS — convert with `YD_TO_M = 0.9144` and round to whole metres for display.
- `targetStrokes` = average of the bucket's per-entry `start` expected-strokes values (this naturally reflects the real mix of par-3 tee starts and fairway/rough lies); `yourStrokes` = that average minus the bucket's raw (unrounded) average SG; both rounded 2 dp. Existing fields (`holes`, `avgSg`, `girRate`, `greenRate`, `breakdown`) unchanged.
- Row tone logic unchanged (still driven by `avgSg`).
- Scratch/no-data behavior: buckets with no entries keep returning nulls; the drive-distance row renders only when at least one drive distance is logged.
- Run tests with `npx jest <path>`; full suite `npm test`; lint `npm run lint`.

---

### Task 1: You-vs-target strokes for approach buckets + drive distance row

**Files:**
- Modify: `src/store/statsEngine.js` — `approachTargetGaps` summarize (~line 2655) + new `driveDistanceAverage` (add after `driveLieBreakdown`)
- Modify: `src/store/personalStats.js` — expose `driveDistance` on `computeMyStats` baseStats
- Modify: `src/components/mystats/tabs/ShotsTab.js` — `makeApproachTargetRows`, `makeDrivingTargetRows`, and their call sites
- Test: `src/store/__tests__/statsEngine.test.js`, `src/store/__tests__/personalStats.test.js`

**Interfaces:**
- Consumes: `BUCKETS.driveDist` midpoints, `shotBenchmark.driverDistance` (yards), existing `approachTargetGaps` entry objects (each already computes `start` locally before pushing — extend the pushed entry with it).
- Produces: `approachTargetGaps(...).buckets[b]` gains `targetStrokes: number|null`, `yourStrokes: number|null`; `driveDistanceAverage(rounds, playerId) → { drives, avgDistance: number|null }` (export); `stats.driveDistance` (same shape).

- [ ] **Step 1: Write the failing tests**

Append to `statsEngine.test.js` (add `driveDistanceAverage` to the import; `makeRound` fixture exists near line 200):

```js
describe('approachTargetGaps you-vs-target strokes', () => {
  test('targetStrokes = avg expected start; yourStrokes = target − avgSg', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }],
      [{ putts: 2, approachBucket: '100-150', approachResult: 'green', firstPuttBucket: '3-6' }],
    );
    const r = approachTargetGaps([round], 'me', 0);
    const b = r.buckets['100-150'];
    // start = E(fairway, 125) = 2.88803; sg = +0.064 → you = 2.824
    expect(b.targetStrokes).toBeCloseTo(2.89, 2);
    expect(b.yourStrokes).toBeCloseTo(2.82, 2);
    expect(b.yourStrokes).toBeCloseTo(b.targetStrokes - b.avgSg, 1);
  });
  test('empty buckets keep null strokes fields', () => {
    const r = approachTargetGaps([], 'me', 0);
    expect(r.buckets['0-50'].targetStrokes).toBeNull();
    expect(r.buckets['0-50'].yourStrokes).toBeNull();
  });
});

describe('driveDistanceAverage', () => {
  test('averages logged bucket midpoints on par 4+', () => {
    const round = makeRound(
      [{ par: 4, strokes: 4 }, { par: 5, strokes: 5 }, { par: 3, strokes: 3 }, { par: 4, strokes: 4 }],
      [
        { drive: 'fairway', driveDistBucket: '210-240' }, // 225
        { drive: 'left', driveDistBucket: '150-180' },    // 165
        { drive: 'fairway', driveDistBucket: '210-240' }, // par 3 → ignored
        { drive: 'fairway' },                              // no bucket → ignored
      ],
    );
    const r = driveDistanceAverage([round], 'me');
    expect(r.drives).toBe(2);
    expect(r.avgDistance).toBe(195);
  });
  test('null average with no logged distances', () => {
    expect(driveDistanceAverage([], 'me')).toEqual({ drives: 0, avgDistance: null });
  });
});
```

Append to `personalStats.test.js` (reuses the existing `puttingRound` helper):

```js
describe('computeMyStats drive distance wiring', () => {
  test('driveDistance rides on stats', () => {
    const stats = computeMyStats([puttingRound(2)], { n: 1, targetHandicap: 0 });
    expect(stats.driveDistance).toEqual({ drives: 0, avgDistance: null });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/store/__tests__/statsEngine.test.js -t "you-vs-target" && npx jest src/store/__tests__/statsEngine.test.js -t "driveDistanceAverage"`
Expected: FAIL — `targetStrokes` undefined; `driveDistanceAverage` not a function.

- [ ] **Step 3: Implement the store layer**

In `approachTargetGaps` (statsEngine.js): the per-entry code already has `start` in scope when pushing — add it to the pushed entry:

```js
      buckets[d.approachBucket].push({
        holeNumber: hole.number,
        gir,
        green,
        start,
        sg: start - end - 1,
      });
```

In its `summarize`, extend the empty case with `targetStrokes: null, yourStrokes: null` and the non-empty return with:

```js
    const startAvg = arr.reduce((sum, e) => sum + e.start, 0) / arr.length;
    const sgAvgRaw = arr.reduce((sum, e) => sum + e.sg, 0) / arr.length;
```

```js
      targetStrokes: round2(startAvg),
      yourStrokes: round2(startAvg - sgAvgRaw),
```

(`round2` already exists locally in that function; keep `avgSg` computed exactly as before.)

Add after `driveLieBreakdown`:

```js
// Average logged drive distance (bucket midpoints, metres) on par 4+ holes.
// Surfaces the driveDistBucket data the scorecard collects for off-the-tee SG.
export function driveDistanceAverage(rounds, playerId) {
  let sum = 0;
  let drives = 0;
  (rounds ?? []).forEach((round) => {
    const byHole = round?.shotDetails?.[playerId];
    if (!byHole) return;
    (round.holes ?? []).forEach((hole) => {
      if (hole.par < 4) return;
      const mid = BUCKETS.driveDist[byHole[hole.number]?.driveDistBucket];
      if (mid == null) return;
      sum += mid;
      drives += 1;
    });
  });
  return { drives, avgDistance: drives > 0 ? Math.round(sum / drives) : null };
}
```

In `personalStats.js`: extend the statsEngine import with `driveDistanceAverage` and add to the `baseStats` object:

```js
    driveDistance: driveDistanceAverage(synthetic.rounds, CANON_ID),
```

- [ ] **Step 4: Implement the UI rows**

In `src/components/mystats/tabs/ShotsTab.js`:

Replace `makeApproachTargetRows` with:

```js
function makeApproachTargetRows(approachTarget) {
  return APPROACH_BUCKETS.map((bucket) => {
    const row = approachTarget.buckets[bucket];
    if (!row || row.holes === 0) return null;
    return {
      key: bucket,
      bucket,
      label: `${bucket} m approaches`,
      value: row.yourStrokes != null ? `you ≈ ${row.yourStrokes}` : signed(row.avgSg),
      raw: row.avgSg,
      secondary: targetSecondary([
        row.targetStrokes != null ? `target ≈ ${row.targetStrokes}` : null,
        `${formatPercent(row.greenRate ?? row.girRate)} green`,
        sampleText(row.holes, 'shots'),
      ].filter(Boolean), row.holes, 6),
      sample: row.holes,
      greenRate: row.greenRate ?? row.girRate,
      tone: toneFromSigned(row.avgSg, { sample: row.holes, minSample: 6 }),
    };
  }).filter(Boolean);
}
```

In `makeDrivingTargetRows`, change the signature to `makeDrivingTargetRows(shots, shotBenchmark, driveDistance)` and append one row to its returned array (after the tee-penalty row, before the final `];`):

```js
    ...(driveDistance?.drives > 0 ? [{
      key: 'driveDistance',
      label: 'Drive distance',
      value: `~${driveDistance.avgDistance} m`,
      secondary: targetSecondary([
        sampleText(driveDistance.drives, 'drives'),
        `target ~${Math.round(shotBenchmark.driverDistance * YD_TO_M)} m`,
      ], driveDistance.drives, 6),
      tone: toneFromComparison({
        value: driveDistance.avgDistance,
        target: Math.round(shotBenchmark.driverDistance * YD_TO_M),
        polarity: 'higher',
        tolerance: 10,
        sample: driveDistance.drives,
        minSample: 6,
      }),
      dim: false,
    }] : []),
```

Add near the top of the module (after imports): `const YD_TO_M = 0.9144;` and update the call site: `makeDrivingTargetRows(shots, shotBenchmark, stats.driveDistance)`.

- [ ] **Step 5: Run the affected suites**

Run: `npx jest src/store/__tests__/ src/components/mystats/__tests__/ src/screens/__tests__/`
Expected: PASS. If a pre-existing test pinned the old approach-row `value` format (`signed(avgSg)`), update the assertion to the new `you ≈ X` format (report which).

- [ ] **Step 6: Commit**

```bash
git add src/store/ src/components/mystats/tabs/ShotsTab.js
git commit -m "feat(sg-ui): approach buckets read you-vs-target strokes; drive distance row"
```

---

### Task 2: Full verification

- [ ] Run `npm test` (all pass) and `npm run lint` (0 errors), confirm clean tree.
