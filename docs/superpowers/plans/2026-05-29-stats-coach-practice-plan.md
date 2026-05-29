# Stats Coach and Practice Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor My Stats so the first tab is a Coach view that gives richer improvement guidance, preserves Strokes Gained vs target and Top 3 / Bottom 3 evidence, and ends with a short Practice Plan.

**Architecture:** Keep recommendation logic in the store layer through a new pure `coachInsights` selector. `MyStatsScreen` remains orchestration only; the Coach tab renders already-computed stats through focused components under `src/components/mystats/`.

**Tech Stack:** Expo SDK 54, React Native 0.81, React 19, Jest via `jest-expo`, `@testing-library/react-native`, existing theme tokens and `react-native-svg`.

---

## File Structure

- Create `src/store/coachInsights.js`: deterministic insight ranking and practice-plan generation from the existing `computeMyStats` result shape.
- Create `src/store/__tests__/coachInsights.test.js`: unit tests for hero selection, board groups, de-duplication, low-sample handling, and practice-plan fallback.
- Modify `src/store/personalStats.js`: import `buildCoachInsights`, attach `coach` to the `computeMyStats` return value.
- Modify `src/store/__tests__/personalStats.test.js`: assert `computeMyStats` exposes a stable `coach` block.
- Create `src/components/mystats/CoachHero.js`: filled green first card for the strongest insight.
- Create `src/components/mystats/CoachInsightRow.js`: one compact insight row with category, reason, metric, sample/confidence, and tone.
- Create `src/components/mystats/CoachBoard.js`: grouped Coach rows for `Fix first`, `Keep doing`, `Getting better`, `Getting worse`, `Next gain`, and `Watch`.
- Create `src/components/mystats/PracticePlanCard.js`: bottom-of-Coach three-item practice summary.
- Create `src/components/mystats/tabs/CoachTab.js`: new first tab that composes Coach Hero, Coach Board, Current Form, Strokes Gained vs target, Top 3 / Bottom 3, and Practice Plan.
- Modify `src/components/mystats/tabs/OverviewTab.js`: compatibility re-export for `CoachTab` during transition.
- Modify `src/components/mystats/tabs/__tests__/StatsTabs.test.js`: replace Overview assertions with Coach assertions and preserve Shots tests.
- Modify `src/screens/MyStatsScreen.js`: tab order, default tab, `overview` route-param mapping to `coach`, and Coach tab import.
- Modify `src/screens/__tests__/MyStatsScreen.test.js`: tab-strip expectations and route compatibility tests.

---

### Task 1: Add Pure Coach Insight Selector

**Files:**
- Create: `src/store/coachInsights.js`
- Create: `src/store/__tests__/coachInsights.test.js`

- [ ] **Step 1: Write the failing selector tests**

Create `src/store/__tests__/coachInsights.test.js`:

```js
import { buildCoachInsights } from '../coachInsights';

function baseStats(overrides = {}) {
  return {
    metrics: { rounds: 8, avgPoints: 31, bestRoundPoints: 38 },
    form: {
      hasHistory: true,
      metrics: [
        { key: 'avgPoints', label: 'Points / round', polarity: 'higher', recent: 32, history: 29, delta: 3, direction: 'up' },
        { key: 'girPct', label: 'Greens in reg %', polarity: 'higher', recent: 34, history: 45, delta: -11, direction: 'down', shot: true },
        { key: 'puttsPerRound', label: 'Putts / round', polarity: 'lower', recent: 34, history: 36, delta: -2, direction: 'up', shot: true },
      ],
    },
    ranking: {
      baseline: 1.72,
      strengths: [
        { label: 'Tee shot on the fairway', avgPoints: 2.45, deviation: 0.73, sample: 22, unit: 'holes' },
      ],
      weaknesses: [
        { label: 'Closing 3 holes', avgPoints: 1.1, deviation: -0.62, sample: 24, unit: 'holes' },
      ],
    },
    actionPlan: {
      keep: { area: 'Driving', label: 'Fairway drives', score: 0.64, sample: 22, unit: 'pts / hole', value: 2.45 },
      improve: { area: 'Putting', label: '6+ m putts', score: -0.81, sample: 18, unit: 'SG / putt', value: -0.81 },
      practice: { area: 'Approach', label: '100-150 m approaches', score: -0.36, sample: 14, unit: 'SG / shot', value: -0.36 },
      strengths: [
        { area: 'Driving', label: 'Fairway drives', score: 0.64, sample: 22, unit: 'pts / hole', value: 2.45 },
      ],
      improvements: [
        { area: 'Putting', label: '6+ m putts', score: -0.81, sample: 18, unit: 'SG / putt', value: -0.81 },
        { area: 'Approach', label: '100-150 m approaches', score: -0.36, sample: 14, unit: 'SG / shot', value: -0.36 },
      ],
    },
    strokesGained: {
      total: -1.25,
      sampleHoles: 54,
      byCategory: { tee: 0.4, approach: -0.35, aroundGreen: -0.1, putting: -1.2 },
    },
    warmupClosing: {
      warmup: { avgPoints: 2.1, holes: 24 },
      closing: { avgPoints: 1.1, holes: 24 },
    },
    frontBack: { frontAvg: 16.4, backAvg: 14.2, rounds: [{}, {}, {}] },
    ...overrides,
  };
}

describe('buildCoachInsights', () => {
  test('chooses a high-confidence point leak as the hero when one exists', () => {
    const coach = buildCoachInsights(baseStats());

    expect(coach.hero).toMatchObject({
      group: 'fixFirst',
      area: 'putting',
      title: '6+ m putts',
      tone: 'bad',
      confidence: 'high',
    });
    expect(coach.hero.reason).toContain('costing');
  });

  test('can choose an improving trend when there is no strong leak', () => {
    const coach = buildCoachInsights(baseStats({
      actionPlan: { keep: null, improve: null, practice: null, strengths: [], improvements: [] },
      strokesGained: { total: 0.2, sampleHoles: 54, byCategory: { tee: 0.1, approach: 0.1, aroundGreen: 0, putting: 0 } },
    }));

    expect(coach.hero).toMatchObject({
      group: 'gettingBetter',
      title: 'Points / round',
      tone: 'good',
    });
  });

  test('builds all supported board groups from available stats', () => {
    const coach = buildCoachInsights(baseStats());

    expect(coach.board.fixFirst).toHaveLength(1);
    expect(coach.board.keepDoing).toHaveLength(1);
    expect(coach.board.gettingBetter.map((i) => i.title)).toContain('Points / round');
    expect(coach.board.gettingWorse.map((i) => i.title)).toContain('Greens in reg %');
    expect(coach.board.nextGains.map((i) => i.title)).toContain('100-150 m approaches');
    expect(coach.board.watch.map((i) => i.title)).toContain('Closing 3 holes');
  });

  test('deduplicates near-identical insights by area and title', () => {
    const coach = buildCoachInsights(baseStats({
      actionPlan: {
        ...baseStats().actionPlan,
        improvements: [
          { area: 'Putting', label: '6+ m putts', score: -0.81, sample: 18, unit: 'SG / putt', value: -0.81 },
          { area: 'Putting', label: '6+ m putts', score: -0.7, sample: 20, unit: 'SG / putt', value: -0.7 },
        ],
      },
    }));

    const all = Object.values(coach.board).flat();
    expect(all.filter((i) => i.id === 'putting:6-m-putts')).toHaveLength(1);
  });

  test('sends low-sample leaks to Watch instead of Fix first', () => {
    const coach = buildCoachInsights(baseStats({
      actionPlan: {
        keep: null,
        improve: { area: 'Putting', label: '6+ m putts', score: -0.91, sample: 2, unit: 'SG / putt', value: -0.91 },
        practice: null,
        strengths: [],
        improvements: [
          { area: 'Putting', label: '6+ m putts', score: -0.91, sample: 2, unit: 'SG / putt', value: -0.91 },
        ],
      },
    }));

    expect(coach.board.fixFirst).toHaveLength(0);
    expect(coach.board.watch).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: '6+ m putts', confidence: 'low' }),
    ]));
  });

  test('creates a three-item practice plan with distinct roles', () => {
    const coach = buildCoachInsights(baseStats());

    expect(coach.practicePlan.map((item) => item.role)).toEqual([
      'practiceFirst',
      'secondaryFocus',
      'onCourseCue',
    ]);
    expect(coach.practicePlan[0].title).toContain('6+ m putts');
    expect(coach.practicePlan[1].title).toContain('100-150 m approaches');
    expect(coach.practicePlan[2].title).toContain('Closing 3 holes');
  });

  test('falls back to form and data-collection guidance without shot data', () => {
    const coach = buildCoachInsights(baseStats({
      actionPlan: { keep: null, improve: null, practice: null, strengths: [], improvements: [] },
      ranking: { baseline: null, strengths: [], weaknesses: [] },
      strokesGained: null,
      warmupClosing: null,
      frontBack: null,
    }));

    expect(coach.hero).toMatchObject({ group: 'gettingBetter' });
    expect(coach.practicePlan).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'onCourseCue' }),
    ]));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npm test -- src/store/__tests__/coachInsights.test.js --runInBand
```

