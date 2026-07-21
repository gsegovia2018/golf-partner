# Report Card Hybrid Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the My Stats → Report Card tab to the user-approved hybrid design: B's inline selector + filled verdict hero, C's twin callout tiles + expandable chapter cards, with center-baseline diverging delta bars inside every chapter.

**Architecture:** `RoundReportCard.js` becomes a thin orchestrator. Presentation moves into four new sibling components under `src/components/mystats/` (flat, matching the existing pattern), fed by a pure view-model module `reportCardView.js` that turns `buildRoundReportCard` groups into render-ready rows (display delta, good-direction, normalized bar ratio, preview line). The store module `roundReportCard.js` is NOT touched.

**Tech Stack:** React Native (Expo 54), react-native-reanimated (same primitives as `BreakdownRow.js`/`SGBars.js`), existing `Reveal`/`CountUpText`/`PressableScale` components, jest-expo + @testing-library/react-native.

## Global Constraints

- Do not modify `src/store/roundReportCard.js` — the card data shape is fixed.
- `RoundReportCard` public props stay exactly: `{ card, rounds, selectedKey, onSelect, onOpenRound }` (see `MyStatsScreen.js:460`).
- Preserve testIDs `report-card-verdict`, `report-card-verdict-phrase`, `report-card-open-round`, and the visible copy `Round Stats` (MyStatsScreen tests press it).
- All colors/spacing/radius/fonts from `useTheme()` tokens — no raw hex except where the existing codebase already does (e.g. `#7fb59f` in BreakdownRow is precedent, but prefer tokens).
- Fonts: `PlayfairDisplay-Bold` for verdict phrase, `PlusJakartaSans-*` elsewhere; tabular numerals (`fontVariant: ['tabular-nums']`) on all numeric columns.
- Motion: reanimated `withTiming` + `Easing.bezier(0.23, 1, 0.32, 1)`, durations ≤ 500ms, 40ms row stagger, `useReducedMotion()` ⇒ static final state. Mirror `BreakdownRow.js` BarFill exactly.
- Every animated bar transform must set `transformOrigin` (left for positive/right for negative) so scaleX grows out of the center axis.
- Run tests with plain `npx jest <path>` inside the dedicated worktree.

---

### Task 1: View-model module `reportCardView.js`

**Files:**
- Create: `src/components/mystats/reportCardView.js`
- Test: `src/components/mystats/__tests__/reportCardView.test.js`

**Interfaces:**
- Consumes: `card.groups` entries `{ key, label, cells[] }` where a cell is `{ label, group, value, baseline, deltaVsAvg, deltaVs2, holes, polarity }` (see `src/store/roundReportCard.js`).
- Produces (used by Tasks 2–3):
  - `fmtDelta(v)` → `'+1.2' | '-0.4' | '0' | '—'` (em-dash when null/undefined).
  - `buildChapterVM(group, { hasHistory })` → `{ key, label, rows, preview, hasDeltas }` where each row is `{ label, valueText, sub, delta, good, ratio }`.
  - `calloutSub(cell)` → `'<value> / hole · <fmtDelta(delta)> vs your avg'` (or `'… vs the 2.0 mark'` when `deltaVsAvg` is null) — same wording as today's `Callout` component.

Row semantics:
- `delta` = `cell.deltaVsAvg ?? cell.deltaVs2` (null when both null — scoring/shot cells with no history).
- `good` = null when `delta` is null, else `polarity === 'lower' ? -delta : delta`.
- `ratio` = `|good| / max(|good| over rows with non-null good)`, `0` when no max or null good.
- `valueText` = `'57%'` for cells whose label ends in `' %'`, else `String(value)`.
- `label` = cell label with trailing `' %'` stripped (`'Fairways hit %'` → `'Fairways hit'`).
- `sub`: groups `course`/`timing` → `'<value.toFixed(2)> / hole'`; group `distribution` → `'<value> this round'`; group `shots` → `'<valueText> this round'`.
- `preview`: when any row has non-null `good`: `'Best: <label> <fmtDelta(delta)> · Worst: <label> <fmtDelta(delta)>'` using the rows with max/min `good`. Otherwise first two rows as `'<valueText> <label lowercased>'` joined by `' · '` (e.g. `'3 birdies+ · 8 pars'`).
- `hasDeltas` = at least one row with non-null `good`.

- [ ] **Step 1: Write the failing tests**

