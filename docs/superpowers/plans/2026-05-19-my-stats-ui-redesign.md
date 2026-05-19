# My Stats UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the personal stats screen (`MyStatsScreen`) as a small, tested component library — a Recent Form hero, labelled SVG line charts, and tap-to-reveal explainers — without changing any computed statistic.

**Architecture:** A new `src/components/mystats/` folder holds presentational primitives (cards, tiles, charts) and one explainer-copy map. Each of the four analytical tabs becomes its own file under `mystats/tabs/`. `MyStatsScreen` is slimmed to orchestration: data loading, round selection, tab switching, and one shared `StatDetailSheet`. The statistics layer (`statsEngine.js`) is untouched; `personalStats.js` gains one additive pure selector (`computeFormSeries`) that reuses the existing engine on single-round slices.

**Tech Stack:** React Native, `react-native-svg` (already a dependency), Jest. Theme via `useTheme()` from `src/theme/ThemeContext`.

---

## Background for the engineer

- `MyStatsScreen.js` currently loads tournaments, calls `collectMyRounds` → `resolveSelection` → `computeMyStats`, and renders 5 tabs (`Report Card`, `Overview`, `Form`, `Breakdown`, `Shots`) with all sub-components defined inline in the same file.
- `computeMyStats(selectedRounds, { n })` (in `src/store/personalStats.js`) returns an object with: `roundCount`, `metrics`, `form`, `ranking`, `parType`, `difficulty`, `frontBack`, `warmupClosing`, `distribution`, `teeShot`, `shots`, `bounceBack`, `scrambling`, `history`. **None of these shapes change in this plan** — we only ADD a `formSeries` field.
- `stats.form` (from `computeRecentVsHistory`) has `{ n, recentCount, historyCount, hasHistory, hasShotData, metrics }` where each `metrics` entry is `{ key, label, polarity, shot, recent, history, delta, direction }`. `direction` is `'up' | 'down' | 'flat'`. `FORM_METRICS` keys are: `avgPoints`, `avgVsPar`, `fairwayPct`, `girPct`, `puttsPerRound`, `threePuttsPerRound`.
- `stats.metrics` has `{ rounds, avgPoints, avgVsPar, bestRoundPoints, hasShotData, fairwayPct, puttsPerRound, girPct, threePuttsPerRound }`.
- `StatDetailSheet` (`src/components/StatDetailSheet.js`) is an existing bottom sheet. Props used here: `visible`, `onClose`, `title`, `subtitle`, `explainer`, `rows` (pass `[]`), `shareable` (pass `false`).
- Theme tokens available: `theme.bg.{primary,secondary,card}`, `theme.text.{primary,secondary,muted,inverse}`, `theme.border.{default,subtle}`, `theme.accent.{primary,light}`, `theme.destructive`, `theme.spacing.{xs,sm,md,lg,xl}`, `theme.radius.{lg,pill}`, `theme.typography.{title,heading,subhead,body,caption,overline,tiny}`.
- Run a single test file: `npx jest <path>`. Run everything: `npx jest`.
- The repo has a pre-commit gate hook; commit messages in this plan already include the required `Co-Authored-By` trailer.

## File structure

**Create:**
- `src/components/mystats/chartGeometry.js` — pure series→coordinate math.
- `src/components/mystats/TrendLineChart.js` — SVG labelled line chart (full + compact via props).
- `src/components/mystats/DistributionBars.js` — SVG vertical bars.
- `src/components/mystats/ScoreMixArea.js` — SVG stacked area chart.
- `src/components/mystats/SectionCard.js` — card shell + optional info button.
- `src/components/mystats/StatTile.js` — one big value + caption.
- `src/components/mystats/MetricRow.js` — label · value · optional sample/trend.
- `src/components/mystats/FormMetricBlock.js` — metric header + compact chart.
- `src/components/mystats/statExplainers.js` — explainer copy map.
- `src/components/mystats/tabs/OverviewTab.js`
- `src/components/mystats/tabs/FormTab.js`
- `src/components/mystats/tabs/BreakdownTab.js`
- `src/components/mystats/tabs/ShotsTab.js`
- `src/components/mystats/__tests__/chartGeometry.test.js`

**Modify:**
- `src/store/personalStats.js` — add `computeFormSeries`; `computeMyStats` returns `formSeries`.
- `src/store/__tests__/personalStats.test.js` — tests for `computeFormSeries`.
- `src/screens/MyStatsScreen.js` — slim to orchestration; delete inline `Snapshot`/`StrengthsSection`/`FormSection`/`BreakdownSection`/`DistributionSection`/`Sparkline`/`Stat`/`StrengthsRow`; compose tab files; add screen-level `StatDetailSheet`.

---

## Task 1: `computeFormSeries` per-round selector

**Files:**
- Modify: `src/store/personalStats.js`
- Test: `src/store/__tests__/personalStats.test.js`

- [ ] **Step 1: Write the failing tests**

Add this `describe` block at the end of `src/store/__tests__/personalStats.test.js` (the fixture helpers `holes18`, `evenScores`, `mkRound` already exist near the top of the file; reuse them):

```js
describe('computeFormSeries', () => {
  // collectMyRounds output shape: each MyRound has { round, courseName, player, playerId }
  function myRound(courseName, holes, strokes) {
    return {
      key: `${courseName}:0`,
      round: mkRound({ courseName, holes, scores: { p1: evenScores(holes, strokes) }, playerHandicaps: { p1: 0 } }),
      courseName,
      roundIndex: 0,
      playerId: 'p1',
      player: { id: 'p1', name: 'Me', handicap: 0, user_id: 'u1' },
      completed: true,
    };
  }

  test('returns one points-series entry per selected round', () => {
    const h = holes18();
    const rounds = [myRound('Pine', h, 4), myRound('Oak', h, 5)];
    const { metrics } = computeFormSeries(rounds);
    expect(metrics.avgPoints).toHaveLength(2);
    expect(metrics.avgPoints[0]).toEqual({ label: 'Pine', value: 36 }); // par on every hole = 2 pts x 18
    expect(metrics.avgPoints[1].value).toBe(18); // bogey on every hole = 1 pt x 18
  });

  test('computes strokes vs par per round', () => {
    const h = holes18(); // 18 par-4 holes -> par 72
    const { metrics } = computeFormSeries([myRound('Pine', h, 5)]);
    expect(metrics.avgVsPar[0]).toEqual({ label: 'Pine', value: 18 }); // 90 strokes - 72 par
  });

  test('shot metrics are null when the round has no shot data', () => {
    const h = holes18();
    const { metrics, hasShotData } = computeFormSeries([myRound('Pine', h, 4)]);
    expect(hasShotData).toBe(false);
    expect(metrics.fairwayPct[0].value).toBeNull();
    expect(metrics.girPct[0].value).toBeNull();
    expect(metrics.puttsPerRound[0].value).toBeNull();
  });

  test('builds a birdie/par/bogey score-mix entry per round', () => {
    const h = holes18();
    const { scoreMix } = computeFormSeries([myRound('Pine', h, 4)]);
    expect(scoreMix[0]).toEqual({ label: 'Pine', birdie: 0, par: 18, bogey: 0 });
  });

  test('empty selection returns empty series', () => {
    const r = computeFormSeries([]);
    expect(r.metrics.avgPoints).toEqual([]);
    expect(r.scoreMix).toEqual([]);
    expect(r.hasShotData).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/store/__tests__/personalStats.test.js -t computeFormSeries`
Expected: FAIL — `computeFormSeries is not a function` / `is not exported`.