Expected: FAIL with a module resolution error for `../coachInsights`.

- [ ] **Step 3: Implement `coachInsights.js`**

Create `src/store/coachInsights.js`:

```js
const HIGH_SAMPLE_MIN = 8;
const MEDIUM_SAMPLE_MIN = 4;

const AREA_KEY = {
  Driving: 'driving',
  Approach: 'approach',
  Putting: 'putting',
  'Strokes Gained': 'scoring',
};

const AREA_LABEL = {
  driving: 'Driving',
  approach: 'Approach',
  putting: 'Putting',
  shortGame: 'Short game',
  scoring: 'Scoring',
  form: 'Form',
  roundShape: 'Round shape',
};

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\+/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function areaKey(area) {
  return AREA_KEY[area] || slug(area) || 'scoring';
}

function round1(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

function round2(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function signed(value, digits = 1) {
  if (!Number.isFinite(value)) return '';
  const rounded = digits === 2 ? round2(value) : round1(value);
  return `${rounded > 0 ? '+' : ''}${rounded}`;
}

function confidenceForSample(sample) {
  if ((sample ?? 0) >= HIGH_SAMPLE_MIN) return 'high';
  if ((sample ?? 0) >= MEDIUM_SAMPLE_MIN) return 'medium';
  return 'low';
}

function makeInsight({
  group, area, title, reason, metric, impact = null, sample = null,
  confidence = null, tone = 'neutral',
}) {
  const normalizedArea = areaKey(area);
  return {
    id: `${normalizedArea}:${slug(title)}`,
    group,
    area: normalizedArea,
    areaLabel: AREA_LABEL[normalizedArea] || area || 'Scoring',
    title,
    reason,
    metric,
    impact,
    sample,
    confidence: confidence || confidenceForSample(sample),
    tone,
  };
}

function pushUnique(target, insight) {
  if (!insight) return;
  if (target.some((item) => item.id === insight.id)) return;
  target.push(insight);
}

function byImpactAsc(a, b) {
  return (a.impact ?? 0) - (b.impact ?? 0);
}

function byImpactDesc(a, b) {
  return (b.impact ?? 0) - (a.impact ?? 0);
}

function insightFromActionCell(cell, group, tone) {
  if (!cell) return null;
  const impact = round2(cell.score);
  const metric = `${signed(impact, 2)} ${cell.unit}`;
  const reason = impact < 0
    ? `${cell.label} is costing points across ${cell.sample} samples.`
    : `${cell.label} is creating scoring value across ${cell.sample} samples.`;
  return makeInsight({
    group,
    area: cell.area,
    title: cell.label,
    reason,
    metric,
    impact,
    sample: cell.sample,
    tone,
  });
}

function insightFromFormMetric(metric) {
  if (!metric || metric.delta == null || metric.direction === 'flat') return null;
  const improving = metric.direction === 'up';
  const absDelta = Math.abs(metric.delta);
  return makeInsight({
    group: improving ? 'gettingBetter' : 'gettingWorse',
    area: 'form',
    title: metric.label,
    reason: improving
      ? `${metric.label} is moving the right way versus earlier selected rounds.`
      : `${metric.label} is moving the wrong way versus earlier selected rounds.`,
    metric: `${improving ? 'Improved' : 'Worse'} by ${absDelta}`,
    impact: improving ? absDelta : -absDelta,
    sample: null,
    confidence: 'medium',
    tone: improving ? 'good' : 'bad',
  });
}

function closingWatch(stats) {
  const warmup = stats?.warmupClosing?.warmup;
  const closing = stats?.warmupClosing?.closing;
  if (!warmup || !closing || warmup.holes < MEDIUM_SAMPLE_MIN || closing.holes < MEDIUM_SAMPLE_MIN) return null;
  const delta = round2(closing.avgPoints - warmup.avgPoints);
  if (delta >= -0.25) return null;
  return makeInsight({
    group: 'watch',
    area: 'roundShape',
    title: 'Closing 3 holes',
    reason: `Closing holes are scoring below your opening holes across ${closing.holes} holes.`,
    metric: `${signed(delta, 2)} pts / hole`,
    impact: delta,
    sample: closing.holes,
    confidence: confidenceForSample(closing.holes),
    tone: 'watch',
  });
}

function backNineWatch(stats) {
  const frontBack = stats?.frontBack;
  if (!frontBack || !Array.isArray(frontBack.rounds) || frontBack.rounds.length < 2) return null;
  const delta = round2(frontBack.backAvg - frontBack.frontAvg);
  if (delta >= -1) return null;
  return makeInsight({
    group: 'watch',
    area: 'roundShape',
    title: 'Back nine',
    reason: `Your back nine is trailing the front nine over ${frontBack.rounds.length} rounds.`,
    metric: `${signed(delta, 1)} pts / 9`,
    impact: delta,
    sample: frontBack.rounds.length,
    confidence: confidenceForSample(frontBack.rounds.length),
    tone: 'watch',
  });
}

function chooseHero(board) {
  const candidates = [
    ...board.fixFirst,
    ...board.gettingBetter,
    ...board.gettingWorse,
    ...board.nextGains,
    ...board.keepDoing,
    ...board.watch,
  ];
  return candidates[0] ?? null;
}

function instructionFor(insight, role) {
  if (!insight) {
    return role === 'onCourseCue'
      ? 'Log putts, drives, and approach buckets next round so Coach can make sharper recommendations.'
      : 'Use the next round to collect cleaner shot data.';
  }
  if (insight.area === 'putting') return 'Spend 15 minutes on distance control before the next round.';
  if (insight.area === 'approach') return 'Hit 10 focused approach shots from the problem distance and track the leave.';
  if (insight.area === 'driving') return 'Choose the tee shot that keeps penalties out of play.';
  if (insight.area === 'roundShape') return 'Pick conservative targets late in the round and protect against doubles.';
  return 'Carry this cue into the next round and check whether the trend changes.';
}

function practiceItem(role, insight, fallbackTitle) {
  return {
    id: `${role}:${insight?.id ?? slug(fallbackTitle)}`,
    role,
    title: insight?.title ?? fallbackTitle,
    instruction: instructionFor(insight, role),
    reason: insight?.reason ?? 'Coach needs more logged rounds and shot detail to sharpen this recommendation.',
    sourceInsightId: insight?.id,
  };
}

function buildPracticePlan(board) {
  const practiceFirst = board.fixFirst[0] || board.gettingWorse[0] || null;
  const secondary = board.nextGains.find((item) => item.area !== practiceFirst?.area)
    || board.fixFirst.find((item) => item.area !== practiceFirst?.area)
    || board.gettingWorse.find((item) => item.area !== practiceFirst?.area)
    || null;
  const cue = board.watch[0] || board.keepDoing[0] || board.gettingBetter[0] || null;
  return [
    practiceItem('practiceFirst', practiceFirst, 'Collect cleaner shot data'),
    practiceItem('secondaryFocus', secondary, 'Find a second scoring pattern'),
    practiceItem('onCourseCue', cue, 'Play the next round with one clear cue'),
  ];
}

export function buildCoachInsights(stats = {}) {
  const board = {
    fixFirst: [],
    keepDoing: [],
    gettingBetter: [],
    gettingWorse: [],
    nextGains: [],
    watch: [],
  };

  const actionPlan = stats.actionPlan || {};
  const improve = insightFromActionCell(actionPlan.improve, 'fixFirst', 'bad');
  if (improve?.confidence === 'low') pushUnique(board.watch, { ...improve, group: 'watch', tone: 'watch' });
  else pushUnique(board.fixFirst, improve);

  pushUnique(board.keepDoing, insightFromActionCell(actionPlan.keep, 'keepDoing', 'good'));

  (actionPlan.improvements || []).sort((a, b) => a.score - b.score).forEach((cell) => {
    const insight = insightFromActionCell(cell, 'nextGain', 'bad');
    if (!insight) return;
    if (insight.confidence === 'low') pushUnique(board.watch, { ...insight, group: 'watch', tone: 'watch' });
    else if (!board.fixFirst.some((item) => item.id === insight.id)) pushUnique(board.nextGains, insight);
  });

  (actionPlan.strengths || []).sort((a, b) => b.score - a.score).forEach((cell) => {
    pushUnique(board.keepDoing, insightFromActionCell(cell, 'keepDoing', 'good'));
  });

  (stats.form?.metrics || []).forEach((metric) => {
    const insight = insightFromFormMetric(metric);
    if (!insight) return;
    if (insight.group === 'gettingBetter') pushUnique(board.gettingBetter, insight);
    if (insight.group === 'gettingWorse') pushUnique(board.gettingWorse, insight);
  });

  pushUnique(board.watch, closingWatch(stats));
  pushUnique(board.watch, backNineWatch(stats));

  board.fixFirst.sort(byImpactAsc);
  board.keepDoing.sort(byImpactDesc);
  board.gettingBetter.sort(byImpactDesc);
  board.gettingWorse.sort(byImpactAsc);
  board.nextGains.sort(byImpactAsc);
  board.watch.sort(byImpactAsc);

  const limited = {
    fixFirst: board.fixFirst.slice(0, 2),
    keepDoing: board.keepDoing.slice(0, 2),
    gettingBetter: board.gettingBetter.slice(0, 2),
    gettingWorse: board.gettingWorse.slice(0, 2),
    nextGains: board.nextGains.slice(0, 3),
    watch: board.watch.slice(0, 3),
  };

  return {
    hero: chooseHero(limited),
    board: limited,
    practicePlan: buildPracticePlan(limited),
  };
}
```