```js
// src/components/mystats/__tests__/reportCardView.test.js
import { fmtDelta, buildChapterVM, calloutSub } from '../reportCardView';

const pph = (label, value, deltaVsAvg, deltaVs2 = null, polarity = 'higher') => ({
  label, group: 'course', value, baseline: null, deltaVsAvg, deltaVs2, holes: 4, polarity,
});

describe('fmtDelta', () => {
  test('formats sign and null', () => {
    expect(fmtDelta(1.2)).toBe('+1.2');
    expect(fmtDelta(-0.4)).toBe('-0.4');
    expect(fmtDelta(0)).toBe('0');
    expect(fmtDelta(null)).toBe('—');
  });
});

describe('buildChapterVM', () => {
  test('normalizes bar ratios to the biggest swing in the chapter', () => {
    const vm = buildChapterVM({
      key: 'course', label: 'Where on the course',
      cells: [pph('Par 3s', 1.25, -0.7), pph('Par 5s', 2.8, 0.9), pph('Par 4s', 2.2, 0.3)],
    }, { hasHistory: true });
    const byLabel = Object.fromEntries(vm.rows.map((r) => [r.label, r]));
    expect(byLabel['Par 5s'].ratio).toBe(1);
    expect(byLabel['Par 3s'].ratio).toBeCloseTo(0.7 / 0.9);
    expect(byLabel['Par 5s'].good).toBeCloseTo(0.9);
    expect(byLabel['Par 3s'].good).toBeCloseTo(-0.7);
    expect(vm.hasDeltas).toBe(true);
  });

  test('applies lower-is-better polarity so beating average reads as good', () => {
    const vm = buildChapterVM({
      key: 'shots', label: 'Shot stats',
      cells: [{ label: 'Putts', group: 'shots', value: 31, baseline: 32.5, deltaVsAvg: -1.5, deltaVs2: null, holes: null, polarity: 'lower' }],
    }, { hasHistory: true });
    expect(vm.rows[0].good).toBeCloseTo(1.5);
    expect(vm.rows[0].delta).toBeCloseTo(-1.5);
    expect(vm.rows[0].sub).toBe('31 this round');
  });

  test('strips % from labels and formats percentage values', () => {
    const vm = buildChapterVM({
      key: 'shots', label: 'Shot stats',
      cells: [{ label: 'Fairways hit %', group: 'shots', value: 57, baseline: 49, deltaVsAvg: 8, deltaVs2: null, holes: null, polarity: 'higher' }],
    }, { hasHistory: true });
    expect(vm.rows[0].label).toBe('Fairways hit');
    expect(vm.rows[0].valueText).toBe('57%');
  });

  test('falls back to deltaVs2 when no career baseline exists', () => {
    const vm = buildChapterVM({
      key: 'course', label: 'Where on the course',
      cells: [pph('Par 3s', 1.25, null, -0.75)],
    }, { hasHistory: false });
    expect(vm.rows[0].delta).toBeCloseTo(-0.75);
    expect(vm.rows[0].good).toBeCloseTo(-0.75);
  });

  test('rows with no delta at all get null good and zero ratio', () => {
    const vm = buildChapterVM({
      key: 'distribution', label: 'Scoring',
      cells: [{ label: 'Pars', group: 'distribution', value: 8, baseline: null, deltaVsAvg: null, deltaVs2: null, holes: null, polarity: 'higher' }],
    }, { hasHistory: false });
    expect(vm.rows[0].good).toBeNull();
    expect(vm.rows[0].ratio).toBe(0);
    expect(vm.hasDeltas).toBe(false);
    expect(vm.preview).toBe('8 pars');
  });

  test('preview names best and worst rows when deltas exist', () => {
    const vm = buildChapterVM({
      key: 'course', label: 'Where on the course',
      cells: [pph('Par 3s', 1.25, -0.7), pph('Par 5s', 2.8, 0.9)],
    }, { hasHistory: true });
    expect(vm.preview).toBe('Best: Par 5s +0.9 · Worst: Par 3s -0.7');
  });

  test('pph rows get a per-hole sub line', () => {
    const vm = buildChapterVM({
      key: 'timing', label: 'When in the round',
      cells: [{ ...pph('Opening 3', 1.33, -0.6), group: 'timing' }],
    }, { hasHistory: true });
    expect(vm.rows[0].sub).toBe('1.33 / hole');
  });
});

describe('calloutSub', () => {
  test('reads vs your avg when a baseline exists', () => {
    expect(calloutSub(pph('Par 5s', 2.8, 0.9))).toBe('2.8 / hole · +0.9 vs your avg');
  });
  test('reads vs the 2.0 mark without a baseline', () => {
    expect(calloutSub(pph('Par 3s', 1.25, null, -0.75))).toBe('1.25 / hole · -0.75 vs the 2.0 mark');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/components/mystats/__tests__/reportCardView.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

```js
// src/components/mystats/reportCardView.js
// Pure view-model for the Report Card hybrid layout: turns the store's
// card.groups cells into render-ready chapter rows (display delta, good
// direction with polarity applied, per-chapter normalized bar ratio) and
// the collapsed-chapter preview line. No theme, no React — unit-testable.

// "+1.2" / "-0.4" / "0" / "—".
export function fmtDelta(v) {
  if (v == null) return '—';
  if (v > 0) return `+${v}`;
  return `${v}`;
}

// Display delta for a cell: career average when available, else the fixed
// 2.0 benchmark (pph cells only — count/shot cells have deltaVs2 = null).
function displayDelta(cell) {
  return cell.deltaVsAvg ?? cell.deltaVs2;
}

// Signed delta in the "good" direction, regardless of polarity.
function goodOf(cell) {
  const d = displayDelta(cell);
  if (d == null) return null;
  return cell.polarity === 'lower' ? -d : d;
}

const PCT_RE = / %$/;

function valueTextOf(cell) {
  return PCT_RE.test(cell.label) ? `${cell.value}%` : `${cell.value}`;
}

function subOf(groupKey, cell) {
  if (groupKey === 'course' || groupKey === 'timing') {
    return `${Number(cell.value).toFixed(2)} / hole`;
  }
  if (groupKey === 'distribution') return `${cell.value} this round`;
  return `${valueTextOf(cell)} this round`;
}

function previewOf(rows) {
  const scored = rows.filter((r) => r.good != null);
  if (scored.length > 0) {
    const best = scored.reduce((a, b) => (b.good > a.good ? b : a));
    const worst = scored.reduce((a, b) => (b.good < a.good ? b : a));
    return `Best: ${best.label} ${fmtDelta(best.delta)} · Worst: ${worst.label} ${fmtDelta(worst.delta)}`;
  }
  return rows.slice(0, 2)
    .map((r) => `${r.valueText} ${r.label.toLowerCase()}`)
    .join(' · ');
}

