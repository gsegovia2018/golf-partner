# My Stats target tick — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the gold "target" tick line (today only on the Scoring-vs-target meters) to every other bar chart in the Strokes Gained and Breakdown sections of My Stats.

**Architecture:** `BreakdownRow` gains an optional `targetRatio` prop and renders a gold tick using `TargetMeterRow`'s exact recipe (color, fade-after-fill animation, geometry). The two parent renderers — `ShotRowsBlock` in `ShotsTab.js` and `PatternRows` in `BreakdownTab.js` — compute that tick position on the same per-group scale as the bar, after folding each row's reference target into the group scale so ticks never pin misleadingly to the track edge.

**Tech Stack:** React Native (Expo), react-native-reanimated, Jest + @testing-library/react-native.

## Global Constraints

- Reuse the existing gold token: `theme.isDark ? theme.semantic.winner.dark : theme.semantic.winner.light`. Do not introduce new colors.
- Tick animation mirrors `TargetMeterRow`: fades in AFTER the bar fill lands (`delay = rowIndex * 40 + 400`), 150ms fade; reduced motion ⇒ static, fully visible.
- Tick testID convention: `${testID}-tick` (matches `TargetMeterRow`).
- A tick is drawn ONLY for a row with a **finite, non-zero** reference target, a real track (`hasTrack`), and `!dim`. Target `0` is the bar origin — no tick (covers ±SG bars, penalty drag, `onePutts`).
- `npm test` and `npm run lint` must be green at the end of every task.
- Do NOT change `TargetMeterRow`, `SGBars`, `ScoreMixBar`, bar colors, or tone logic.

## File Structure

- `src/components/mystats/BreakdownRow.js` — **modify.** Add `targetRatio` prop + gold tick (new `TickFade` sub-component, constants, styles).
- `src/components/mystats/__tests__/BreakdownRow.test.js` — **modify.** Add tick tests.
- `src/components/mystats/tabs/ShotsTab.js` — **modify.** Surface `target` on driving/GIR/putting rows; extend group scale; compute + pass `targetRatio`.
- `src/components/mystats/tabs/__tests__/StatsTabs.test.js` — **modify.** Assert ShotsTab ticks (present on benchmark rows, absent on SG buckets).
- `src/components/mystats/tabs/BreakdownTab.js` — **modify.** Attach `target` (baseline / fixed thresholds); extend group scale; compute + pass `targetRatio`.
- `src/components/mystats/tabs/__tests__/BreakdownTabBars.test.js` — **modify.** Update the solo `bunkerVisits` expectation; assert vs-avg reference-line ticks and no-tick rows.

---

### Task 1: `BreakdownRow` renders an optional gold target tick

**Files:**
- Modify: `src/components/mystats/BreakdownRow.js`
- Test: `src/components/mystats/__tests__/BreakdownRow.test.js`

**Interfaces:**
- Consumes: nothing new (reanimated hooks already imported).
- Produces: `BreakdownRow` accepts a new optional prop `targetRatio` (number in 0..1, or `undefined`). When it is a finite number AND the row has a track AND `!dim`, the row renders an `Animated.View` with testID `${testID}-tick` at `left: ${clamp(targetRatio,0,1)*100}%`. Absent/`undefined` ⇒ no tick node, and the row is otherwise unchanged.

- [ ] **Step 1: Write the failing tests**

Append these tests inside the `describe('BreakdownRow', ...)` block in `src/components/mystats/__tests__/BreakdownRow.test.js`. Add this helper just below the existing `wrap` definition (top of file), matching `TargetMeterRow.test.js`:

```javascript
const pct = (styleValue) => parseFloat(styleValue);
```

Then the tests:

```javascript
  test('renders a gold target tick at the normalized position', () => {
    const { getByTestId } = render(wrap(
      <BreakdownRow label="Par 4s" value="1.6 pts" barRatio={0.75} targetRatio={0.5} testID="bar" first />
    ));

    const tick = StyleSheet.flatten(getByTestId('bar-tick').props.style);
    expect(pct(tick.left)).toBeCloseTo(50, 5);
  });

  test('draws no tick without a targetRatio', () => {
    const { queryByTestId } = render(wrap(
      <BreakdownRow label="Par 4s" value="1.6 pts" barRatio={0.75} testID="bar" first />
    ));

    expect(queryByTestId('bar-tick')).toBeNull();
  });

  test('keeps the tick when the fill clamps to empty', () => {
    const { getByTestId, queryByTestId } = render(wrap(
      <BreakdownRow label="SG" value="-0.2" barRatio={0} targetRatio={0.4} testID="bar" first />
    ));

    expect(queryByTestId('bar-fill')).toBeNull();
    const tick = StyleSheet.flatten(getByTestId('bar-tick').props.style);
    expect(pct(tick.left)).toBeCloseTo(40, 5);
  });

  test('draws no tick on a dim row even with a targetRatio', () => {
    const { queryByTestId } = render(wrap(
      <BreakdownRow label="Miss left" value="1.2" barRatio={0.6} targetRatio={0.5} dim testID="bar" first />
    ));

    expect(queryByTestId('bar-tick')).toBeNull();
  });

  test('draws no tick when there is no track', () => {
    const { queryByTestId } = render(wrap(
      <BreakdownRow label="Sand-save rate" value="-" targetRatio={0.5} testID="bar" first />
    ));

    expect(queryByTestId('bar-tick')).toBeNull();
  });

  test('clamps an out-of-range targetRatio into 0..1', () => {
    const { getByTestId } = render(wrap(
      <BreakdownRow label="Pars" value="9" barRatio={0.5} targetRatio={1.4} testID="bar" first />
    ));

    expect(pct(StyleSheet.flatten(getByTestId('bar-tick').props.style).left)).toBeCloseTo(100, 5);
  });

  test('renders the tick statically under reduced motion', () => {
    mockReducedMotion = true;
    const { getByTestId } = render(wrap(
      <BreakdownRow label="Par 5s" value="2 pts" barRatio={1} targetRatio={0.5} testID="bar" first />
    ));

    expect(StyleSheet.flatten(getByTestId('bar-tick').props.style).opacity).toBe(1);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/components/mystats/__tests__/BreakdownRow.test.js -t "tick"`
Expected: FAIL — `bar-tick` testID not found (tick not implemented yet).

- [ ] **Step 3: Add the tick constants and `TickFade` component**

In `src/components/mystats/BreakdownRow.js`, extend the constants block near the top (currently `EASE_OUT` and `STAGGER_MS`) to:

```javascript
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const STAGGER_MS = 40;
const FILL_MS = 400;
const TICK_MS = 150;
```

Update `BarFill` to use `FILL_MS` instead of the inline `400` (same value, keeps fill/tick timing in sync):

```javascript
      scaleX.value = withDelay(delay, withTiming(1, { duration: FILL_MS, easing: EASE_OUT }));
```