- [ ] **Step 4: Run the selector tests to verify they pass**

Run:

```bash
npm test -- src/store/__tests__/coachInsights.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/coachInsights.js src/store/__tests__/coachInsights.test.js
git commit -m "feat: add stats coach insights selector"
```

---

### Task 2: Wire Coach Insights Into Personal Stats

**Files:**
- Modify: `src/store/personalStats.js`
- Modify: `src/store/__tests__/personalStats.test.js`

- [ ] **Step 1: Write the failing integration test**

In `src/store/__tests__/personalStats.test.js`, add `coach` to the import list if the previous task did not require it. Then add this test at the end of the existing `describe('computeMyStats', ...)` block:

```js
  test('includes a coach block with hero, board groups, and practice plan', () => {
    const holes = holes18();
    const scores = {};
    const shotDetails = { p1: {} };
    holes.forEach((hole) => {
      if (hole.number <= 12) {
        scores[hole.number] = 4;
        shotDetails.p1[hole.number] = {
          drive: 'fairway',
          approachBucket: '100-150',
          putts: 2,
          firstPuttBucket: '3-6',
          sandShots: 0,
        };
      } else {
        scores[hole.number] = 6;
        shotDetails.p1[hole.number] = {
          drive: 'right',
          approachBucket: '200+',
          putts: 3,
          firstPuttBucket: '6+',
          sandShots: 0,
        };
      }
    });
    const myRound = {
      key: 'coach:0',
      round: mkRound({
        holes,
        scores: { p1: scores },
        shotDetails,
        playerHandicaps: { p1: 0 },
      }),
      playerId: 'p1',
      player: { id: 'p1', name: 'Me', handicap: 0 },
      courseName: 'Coach',
      tournamentName: 'T',
      tournamentDate: '2026-05-29',
      completed: true,
    };

    const stats = computeMyStats([myRound], { targetHandicap: 14 });

    expect(stats.coach.hero).toBeTruthy();
    expect(stats.coach.board).toHaveProperty('fixFirst');
    expect(stats.coach.board).toHaveProperty('keepDoing');
    expect(stats.coach.board).toHaveProperty('nextGains');
    expect(stats.coach.practicePlan).toHaveLength(3);
  });
```