- [ ] **Step 3: Implement `computeFormSeries`**

In `src/store/personalStats.js`, add `playerScoreDistribution` to the existing import from `./statsEngine` (`shotStats` is already imported). Then add this function immediately ABOVE `computeMyStats`:

```js
// ── computeFormSeries ──
// Per-round series for the Form-tab charts. Each selected round is sliced into
// a one-round synthetic tournament and run back through the existing engine —
// no parallel per-round math. Shot-derived values are null for rounds with no
// shot detail so charts render a gap rather than a fake zero.
export function computeFormSeries(selectedRounds) {
  const rounds = selectedRounds || [];
  const metrics = {
    avgPoints: [], avgVsPar: [], fairwayPct: [],
    girPct: [], puttsPerRound: [], threePuttsPerRound: [],
  };
  const scoreMix = [];
  let hasShotData = false;

  rounds.forEach((mr, i) => {
    const label = mr.courseName || `R${i + 1}`;
    const synthetic = buildSyntheticTournament([mr]);
    const round = synthetic.rounds[0];
    const hist = playerRoundHistory(synthetic, CANON_ID)[0] || null;
    let parPlayed = 0;
    (round.holes || []).forEach((h) => {
      if (round.scores?.[CANON_ID]?.[h.number] != null) parPlayed += h.par;
    });
    const shots = shotStats(synthetic, CANON_ID);
    if (shots.hasData) hasShotData = true;

    metrics.avgPoints.push({ label, value: hist ? hist.points : 0 });
    metrics.avgVsPar.push({ label, value: hist ? hist.strokes - parPlayed : null });
    metrics.fairwayPct.push({ label, value: shots.drives.recorded > 0 ? shots.drives.fairwayPct : null });
    metrics.girPct.push({ label, value: shots.gir.eligible > 0 ? shots.gir.pct : null });
    metrics.puttsPerRound.push({ label, value: shots.putts.holes > 0 ? shots.putts.total : null });
    metrics.threePuttsPerRound.push({ label, value: shots.putts.holes > 0 ? shots.putts.threePuttPlus : null });

    const d = playerScoreDistribution(synthetic, CANON_ID);
    scoreMix.push({
      label,
      birdie: d.eagles + d.birdies,
      par: d.pars,
      bogey: d.bogeys + d.doubles + d.worse,
    });
  });

  return { metrics, scoreMix, hasShotData };
}
```

Then, inside `computeMyStats`, add `formSeries` to the returned object (place it right after `history`):

```js
    history: playerRoundHistory(synthetic, CANON_ID),
    formSeries: computeFormSeries(rounds),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/store/__tests__/personalStats.test.js`
Expected: PASS — all `computeFormSeries` tests plus the pre-existing `personalStats` tests.

- [ ] **Step 5: Commit**

```bash
git add src/store/personalStats.js src/store/__tests__/personalStats.test.js
git commit -m "$(printf 'feat: computeFormSeries — per-round series for Form charts\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

## Task 2: Chart geometry helper

**Files:**
- Create: `src/components/mystats/chartGeometry.js`
- Test: `src/components/mystats/__tests__/chartGeometry.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/components/mystats/__tests__/chartGeometry.test.js`:

```js
import { scalePoints, toSegments } from '../chartGeometry';

const BOX = { width: 100, height: 100, padX: 0, padTop: 0, padBottom: 0 };

describe('scalePoints', () => {
  test('returns one point per input value', () => {
    expect(scalePoints([1, 2, 3], BOX)).toHaveLength(3);
  });

  test('a single value is centred horizontally', () => {
    const [p] = scalePoints([5], BOX);
    expect(p.x).toBe(50);
  });

  test('min value maps to the bottom, max to the top', () => {
    const pts = scalePoints([10, 20], BOX);
    expect(pts[0].y).toBe(100); // min -> bottom
    expect(pts[1].y).toBe(0);   // max -> top
  });

  test('a flat series maps every point to the same y', () => {
    const pts = scalePoints([7, 7, 7], BOX);
    expect(pts.every((p) => p.y === pts[0].y)).toBe(true);
  });

  test('null values keep an x but carry a null y', () => {
    const pts = scalePoints([10, null, 20], BOX);
    expect(pts[1].y).toBeNull();
    expect(typeof pts[1].x).toBe('number');
  });

  test('empty input returns an empty array', () => {
    expect(scalePoints([], BOX)).toEqual([]);
  });
});