Add this component directly below `BarFill` (it mirrors `TargetMeterRow`'s tick — the gold target line fades in after the fill lands; reduced motion ⇒ static):

```javascript
// The gold target tick fades in only after its row's fill has landed
// (delay = row stagger + fill duration). Mirrors TargetMeterRow's TickFade.
// Own component so the hooks stay out of the "has a tick" conditional.
function TickFade({ style, delay, testID }) {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (!reduced) {
      opacity.value = withDelay(delay, withTiming(1, { duration: TICK_MS }));
    }
  }, [reduced, opacity, delay]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return <Animated.View testID={testID} style={[style, animatedStyle]} />;
}
```

- [ ] **Step 4: Add the `targetRatio` prop and render the tick**

Replace the `BreakdownRow` function signature and body down through the `barSlot` view. New signature (adds `targetRatio`):

```javascript
export default function BreakdownRow({
  label, value, secondary, tone = 'neutral', dim = false, first = false,
  barRatio, targetRatio, rowIndex = 0, testID,
}) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const valueColor = dim ? theme.text.muted : toneColor(theme, tone);
  const hasTrack = typeof barRatio === 'number' && Number.isFinite(barRatio);
  const fillPct = hasTrack && !dim ? Math.min(1, Math.max(0, barRatio)) * 100 : 0;
  const showTick = hasTrack && !dim
    && typeof targetRatio === 'number' && Number.isFinite(targetRatio);
  const tickPct = showTick ? Math.min(1, Math.max(0, targetRatio)) * 100 : 0;
  const tickColor = theme.isDark ? theme.semantic.winner.dark : theme.semantic.winner.light;
```

Then replace the `barSlot` block so the track and tick are siblings inside it:

```javascript
      <View style={s.barSlot}>
        {hasTrack ? (
          <>
            <View style={s.track} testID={testID}>
              {fillPct > 0 ? (
                <BarFill
                  testID={testID ? `${testID}-fill` : undefined}
                  delay={rowIndex * STAGGER_MS}
                  style={[s.fill, { width: `${fillPct}%` }, barFillStyle(theme, tone)]}
                />
              ) : null}
            </View>
            {showTick ? (
              <TickFade
                testID={testID ? `${testID}-tick` : undefined}
                delay={rowIndex * STAGGER_MS + FILL_MS}
                style={[s.tick, { left: `${tickPct}%`, backgroundColor: tickColor }]}
              />
            ) : null}
          </>
        ) : null}
      </View>
```

- [ ] **Step 5: Update styles so the tick can overhang the track**

In `makeStyles`, change `barSlot` and `track`, and add `tick` (mirrors `TargetMeterRow`'s `meterSlot`/`track`/`tick`):

```javascript
    barSlot: {
      flex: 1,
      minWidth: 0,
      height: 14,
      justifyContent: 'center',
    },
    track: {
      height: 8,
      flexBasis: 'auto',
      borderRadius: 999,
      overflow: 'hidden',
      backgroundColor: theme.bg.secondary,
    },
    tick: {
      position: 'absolute',
      top: 0,
      width: 2.5,
      height: 14,
      borderRadius: 1.25,
      marginLeft: -1.25,
    },
```

(Leave `fill` and every other style unchanged.)

- [ ] **Step 6: Run the full BreakdownRow suite**

Run: `npx jest src/components/mystats/__tests__/BreakdownRow.test.js`
Expected: PASS — all new tick tests plus the 8 existing tests (the existing tests never pass `targetRatio`, so they render no tick and are unaffected).

- [ ] **Step 7: Lint**

Run: `npx eslint src/components/mystats/BreakdownRow.js src/components/mystats/__tests__/BreakdownRow.test.js`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/mystats/BreakdownRow.js src/components/mystats/__tests__/BreakdownRow.test.js
git commit -m "feat(mystats): optional gold target tick on BreakdownRow"
```

---

### Task 2: Strokes Gained bars pass a target tick

**Files:**
- Modify: `src/components/mystats/tabs/ShotsTab.js`
- Test: `src/components/mystats/tabs/__tests__/StatsTabs.test.js`

**Interfaces:**
- Consumes: `BreakdownRow`'s `targetRatio` prop from Task 1.
- Produces: `ShotRowsBlock` passes `targetRatio` to each `BreakdownRow`. Benchmark rows (`pct`/`count`/`avg`/`dist` with a finite non-zero `target`) get a tick; `sg` bucket rows and dim rows do not.

- [ ] **Step 1: Write the failing tests**

Add these tests to `src/components/mystats/tabs/__tests__/StatsTabs.test.js`, inside the same `describe` that holds the existing ShotsTab tests (reuse the file's existing `shotStats()` fixture and `wrap`):

```javascript
  test('ShotsTab marks benchmark bars with a target tick but leaves SG buckets tickless', async () => {
    const { findByTestId, getByTestId, queryByTestId } = render(wrap(
      <ShotsTab stats={shotStats()} onInfo={() => {}} targetHandicap={14} onChangeTarget={() => {}} />
    ));

    // Benchmark rows carry a gold target tick.
    expect(await findByTestId('shots-bar-fairways-tick')).toBeTruthy();
    expect(getByTestId('shots-bar-gir-tick')).toBeTruthy();
    expect(getByTestId('shots-bar-puttsPerRound-tick')).toBeTruthy();
    expect(getByTestId('shots-bar-par3AvgScore-tick')).toBeTruthy();

    // Diverging +/- SG bucket bars have no meaningful target (origin) → no tick.
    expect(queryByTestId('shots-bar-100-150-tick')).toBeNull();
    expect(queryByTestId('shots-bar-6+-tick')).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/components/mystats/tabs/__tests__/StatsTabs.test.js -t "target tick"`
Expected: FAIL — `shots-bar-fairways-tick` not found (ShotsTab doesn't pass `targetRatio` yet).

- [ ] **Step 3: Surface a numeric `target` on the benchmark rows that lack one**

In `src/components/mystats/tabs/ShotsTab.js`, add a `target` field to the rows that currently pass the benchmark only into `toneFromComparison`. The par-avg and per-round count rows already carry `target` — do not touch those.

In `makeDrivingTargetRows`, add `target` to each returned row object:
- `fairways`: `target: shotBenchmark.fairwayPct,`
- `leftMissPct`: `target: shotBenchmark.leftMissPct,`
- `rightMissPct`: `target: shotBenchmark.rightMissPct,`
- `teePenaltyPct`: `target: shotBenchmark.teePenaltyPct,`
- `driveDistance` (BOTH the data branch and the dim `else` branch): `target: Math.round(shotBenchmark.driverDistance * YD_TO_M),`

In `makeGirRows`, add to the `gir` row: `target: shotBenchmark.girPct,`

In `makePuttingVolumeRows`, add:
- `puttsPerRound`: `target: shotBenchmark.puttsPerRound,`
- `threePutts`: `target: shotBenchmark.threePuttsPerRound,`

- [ ] **Step 4: Fold targets into the block scale and compute the tick ratio**

Still in `ShotsTab.js`, replace the group-building loop and `shotBarRatio` inside `ShotRowsBlock`, and add `shotTargetRatio`.

Replace the `groups` build in `ShotRowsBlock` with:

```javascript
  const groups = {};
  rows.forEach((row) => {
    if (row.dim || !isNumber(row.magnitude)) return;
    const tag = row.barGroup;
    if (!tag || tag === 'pct') return; // absolute scale
    const entry = groups[tag] ?? { scale: 0, size: 0 };
    entry.scale = Math.max(
      entry.scale,
      Math.abs(row.magnitude),
      isNumber(row.target) ? Math.abs(row.target) : 0
    );
    entry.size += 1;
    groups[tag] = entry;
  });
```

Update the `BreakdownRow` render inside `ShotRowsBlock` to pass `targetRatio` (the map already destructures `target` out of the row):

```javascript
          <BreakdownRow
            key={key}
            {...row}
            first={index === 0}
            rowIndex={index}
            testID={`shots-bar-${key}`}
            barRatio={shotBarRatio({ magnitude, barGroup, target, dim: row.dim }, groups)}
            targetRatio={shotTargetRatio({ magnitude, barGroup, target, dim: row.dim }, groups)}
          />
```

Replace `shotBarRatio` with the scale-based version (uses `entry.scale`; solo cap applies only when there is no target to scale against):

```javascript
function shotBarRatio({ magnitude, barGroup, target, dim }, groups) {
  if (!isNumber(magnitude)) return undefined;
  const size = Math.abs(magnitude);
  if (barGroup === 'pct') return clamp01(size / 100);
  const entry = groups[barGroup];
  if (!entry || entry.scale <= 0) return 0;
  if (entry.size === 1 && !dim && !isNumber(target)) return SOLO_BAR_RATIO;
  return clamp01(size / entry.scale);
}
```

Add `shotTargetRatio` directly below it:

```javascript
// Tick position on the SAME scale as shotBarRatio. Only benchmark rows with a
// finite, non-zero target get a tick; 'sg' bucket bars diverge from a zero
// origin (no useful tick), and dim rows never show one.
function shotTargetRatio({ magnitude, barGroup, target, dim }, groups) {
  if (dim || barGroup === 'sg') return undefined;
  if (!isNumber(magnitude) || !isNumber(target) || target === 0) return undefined;
  const size = Math.abs(target);
  if (barGroup === 'pct') return clamp01(size / 100);
  const entry = groups[barGroup];
  if (!entry || entry.scale <= 0) return undefined;
  return clamp01(size / entry.scale);
}
```

- [ ] **Step 5: Run the ShotsTab tests**

Run: `npx jest src/components/mystats/tabs/__tests__/StatsTabs.test.js`
Expected: PASS — the new tick test plus all existing ShotsTab tests. The existing tests assert `-fill` presence/absence and `toBeTruthy`, none of which change (pct fills stay absolute; the only solo `dist` row, `driveDistance`, is dim in the fixture so it still renders an empty track and no tick).

- [ ] **Step 6: Lint**

Run: `npx eslint src/components/mystats/tabs/ShotsTab.js src/components/mystats/tabs/__tests__/StatsTabs.test.js`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/mystats/tabs/ShotsTab.js src/components/mystats/tabs/__tests__/StatsTabs.test.js
git commit -m "feat(mystats): target tick on Strokes Gained detail bars"
```

---

### Task 3: Breakdown bars pass a target tick (own reference)

**Files:**
- Modify: `src/components/mystats/tabs/BreakdownTab.js`
- Test: `src/components/mystats/tabs/__tests__/BreakdownTabBars.test.js`

**Interfaces:**
- Consumes: `BreakdownRow`'s `targetRatio` prop from Task 1.
- Produces: `PatternRows` passes `targetRatio` to each `BreakdownRow`. "vs your avg" rows tick at the shared `baseline`; putting/recovery rows tick at their fixed threshold; scoring-pattern count rows, `puttsPerRound`, `onePutts`, and penalty drag get no tick.

- [ ] **Step 1: Write / update the failing tests**

In `src/components/mystats/tabs/__tests__/BreakdownTabBars.test.js`:

First, **update** the existing solo test (the one titled `'a solo count row caps at two-thirds instead of a misleading full bar'`). `bunkerVisits` now carries a target (1.5), so it scales against `max(1.2, 1.5)` and also gets a tick. Replace that whole test with:

```javascript
  test('a solo count row scales against its own target and shows a tick', async () => {
    const stats = {
      ...statsFixture(),
      bounceBack: { rate: 25, opportunities: 8 },
      bunkerVisits: { avgPerRound: 1.2, holesWithSand: 8 },
    };
    const { findByTestId, getByTestId } = render(wrap(
      <BreakdownTab stats={stats} onInfo={() => {}} />
    ));

    // Bunker visits is the only count row among recovery's rates, but it now
    // has a target (1.5) to scale against: 1.2 / max(1.2, 1.5) = 80%, with the
    // target tick pinned at the scale max.
    expect(width(await findByTestId('breakdown-bar-bunkerVisits-fill'))).toBe('80%');
    expect(pct(StyleSheet.flatten(getByTestId('breakdown-bar-bunkerVisits-tick').props.style).left))
      .toBeCloseTo(100, 5);
  });
```

Add a `pct` helper near the top of the file (below the existing `width` helper):

```javascript
const pct = (styleValue) => parseFloat(styleValue);
```

Then **add** these tests inside the `describe('BreakdownTab magnitude bars', ...)` block:

```javascript
  test('vs-your-avg rows share one baseline reference tick across the group', async () => {
    const { findByTestId, getByTestId } = render(wrap(
      <BreakdownTab stats={statsFixture()} onInfo={() => {}} />
    ));

    // Baseline = 60 pts / 36 holes = 1.667; course group scale = par5 (2).
    // Every course row ticks at the same 1.667 / 2 = 83.33%.
    const par3 = pct(StyleSheet.flatten((await findByTestId('breakdown-bar-par3-tick')).props.style).left);
    const par5 = pct(StyleSheet.flatten(getByTestId('breakdown-bar-par5-tick').props.style).left);
    expect(par3).toBeCloseTo(83.33, 1);
    expect(par5).toBeCloseTo(83.33, 1);
    expect(par3).toBe(par5);
  });

  test('penalty drag has no target tick (target is the zero origin)', async () => {
    const { findByTestId, queryByTestId } = render(wrap(
      <BreakdownTab stats={statsFixture()} onInfo={() => {}} />
    ));

    expect(await findByTestId('breakdown-bar-penaltyDrag-fill')).toBeTruthy();
    expect(queryByTestId('breakdown-bar-penaltyDrag-tick')).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/components/mystats/tabs/__tests__/BreakdownTabBars.test.js`
Expected: FAIL — `breakdown-bar-bunkerVisits-tick` / `breakdown-bar-par3-tick` not found, and the bunker fill still reads `66.66...%` until the scale change lands.

- [ ] **Step 3: Attach `target` to the "vs your avg" rows**

In `src/components/mystats/tabs/BreakdownTab.js`, the vs-your-avg rows compare against `baseline`. Add `target: isNumber(baseline) ? baseline : undefined` to each.

In `pointPatternRow` (used by course + timing opening/closing + tee outcome rows), add to the returned object:

```javascript
    target: isNumber(baseline) ? baseline : undefined,
```

In `timingNineRow` (front/back nine), add the same line to the returned object.

In `makeDrivePatternRows`'s returned row object, add the same line.

In `makeApproachPatternRows`'s returned row object, add the same line.

- [ ] **Step 4: Attach fixed-threshold `target` to putting/recovery rows**

Add `target` to these rows (match the value already passed into their `toneFromComparison`/`toneFromRate`, in the magnitude's units). Do NOT add a target to `puttsPerRound` (tone `neutral`, no reference) or `onePutts` (reference is 0 → origin), or to the `makeScoringPatternRows` count rows.

In `makePuttingPatternRows`:
- `threePutts` row: `target: 2,`
- `twoPuttRate` row: `target: 60,`
- `girPutts` row: `target: 2,`
- `nonGirPutts` row: `target: 2,`
- `onePuttSave` row: `target: 30,`

In `makeRecoveryRows`:
- `bounceBack` row: `target: 30,`
- `scrambling` row: `target: 35,`
- `sandSaves` row (magnitude is `rate*100`): `target: 40,`
- `upAndDown` row (magnitude is `rate*100`): `target: 45,`
- `bunkerVisits` row: `target: 1.5,`

- [ ] **Step 5: Fold targets into the section scale and compute the tick ratio**

Replace the `groups` build in `PatternRows`:

```javascript
  const groups = {};
  rows.forEach((row) => {
    if (row.dim || !isNumber(row.magnitude)) return;
    const tag = row.barGroup ?? 'pts';
    if (tag === 'pct' || tag === 'drag') return; // absolute scales
    const entry = groups[tag] ?? { scale: 0, size: 0 };
    entry.scale = Math.max(
      entry.scale,
      Math.abs(row.magnitude),
      isNumber(row.target) ? Math.abs(row.target) : 0
    );
    entry.size += 1;
    groups[tag] = entry;
  });
```

Update the `BreakdownRow` render in `PatternRows` to destructure `target` and pass `targetRatio`:

```javascript
      {rows.map(({ key, magnitude, barGroup, target, ...row }, index) => (
        <BreakdownRow
          key={key}
          {...row}
          first={index === 0}
          rowIndex={index}
          testID={`breakdown-bar-${key}`}
          barRatio={barRatioFor({ magnitude, barGroup, target, dim: row.dim }, groups)}
          targetRatio={targetRatioFor({ magnitude, barGroup, target, dim: row.dim }, groups)}
        />
      ))}
```

Replace `barRatioFor` (uses `entry.scale`; solo cap only without a target):

```javascript
function barRatioFor({ magnitude, barGroup, target, dim }, groups) {
  if (!isNumber(magnitude)) return undefined;
  const tag = barGroup ?? 'pts';
  const size = Math.abs(magnitude);
  if (tag === 'pct') return clamp01(size / 100);
  if (tag === 'drag') return clamp01(size / PENALTY_DRAG_SCALE);
  const entry = groups[tag];
  if (!entry || entry.scale <= 0) return 0;
  if (tag !== 'pts' && entry.size === 1 && !dim && !isNumber(target)) return SOLO_COUNT_RATIO;
  return clamp01(size / entry.scale);
}
```

Add `targetRatioFor` directly below it:

```javascript
// Tick position on the SAME scale as barRatioFor. Only rows with a finite,
// non-zero reference target get a tick; 'drag' rows compare against a zero
// origin (no useful tick) and dim rows never show one.
function targetRatioFor({ magnitude, barGroup, target, dim }, groups) {
  if (dim || !isNumber(magnitude) || !isNumber(target) || target === 0) return undefined;
  const tag = barGroup ?? 'pts';
  if (tag === 'drag') return undefined;
  const size = Math.abs(target);
  if (tag === 'pct') return clamp01(size / 100);
  const entry = groups[tag];
  if (!entry || entry.scale <= 0) return undefined;
  return clamp01(size / entry.scale);
}
```

- [ ] **Step 6: Run the BreakdownTab bar tests**

Run: `npx jest src/components/mystats/tabs/__tests__/BreakdownTabBars.test.js`
Expected: PASS — new tick tests plus the updated solo test. The other width tests are unaffected: course/tee `pts` groups keep `scale == section max` because `baseline` (1.667) is below the section max (2); the putting count/avg groups keep their maxes because `puttsPerRound` (32) and `nonGirPutts` (2) still dominate their targets.

- [ ] **Step 7: Full suite + lint**

Run: `npm test`
Expected: PASS — entire suite green (confirms no other tab/screen test regressed).

Run: `npx eslint src/components/mystats/tabs/BreakdownTab.js src/components/mystats/tabs/__tests__/BreakdownTabBars.test.js`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/mystats/tabs/BreakdownTab.js src/components/mystats/tabs/__tests__/BreakdownTabBars.test.js
git commit -m "feat(mystats): own-reference target tick on Breakdown bars"
```

---

## Self-Review

**Spec coverage:**
- BreakdownRow gains the tick (color/animation/geometry from TargetMeterRow) → Task 1.
- Strokes Gained: driving, GIR, aggregate-putting, scoring-detail bars tick at benchmark; SG buckets tickless → Task 2.
- Breakdown: vs-your-avg rows tick at baseline (shared reference line), putting/recovery at fixed thresholds; scoring-pattern counts / puttsPerRound / onePutts / penalty drag tickless → Task 3.
- Scale-to-fit-both (fold target into group scale) → Tasks 2 & 3.
- Origin-skip rule (target 0 / absent) → BreakdownRow guard + parent `targetRatioFor`/`shotTargetRatio` guards.
- No change to TargetMeterRow / SGBars / ScoreMixBar → respected (not in file list).
- Tests for tick render/position/omit/reduced-motion, tab-level present/absent, shared reference line → all three tasks.

**Placeholder scan:** none — every code and test step shows complete content.

**Type consistency:** `targetRatio` (number|undefined) is produced by `shotTargetRatio`/`targetRatioFor` and consumed by `BreakdownRow` with the same name and guards throughout. Group entries use `{ scale, size }` consistently in both parents' build loops and ratio helpers. `SOLO_BAR_RATIO` (ShotsTab) and `SOLO_COUNT_RATIO` (BreakdownTab) keep their existing names.