- [ ] **Step 2: Run the integration test to verify it fails**

Run:

```bash
npm test -- src/store/__tests__/personalStats.test.js --runInBand
```

Expected: FAIL because `stats.coach` is undefined.

- [ ] **Step 3: Import and attach `coach` in `computeMyStats`**

In `src/store/personalStats.js`, add this import below the existing imports:

```js
import { buildCoachInsights } from './coachInsights';
```

Replace the current `return { ... }` in `computeMyStats` with this structure:

```js
  const baseStats = {
    roundCount: rounds.length,
    metrics: computeMetrics(synthetic),
    form: computeRecentVsHistory(rounds, n),
    ranking,
    parType: parTypeSplit(synthetic, CANON_ID),
    difficulty: holeDifficultySplit(synthetic, CANON_ID),
    frontBack: frontBackSplit(synthetic)[0] ?? null,
    warmupClosing: warmupVsClosing(synthetic, CANON_ID),
    distribution: playerScoreDistribution(synthetic, CANON_ID),
    teeShot: teeShotImpact(synthetic, CANON_ID),
    shots: shotStats(synthetic, CANON_ID),
    driveImpact,
    approachImpact,
    puttDive,
    puttingTarget,
    approachTarget,
    actionPlan: buildActionPlan({
      driveImpact, approachTarget, puttingTarget, strokesGained,
    }),
    bounceBack: bounceBackRate(synthetic)[0] ?? null,
    scrambling: scramblingStats(synthetic)[0] ?? null,
    history: playerRoundHistory(synthetic, CANON_ID),
    formSeries: computeFormSeries(rounds),
    lagPutting: lagPuttingQuality(synthetic.rounds, CANON_ID),
    sandSaves: sandSaveRate(synthetic.rounds, CANON_ID),
    upAndDown: upAndDownRate(synthetic.rounds, CANON_ID),
    bunkerVisits: bunkerVisits(synthetic.rounds, CANON_ID),
    strokesGained,
  };

  return {
    ...baseStats,
    coach: buildCoachInsights(baseStats),
  };
```

- [ ] **Step 4: Run the personal stats tests to verify they pass**

Run:

```bash
npm test -- src/store/__tests__/personalStats.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/personalStats.js src/store/__tests__/personalStats.test.js
git commit -m "feat: attach coach insights to personal stats"
```

---

### Task 3: Create Coach Presentation Components

**Files:**
- Create: `src/components/mystats/CoachHero.js`
- Create: `src/components/mystats/CoachInsightRow.js`
- Create: `src/components/mystats/CoachBoard.js`
- Create: `src/components/mystats/PracticePlanCard.js`
- Create: `src/components/mystats/__tests__/CoachComponents.test.js`

- [ ] **Step 1: Write component tests**

Create `src/components/mystats/__tests__/CoachComponents.test.js`:

```js
import React from 'react';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '../../../theme/ThemeContext';
import CoachHero from '../CoachHero';
import CoachBoard from '../CoachBoard';
import PracticePlanCard from '../PracticePlanCard';

const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

const insight = {
  id: 'putting:6-m-putts',
  group: 'fixFirst',
  area: 'putting',
  areaLabel: 'Putting',
  title: '6+ m putts',
  reason: '6+ m putts is costing points across 18 samples.',
  metric: '-0.81 SG / putt',
  sample: 18,
  confidence: 'high',
  tone: 'bad',
};

describe('Coach components', () => {
  test('CoachHero renders the main insight and proof chips', () => {
    const { getByText } = render(wrap(<CoachHero insight={insight} />));

    expect(getByText('Fix first')).toBeTruthy();
    expect(getByText('6+ m putts')).toBeTruthy();
    expect(getByText('-0.81 SG / putt')).toBeTruthy();
    expect(getByText('18 samples')).toBeTruthy();
  });

  test('CoachBoard renders multiple diagnostic groups', () => {
    const board = {
      fixFirst: [insight],
      keepDoing: [{ ...insight, id: 'driving:fairway-drives', group: 'keepDoing', title: 'Fairway drives', tone: 'good', metric: '+0.64 pts / hole' }],
      gettingBetter: [{ ...insight, id: 'form:points-round', group: 'gettingBetter', area: 'form', title: 'Points / round', tone: 'good', metric: 'Improved by 3' }],
      gettingWorse: [],
      nextGains: [],
      watch: [],
    };

    const { getByText } = render(wrap(<CoachBoard board={board} />));

    expect(getByText('Fix first')).toBeTruthy();
    expect(getByText('Keep doing')).toBeTruthy();
    expect(getByText('Getting better')).toBeTruthy();
    expect(getByText('Fairway drives')).toBeTruthy();
  });

  test('PracticePlanCard renders the three plan roles at the bottom summary level', () => {
    const plan = [
      { id: 'a', role: 'practiceFirst', title: '6+ m putts', instruction: 'Spend 15 minutes on distance control.', reason: 'Putting is costing points.' },
      { id: 'b', role: 'secondaryFocus', title: '100-150 m approaches', instruction: 'Hit 10 focused approach shots.', reason: 'Approach is below target.' },
      { id: 'c', role: 'onCourseCue', title: 'Closing 3 holes', instruction: 'Choose conservative targets late.', reason: 'Closing holes are fading.' },
    ];

    const { getByText } = render(wrap(<PracticePlanCard plan={plan} />));

    expect(getByText('Practice Plan')).toBeTruthy();
    expect(getByText('Practice first')).toBeTruthy();
    expect(getByText('Secondary focus')).toBeTruthy();
    expect(getByText('On-course cue')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the component tests to verify they fail**

Run:

```bash
npm test -- src/components/mystats/__tests__/CoachComponents.test.js --runInBand
```

Expected: FAIL with module resolution errors for the new components.

- [ ] **Step 3: Implement `CoachHero`**

Create `src/components/mystats/CoachHero.js`:

```js
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';

