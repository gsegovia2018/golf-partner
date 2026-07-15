# CourseStats Shot Detail Accuracy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three display-accuracy issues in the CourseStats shot-detail section: drive bars show pooled percentages, the putts tile is normalized per 18 holes, and the GIR caption states its hole sample.

**Architecture:** Display-layer only — no store math changes. `DistributionBars` gains an optional per-bar `displayValue` string (backwards compatible; `count` still drives bar height and remains the display fallback). `CourseStatsScreen` switches the putts tile to the existing `shots.putts.per18` field, appends the GIR sample to its caption, and passes percentage `displayValue`s plus a sample caption for the drive bars.

**Tech Stack:** Expo SDK 54 / React Native 0.81 / React 19, plain JavaScript, Jest via jest-expo + @testing-library/react-native.

**Spec:** `docs/superpowers/specs/2026-07-15-course-shot-detail-accuracy-design.md`

## Global Constraints

- Plain JS only — no TypeScript syntax.
- No store changes: `shotStats` already provides `putts.per18`, `gir.eligible`, `drives.recorded` — display them, don't recompute.
- `DistributionBars` change must be backwards compatible: existing callers (BreakdownTab/ShotsTab/CourseStatsScreen score mix) pass no `displayValue` and must render exactly as before.
- Run tests file-scoped (never bare `npm test` mid-task); `npm run lint` must stay at 0 errors.
- Commit after every task with the exact message given.

---

### Task 1: `DistributionBars` optional `displayValue`

**Files:**
- Modify: `src/components/mystats/DistributionBars.js`
- Test: `src/components/mystats/__tests__/DistributionBars.test.js` (new file)

**Interfaces:**
- Produces: `bars` items accept optional `displayValue` (string) — rendered as the text above the bar in place of `count`; `count` (number) still scales bar height and is displayed when `displayValue` is absent. Task 2 relies on exactly this prop name.

- [ ] **Step 1: Write the failing test**

Create `src/components/mystats/__tests__/DistributionBars.test.js`:

```js
import React from 'react';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import DistributionBars from '../DistributionBars';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => new Promise(() => {})),
  setItem: jest.fn(),
}));

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

describe('DistributionBars', () => {
  test('renders displayValue in place of count when provided', () => {
    const { getByText, queryByText } = render(wrap(
      <DistributionBars bars={[
        { label: 'Fairway', count: 37, displayValue: '45%' },
        { label: 'Left', count: 16, displayValue: '20%' },
      ]} />
    ));
    expect(getByText('45%')).toBeTruthy();
    expect(getByText('20%')).toBeTruthy();
    expect(queryByText('37')).toBeNull();
    expect(queryByText('16')).toBeNull();
  });

  test('falls back to count when displayValue is absent (existing callers)', () => {
    const { getByText } = render(wrap(
      <DistributionBars bars={[
        { label: 'Par', count: 12 },
        { label: 'Bogey', count: 7 },
      ]} />
    ));
    expect(getByText('12')).toBeTruthy();
    expect(getByText('7')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/mystats/__tests__/DistributionBars.test.js`
Expected: first test FAILS (no element with text `45%`); second test passes (current behavior).

- [ ] **Step 3: Implement**

In `src/components/mystats/DistributionBars.js`, the count `Text` currently reads:

```js
          <Text style={s.count}>{b.count}</Text>
```

Change it to:

```js
          <Text style={s.count}>{b.displayValue ?? b.count}</Text>
```

And update the component's doc comment on line 5 from:

```js
// bars: [{ label, count, muted? }]  — vertical bars scaled to the largest count.
```

to:

```js
// bars: [{ label, count, displayValue?, muted? }] — vertical bars scaled to the
// largest count; displayValue (e.g. '45%') replaces count as the shown text.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/mystats/__tests__/DistributionBars.test.js`
Expected: PASS (2/2).

- [ ] **Step 5: Regression + lint + commit**

Run: `npm test -- src/components/mystats/__tests__` (all mystats component tests must pass)
Run: `npm run lint` (0 errors)