// One chapter's render model. The delta source is per-cell
// (deltaVsAvg ?? deltaVs2) — a split the player never recorded before
// falls back to the benchmark even when career history exists.
export function buildChapterVM(group, _opts = {}) {
  const rows = group.cells.map((cell) => ({
    label: cell.label.replace(PCT_RE, ''),
    valueText: valueTextOf(cell),
    sub: subOf(group.key, cell),
    delta: displayDelta(cell),
    good: goodOf(cell),
  }));
  const max = rows.reduce((m, r) => Math.max(m, r.good != null ? Math.abs(r.good) : 0), 0);
  for (const r of rows) {
    r.ratio = r.good != null && max > 0 ? Math.abs(r.good) / max : 0;
  }
  return {
    key: group.key,
    label: group.label,
    rows,
    preview: previewOf(rows),
    hasDeltas: rows.some((r) => r.good != null),
  };
}

// Sub-line for a bright-spot / cost-you-points tile — same wording the old
// Callout component used.
export function calloutSub(cell) {
  const delta = cell.deltaVsAvg != null ? cell.deltaVsAvg : cell.deltaVs2;
  const vs = cell.deltaVsAvg != null ? 'your avg' : 'the 2.0 mark';
  return `${cell.value} / hole · ${fmtDelta(delta)} vs ${vs}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/components/mystats/__tests__/reportCardView.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/mystats/reportCardView.js src/components/mystats/__tests__/reportCardView.test.js
git commit -m "feat(reportcard): pure view-model for hybrid chapter rows"
```

---

### Task 2: Presentational components — `ReportDeltaRow`, `ReportChapter`, `ReportVerdictHero`, `ReportCalloutTiles`

**Files:**
- Create: `src/components/mystats/ReportDeltaRow.js`
- Create: `src/components/mystats/ReportChapter.js`
- Create: `src/components/mystats/ReportVerdictHero.js`
- Create: `src/components/mystats/ReportCalloutTiles.js`
- Test: `src/components/mystats/__tests__/ReportChapter.test.js`
- Test: `src/components/mystats/__tests__/ReportVerdictHero.test.js`

**Interfaces:**
- Consumes: row/preview shapes from Task 1 (`{ label, valueText, sub, delta, good, ratio }`), `fmtDelta`, `calloutSub`; `Reveal` (`src/components/ui/Reveal.js`), `CountUpText` (`src/components/mystats/CountUpText.js`), `useTheme`.
- Produces:
  - `<ReportDeltaRow row={row} rowIndex first testID />`
  - `<ReportChapter icon="flag" title preview rows={rows} hasDeltas initiallyOpen testID />` — self-managed open state, `testID` on the header touchable.
  - `<ReportVerdictHero headline round hasHistory />` — carries testIDs `report-card-verdict` (container) and `report-card-verdict-phrase`.
  - `<ReportCalloutTiles callouts={{ bright, cost }} />` — renders nothing when both arrays are empty.

- [ ] **Step 1: Write the failing tests**

```js
// src/components/mystats/__tests__/ReportChapter.test.js
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import ReportChapter from '../ReportChapter';

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const rows = [
  { label: 'Par 3s', valueText: '1.25', sub: '1.25 / hole', delta: -0.7, good: -0.7, ratio: 0.78 },
  { label: 'Par 5s', valueText: '2.80', sub: '2.80 / hole', delta: 0.9, good: 0.9, ratio: 1 },
];

describe('ReportChapter', () => {
  test('collapsed chapter shows the preview but not its rows', () => {
    const { getByText, queryByText } = render(wrap(
      <ReportChapter icon="flag" title="Where on the course" preview="Best: Par 5s +0.9 · Worst: Par 3s -0.7" rows={rows} hasDeltas />
    ));
    expect(getByText('Best: Par 5s +0.9 · Worst: Par 3s -0.7')).toBeTruthy();
    expect(queryByText('Par 5s')).toBeNull();
  });

  test('tapping the header expands the rows', () => {
    const { getByText, queryByText } = render(wrap(
      <ReportChapter icon="flag" title="Where on the course" preview="p" rows={rows} hasDeltas />
    ));
    fireEvent.press(getByText('Where on the course'));
    expect(getByText('Par 5s')).toBeTruthy();
    expect(getByText('+0.9')).toBeTruthy();
  });

  test('initiallyOpen renders rows and a legend when deltas exist', () => {
    const { getByText } = render(wrap(
      <ReportChapter icon="flag" title="Where on the course" preview="p" rows={rows} hasDeltas initiallyOpen />
    ));
    expect(getByText('Par 3s')).toBeTruthy();
    expect(getByText(/cost you/i)).toBeTruthy();
    expect(getByText(/gained/i)).toBeTruthy();
  });

  test('rows without deltas render an em-dash and no legend', () => {
    const bare = [{ label: 'Pars', valueText: '8', sub: '8 this round', delta: null, good: null, ratio: 0 }];
    const { getByText, queryByText } = render(wrap(
      <ReportChapter icon="hash" title="Scoring" preview="8 pars" rows={bare} hasDeltas={false} initiallyOpen />
    ));
    expect(getByText('—')).toBeTruthy();
    expect(queryByText(/gained/i)).toBeNull();
  });
});
```

```js
// src/components/mystats/__tests__/ReportVerdictHero.test.js
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import ReportVerdictHero from '../ReportVerdictHero';

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const headline = (tone) => ({
  points: 39, perHole: 2.17, vsAvg: tone === 'bad' ? -6.9 : 4.2,
  clearedBenchmark: tone !== 'bad', verdict: 'Strong round', tone,
});
const round = { holesPlayed: 18, complete: true };

describe('ReportVerdictHero', () => {
  test('fills the hero by tone', () => {
    const good = render(wrap(<ReportVerdictHero headline={headline('good')} round={round} hasHistory />));
    const bad = render(wrap(<ReportVerdictHero headline={headline('bad')} round={round} hasHistory />));
    const goodBg = StyleSheet.flatten(good.getByTestId('report-card-verdict').props.style).backgroundColor;
    const badBg = StyleSheet.flatten(bad.getByTestId('report-card-verdict').props.style).backgroundColor;
    expect(goodBg).not.toBe(badBg);
  });

  test('shows chips for per-hole, vs-avg and benchmark', () => {
    const { getByText } = render(wrap(<ReportVerdictHero headline={headline('good')} round={round} hasHistory />));
    expect(getByText('2.17 / hole')).toBeTruthy();
    expect(getByText('+4.2 vs your avg')).toBeTruthy();
    expect(getByText(/above 2.0 mark/)).toBeTruthy();
  });

  test('hides the vs-avg chip and explains when there is no history', () => {
    const { queryByText, getByText } = render(wrap(
      <ReportVerdictHero headline={{ ...headline('good'), vsAvg: null }} round={round} hasHistory={false} />
    ));
    expect(queryByText(/vs your avg/)).toBeNull();
    expect(getByText(/more rounds/)).toBeTruthy();
  });

  test('flags incomplete rounds', () => {
    const { getByText } = render(wrap(
      <ReportVerdictHero headline={headline('good')} round={{ holesPlayed: 13, complete: false }} hasHistory />
    ));
    expect(getByText(/through 13 holes/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/components/mystats/__tests__/ReportChapter.test.js src/components/mystats/__tests__/ReportVerdictHero.test.js`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `ReportDeltaRow.js`**

```js
// src/components/mystats/ReportDeltaRow.js
import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing, useReducedMotion,
} from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';
import { fmtDelta } from './reportCardView';

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
const STAGGER_MS = 40;

// Bar sweeping out of the center axis (scaleX 0→1), staggered by row.
// Own component because hooks can't sit behind the "has a bar" conditional.
function AxisBarFill({ style, delay, testID }) {
  const reduced = useReducedMotion();
  const scaleX = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (!reduced) {
      scaleX.value = withDelay(delay, withTiming(1, { duration: 420, easing: EASE_OUT }));
    }
  }, [reduced, scaleX, delay]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: scaleX.value }],
  }));

  return <Animated.View testID={testID} style={[style, animatedStyle]} />;
}

// One chapter row: label + sub on the left, a center-baseline diverging bar
// in the middle (green sweeping right = gained vs average, red sweeping left
// = cost you — polarity already folded into `row.good`), and the raw signed
// delta on the right. `row.good == null` ⇒ no bar, em-dash delta.
export default function ReportDeltaRow({ row, rowIndex = 0, first = false, testID }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const positive = row.good != null && row.good > 0;
  const negative = row.good != null && row.good < 0;
  const widthPct = Math.min(1, Math.max(0, row.ratio || 0)) * 50;
  const deltaColor = positive ? theme.accent.primary
    : negative ? theme.destructive : theme.text.muted;

  return (
    <View style={[s.row, !first && s.rowDivider]}>
      <View style={s.copy}>
        <Text style={s.label} numberOfLines={1}>{row.label}</Text>
        <Text style={s.sub} numberOfLines={1}>{row.sub}</Text>
      </View>
      <View style={s.axis}>
        <View style={s.zeroLine} />
        {row.good != null && widthPct > 0 ? (
          <AxisBarFill
            testID={testID ? `${testID}-fill` : undefined}
            delay={rowIndex * STAGGER_MS}
            style={[
              s.bar,
              positive ? s.barPositive : s.barNegative,
              { width: `${widthPct}%` },
              positive
                ? { backgroundColor: theme.accent.primary, transformOrigin: 'left center' }
                : { backgroundColor: theme.destructive, opacity: 0.75, transformOrigin: 'right center' },
            ]}
          />
        ) : null}
      </View>
      <Text style={[s.delta, { color: deltaColor }]}>{fmtDelta(row.delta)}</Text>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingVertical: 7 },
    rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border.subtle },
    copy: { width: 96, gap: 1 },
    label: { fontSize: 12, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.primary },
    sub: {
      fontSize: 9.5, fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted,
      fontVariant: ['tabular-nums'],
    },
    axis: { flex: 1, minWidth: 0, height: 18, justifyContent: 'center' },
    zeroLine: {
      position: 'absolute', left: '50%', top: -2, bottom: -2, width: 1.5,
      marginLeft: -0.75, backgroundColor: theme.border.default,
    },
    bar: { position: 'absolute', top: 4, bottom: 4, borderRadius: 999 },
    barPositive: { left: '50%' },
    barNegative: { right: '50%' },
    delta: {
      width: 44, textAlign: 'right', fontSize: 12,
      fontFamily: 'PlusJakartaSans-ExtraBold', fontVariant: ['tabular-nums'],
    },
  });
}
```

- [ ] **Step 4: Implement `ReportChapter.js`**

```js
// src/components/mystats/ReportChapter.js
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, Easing, useReducedMotion,
} from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import ReportDeltaRow from './ReportDeltaRow';

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

// Expandable chapter card: icon + title + collapsed preview in the header,
// center-baseline delta rows in the body. The chevron rotates on toggle;
// rows carry their own staggered bar sweeps.
export default function ReportChapter({
  icon, title, preview, rows, hasDeltas, initiallyOpen = false, testID,
}) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [open, setOpen] = useState(initiallyOpen);
  const reduced = useReducedMotion();
  const rotation = useSharedValue(initiallyOpen ? 1 : 0);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    rotation.value = reduced ? (next ? 1 : 0)
      : withTiming(next ? 1 : 0, { duration: 200, easing: EASE_OUT });
  };

  const chevStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value * 180}deg` }],
  }));

  return (
    <View style={s.card}>
      <TouchableOpacity
        style={s.head}
        onPress={toggle}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        testID={testID}
      >
        <View style={s.ico}>
          <Feather name={icon} size={14} color={theme.accent.primary} />
        </View>
        <View style={s.headCopy}>
          <Text style={s.title}>{title}</Text>
          <Text style={s.preview} numberOfLines={1}>{preview}</Text>
        </View>
        <Animated.View style={chevStyle}>
          <Feather name="chevron-down" size={16} color={theme.text.muted} />
        </Animated.View>
      </TouchableOpacity>
      {open && (
        <View style={s.body}>
          {hasDeltas && (
            <View style={s.legend}>
              <Text style={[s.legendText, { color: theme.destructive }]}>◂ COST YOU</Text>
              <Text style={[s.legendText, { color: theme.accent.primary }]}>GAINED ▸</Text>
            </View>
          )}
          {rows.map((row, i) => (
            <ReportDeltaRow
              key={row.label}
              row={row}
              rowIndex={i}
              first={i === 0}
              testID={testID ? `${testID}-row-${i}` : undefined}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.bg.card, borderRadius: theme.radius.lg,
      borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
      paddingHorizontal: 14, paddingVertical: 13,
    },
    head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    ico: {
      width: 30, height: 30, borderRadius: 999, backgroundColor: theme.accent.light,
      alignItems: 'center', justifyContent: 'center',
    },
    headCopy: { flex: 1, gap: 1 },
    title: { fontSize: 13, fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.primary },
    preview: {
      fontSize: 10.5, fontFamily: 'PlusJakartaSans-Medium', color: theme.text.secondary,
      fontVariant: ['tabular-nums'],
    },
    body: {
      marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border.subtle, paddingTop: 2,
    },
    legend: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
    legendText: { fontSize: 8.5, fontFamily: 'PlusJakartaSans-Bold', letterSpacing: 0.8 },
  });
}
```

- [ ] **Step 5: Implement `ReportVerdictHero.js`**

Tone fills: `good → theme.accent.primary`, `bad → theme.destructive`, `neutral → theme.text.primary` (ink). All text on the fill uses `theme.text.inverse`; secondary text uses `theme.text.inverse` at `opacity: 0.75` (NOT hard-coded white — dark theme inverts). Chip background: `theme.isDark ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.14)'`.

```js
// src/components/mystats/ReportVerdictHero.js
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeContext';
import Reveal from '../ui/Reveal';
import CountUpText from './CountUpText';
import { fmtDelta } from './reportCardView';

// Filled verdict hero (hybrid option B): tone-colored card, inverse Playfair
// verdict, count-up points top-right, chips for per-hole / vs-avg /
// benchmark / partial-round.
function heroBg(theme, tone) {
  if (tone === 'bad') return theme.destructive;
  if (tone === 'neutral') return theme.text.primary;
  return theme.accent.primary;
}

export default function ReportVerdictHero({ headline, round, hasHistory }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const reduced = useReducedMotion();
  const bg = heroBg(theme, headline.tone ?? 'neutral');

  const chips = [`${headline.perHole} / hole`];
  if (headline.vsAvg != null) chips.push(`${fmtDelta(headline.vsAvg)} vs your avg`);
  chips.push(headline.clearedBenchmark ? '✓ above 2.0 mark' : 'below 2.0 mark');
  if (!round.complete) chips.push(`through ${round.holesPlayed} holes`);

  return (
    <View testID="report-card-verdict" style={[s.hero, { backgroundColor: bg }]}>
      <View style={s.topRow}>
        <View style={s.topCopy}>
          <Text style={s.ov}>Round verdict</Text>
          <Reveal dy={9} duration={400}>
            <Text testID="report-card-verdict-phrase" style={s.verdict}>
              {headline.verdict}.
            </Text>
          </Reveal>
        </View>
        <Reveal delay={80} dy={9} duration={400}>
          <View style={s.bignum}>
            <Text style={s.bignumN}>
              <CountUpText value={headline.points} duration={500} disabled={reduced} />
            </Text>
            <Text style={s.bignumU}>points</Text>
          </View>
        </Reveal>
      </View>
      <View style={s.chips}>
        {chips.map((c) => (
          <View key={c} style={s.chip}><Text style={s.chipText}>{c}</Text></View>
        ))}
      </View>
      {!hasHistory && (
        <Text style={s.note}>The vs-your-average comparison appears once you have more rounds.</Text>
      )}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    hero: { borderRadius: theme.radius.lg + 2, padding: 16, overflow: 'hidden' },
    topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    topCopy: { flex: 1 },
    ov: {
      fontSize: 10, fontFamily: 'PlusJakartaSans-Bold', letterSpacing: 1.4,
      textTransform: 'uppercase', color: theme.text.inverse, opacity: 0.75,
    },
    verdict: {
      fontFamily: 'PlayfairDisplay-Bold', fontSize: 28, letterSpacing: -0.4,
      color: theme.text.inverse, marginTop: 4,
    },
    bignum: { alignItems: 'flex-end' },
    bignumN: {
      fontSize: 38, lineHeight: 40, fontFamily: 'PlusJakartaSans-ExtraBold',
      letterSpacing: -1.5, color: theme.text.inverse, fontVariant: ['tabular-nums'],
    },
    bignumU: {
      fontSize: 9.5, fontFamily: 'PlusJakartaSans-Bold', letterSpacing: 1.2,
      textTransform: 'uppercase', color: theme.text.inverse, opacity: 0.75,
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 13 },
    chip: {
      backgroundColor: theme.isDark ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.14)',
      borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10,
    },
    chipText: {
      fontSize: 10.5, fontFamily: 'PlusJakartaSans-Bold', color: theme.text.inverse,
      fontVariant: ['tabular-nums'],
    },
    note: {
      fontSize: 10.5, fontFamily: 'PlusJakartaSans-Medium',
      color: theme.text.inverse, opacity: 0.75, marginTop: 10,
    },
  });
}
```

- [ ] **Step 6: Implement `ReportCalloutTiles.js`**

```js
// src/components/mystats/ReportCalloutTiles.js
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import Reveal from '../ui/Reveal';
import { calloutSub } from './reportCardView';

// Twin summary tiles (hybrid option C): bright spots on the left, cost-you-
// points on the right, one row per rank. A missing side renders a spacer so
// the grid stays aligned. Renders nothing when there are no callouts at all.
export default function ReportCalloutTiles({ callouts }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const bright = callouts?.bright ?? [];
  const cost = callouts?.cost ?? [];
  const rowCount = Math.max(bright.length, cost.length);
  if (rowCount === 0) return null;

  const rows = Array.from({ length: rowCount }, (_, i) => ({
    bright: bright[i] ?? null,
    cost: cost[i] ?? null,
  }));

  return (
    <View style={s.wrap}>
      {rows.map((row, i) => (
        <Reveal key={row.bright?.label ?? row.cost?.label ?? i} delay={140 + i * 60} dy={9} duration={400} style={s.row}>
          {row.bright ? (
            <View style={[s.tile, s.tileGood]}>
              <Text style={[s.kicker, { color: theme.accent.primary }]}>BRIGHT SPOT</Text>
              <Text style={s.label}>{row.bright.label}</Text>
              <Text style={s.sub}>{calloutSub(row.bright)}</Text>
            </View>
          ) : <View style={s.spacer} />}
          {row.cost ? (
            <View style={[s.tile, s.tileBad]}>
              <Text style={[s.kicker, { color: theme.destructive }]}>COST YOU POINTS</Text>
              <Text style={s.label}>{row.cost.label}</Text>
              <Text style={s.sub}>{calloutSub(row.cost)}</Text>
            </View>
          ) : <View style={s.spacer} />}
        </Reveal>
      ))}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { gap: 8 },
    row: { flexDirection: 'row', gap: 8 },
    tile: { flex: 1, borderRadius: theme.radius.lg, paddingVertical: 11, paddingHorizontal: 12 },
    tileGood: { backgroundColor: theme.accent.light },
    tileBad: { backgroundColor: theme.bg.secondary },
    spacer: { flex: 1 },
    kicker: { fontSize: 9, fontFamily: 'PlusJakartaSans-Bold', letterSpacing: 1 },
    label: { fontSize: 13, fontFamily: 'PlusJakartaSans-ExtraBold', color: theme.text.primary, marginTop: 3 },
    sub: {
      fontSize: 10, fontFamily: 'PlusJakartaSans-SemiBold', color: theme.text.secondary,
      marginTop: 1, fontVariant: ['tabular-nums'],
    },
  });
}
```

- [ ] **Step 7: Run the new tests**

Run: `npx jest src/components/mystats/__tests__/ReportChapter.test.js src/components/mystats/__tests__/ReportVerdictHero.test.js`
Expected: PASS (8 tests).

- [ ] **Step 8: Commit**

```bash
git add src/components/mystats/ReportDeltaRow.js src/components/mystats/ReportChapter.js \
  src/components/mystats/ReportVerdictHero.js src/components/mystats/ReportCalloutTiles.js \
  src/components/mystats/__tests__/ReportChapter.test.js src/components/mystats/__tests__/ReportVerdictHero.test.js
git commit -m "feat(reportcard): hybrid presentational components"
```

---

### Task 3: Rewire `RoundReportCard.js` + update its tests

**Files:**
- Modify: `src/components/RoundReportCard.js` (full rewrite of the render; keep the picker modal)
- Modify: `src/components/__tests__/RoundReportCard.test.js`

**Interfaces:**
- Consumes: everything from Tasks 1–2; `PressableScale` (`src/components/ui/PressableScale.js`) for the Change pill and Round Stats button. Read `PressableScale.js` first — if it doesn't forward `testID`/arbitrary props, fall back to `TouchableOpacity` for the Round Stats button so `testID="report-card-open-round"` keeps working.
- Produces: same public component contract as before — `MyStatsScreen.js:460` needs no changes.

Chapter icon map (Feather names, all exist): `course → 'flag'`, `timing → 'clock'`, `distribution → 'hash'`, `shots → 'crosshair'`.

- [ ] **Step 1: Replace the test file**

```js
// src/components/__tests__/RoundReportCard.test.js — full new content
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import RoundReportCard from '../RoundReportCard';

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const pph = (label, group, value, deltaVsAvg) => ({
  label, group, value, baseline: null, deltaVsAvg, deltaVs2: +(value - 2).toFixed(2), holes: 4, polarity: 'higher',
});

function card(tone, verdict, extras = {}) {
  return {
    round: {
      key: 'round-1', courseName: 'Pine', tournamentName: 'Cup',
      holesPlayed: 18, complete: true,
    },
    headline: {
      points: 29, perHole: 1.61,
      vsAvg: tone === 'bad' ? -6.9 : tone === 'good' ? 4.2 : 0,
      clearedBenchmark: tone === 'good', verdict, tone,
    },
    callouts: { bright: [], cost: [] },
    groups: [],
    hasHistory: true,
    ...extras,
  };
}

const groups = [
  { key: 'course', label: 'Where on the course',
    cells: [pph('Par 3s', 'course', 1.25, -0.7), pph('Par 5s', 'course', 2.8, 0.9)] },
  { key: 'timing', label: 'When in the round',
    cells: [pph('Opening 3', 'timing', 1.33, -0.6)] },
];

describe('RoundReportCard', () => {
  test('fills the verdict hero by headline tone', () => {
    const tough = render(wrap(
      <RoundReportCard card={card('bad', 'Tough day')} rounds={[]} selectedKey="round-1" onSelect={() => {}} />
    ));
    const strong = render(wrap(
      <RoundReportCard card={card('good', 'Strong round')} rounds={[]} selectedKey="round-1" onSelect={() => {}} />
    ));
    const toughBg = StyleSheet.flatten(tough.getByTestId('report-card-verdict').props.style).backgroundColor;
    const strongBg = StyleSheet.flatten(strong.getByTestId('report-card-verdict').props.style).backgroundColor;
    expect(toughBg).not.toBe(strongBg);
    expect(strong.getByTestId('report-card-verdict-phrase')).toBeTruthy();
  });

  test('renders callout tiles when the card has callouts', () => {
    const withCallouts = card('good', 'Strong round', {
      callouts: { bright: [pph('Par 5s', 'course', 2.8, 0.9)], cost: [pph('Par 3s', 'course', 1.25, -0.7)] },
    });
    const { getByText } = render(wrap(
      <RoundReportCard card={withCallouts} rounds={[]} selectedKey="round-1" onSelect={() => {}} />
    ));
    expect(getByText('BRIGHT SPOT')).toBeTruthy();
    expect(getByText('COST YOU POINTS')).toBeTruthy();
  });

  test('renders chapters with the first one expanded', () => {
    const { getByText, queryByText } = render(wrap(
      <RoundReportCard card={card('good', 'Strong round', { groups })} rounds={[]} selectedKey="round-1" onSelect={() => {}} />
    ));
    expect(getByText('Par 3s')).toBeTruthy();          // first chapter open
    expect(queryByText('Opening 3')).toBeNull();       // second collapsed
    fireEvent.press(getByText('When in the round'));
    expect(getByText('Opening 3')).toBeTruthy();
  });

  test('Change pill opens the round picker modal', () => {
    const { getByText } = render(wrap(
      <RoundReportCard card={card('good', 'Strong round')} rounds={[]} selectedKey="round-1" onSelect={() => {}} />
    ));
    fireEvent.press(getByText('Change'));
    expect(getByText('Choose a round')).toBeTruthy();
  });

  test('renders a Round Stats link that fires onOpenRound', () => {
    const onOpenRound = jest.fn();
    const { getByText, getByTestId } = render(wrap(
      <RoundReportCard
        card={card('good', 'Strong round')} rounds={[]} selectedKey="round-1"
        onSelect={() => {}} onOpenRound={onOpenRound}
      />
    ));
    expect(getByTestId('report-card-open-round')).toBeTruthy();
    fireEvent.press(getByText('Round Stats'));
    expect(onOpenRound).toHaveBeenCalledTimes(1);
  });

  test('hides the Round Stats link when onOpenRound is not provided', () => {
    const { queryByText } = render(wrap(
      <RoundReportCard card={card('good', 'Strong round')} rounds={[]} selectedKey="round-1" onSelect={() => {}} />
    ));
    expect(queryByText('Round Stats')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx jest src/components/__tests__/RoundReportCard.test.js`
Expected: FAIL — old component doesn't render `BRIGHT SPOT` tiles, `Change` pill, or hero fills.

- [ ] **Step 3: Rewrite the component**

```js
// src/components/RoundReportCard.js — full new content
import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, Modal, ScrollView, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import PressableScale from './ui/PressableScale';
import ReportVerdictHero from './mystats/ReportVerdictHero';
import ReportCalloutTiles from './mystats/ReportCalloutTiles';
import ReportChapter from './mystats/ReportChapter';
import { buildChapterVM } from './mystats/reportCardView';

const CHAPTER_ICONS = {
  course: 'flag',
  timing: 'clock',
  distribution: 'hash',
  shots: 'crosshair',
};

export default function RoundReportCard({ card, rounds, selectedKey, onSelect, onOpenRound }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const chapters = useMemo(
    () => (card ? card.groups.map((g) => buildChapterVM(g, { hasHistory: card.hasHistory })) : []),
    [card],
  );

  if (!card) {
    return (
      <View style={s.empty}>
        <Feather name="clipboard" size={44} color={theme.text.muted} />
        <Text style={s.emptyText}>No round selected.</Text>
      </View>
    );
  }

  const { round, headline, callouts, hasHistory } = card;

  return (
    <View style={s.wrap}>
      {/* Round selector: course + tournament inline, Change pill opens the picker */}
      <View style={s.dropLine}>
        <View style={{ flex: 1 }}>
          <Text style={s.dropTitle} numberOfLines={1}>{round.courseName}</Text>
          <Text style={s.dropSub} numberOfLines={1}>{round.tournamentName}</Text>
        </View>
        <PressableScale style={s.pickBtn} onPress={() => setPickerOpen(true)}>
          <Text style={s.pickBtnText}>Change</Text>
          <Feather name="chevron-down" size={13} color={theme.accent.primary} />
        </PressableScale>
      </View>

      <ReportVerdictHero headline={headline} round={round} hasHistory={hasHistory} />

      <ReportCalloutTiles callouts={callouts} />

      {/* Remount chapters when the round changes so bar sweeps replay */}
      {chapters.map((ch, i) => (
        <ReportChapter
          key={`${round.key}-${ch.key}`}
          icon={CHAPTER_ICONS[ch.key] ?? 'bar-chart-2'}
          title={ch.label}
          preview={ch.preview}
          rows={ch.rows}
          hasDeltas={ch.hasDeltas}
          initiallyOpen={i === 0}
          testID={`report-chapter-${ch.key}`}
        />
      ))}

      {onOpenRound && (
        <PressableScale
          testID="report-card-open-round"
          style={s.openRoundBtn}
          onPress={onOpenRound}
        >
          <Text style={s.openRoundText}>Round Stats</Text>
          <Feather name="chevron-right" size={16} color={theme.accent.primary} />
        </PressableScale>
      )}

      {/* Round picker modal — unchanged behavior */}
      <Modal statusBarTranslucent hardwareAccelerated visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <TouchableOpacity style={s.modalBg} activeOpacity={1} onPress={() => setPickerOpen(false)}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Choose a round</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {(rounds || []).slice().reverse().map((r) => (
                <TouchableOpacity
                  key={r.key}
                  style={[s.pickRow, r.key === selectedKey && s.pickRowOn]}
                  onPress={() => { onSelect(r.key); setPickerOpen(false); }}
                >
                  <Text style={s.pickName} numberOfLines={1}>{r.courseName}</Text>
                  <Text style={s.pickSub} numberOfLines={1}>{r.tournamentName}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { padding: 4, gap: 12 },
    empty: { alignItems: 'center', justifyContent: 'center', padding: 40, gap: 10 },
    emptyText: { fontFamily: 'PlusJakartaSans-Medium', color: theme.text.muted, fontSize: 14 },

    dropLine: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 2 },
    dropTitle: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 14, color: theme.text.primary },
    dropSub: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme.text.muted, marginTop: 1 },
    pickBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      backgroundColor: theme.accent.light, borderRadius: 999,
      paddingVertical: 6, paddingHorizontal: 11,
    },
    pickBtnText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 11, color: theme.accent.primary },

    openRoundBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      backgroundColor: theme.bg.secondary, borderRadius: 12, padding: 12,
    },
    openRoundText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 12, color: theme.accent.primary },

    modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
    modalCard: { backgroundColor: theme.bg.card, borderRadius: 16, padding: 16, width: '100%' },
    modalTitle: { fontFamily: 'PlayfairDisplay-Bold', fontSize: 17, color: theme.text.primary, marginBottom: 10 },
    pickRow: { paddingVertical: 11, paddingHorizontal: 10, borderRadius: 10 },
    pickRowOn: { backgroundColor: theme.accent.light },
    pickName: { fontFamily: 'PlusJakartaSans-Bold', fontSize: 14, color: theme.text.primary },
    pickSub: { fontFamily: 'PlusJakartaSans-Medium', fontSize: 11, color: theme.text.muted, marginTop: 1 },
  });
}
```

- [ ] **Step 4: Run the component tests**

Run: `npx jest src/components/__tests__/RoundReportCard.test.js src/components/mystats/__tests__/reportCardView.test.js src/components/mystats/__tests__/ReportChapter.test.js src/components/mystats/__tests__/ReportVerdictHero.test.js`
Expected: PASS.

- [ ] **Step 5: Run the neighboring suite**

Run: `npx jest src/screens/__tests__/MyStatsScreen.test.js`
Expected: PASS — the `Round Stats` press-through and reportCard routing tests still find their targets. If a test asserts on removed copy (`Show full breakdown`, `BRIGHT SPOTS` section header), update the assertion to the new equivalents (`report-chapter-*` testIDs, `BRIGHT SPOT` tile kicker).

- [ ] **Step 6: Commit**

```bash
git add src/components/RoundReportCard.js src/components/__tests__/RoundReportCard.test.js
git commit -m "feat(reportcard): hybrid layout — selector pill, filled hero, callout tiles, chapters"
```

---

### Task 4: Full verification

- [ ] **Step 1: Full test suite**

Run: `npx jest`
Expected: all suites pass. (Pre-existing QuickStartCourses failures, if any, are known-unrelated — verify they also fail on master before ignoring.)

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 3: Commit any fixups**

```bash
git add -A && git commit -m "test: fixups after report card hybrid"   # only if needed
```