const GROUP_LABELS = {
  fixFirst: 'Fix first',
  keepDoing: 'Keep doing',
  gettingBetter: 'Getting better',
  gettingWorse: 'Getting worse',
  nextGain: 'Next gain',
  watch: 'Watch',
};

export default function CoachHero({ insight }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const safeInsight = insight || {
    group: 'watch',
    title: 'Play more rounds to unlock Coach',
    reason: 'Coach needs completed rounds to find reliable scoring patterns.',
    metric: 'More data needed',
    sample: null,
    confidence: 'low',
  };
  const sampleText = safeInsight.sample != null ? `${safeInsight.sample} samples` : safeInsight.confidence;

  return (
    <View style={s.card}>
      <View style={s.topRow}>
        <Text style={s.kicker}>{GROUP_LABELS[safeInsight.group] || 'Coach'}</Text>
        <Text style={s.kicker}>{safeInsight.areaLabel || 'Stats'}</Text>
      </View>
      <Text style={s.title}>{safeInsight.title}</Text>
      <Text style={s.reason}>{safeInsight.reason}</Text>
      <View style={s.proofs}>
        <View style={s.proof}>
          <Text style={s.proofLabel}>Impact</Text>
          <Text style={s.proofValue}>{safeInsight.metric}</Text>
        </View>
        <View style={s.proof}>
          <Text style={s.proofLabel}>Confidence</Text>
          <Text style={s.proofValue}>{sampleText}</Text>
        </View>
      </View>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.accent.primary,
      borderRadius: theme.radius.lg,
      padding: theme.spacing.lg,
      gap: theme.spacing.sm,
    },
    topRow: { flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing.md },
    kicker: { ...theme.typography.caption, color: 'rgba(255,255,255,0.82)', fontWeight: '800' },
    title: { ...theme.typography.title, color: theme.text.inverse, fontWeight: '900' },
    reason: { ...theme.typography.body, color: 'rgba(255,255,255,0.86)', fontWeight: '700' },
    proofs: { flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.xs },
    proof: {
      flex: 1,
      borderRadius: theme.radius.md,
      padding: theme.spacing.sm,
      backgroundColor: 'rgba(255,255,255,0.14)',
    },
    proofLabel: { ...theme.typography.tiny, color: 'rgba(255,255,255,0.74)', fontWeight: '800' },
    proofValue: { ...theme.typography.caption, color: theme.text.inverse, fontWeight: '800', marginTop: 2 },
  });
}
```

- [ ] **Step 4: Implement `CoachInsightRow` and `CoachBoard`**

Create `src/components/mystats/CoachInsightRow.js`:

```js
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';

function toneColor(theme, tone) {
  if (tone === 'good') return theme.accent.primary;
  if (tone === 'bad') return theme.destructive;
  if (tone === 'watch') return theme.pairB;
  return theme.text.secondary;
}

function toneIcon(tone) {
  if (tone === 'good') return 'trending-up';
  if (tone === 'bad') return 'alert-triangle';
  if (tone === 'watch') return 'eye';
  return 'circle';
}

export default function CoachInsightRow({ insight }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const color = toneColor(theme, insight.tone);
  const sample = insight.sample != null ? `${insight.sample} samples` : insight.confidence;

  return (
    <View style={s.row}>
      <View style={[s.iconWrap, { backgroundColor: `${color}18` }]}>
        <Feather name={toneIcon(insight.tone)} size={15} color={color} />
      </View>
      <View style={s.copy}>
        <View style={s.metaRow}>
          <Text style={[s.area, { color }]}>{insight.areaLabel}</Text>
          <Text style={s.sample}>{sample}</Text>
        </View>
        <Text style={s.title}>{insight.title}</Text>
        <Text style={s.reason}>{insight.reason}</Text>
      </View>
      <Text style={[s.metric, { color }]}>{insight.metric}</Text>
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.sm,
      paddingVertical: theme.spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border.default,
    },
    iconWrap: {
      width: 30,
      height: 30,
      borderRadius: theme.radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    copy: { flex: 1 },
    metaRow: { flexDirection: 'row', gap: theme.spacing.sm, alignItems: 'center' },
    area: { ...theme.typography.tiny, fontWeight: '800' },
    sample: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '700' },
    title: { ...theme.typography.body, color: theme.text.primary, fontWeight: '800', marginTop: 1 },
    reason: { ...theme.typography.caption, color: theme.text.secondary, marginTop: 1 },
    metric: { ...theme.typography.caption, fontWeight: '900', maxWidth: 86, textAlign: 'right' },
  });
}
```

Create `src/components/mystats/CoachBoard.js`:

```js
import React from 'react';
import { Text } from 'react-native';
import SectionCard from './SectionCard';
import CoachInsightRow from './CoachInsightRow';

const GROUPS = [
  ['fixFirst', 'Fix first'],
  ['keepDoing', 'Keep doing'],
  ['gettingBetter', 'Getting better'],
  ['gettingWorse', 'Getting worse'],
  ['nextGains', 'Next gain'],
  ['watch', 'Watch'],
];

export default function CoachBoard({ board }) {
  const visibleGroups = GROUPS
    .map(([key, label]) => ({ key, label, insights: board?.[key] || [] }))
    .filter((group) => group.insights.length > 0);

  return (
    <SectionCard title="Coach Board">
      {visibleGroups.length === 0 ? (
        <Text>No strong patterns yet. Play more rounds to unlock Coach insights.</Text>
      ) : visibleGroups.map((group) => (
        <React.Fragment key={group.key}>
          <Text>{group.label}</Text>
          {group.insights.map((insight) => (
            <CoachInsightRow key={insight.id} insight={insight} />
          ))}
        </React.Fragment>
      ))}
    </SectionCard>
  );
}
```

- [ ] **Step 5: Implement `PracticePlanCard`**

Create `src/components/mystats/PracticePlanCard.js`:

```js
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import SectionCard from './SectionCard';