describe('toSegments', () => {
  test('splits a polyline on null gaps', () => {
    const pts = [
      { x: 0, y: 1 }, { x: 1, y: 2 },
      { x: 2, y: null },
      { x: 3, y: 3 },
    ];
    const segs = toSegments(pts);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toHaveLength(2);
    expect(segs[1]).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/components/mystats/__tests__/chartGeometry.test.js`
Expected: FAIL — `Cannot find module '../chartGeometry'`.

- [ ] **Step 3: Implement the helper**

Create `src/components/mystats/chartGeometry.js`:

```js
// Pure geometry for the My Stats charts. No React, no SVG — just numbers, so
// it is trivially unit-testable.

// Maps an array of values (numbers, or null for a gap) to {x, y, value}
// points inside a box. The min value sits on the bottom edge of the inner
// area, the max on the top edge. A flat series is pinned to the vertical
// middle of the inner area.
export function scalePoints(values, { width, height, padX = 0, padTop = 0, padBottom = 0 }) {
  if (!values || values.length === 0) return [];
  const nums = values.filter((v) => v != null);
  const min = nums.length ? Math.min(...nums) : 0;
  const max = nums.length ? Math.max(...nums) : 0;
  const span = max - min;
  const innerW = width - padX * 2;
  const innerH = height - padTop - padBottom;
  const n = values.length;
  return values.map((v, i) => {
    const x = n === 1 ? width / 2 : padX + (innerW * i) / (n - 1);
    if (v == null) return { x, y: null, value: null };
    const ratio = span === 0 ? 0.5 : (v - min) / span;
    const y = padTop + innerH * (1 - ratio);
    return { x, y, value: v };
  });
}

// Splits scaled points into contiguous runs that have a non-null y, so a
// polyline can skip gaps instead of drawing a line through them.
export function toSegments(points) {
  const segments = [];
  let current = [];
  (points || []).forEach((p) => {
    if (p.y == null) {
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push(p);
    }
  });
  if (current.length) segments.push(current);
  return segments;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/components/mystats/__tests__/chartGeometry.test.js`
Expected: PASS — all 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/mystats/chartGeometry.js src/components/mystats/__tests__/chartGeometry.test.js
git commit -m "$(printf 'feat: chartGeometry helper for My Stats charts\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

## Task 3: `TrendLineChart` component

A single configurable line chart used both full-size (Form/Overview) and compact (inside metric rows). No unit test — it is presentational; its math lives in the tested `chartGeometry`.

**Files:**
- Create: `src/components/mystats/TrendLineChart.js`

- [ ] **Step 1: Implement the component**

Create `src/components/mystats/TrendLineChart.js`:

```js
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polyline, Circle, Line, Text as SvgText } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeContext';
import { scalePoints, toSegments } from './chartGeometry';

// series: [{ label, value }]  — value may be null for a gap.
// variant: 'full' (default) | 'compact'.
// formatValue: (number) => string  — used for the on-dot labels.
export default function TrendLineChart({
  series = [],
  color,
  variant = 'full',
  formatValue = (v) => `${v}`,
  caption,
}) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const stroke = color || theme.accent.primary;

  const compact = variant === 'compact';
  const width = 300;
  const height = compact ? 56 : 104;
  const padX = 18;
  const padTop = compact ? 14 : 20;
  const padBottom = compact ? 14 : 16;
  const dotR = compact ? 3.2 : 3.6;
  const fontSize = compact ? 9 : 9.5;

  const points = useMemo(
    () => scalePoints(series.map((p) => p.value), { width, height, padX, padTop, padBottom }),
    [series],
  );
  const drawn = points.filter((p) => p.y != null);
  const segments = useMemo(() => toSegments(points), [points]);

  if (drawn.length === 0) {
    return (
      <View style={s.empty}>
        <Text style={s.emptyText}>Not enough rounds yet.</Text>
      </View>
    );
  }

  return (
    <View>
      {caption ? <Text style={s.caption}>{caption}</Text> : null}
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        {!compact && (
          <>
            <Line x1={padX / 2} y1={padTop} x2={width - padX / 2} y2={padTop} stroke={theme.border.default} strokeWidth="1" />
            <Line x1={padX / 2} y1={height - padBottom} x2={width - padX / 2} y2={height - padBottom} stroke={theme.border.default} strokeWidth="1" />
          </>
        )}
        {segments.map((seg, i) => (
          <Polyline
            key={`seg-${i}`}
            points={seg.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke={stroke}
            strokeWidth={compact ? 2.6 : 3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {drawn.map((p, i) => {
          const labelAbove = p.y > height * 0.32;
          const ly = labelAbove ? p.y - dotR - 4 : p.y + dotR + fontSize + 1;
          return (
            <React.Fragment key={`pt-${i}`}>
              <Circle cx={p.x} cy={p.y} r={dotR} fill={stroke} />
              <SvgText
                x={p.x}
                y={ly}
                fontSize={fontSize}
                fontWeight="800"
                fill={theme.text.primary}
                textAnchor="middle"
              >
                {formatValue(p.value)}
              </SvgText>
            </React.Fragment>
          );
        })}
      </Svg>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    caption: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '700', marginBottom: 2 },
    empty: { paddingVertical: theme.spacing.md, alignItems: 'center' },
    emptyText: { ...theme.typography.caption, color: theme.text.muted, fontStyle: 'italic' },
  });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx jest` (the full suite — confirms no import/syntax error is introduced).
Expected: PASS — same test count as before this task (no tests added).

- [ ] **Step 3: Commit**

```bash
git add src/components/mystats/TrendLineChart.js
git commit -m "$(printf 'feat: TrendLineChart — labelled SVG line chart for My Stats\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

## Task 4: `DistributionBars` and `ScoreMixArea` components

**Files:**
- Create: `src/components/mystats/DistributionBars.js`
- Create: `src/components/mystats/ScoreMixArea.js`

- [ ] **Step 1: Implement `DistributionBars`**

Create `src/components/mystats/DistributionBars.js`:

```js
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

// bars: [{ label, count, muted? }]  — vertical bars scaled to the largest count.
export default function DistributionBars({ bars = [] }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const max = Math.max(1, ...bars.map((b) => b.count));

  return (
    <View style={s.row}>
      {bars.map((b) => (
        <View key={b.label} style={s.col}>
          <Text style={s.count}>{b.count}</Text>
          <View
            style={[
              s.bar,
              {
                height: `${Math.max(3, Math.round((b.count / max) * 100))}%`,
                backgroundColor: b.muted ? theme.border.default : theme.accent.primary,
              },
            ]}
          />
          <Text style={s.label}>{b.label}</Text>
        </View>
      ))}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'flex-end', gap: 7, height: 128, paddingTop: 16 },
    col: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' },
    count: { ...theme.typography.caption, fontWeight: '800', color: theme.text.primary, marginBottom: 3 },
    bar: { width: '100%', borderTopLeftRadius: 5, borderTopRightRadius: 5 },
    label: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '700', marginTop: 5, textAlign: 'center' },
  });
}
```

- [ ] **Step 2: Implement `ScoreMixArea`**

Create `src/components/mystats/ScoreMixArea.js`:

```js
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeContext';

// rounds: [{ label, birdie, par, bogey }] — counts per round. Each round is
// normalised to a 0..1 share, then drawn as three stacked bands.
export default function ScoreMixArea({ rounds = [] }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const C = { birdie: theme.accent.primary, par: '#7fb59f', bogey: '#e7d7b4' };
  const width = 300;
  const height = 92;
  const padX = 22;

  const cols = useMemo(() => {
    const n = rounds.length;
    return rounds.map((r, i) => {
      const total = r.birdie + r.par + r.bogey || 1;
      const x = n === 1 ? width / 2 : padX + ((width - padX * 2) * i) / (n - 1);
      const birdieShare = r.birdie / total;
      const parShare = r.par / total;
      // y boundaries: 0 = top. birdie band top..b1, par b1..b2, bogey b2..height.
      const b1 = height * birdieShare;
      const b2 = height * (birdieShare + parShare);
      return { x, b1, b2 };
    });
  }, [rounds]);

  if (cols.length < 2) {
    return <Text style={s.empty}>Not enough rounds yet.</Text>;
  }

  const band = (topFn, botFn) => {
    const top = cols.map((c) => `${c.x},${topFn(c)}`);
    const bot = cols.map((c) => `${c.x},${botFn(c)}`).reverse();
    return `M${top.join(' L')} L${bot.join(' L')} Z`;
  };

  return (
    <View>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <Path d={band(() => 0, (c) => c.b1)} fill={C.birdie} />
        <Path d={band((c) => c.b1, (c) => c.b2)} fill={C.par} />
        <Path d={band((c) => c.b2, () => height)} fill={C.bogey} />
      </Svg>
      <View style={s.legend}>
        {[['Birdie+', C.birdie], ['Par', C.par], ['Bogey+', C.bogey]].map(([label, color]) => (
          <View key={label} style={s.lg}>
            <View style={[s.sw, { backgroundColor: color }]} />
            <Text style={s.lgText}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    empty: { ...theme.typography.caption, color: theme.text.muted, fontStyle: 'italic', paddingVertical: theme.spacing.md, textAlign: 'center' },
    legend: { flexDirection: 'row', gap: theme.spacing.md, marginTop: theme.spacing.sm },
    lg: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    sw: { width: 10, height: 10, borderRadius: 3 },
    lgText: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '700' },
  });
}
```

- [ ] **Step 3: Verify both compile**

Run: `npx jest`
Expected: PASS — same test count as before.

- [ ] **Step 4: Commit**

```bash
git add src/components/mystats/DistributionBars.js src/components/mystats/ScoreMixArea.js
git commit -m "$(printf 'feat: DistributionBars and ScoreMixArea charts for My Stats\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

## Task 5: `SectionCard`, `StatTile`, `MetricRow`

**Files:**
- Create: `src/components/mystats/SectionCard.js`
- Create: `src/components/mystats/StatTile.js`
- Create: `src/components/mystats/MetricRow.js`

- [ ] **Step 1: Implement `SectionCard`**

Create `src/components/mystats/SectionCard.js`:

```js
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';

// Card shell with a title and an optional (i) button. The button does not own
// any sheet — it just calls onInfo(infoKey). `right` renders extra header
// content (e.g. period chips). `tone='hero'` gives the filled green variant.
export default function SectionCard({ title, infoKey, onInfo, right, tone = 'default', children, style }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const hero = tone === 'hero';

  return (
    <View style={[s.card, hero && s.cardHero, style]}>
      <View style={s.head}>
        <View style={s.titleWrap}>
          <Text style={[s.title, hero && s.titleHero]}>{title}</Text>
          {infoKey && onInfo ? (
            <TouchableOpacity
              onPress={() => onInfo(infoKey)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={`What is ${title}`}
            >
              <Feather name="info" size={15} color={hero ? 'rgba(255,255,255,0.85)' : theme.text.muted} />
            </TouchableOpacity>
          ) : null}
        </View>
        {right ?? null}
      </View>
      {children}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.bg.card, borderRadius: theme.radius.lg,
      padding: theme.spacing.lg, gap: theme.spacing.sm,
      borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
    },
    cardHero: { backgroundColor: theme.accent.primary, borderColor: theme.accent.primary },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    titleWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    title: { ...theme.typography.heading, color: theme.text.primary },
    titleHero: { color: theme.text.inverse },
  });
}
```

- [ ] **Step 2: Implement `StatTile`**

Create `src/components/mystats/StatTile.js`:

```js
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

// One large value + caption. tone: 'default' | 'up' | 'down'.
// surface: 'card' (default, on a light card) | 'hero' (on the green hero).
export default function StatTile({ value, caption, tone = 'default', surface = 'card' }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const hero = surface === 'hero';
  const valueColor = tone === 'up' ? (hero ? theme.text.inverse : theme.accent.primary)
    : tone === 'down' ? theme.destructive
      : (hero ? theme.text.inverse : theme.text.primary);

  return (
    <View style={[s.tile, hero && s.tileHero]}>
      <Text style={[s.value, { color: valueColor }]}>{value}</Text>
      <Text style={[s.caption, hero && s.captionHero]}>{caption}</Text>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    tile: {
      flex: 1, backgroundColor: theme.bg.secondary, borderRadius: theme.radius.lg,
      padding: theme.spacing.md, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.border.default,
    },
    tileHero: { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'transparent' },
    value: { ...theme.typography.title, color: theme.text.primary },
    caption: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '700', marginTop: 1 },
    captionHero: { color: 'rgba(255,255,255,0.75)' },
  });
}
```

- [ ] **Step 3: Implement `MetricRow`**

Create `src/components/mystats/MetricRow.js`:

```js
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';

// A label + primary value, with an optional secondary value (e.g. "36 holes")
// and an optional (i) button. `dim` greys a zero-sample row.
export default function MetricRow({ label, value, secondary, infoKey, onInfo, dim = false }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);

  return (
    <View style={s.row}>
      <View style={s.labelWrap}>
        <Text style={[s.label, dim && s.dim]}>{label}</Text>
        {infoKey && onInfo ? (
          <TouchableOpacity
            onPress={() => onInfo(infoKey)}
            hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={`What is ${label}`}
          >
            <Feather name="info" size={13} color={theme.text.muted} />
          </TouchableOpacity>
        ) : null}
      </View>
      <Text style={[s.value, dim && s.dim]}>{dim ? '—' : value}</Text>
      {secondary != null ? <Text style={s.secondary}>{dim ? '' : secondary}</Text> : null}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7 },
    labelWrap: { flex: 2, flexDirection: 'row', alignItems: 'center', gap: 5 },
    label: { ...theme.typography.body, color: theme.text.primary },
    value: { ...theme.typography.body, color: theme.text.primary, flex: 1, textAlign: 'right', fontWeight: '700' },
    secondary: { ...theme.typography.caption, color: theme.text.muted, flex: 1, textAlign: 'right' },
    dim: { color: theme.text.muted },
  });
}
```

- [ ] **Step 4: Verify all compile**

Run: `npx jest`
Expected: PASS — same test count as before.

- [ ] **Step 5: Commit**

```bash
git add src/components/mystats/SectionCard.js src/components/mystats/StatTile.js src/components/mystats/MetricRow.js
git commit -m "$(printf 'feat: SectionCard, StatTile, MetricRow primitives for My Stats\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

## Task 6: `FormMetricBlock` component

**Files:**
- Create: `src/components/mystats/FormMetricBlock.js`

- [ ] **Step 1: Implement the component**

Create `src/components/mystats/FormMetricBlock.js`:

```js
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import TrendLineChart from './TrendLineChart';

// One Form-tab metric: a header (name, Recent vs History, trend chip) above a
// compact labelled line chart.
//   metric: { key, label, recent, history, delta, direction } (from stats.form)
//   series: [{ label, value }] (from stats.formSeries.metrics[key])
export default function FormMetricBlock({ metric, series, color, formatValue, infoKey, onInfo }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const trendColor = metric.direction === 'up' ? theme.accent.primary
    : metric.direction === 'down' ? theme.destructive : theme.text.muted;
  const arrow = metric.direction === 'up' ? '▲' : metric.direction === 'down' ? '▼' : '—';
  const sign = metric.delta != null && metric.delta > 0 ? '+' : '';
  const fmt = formatValue || ((v) => `${v}`);

  return (
    <View style={s.block}>
      <View style={s.top}>
        <View style={s.nameWrap}>
          <Text style={s.name}>{metric.label}</Text>
          {infoKey && onInfo ? (
            <TouchableOpacity
              onPress={() => onInfo(infoKey)}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={`What is ${metric.label}`}
            >
              <Feather name="info" size={13} color={theme.text.muted} />
            </TouchableOpacity>
          ) : null}
        </View>
        <View style={s.right}>
          <Text style={s.vs}>
            <Text style={s.vsStrong}>{fmt(metric.recent)}</Text>
            {metric.history != null ? `  vs ${fmt(metric.history)}` : ''}
          </Text>
          <Text style={[s.trend, { color: trendColor }]}>
            {metric.delta == null ? '—' : `${arrow} ${sign}${metric.delta}`}
          </Text>
        </View>
      </View>
      <TrendLineChart series={series} color={color} variant="compact" formatValue={fmt} />
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    block: {
      paddingVertical: theme.spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border.subtle,
    },
    top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    nameWrap: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    name: { ...theme.typography.subhead, color: theme.text.primary, fontWeight: '800' },
    right: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
    vs: { ...theme.typography.caption, color: theme.text.muted },
    vsStrong: { color: theme.text.primary, fontWeight: '800' },
    trend: { ...theme.typography.caption, fontWeight: '800' },
  });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx jest`
Expected: PASS — same test count as before.

- [ ] **Step 3: Commit**

```bash
git add src/components/mystats/FormMetricBlock.js
git commit -m "$(printf 'feat: FormMetricBlock — metric header plus compact trend chart\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

## Task 7: `statExplainers` copy map

**Files:**
- Create: `src/components/mystats/statExplainers.js`

- [ ] **Step 1: Implement the map**

Create `src/components/mystats/statExplainers.js`:

```js
// Plain-language explainer copy for the My Stats (i) buttons. Each entry feeds
// StatDetailSheet's title / subtitle / explainer props. Keyed by a stable
// string used as `infoKey` on SectionCard / MetricRow / FormMetricBlock.
export const statExplainers = {
  recentForm: {
    title: 'Recent Form',
    subtitle: 'Are you trending up or down?',
    explainer: 'Compares your last few rounds against everything before them. '
      + 'The line shows points scored in each selected round, oldest to newest. '
      + 'Improving means your recent points-per-round average beats your earlier one.',
  },
  strengths: {
    title: 'Strengths & Pain Points',
    subtitle: 'Where you gain and lose points',
    explainer: 'Every part of your game is scored as net Stableford points per hole '
      + 'and compared to your overall average. Cells well above average are strengths; '
      + 'well below are pain points. Only buckets with at least 12 holes are ranked, '
      + 'so a couple of lucky holes will not show up here.',
  },
  pointsPerRound: {
    title: 'Points per round',
    subtitle: 'Total Stableford points each round',
    explainer: 'Net Stableford points for every selected round, oldest to newest. Higher is better.',
  },
  strokesVsPar: {
    title: 'Strokes vs par',
    subtitle: 'Gross strokes above or below par',
    explainer: 'Your total strokes minus the par of the holes you played. Lower is better; '
      + 'a negative number means under par.',
  },
  scoreMix: {
    title: 'Score mix',
    subtitle: 'Birdies, pars and bogeys over time',
    explainer: 'For each round, the share of holes that were birdie-or-better, par, or '
      + 'bogey-or-worse. A growing green band means more good holes.',
  },
  recentVsHistory: {
    title: 'Recent vs History',
    subtitle: 'Recent rounds vs everything earlier',
    explainer: 'Splits your selected rounds into the most recent few and all earlier ones, '
      + 'then compares each metric. The mini chart shows that metric for every selected round.',
  },
  fairwaysHit: {
    title: 'Fairways hit',
    subtitle: 'Tee-shot accuracy',
    explainer: 'The share of par-4 and par-5 tee shots that found the fairway. '
      + 'Needs shot tracking logged during the round.',
  },
  greensInReg: {
    title: 'Greens in regulation',
    subtitle: 'Reaching the green with putts to spare',
    explainer: 'A green is "in regulation" when you reach it with at least two strokes left '
      + 'for putting. Needs shot tracking logged during the round.',
  },
  putts: {
    title: 'Putts per round',
    subtitle: 'Putting workload',
    explainer: 'Total putts in the round. Fewer is better. Needs shot tracking logged during the round.',
  },
  threePutts: {
    title: '3-putts per round',
    subtitle: 'Costly putting holes',
    explainer: 'Holes where you took three or more putts. Needs shot tracking logged during the round.',
  },
  scoreDistribution: {
    title: 'Score distribution',
    subtitle: 'How your holes break down',
    explainer: 'Counts every scored hole by result — eagle-or-better through triple-bogey-or-worse — '
      + 'across all selected rounds.',
  },
  parType: {
    title: 'Par type',
    subtitle: 'Net points by hole length',
    explainer: 'Average net Stableford points per hole, split by par 3 / 4 / 5. The "played" '
      + 'figure is how many holes of that type are in the sample.',
  },
  holeDifficulty: {
    title: 'Hole difficulty',
    subtitle: 'Net points by stroke index',
    explainer: 'Average net points per hole, split by the printed stroke index: hard (SI 1-6), '
      + 'mid (SI 7-12), easy (SI 13-18).',
  },
  roundShape: {
    title: 'Round shape',
    subtitle: 'Front vs back, openers vs closers',
    explainer: 'Average net points across the front and back nine, and across your opening and '
      + 'closing three holes — useful for spotting slow starts or fades.',
  },
  recovery: {
    title: 'Recovery',
    subtitle: 'Bouncing back and scrambling',
    explainer: 'Bounce-back rate is how often you follow a bogey-or-worse with a birdie-or-better. '
      + 'Scrambling is how often you still make par after missing the green.',
  },
  teeShotImpact: {
    title: 'Tee shot impact',
    subtitle: 'What your drive costs you',
    explainer: 'Average net points on holes grouped by tee-shot result — fairway found, missed, '
      + 'or after a tee penalty. Needs shot tracking logged during the round.',
  },
  puttingDriving: {
    title: 'Putting & driving',
    subtitle: 'Shot-tracking detail',
    explainer: 'Putting and driving aggregates from holes where you logged shot detail.',
  },
};
```

- [ ] **Step 2: Verify it compiles**

Run: `npx jest`
Expected: PASS — same test count as before.

- [ ] **Step 3: Commit**

```bash
git add src/components/mystats/statExplainers.js
git commit -m "$(printf 'feat: statExplainers copy map for My Stats info sheets\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

## Task 8: `OverviewTab`

This file owns the Overview tab content: the Recent Form hero card and the Strengths & Pain Points card. It receives `stats` (the `computeMyStats` result) and `onInfo`.

**Files:**
- Create: `src/components/mystats/tabs/OverviewTab.js`

- [ ] **Step 1: Implement `OverviewTab`**

Create `src/components/mystats/tabs/OverviewTab.js`:

```js
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeContext';
import SectionCard from '../SectionCard';
import StatTile from '../StatTile';
import TrendLineChart from '../TrendLineChart';

// Verdict text from the points/round form direction.
function verdict(form) {
  if (!form.hasHistory) return 'Not enough history';
  const d = form.metrics[0].direction;
  if (d === 'up') return '▲ Improving';
  if (d === 'down') return '▼ Declining';
  return 'Holding steady';
}

export default function OverviewTab({ stats, onInfo }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);

  const { metrics, form, ranking, formSeries } = stats;
  const pointsDelta = form.hasHistory ? form.metrics[0].delta : null;

  return (
    <View style={s.wrap}>
      {/* ── Recent Form hero ── */}
      <SectionCard title="Recent Form" tone="hero" infoKey="recentForm" onInfo={onInfo}>
        <Text style={s.verdict}>{verdict(form)}</Text>
        {pointsDelta != null ? (
          <Text style={s.verdictSub}>
            {`${pointsDelta > 0 ? '+' : ''}${pointsDelta} pts / round vs your earlier rounds`}
          </Text>
        ) : (
          <Text style={s.verdictSub}>Play more rounds to see a trend.</Text>
        )}
        <TrendLineChart series={formSeries.metrics.avgPoints} color={theme.text.inverse} />
        <View style={s.tiles}>
          <StatTile surface="hero" value={`${metrics.rounds}`} caption="ROUNDS COUNTED" />
          <StatTile surface="hero" value={`${metrics.avgPoints}`} caption="AVG PTS / ROUND" />
          <StatTile surface="hero" value={`${metrics.bestRoundPoints}`} caption="BEST ROUND" />
        </View>
      </SectionCard>

      {/* ── Strengths & Pain Points ── */}
      <SectionCard title="Strengths & Pain Points" infoKey="strengths" onInfo={onInfo}>
        {ranking.baseline == null ? (
          <Text style={s.note}>Not enough data yet.</Text>
        ) : (
          <>
            <Text style={[s.group, { color: theme.accent.primary }]}>WHAT'S WORKING</Text>
            {ranking.strengths.length === 0 && <Text style={s.note}>Nothing stands out yet.</Text>}
            {ranking.strengths.map((c) => (
              <InsightRow key={c.label} cell={c} kind="good" s={s} theme={theme} />
            ))}
            <Text style={[s.group, { color: theme.destructive }]}>WHERE YOU LOSE POINTS</Text>
            {ranking.weaknesses.length === 0 && <Text style={s.note}>Nothing stands out yet.</Text>}
            {ranking.weaknesses.map((c) => (
              <InsightRow key={c.label} cell={c} kind="bad" s={s} theme={theme} />
            ))}
            <Text style={s.note}>{`Measured against your ${ranking.baseline} pts/hole average.`}</Text>
          </>
        )}
      </SectionCard>
    </View>
  );
}

function InsightRow({ cell, kind, s, theme }) {
  const color = kind === 'good' ? theme.accent.primary : theme.destructive;
  return (
    <View style={s.insightRow}>
      <Feather name={kind === 'good' ? 'trending-up' : 'trending-down'} size={16} color={color} />
      <View style={s.insightText}>
        <Text style={s.insightName}>{cell.label}</Text>
        <Text style={s.insightSub}>{`${cell.avgPoints} pts / hole`}</Text>
      </View>
      <Text style={[s.insightDelta, { color }]}>
        {cell.deviation > 0 ? `+${cell.deviation}` : `${cell.deviation}`}
      </Text>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { gap: theme.spacing.lg },
    verdict: { ...theme.typography.title, color: theme.text.inverse, fontWeight: '800' },
    verdictSub: { ...theme.typography.caption, color: 'rgba(255,255,255,0.8)', fontWeight: '700' },
    tiles: { flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.xs },
    group: { ...theme.typography.overline, fontWeight: '800', marginTop: theme.spacing.sm },
    note: { ...theme.typography.caption, color: theme.text.muted, fontStyle: 'italic', marginTop: theme.spacing.xs },
    insightRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingVertical: 7 },
    insightText: { flex: 1 },
    insightName: { ...theme.typography.body, color: theme.text.primary, fontWeight: '600' },
    insightSub: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '700' },
    insightDelta: { ...theme.typography.caption, fontWeight: '800' },
  });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx jest`
Expected: PASS — same test count as before.

- [ ] **Step 3: Commit**

```bash
git add src/components/mystats/tabs/OverviewTab.js
git commit -m "$(printf 'feat: OverviewTab — Recent Form hero and strengths\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

## Task 9: `FormTab`

The Form tab: three trend charts plus a Recent vs History card of `FormMetricBlock`s. It receives `stats`, `n`, `onChangeN`, `onInfo`.

**Files:**
- Create: `src/components/mystats/tabs/FormTab.js`

- [ ] **Step 1: Implement `FormTab`**

Create `src/components/mystats/tabs/FormTab.js`:

```js
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../../theme/ThemeContext';
import SectionCard from '../SectionCard';
import TrendLineChart from '../TrendLineChart';
import ScoreMixArea from '../ScoreMixArea';
import FormMetricBlock from '../FormMetricBlock';

// vs-par values print with an explicit sign.
const fmtVsPar = (v) => (v > 0 ? `+${v}` : `${v}`);
const fmtPct = (v) => `${v}%`;
const fmtNum = (v) => `${v}`;

// Per-metric formatting + explainer key + chart colour token, keyed by FORM_METRICS key.
const META = {
  avgPoints:          { colorToken: 'accent', format: fmtNum,   info: 'pointsPerRound' },
  avgVsPar:           { colorToken: 'gold',   format: fmtVsPar, info: 'strokesVsPar' },
  fairwayPct:         { colorToken: 'accent', format: fmtPct,   info: 'fairwaysHit' },
  girPct:             { colorToken: 'accent', format: fmtPct,   info: 'greensInReg' },
  puttsPerRound:      { colorToken: 'red',    format: fmtNum,   info: 'putts' },
  threePuttsPerRound: { colorToken: 'red',    format: fmtNum,   info: 'threePutts' },
};

export default function FormTab({ stats, n, onChangeN, onInfo }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { form, formSeries } = stats;
  const GOLD = '#caa53d';
  const colorFor = (token) => (token === 'gold' ? GOLD : token === 'red' ? theme.destructive : theme.accent.primary);

  const periodChips = (
    <View style={s.chips}>
      {[3, 5, 10].map((opt) => (
        <TouchableOpacity
          key={opt}
          onPress={() => onChangeN(opt)}
          style={[s.chip, n === opt && s.chipOn]}
          accessibilityRole="button"
          accessibilityState={{ selected: n === opt }}
        >
          <Text style={[s.chipText, n === opt && s.chipTextOn]}>{`Last ${opt}`}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  return (
    <View style={s.wrap}>
      <SectionCard title="Points per round" infoKey="pointsPerRound" onInfo={onInfo}>
        <TrendLineChart
          series={formSeries.metrics.avgPoints}
          color={theme.accent.primary}
          caption="Higher is better · oldest → newest"
        />
      </SectionCard>

      <SectionCard title="Strokes vs par" infoKey="strokesVsPar" onInfo={onInfo}>
        <TrendLineChart
          series={formSeries.metrics.avgVsPar}
          color={GOLD}
          formatValue={fmtVsPar}
          caption="Lower is better · oldest → newest"
        />
      </SectionCard>

      <SectionCard title="Score mix" infoKey="scoreMix" onInfo={onInfo}>
        <Text style={s.caption}>Share of holes per round · birdie+ → bogey+</Text>
        <ScoreMixArea rounds={formSeries.scoreMix} />
      </SectionCard>

      <SectionCard title="Recent vs History" infoKey="recentVsHistory" onInfo={onInfo} right={periodChips}>
        {!form.hasHistory && (
          <Text style={s.note}>{`Not enough history yet — select more than ${n} rounds to compare.`}</Text>
        )}
        {form.metrics.map((m) => {
          const meta = META[m.key];
          // Shot metrics with no logged data have an all-null series — skip them.
          if (m.shot && !formSeries.hasShotData) return null;
          return (
            <FormMetricBlock
              key={m.key}
              metric={m}
              series={formSeries.metrics[m.key]}
              color={colorFor(meta.colorToken)}
              formatValue={meta.format}
              infoKey={meta.info}
              onInfo={onInfo}
            />
          );
        })}
        {!formSeries.hasShotData && (
          <Text style={s.note}>Log putts and drives during a round to unlock fairway, green and putting trends.</Text>
        )}
      </SectionCard>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { gap: theme.spacing.lg },
    caption: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '700' },
    note: { ...theme.typography.caption, color: theme.text.muted, fontStyle: 'italic' },
    chips: { flexDirection: 'row', gap: 4 },
    chip: {
      paddingHorizontal: theme.spacing.sm, paddingVertical: 4,
      borderRadius: theme.radius.pill, backgroundColor: theme.bg.secondary,
    },
    chipOn: { backgroundColor: theme.accent.primary },
    chipText: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '700' },
    chipTextOn: { color: theme.text.inverse },
  });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx jest`
Expected: PASS — same test count as before.

- [ ] **Step 3: Commit**

```bash
git add src/components/mystats/tabs/FormTab.js
git commit -m "$(printf 'feat: FormTab — three trend charts and labelled metric rows\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

## Task 10: `BreakdownTab` and `ShotsTab`

**Files:**
- Create: `src/components/mystats/tabs/BreakdownTab.js`
- Create: `src/components/mystats/tabs/ShotsTab.js`

- [ ] **Step 1: Implement `BreakdownTab`**

Create `src/components/mystats/tabs/BreakdownTab.js`:

```js
import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../../../theme/ThemeContext';
import SectionCard from '../SectionCard';
import MetricRow from '../MetricRow';
import DistributionBars from '../DistributionBars';

const holes = (n) => `${n} holes`;

export default function BreakdownTab({ stats, onInfo }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { parType, difficulty, frontBack, warmupClosing, distribution, bounceBack, scrambling } = stats;
  const fbHoles = frontBack ? frontBack.rounds.length * 9 : 0;

  return (
    <View style={s.wrap}>
      <SectionCard title="Score distribution" infoKey="scoreDistribution" onInfo={onInfo}>
        <DistributionBars
          bars={[
            { label: 'Eagle+', count: distribution.eagles },
            { label: 'Birdie', count: distribution.birdies },
            { label: 'Par', count: distribution.pars },
            { label: 'Bogey', count: distribution.bogeys },
            { label: 'Double', count: distribution.doubles, muted: true },
            { label: 'Triple+', count: distribution.worse, muted: true },
          ]}
        />
      </SectionCard>

      <SectionCard title="Par type" infoKey="parType" onInfo={onInfo}>
        <MetricRow label="Par 3s" value={parType.par3.avgPoints} secondary={holes(parType.par3.holes)} dim={parType.par3.holes === 0} />
        <MetricRow label="Par 4s" value={parType.par4.avgPoints} secondary={holes(parType.par4.holes)} dim={parType.par4.holes === 0} />
        <MetricRow label="Par 5s" value={parType.par5.avgPoints} secondary={holes(parType.par5.holes)} dim={parType.par5.holes === 0} />
      </SectionCard>

      <SectionCard title="Hole difficulty" infoKey="holeDifficulty" onInfo={onInfo}>
        <MetricRow label="Hard (SI 1-6)" value={difficulty.hard.avgPoints} secondary={holes(difficulty.hard.holes)} dim={difficulty.hard.holes === 0} />
        <MetricRow label="Mid (SI 7-12)" value={difficulty.mid.avgPoints} secondary={holes(difficulty.mid.holes)} dim={difficulty.mid.holes === 0} />
        <MetricRow label="Easy (SI 13-18)" value={difficulty.easy.avgPoints} secondary={holes(difficulty.easy.holes)} dim={difficulty.easy.holes === 0} />
      </SectionCard>

      <SectionCard title="Round shape" infoKey="roundShape" onInfo={onInfo}>
        <MetricRow label="Front nine" value={frontBack ? frontBack.frontAvg : 0} secondary={holes(fbHoles)} dim={fbHoles === 0} />
        <MetricRow label="Back nine" value={frontBack ? frontBack.backAvg : 0} secondary={holes(fbHoles)} dim={fbHoles === 0} />
        <MetricRow label="Opening 3" value={warmupClosing.warmup.avgPoints} secondary={holes(warmupClosing.warmup.holes)} dim={warmupClosing.warmup.holes === 0} />
        <MetricRow label="Closing 3" value={warmupClosing.closing.avgPoints} secondary={holes(warmupClosing.closing.holes)} dim={warmupClosing.closing.holes === 0} />
      </SectionCard>

      {(bounceBack || scrambling) ? (
        <SectionCard title="Recovery" infoKey="recovery" onInfo={onInfo}>
          <MetricRow
            label="Bounce-back rate"
            value={bounceBack ? `${bounceBack.rate}%` : '—'}
            secondary={bounceBack ? `${bounceBack.opportunities} chances` : ''}
            dim={!bounceBack}
          />
          <MetricRow
            label="Scrambling"
            value={scrambling ? `${scrambling.pct}%` : '—'}
            secondary={scrambling ? `${scrambling.missedGir} misses` : ''}
            dim={!scrambling}
          />
        </SectionCard>
      ) : null}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { gap: theme.spacing.lg },
  });
}
```

- [ ] **Step 2: Implement `ShotsTab`**

Create `src/components/mystats/tabs/ShotsTab.js`:

```js
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../../theme/ThemeContext';
import SectionCard from '../SectionCard';
import MetricRow from '../MetricRow';

export default function ShotsTab({ stats, onInfo }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { teeShot, shots } = stats;

  if (!teeShot.hasData && !shots.hasData) {
    return (
      <View style={s.wrap}>
        <SectionCard title="Shots">
          <Text style={s.note}>
            Log putts and drives during a round to unlock tee-shot, putting and driving stats.
          </Text>
        </SectionCard>
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      {teeShot.hasData ? (
        <SectionCard title="Tee shot impact" infoKey="teeShotImpact" onInfo={onInfo}>
          <MetricRow label="Fairway found" value={teeShot.fairway.avgPoints} secondary={`${teeShot.fairway.holes} holes`} dim={teeShot.fairway.holes === 0} />
          <MetricRow label="Fairway missed" value={teeShot.missed.avgPoints} secondary={`${teeShot.missed.holes} holes`} dim={teeShot.missed.holes === 0} />
          <MetricRow label="Miss left" value={teeShot.byDirection.left.avgPoints} secondary={`${teeShot.byDirection.left.holes} holes`} dim={teeShot.byDirection.left.holes === 0} />
          <MetricRow label="Miss right" value={teeShot.byDirection.right.avgPoints} secondary={`${teeShot.byDirection.right.holes} holes`} dim={teeShot.byDirection.right.holes === 0} />
          <MetricRow label="Miss short" value={teeShot.byDirection.short.avgPoints} secondary={`${teeShot.byDirection.short.holes} holes`} dim={teeShot.byDirection.short.holes === 0} />
          <MetricRow label="After tee penalty" value={teeShot.teePenalty.avgPoints} secondary={`${teeShot.teePenalty.holes} holes`} dim={teeShot.teePenalty.holes === 0} />
          <MetricRow label="Penalty drag (pts lost)" value={teeShot.penaltyDrag} secondary={`${teeShot.teePenalty.holes} holes`} dim={teeShot.teePenalty.holes === 0} />
        </SectionCard>
      ) : null}

      {shots.hasData ? (
        <SectionCard title="Putting & driving" infoKey="puttingDriving" onInfo={onInfo}>
          <MetricRow label="Putts / round" value={shots.putts.perRound} secondary={`${shots.putts.holes} holes`} dim={shots.putts.holes === 0} />
          <MetricRow label="1-putts" value={shots.putts.onePutts} secondary={`${shots.putts.holes} holes`} dim={shots.putts.holes === 0} />
          <MetricRow label="3-putts+" value={shots.putts.threePuttPlus} secondary={`${shots.putts.holes} holes`} dim={shots.putts.holes === 0} />
          <MetricRow label="Fairways hit %" value={`${shots.drives.fairwayPct}%`} secondary={`${shots.drives.recorded} drives`} dim={shots.drives.recorded === 0} />
          <MetricRow label="Greens in reg %" value={`${shots.gir.pct}%`} secondary={`${shots.gir.eligible} holes`} dim={shots.gir.eligible === 0} />
          <MetricRow label="Penalties / round" value={shots.penalties.total} secondary={`${shots.roundsWithData} rounds`} dim={shots.roundsWithData === 0} />
        </SectionCard>
      ) : null}
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { gap: theme.spacing.lg },
    note: { ...theme.typography.caption, color: theme.text.muted, fontStyle: 'italic' },
  });
}
```

- [ ] **Step 3: Verify both compile**

Run: `npx jest`
Expected: PASS — same test count as before.

- [ ] **Step 4: Commit**

```bash
git add src/components/mystats/tabs/BreakdownTab.js src/components/mystats/tabs/ShotsTab.js
git commit -m "$(printf 'feat: BreakdownTab and ShotsTab built from My Stats primitives\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

## Task 11: Rewire `MyStatsScreen`

Slim `MyStatsScreen.js` to orchestration: keep loading / selection / tab state, render the new tab components, and add one screen-level `StatDetailSheet`. Delete the inline `Snapshot`, `Stat`, `FormSection`, `StrengthsRow`, `StrengthsSection`, `BreakdownSection`, `DistributionSection`, `Sparkline` components, the `fmtVsPar` helper, and the now-unused styles.

**Files:**
- Modify: `src/screens/MyStatsScreen.js`

- [ ] **Step 1: Replace the imports block**

In `src/screens/MyStatsScreen.js`, replace the top import block (every `import` line from React through `CardGrid`) with exactly:

```js
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { loadAllTournamentsWithFallback } from '../store/tournamentStore';
import { loadProfile } from '../store/profileStore';
import { collectMyRounds, resolveSelection, computeMyStats } from '../store/personalStats';
import { buildRoundReportCard } from '../store/roundReportCard';
import RoundReportCard from '../components/RoundReportCard';
import MyStatsRoundSelector from '../components/MyStatsRoundSelector';
import StatDetailSheet from '../components/StatDetailSheet';
import OverviewTab from '../components/mystats/tabs/OverviewTab';
import FormTab from '../components/mystats/tabs/FormTab';
import BreakdownTab from '../components/mystats/tabs/BreakdownTab';
import ShotsTab from '../components/mystats/tabs/ShotsTab';
import { statExplainers } from '../components/mystats/statExplainers';
```

(`CardGrid` is no longer imported here — it stays in the repo for other screens. `loadProfile` is already imported in the current file from the earlier single-games fix; keep a single import line.)

- [ ] **Step 2: Add the `infoKey` state and callback**

Inside the `MyStatsScreen` function, add this state immediately after the `reportRoundKey` `useState` line:

```js
  const [infoKey, setInfoKey] = useState(null);
```

Add this callback immediately after the `persistOverrides` `useCallback`:

```js
  const onInfo = useCallback((key) => setInfoKey(key), []);
```

- [ ] **Step 3: Replace the tab render body**

Replace the entire `<ScrollView contentContainerStyle={s.scroll}> … </ScrollView>` block (the one containing the `tab === 'reportCard'` through `tab === 'shots'` branches) with:

```jsx
      <ScrollView contentContainerStyle={s.scroll}>
        {tab === 'reportCard' && (
          <RoundReportCard
            card={reportCard}
            rounds={myRounds}
            selectedKey={reportRoundKey}
            onSelect={setReportRoundKey}
          />
        )}
        {tab === 'overview' && <OverviewTab stats={stats} onInfo={onInfo} />}
        {tab === 'form' && <FormTab stats={stats} n={n} onChangeN={setN} onInfo={onInfo} />}
        {tab === 'breakdown' && <BreakdownTab stats={stats} onInfo={onInfo} />}
        {tab === 'shots' && <ShotsTab stats={stats} onInfo={onInfo} />}
      </ScrollView>
```

- [ ] **Step 4: Render the shared `StatDetailSheet`**

Immediately before the final `{Selector}` line inside the main `return`, add:

```jsx
      <StatDetailSheet
        visible={!!infoKey}
        onClose={() => setInfoKey(null)}
        title={infoKey ? statExplainers[infoKey]?.title : ''}
        subtitle={infoKey ? statExplainers[infoKey]?.subtitle : ''}
        explainer={infoKey ? statExplainers[infoKey]?.explainer : ''}
        rows={[]}
        shareable={false}
      />
```

- [ ] **Step 5: Delete the dead inline components**

Delete these function declarations in full: `Snapshot`, `Stat`, `FormSection`, `StrengthsRow`, `StrengthsSection`, `BreakdownSection`, `DistributionSection`, `Sparkline`. Also delete the `fmtVsPar` helper near the top of the file (no longer referenced). The file should now contain only the `MyStatsScreen` component and `makeStyles`.

- [ ] **Step 6: Trim `makeStyles`**

In `makeStyles`, delete the now-unused style keys: `card`, `cardHead`, `cardTitle`, `metricToggle`, `metricChip`, `metricChipOn`, `metricChipText`, `metricChipTextOn`, `statRow`, `stat`, `statValue`, `statLabel`, `note`, `formRow`, `formLabel`, `formRecent`, `formHistory`, `formDelta`, `formHeadCell`, `subhead`, `insightRow`, `insightText`, `insightDelta`, `dim`, `sparkWrap`, `sparkCaption`, `sparkRow`, `sparkBar`, `sparkScale`, `sparkScaleText`. Keep exactly these keys (all still referenced by the header / tab bar / loading / empty / error states): `container`, `header`, `backBtn`, `headerTitle`, `roundsBtn`, `roundsBtnText`, `tabBar`, `tab`, `tabActive`, `tabText`, `tabTextActive`, `center`, `emptyText`, `retryBtn`, `retryText`, `scroll`.

- [ ] **Step 7: Run the full suite**

Run: `npx jest`
Expected: PASS — every suite green, test count unchanged from Task 10.

- [ ] **Step 8: Verify the screen renders (manual smoke check)**

Run the project's dev command (e.g. `npx expo start`), open the app, go to **My Stats**. Confirm: all 5 tabs render with no redbox; the Overview hero shows the points line chart; the Form tab shows three charts plus labelled metric rows; tapping any (i) opens the explainer sheet and closing it works; the Breakdown bars render; tabs with no shot data show their notes.

- [ ] **Step 9: Commit**

```bash
git add src/screens/MyStatsScreen.js
git commit -m "$(printf 'refactor: MyStatsScreen orchestration only — compose mystats tabs\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

---

## Task 12: Final regression and cleanup

**Files:** none modified — verification only.

- [ ] **Step 1: Full test suite**

Run: `npx jest`
Expected: PASS — all suites. The pre-existing `personalStats.test.js` and `statsEngine.test.js` confirm no computed statistic changed.

- [ ] **Step 2: Lint if the project has one**

Run: `npx eslint src/components/mystats src/screens/MyStatsScreen.js src/store/personalStats.js` (skip if the repo has no eslint config).
Expected: no errors.

- [ ] **Step 3: Confirm no dead references**

Run: `grep -rn "Sparkline\|BreakdownSection\|DistributionSection\|StrengthsSection" src/screens/MyStatsScreen.js`
Expected: no matches — all inline components removed.

- [ ] **Step 4: Commit any cleanup**

If steps 2–3 surfaced fixes, commit them:

```bash
git add -A
git commit -m "$(printf 'chore: My Stats redesign cleanup\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>')"
```

If nothing changed, skip this step.

---

## Self-review notes

- **Spec coverage:** Recent Form hero → Task 8. Labelled line charts → Tasks 3, 8, 9. Score-mix area → Tasks 4, 9. Per-metric labelled charts in Recent vs History → Tasks 6, 9 (`FormMetricBlock` uses `TrendLineChart variant="compact"` with `formatValue`). Distribution bars → Tasks 4, 10. Info-icon explainers → Tasks 5, 7, 11. `computeFormSeries` data layer → Task 1. Component library + tab files → Tasks 2–10. The Report Card tab keeps its existing `RoundReportCard` component and is rendered unchanged in Task 11; the spec's Report Card "consistency pass" is intentionally minimal (it already uses the shared card styling), so no separate task is needed.
- **Deviations from spec:** (1) the spec listed `MiniTrendChart` as a separate component; this plan consolidates it into `TrendLineChart` via `variant="compact"` (DRY — identical geometry). (2) The spec kept tab bodies inside `MyStatsScreen`; this plan extracts them into `mystats/tabs/*` files, which better satisfies the spec's "orchestration only" intent and the focused-file guidance.
- **Placeholder scan:** no TBD/TODO; every code step shows complete code.
- **Type consistency:** `computeFormSeries` returns `{ metrics: { <FORM_METRICS key>: [{label,value}] }, scoreMix: [{label,birdie,par,bogey}], hasShotData }` — consumed unchanged by `OverviewTab` (`formSeries.metrics.avgPoints`), `FormTab` (`formSeries.metrics[m.key]`, `formSeries.scoreMix`, `formSeries.hasShotData`) and `FormMetricBlock`. `scalePoints`/`toSegments` signatures match between Task 2 and Task 3. `SectionCard` props (`title`, `infoKey`, `onInfo`, `right`, `tone`) are used consistently in Tasks 8–11. `StatTile` props (`value`, `caption`, `surface`) match between Task 5 and Task 8. `MetricRow` props (`label`, `value`, `secondary`, `dim`, `infoKey`, `onInfo`) match between Task 5 and Task 10.
```