```bash
git add src/components/mystats/DistributionBars.js src/components/mystats/__tests__/DistributionBars.test.js
git commit -m "feat(mystats): optional displayValue on DistributionBars"
```

---

### Task 2: CourseStats shot tiles + drive percentages

**Files:**
- Modify: `src/screens/CourseStatsScreen.js:169-189` (the `{shots ? (...)}` section)

**Interfaces:**
- Consumes: `displayValue` from Task 1; `shots.putts.per18` (number|null), `shots.gir.eligible` (number), `shots.drives.recorded` (number), `shots.drives.distribution` (map) — all already returned by `shotStats`.

- [ ] **Step 1: Implement the section changes**

(Screens are not unit-tested in this repo; verification is the existing suites + lint + the diff itself.)

In `src/screens/CourseStatsScreen.js`, replace the shots section (currently lines 169-184, shown here as it exists today):

```js
        {shots ? (
          <SectionCard title="Shot detail here">
            <View style={s.tileRow}>
              <StatTile value={shots.putts.holes > 0 ? shots.putts.perRound : '—'} caption="putts / round" />
              <StatTile value={shots.drives.recorded > 0 ? `${shots.drives.fairwayPct}%` : '—'} caption="fairways" />
              <StatTile value={shots.penalties.total} caption="penalties" />
              <StatTile value={shots.gir.eligible > 0 ? `${shots.gir.pct}%` : '—'} caption="GIR" />
            </View>
            {shots.drives.recorded > 0 ? (
              <DistributionBars bars={DRIVE_ORDER.map((k) => ({
                label: DRIVE_BAR_LABELS[k],
                count: shots.drives.distribution[k] ?? 0,
                muted: (shots.drives.distribution[k] ?? 0) === 0,
              }))} />
            ) : null}
          </SectionCard>
        ) : (
```

with:

```js
        {shots ? (
          <SectionCard title="Shot detail here">
            <View style={s.tileRow}>
              <StatTile
                value={shots.putts.per18 ?? '—'}
                caption="putts / 18 holes"
              />
              <StatTile value={shots.drives.recorded > 0 ? `${shots.drives.fairwayPct}%` : '—'} caption="fairways" />
              <StatTile value={shots.penalties.total} caption="penalties" />
              <StatTile
                value={shots.gir.eligible > 0 ? `${shots.gir.pct}%` : '—'}
                caption={shots.gir.eligible > 0 ? `GIR · ${shots.gir.eligible} holes` : 'GIR'}
              />
            </View>
            {shots.drives.recorded > 0 ? (
              <>
                <DistributionBars bars={DRIVE_ORDER.map((k) => {
                  const count = shots.drives.distribution[k] ?? 0;
                  return {
                    label: DRIVE_BAR_LABELS[k],
                    count,
                    displayValue: `${Math.round((count / shots.drives.recorded) * 100)}%`,
                    muted: count === 0,
                  };
                })} />
                <Text style={s.metaLine}>
                  {`${shots.drives.recorded} drive${shots.drives.recorded === 1 ? '' : 's'} logged`}
                </Text>
              </>
            ) : null}
          </SectionCard>
        ) : (
```

Notes:
- `shots.putts.per18` is `null` when no putt holes were logged, so `?? '—'` covers the empty case — the old `holes > 0` ternary is no longer needed.
- `s.metaLine` already exists in this screen's styles.
- The React fragment (`<>...</>`) needs no new import (React is already imported).

- [ ] **Step 2: Verify no regressions + lint**

Run: `npm test -- src/components/mystats/__tests__ src/store/__tests__/courseBreakdown.test.js`
Expected: all pass.

Run: `npm run lint`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/screens/CourseStatsScreen.js
git commit -m "fix(stats): course shot tiles — putts per-18, GIR sample, drive percentages"
```

---

### Task 3: Full-suite verification

**Files:** none new.

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: all tests pass (1890+ with the two new DistributionBars tests).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: 0 errors (64 pre-existing warnings acceptable).