const ROLE_LABELS = {
  practiceFirst: 'Practice first',
  secondaryFocus: 'Secondary focus',
  onCourseCue: 'On-course cue',
};

export default function PracticePlanCard({ plan }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const items = Array.isArray(plan) ? plan : [];

  return (
    <SectionCard title="Practice Plan">
      {items.map((item, index) => (
        <View key={item.id} style={s.item}>
          <View style={s.number}>
            <Text style={s.numberText}>{index + 1}</Text>
          </View>
          <View style={s.copy}>
            <Text style={s.role}>{ROLE_LABELS[item.role] || 'Practice'}</Text>
            <Text style={s.title}>{item.title}</Text>
            <Text style={s.instruction}>{item.instruction}</Text>
            <Text style={s.reason}>{item.reason}</Text>
          </View>
        </View>
      ))}
    </SectionCard>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    item: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      paddingVertical: theme.spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border.default,
    },
    number: {
      width: 34,
      height: 34,
      borderRadius: theme.radius.md,
      backgroundColor: theme.accent.light,
      alignItems: 'center',
      justifyContent: 'center',
    },
    numberText: { ...theme.typography.subhead, color: theme.accent.primary, fontWeight: '900' },
    copy: { flex: 1 },
    role: { ...theme.typography.tiny, color: theme.accent.primary, fontWeight: '900' },
    title: { ...theme.typography.body, color: theme.text.primary, fontWeight: '800', marginTop: 1 },
    instruction: { ...theme.typography.caption, color: theme.text.primary, marginTop: 2 },
    reason: { ...theme.typography.tiny, color: theme.text.muted, marginTop: 2 },
  });
}
```

- [ ] **Step 6: Run component tests to verify they pass**

Run:

```bash
npm test -- src/components/mystats/__tests__/CoachComponents.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/mystats/CoachHero.js src/components/mystats/CoachInsightRow.js src/components/mystats/CoachBoard.js src/components/mystats/PracticePlanCard.js src/components/mystats/__tests__/CoachComponents.test.js
git commit -m "feat: add stats coach presentation components"
```

---

### Task 4: Build Coach Tab and Preserve Evidence Cards

**Files:**
- Create: `src/components/mystats/tabs/CoachTab.js`
- Modify: `src/components/mystats/tabs/OverviewTab.js`
- Modify: `src/components/mystats/tabs/__tests__/StatsTabs.test.js`

- [ ] **Step 1: Replace tab tests for Coach behavior**

In `src/components/mystats/tabs/__tests__/StatsTabs.test.js`:

1. Replace `import OverviewTab from '../OverviewTab';` with:

```js
import CoachTab from '../CoachTab';
```

2. Update `baseStats()` to include `coach`, `ranking` top/bottom data, and existing Strokes Gained:

```js
    ranking: {
      baseline: 1.6,
      strengths: [{ label: 'Fairway drives', avgPoints: 2.6, deviation: 1, sample: 18, unit: 'holes' }],
      weaknesses: [{ label: '6+ m putts', avgPoints: 0.8, deviation: -0.8, sample: 12, unit: 'attempts' }],
    },
    coach: {
      hero: {
        id: 'putting:6-m-putts',
        group: 'fixFirst',
        area: 'putting',
        areaLabel: 'Putting',
        title: '6+ m putts',
        reason: '6+ m putts is costing points across 12 samples.',
        metric: '-0.81 SG / putt',
        sample: 12,
        confidence: 'high',
        tone: 'bad',
      },
      board: {
        fixFirst: [{
          id: 'putting:6-m-putts',
          group: 'fixFirst',
          area: 'putting',
          areaLabel: 'Putting',
          title: '6+ m putts',
          reason: '6+ m putts is costing points across 12 samples.',
          metric: '-0.81 SG / putt',
          sample: 12,
          confidence: 'high',
          tone: 'bad',
        }],
        keepDoing: [],
        gettingBetter: [],
        gettingWorse: [],
        nextGains: [],
        watch: [],
      },
      practicePlan: [
        { id: 'a', role: 'practiceFirst', title: '6+ m putts', instruction: 'Spend 15 minutes on distance control.', reason: 'Putting is costing points.' },
        { id: 'b', role: 'secondaryFocus', title: 'Approach', instruction: 'Hit 10 focused approaches.', reason: 'Approach is below target.' },
        { id: 'c', role: 'onCourseCue', title: 'Closing 3 holes', instruction: 'Protect against doubles late.', reason: 'Closing holes are fading.' },
      ],
    },
```

3. Replace the Overview test with:

```js
  test('CoachTab renders coach guidance, strokes gained, top/bottom evidence, and practice plan', async () => {
    const { findByText } = render(wrap(
      <CoachTab stats={baseStats()} onInfo={() => {}} targetHandicap={14} onChangeTarget={() => {}} />
    ));

    expect(await findByText('6+ m putts')).toBeTruthy();
    expect(await findByText('Strokes Gained vs handicap 14')).toBeTruthy();
    expect(await findByText('-1.25')).toBeTruthy();
    expect(await findByText('Top strengths')).toBeTruthy();
    expect(await findByText('Bottom leaks')).toBeTruthy();
    expect(await findByText('Fairway drives')).toBeTruthy();
    expect(await findByText('Practice Plan')).toBeTruthy();
  });
```

- [ ] **Step 2: Run the tab tests to verify they fail**

Run:

```bash
npm test -- src/components/mystats/tabs/__tests__/StatsTabs.test.js --runInBand
```

Expected: FAIL with a module resolution error for `../CoachTab`.

- [ ] **Step 3: Implement `CoachTab.js`**

Create `src/components/mystats/tabs/CoachTab.js`:

```js
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../../theme/ThemeContext';
import SectionCard from '../SectionCard';
import StatTile from '../StatTile';
import TrendLineChart from '../TrendLineChart';
import CoachHero from '../CoachHero';
import CoachBoard from '../CoachBoard';
import PracticePlanCard from '../PracticePlanCard';
import { SGBar } from '../SGBars';

function verdict(form) {
  if (!form?.hasHistory) return 'Not enough history';
  const d = form.metrics?.[0]?.direction;
  if (d === 'up') return 'Improving';
  if (d === 'down') return 'Declining';
  return 'Holding steady';
}

function signed(value) {
  if (!Number.isFinite(value)) return '0';
  return value >= 0 ? `+${value}` : `${value}`;
}

function EvidenceRow({ cell, tone, s, theme }) {
  const color = tone === 'good' ? theme.accent.primary : theme.destructive;
  return (
    <View style={s.evidenceRow}>
      <View style={s.evidenceText}>
        <Text style={s.evidenceName}>{cell.label}</Text>
        <Text style={s.evidenceSub}>{`${cell.avgPoints} pts / hole - ${cell.sample} ${cell.unit || 'holes'}`}</Text>
      </View>
      <Text style={[s.evidenceDelta, { color }]}>{signed(cell.deviation)}</Text>
    </View>
  );
}

export default function CoachTab({ stats, onInfo, targetHandicap, onChangeTarget }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { metrics, form, formSeries, ranking, strokesGained, coach } = stats;
  const pointsDelta = form?.hasHistory ? form.metrics?.[0]?.delta : null;
  const sgTitle = (targetHandicap == null || targetHandicap === 0)
    ? 'Strokes Gained vs scratch'
    : `Strokes Gained vs handicap ${targetHandicap}`;

  return (
    <View style={s.wrap}>
      <CoachHero insight={coach?.hero} />
      <CoachBoard board={coach?.board} />

      <SectionCard title="Current Form" infoKey="recentForm" onInfo={onInfo}>
        <Text style={s.verdict}>{verdict(form)}</Text>
        {pointsDelta != null ? (
          <Text style={s.verdictSub}>
            {`${pointsDelta > 0 ? '+' : ''}${pointsDelta} pts / round vs earlier selected rounds`}
          </Text>
        ) : (
          <Text style={s.verdictSub}>Play more rounds to see what is changing.</Text>
        )}
        <TrendLineChart series={formSeries.metrics.avgPoints} color={theme.accent.primary} />
        <View style={s.tiles}>
          <StatTile value={`${metrics.rounds}`} caption="ROUNDS COUNTED" />
          <StatTile value={`${metrics.avgPoints}`} caption="AVG PTS / ROUND" />
          <StatTile value={`${metrics.bestRoundPoints}`} caption="BEST ROUND" />
        </View>
      </SectionCard>

      {strokesGained?.total != null && (
        <SectionCard
          title={sgTitle}
          infoKey="strokesGained"
          onInfo={onInfo}
          right={onChangeTarget ? (
            <TouchableOpacity onPress={onChangeTarget} hitSlop={8} accessibilityLabel="Change target handicap">
              <Feather name="edit-2" size={14} color={theme.text.secondary} />
            </TouchableOpacity>
          ) : null}
        >
          <Text
            style={[
              s.sgValue,
              { color: strokesGained.total >= 0 ? theme.scoreColor('good') : theme.scoreColor('poor') },
            ]}
          >
            {strokesGained.total >= 0 ? '+' : ''}
            {strokesGained.total.toFixed(2)}
          </Text>
          <Text style={s.sgSubtle}>
            per round {(targetHandicap == null || targetHandicap === 0) ? 'vs scratch' : `vs hcp ${targetHandicap}`}
          </Text>
          <SGBar label="Off the tee" value={strokesGained.byCategory?.tee} />
          <SGBar label="Approach" value={strokesGained.byCategory?.approach} />
          <SGBar label="Around green" value={strokesGained.byCategory?.aroundGreen} />
          <SGBar label="Putting" value={strokesGained.byCategory?.putting} />
        </SectionCard>
      )}

      <SectionCard title="Top 3 / Bottom 3" infoKey="strengths" onInfo={onInfo}>
        {ranking?.baseline == null ? (
          <Text style={s.note}>Not enough data yet.</Text>
        ) : (
          <>
            <Text style={[s.group, { color: theme.accent.primary }]}>Top strengths</Text>
            {ranking.strengths.length === 0 && <Text style={s.note}>Nothing stands out yet.</Text>}
            {ranking.strengths.map((cell) => (
              <EvidenceRow key={`top-${cell.label}`} cell={cell} tone="good" s={s} theme={theme} />
            ))}
            <Text style={[s.group, { color: theme.destructive }]}>Bottom leaks</Text>
            {ranking.weaknesses.length === 0 && <Text style={s.note}>Nothing stands out yet.</Text>}
            {ranking.weaknesses.map((cell) => (
              <EvidenceRow key={`bottom-${cell.label}`} cell={cell} tone="bad" s={s} theme={theme} />
            ))}
            <Text style={s.note}>{`Measured against your ${ranking.baseline} pts/hole average.`}</Text>
          </>
        )}
      </SectionCard>

      <PracticePlanCard plan={coach?.practicePlan} />
    </View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    wrap: { gap: theme.spacing.lg },
    verdict: { ...theme.typography.title, color: theme.text.primary, fontWeight: '800' },
    verdictSub: { ...theme.typography.caption, color: theme.text.secondary, fontWeight: '700' },
    tiles: { flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.xs },
    sgValue: { ...theme.typography.title, fontWeight: '800' },
    sgSubtle: { ...theme.typography.caption, color: theme.text.muted, marginTop: theme.spacing.xs },
    group: { ...theme.typography.overline, fontWeight: '800', marginTop: theme.spacing.sm },
    note: { ...theme.typography.caption, color: theme.text.muted, fontStyle: 'italic', marginTop: theme.spacing.xs },
    evidenceRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingVertical: 7 },
    evidenceText: { flex: 1 },
    evidenceName: { ...theme.typography.body, color: theme.text.primary, fontWeight: '700' },
    evidenceSub: { ...theme.typography.tiny, color: theme.text.muted, fontWeight: '700' },
    evidenceDelta: { ...theme.typography.caption, fontWeight: '900' },
  });
}
```

- [ ] **Step 4: Keep `OverviewTab.js` as a compatibility re-export**

Replace `src/components/mystats/tabs/OverviewTab.js` with:

```js
export { default } from './CoachTab';
```

- [ ] **Step 5: Run the tab tests to verify they pass**

Run:

```bash
npm test -- src/components/mystats/tabs/__tests__/StatsTabs.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/mystats/tabs/CoachTab.js src/components/mystats/tabs/OverviewTab.js src/components/mystats/tabs/__tests__/StatsTabs.test.js
git commit -m "feat: build stats coach tab"
```

---

### Task 5: Wire Coach Tab Into MyStatsScreen

**Files:**
- Modify: `src/screens/MyStatsScreen.js`
- Modify: `src/screens/__tests__/MyStatsScreen.test.js`

- [ ] **Step 1: Update screen tests for Coach tab order and route compatibility**

In `src/screens/__tests__/MyStatsScreen.test.js`:

1. Replace the Overview tab mock with a Coach tab mock:

```js
jest.mock('../../components/mystats/tabs/CoachTab', () => function MockCoachTab() {
  const { Text } = require('react-native');
  return <Text>Coach content</Text>;
});
```

2. Keep the `OverviewTab` mock only if imports still reference it after Step 3. If Step 3 removes the import, delete the Overview mock.

3. Update `computeMyStats` mock so all tabs receive a usable `stats` object:

```js
  computeMyStats: jest.fn(() => ({
    metrics: { rounds: 1, avgPoints: 30, bestRoundPoints: 30 },
    form: { hasHistory: false, metrics: [{ key: 'avgPoints', direction: 'flat', delta: null }] },
    formSeries: { metrics: { avgPoints: [] } },
    ranking: { baseline: null, strengths: [], weaknesses: [] },
    coach: { hero: null, board: {}, practicePlan: [] },
  })),
```

4. Update the tab strip test:

```js
  test('renders the personal stats tabs in a horizontal scroller', async () => {
    const { findByTestId, getByText } = renderScreen({ params: {} });

    const tabs = await findByTestId('my-stats-tab-scroller');

    expect(tabs.props.horizontal).toBe(true);
    expect(tabs.props.showsHorizontalScrollIndicator).toBe(false);
    expect(getByText('Coach')).toBeTruthy();
    expect(getByText('Report Card')).toBeTruthy();
    expect(getByText('Form')).toBeTruthy();
    expect(getByText('Breakdown')).toBeTruthy();
    expect(getByText('Shots')).toBeTruthy();
    expect(getByText('Coach content')).toBeTruthy();
  });
```

5. Add this route compatibility test:

```js
  test('maps legacy overview route param to the Coach tab', async () => {
    const { findByText, getByLabelText } = renderScreen({ params: { tab: 'overview' } });

    expect(await findByText('Coach content')).toBeTruthy();
    expect(getByLabelText('Coach').props.accessibilityState?.selected).toBe(true);
  });
```

- [ ] **Step 2: Run the screen test to verify it fails**

Run:

```bash
npm test -- src/screens/__tests__/MyStatsScreen.test.js --runInBand
```

Expected: FAIL because `Coach` is not in the tab list and `overview` still selects Overview.

- [ ] **Step 3: Update MyStatsScreen tab config and rendering**

In `src/screens/MyStatsScreen.js`:

1. Replace the Overview import:

```js
import CoachTab from '../components/mystats/tabs/CoachTab';
```

2. Replace `ALL_TABS` with:

```js
const ALL_TABS = [
  { key: 'coach', label: 'Coach' },
  { key: 'reportCard', label: 'Report Card' },
  { key: 'form', label: 'Form' },
  { key: 'breakdown', label: 'Breakdown' },
  { key: 'shots', label: 'Shots' },
];
```

3. Add this helper above the component:

```js
function normalizeStatsTab(value) {
  if (value === 'overview') return 'coach';
  return value ?? 'coach';
}
```

4. Replace the tab state initializer:

```js
  const [tab, setTab] = useState(normalizeStatsTab(route?.params?.tab));
```

5. Replace the tab scroll effect condition:

```js
      if (tab === 'breakdown' || tab === 'shots') {
        tabScrollRef.current?.scrollToEnd({ animated: true });
      } else if (tab === 'coach' || tab === 'reportCard') {
        tabScrollRef.current?.scrollTo({ x: 0, animated: true });
      }
```

6. Replace the Overview render branch:

```js
        {tab === 'coach' && <CoachTab stats={stats} onInfo={onInfo} targetHandicap={targetHandicap} onChangeTarget={() => setPickerOpen(true)} />}
```

- [ ] **Step 4: Run the screen test to verify it passes**

Run:

```bash
npm test -- src/screens/__tests__/MyStatsScreen.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/screens/MyStatsScreen.js src/screens/__tests__/MyStatsScreen.test.js
git commit -m "feat: make coach the first stats tab"
```

---

### Task 6: Verify Full Stats Behavior and Polish Copy

**Files:**
- Modify as needed from failed verification only:
  - `src/store/coachInsights.js`
  - `src/components/mystats/tabs/CoachTab.js`
  - `src/components/mystats/CoachBoard.js`
  - `src/components/mystats/PracticePlanCard.js`
  - related tests

- [ ] **Step 1: Run the focused stats test suite**

Run:

```bash
npm test -- src/store/__tests__/coachInsights.test.js src/store/__tests__/personalStats.test.js src/components/mystats/__tests__/CoachComponents.test.js src/components/mystats/tabs/__tests__/StatsTabs.test.js src/screens/__tests__/MyStatsScreen.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Run the full Jest suite**

Run:

```bash
npm test -- --runInBand
```

Expected: PASS.

- [ ] **Step 4: Fix any concrete failures**

If a command fails, make the smallest scoped change that matches the failure. Examples:

```js
// If a Coach component renders unstyled fallback text that is hard to read,
// wrap it in a Text style using theme.typography.caption and theme.text.muted.
<Text style={s.empty}>No strong patterns yet. Play more rounds to unlock Coach insights.</Text>
```

```js
// If a route test fails because route params are undefined, keep the helper total.
function normalizeStatsTab(value) {
  if (value === 'overview') return 'coach';
  if (!ALL_TABS.some((tab) => tab.key === value)) return 'coach';
  return value;
}
```

- [ ] **Step 5: Re-run the failing command**

Run the exact command that failed in Step 1, Step 2, or Step 3.

Expected: PASS.

- [ ] **Step 6: Commit verification fixes**

Only commit if files changed in this task:

```bash
git add src/store/coachInsights.js src/components/mystats/tabs/CoachTab.js src/components/mystats/CoachBoard.js src/components/mystats/PracticePlanCard.js src/store/__tests__/coachInsights.test.js src/components/mystats/__tests__/CoachComponents.test.js src/components/mystats/tabs/__tests__/StatsTabs.test.js src/screens/__tests__/MyStatsScreen.test.js
git commit -m "fix: polish stats coach behavior"
```

---

## Self-Review

- Spec coverage: The plan implements Coach as the first tab, richer board groups, Strokes Gained vs target, Top 3 / Bottom 3, Practice Plan near the bottom, route compatibility, sparse-data fallbacks, and deterministic store-owned logic.
- Red-flag scan: No incomplete markers or unspecified test steps remain.
- Type consistency: `buildCoachInsights(stats)` returns `hero`, `board`, and `practicePlan`; `computeMyStats` attaches that object as `stats.coach`; `CoachTab` consumes `stats.coach`.
