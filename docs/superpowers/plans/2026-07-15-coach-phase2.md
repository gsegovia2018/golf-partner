# Closing-the-Loop Coach (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the coach genuinely help the player improve: concrete drills with measurable pass targets, a committed focus the coach verdicts after later rounds, five quantified on-course strategy tips, and Stableford-points framing.

**Architecture:** Three new pure store modules (`coachDrills.js`, `coachStrategy.js`, `coachFocus.js`) plus small extensions to `coachInsights.js`/`personalStats.js`/`statsEngine.js`; UI in `src/components/mystats/` (FocusCard, PlaySmarterCard, upgraded PracticePlanCard/CoachHero/CoachTab) wired through `MyStatsScreen`. Spec: `docs/superpowers/specs/2026-07-15-sg-coach-improvements-design.md` (Phase 2 sections). Phase 1 (five-category SG, personalDelta, reconciliation) is already on master.

**Tech Stack:** Expo SDK 54 / React Native 0.81 / React 19, plain JS, AsyncStorage, Jest (jest-expo), @testing-library/react-native.

## Global Constraints

- Everything deterministic and on-device — no LLM, no network calls (spec goal 5). AsyncStorage timestamps may use `new Date()`, but **verdict/stat logic must not depend on wall-clock time**.
- Store modules stay pure functions apart from the AsyncStorage adapter functions in `coachFocus.js`; no React imports in `src/store/`.
- Focus is device-local (AsyncStorage), keyed per user id — no schema/sync changes (spec §2.2).
- Focus verdicts refuse to judge with fewer than 2 post-commit rounds (spec error handling).
- Strategy tips are EXACTLY the five spec'd rules; each renders only when its data threshold is met (spec §2.3); no tip may fire from under-sampled data.
- Points framing: 1 SG/round ≈ 1 Stableford pt/round, stated as an approximation; applied ONLY to insights whose unit is per-round SG — never converted from per-shot/per-putt units without a rounds denominator (spec §2.4).
- Run tests with `npx jest <path>`; full suite `npm test`; lint `npm run lint` (CI-blocking). Ignore failures under `.claude/worktrees/`/`.worktrees/` copies (environment artifact).
- Commit after every task with the message given in the task.

---

### Task 1: `driveLieBreakdown` in statsEngine

**Files:**
- Modify: `src/store/statsEngine.js` (add after `driveLieFromDetail`, ~line 2560)
- Test: `src/store/__tests__/statsEngine.test.js`

**Interfaces:**
- Consumes: existing `driveLieFromDetail(detail)` (exported, same file).
- Produces (used by Task 5's club-down rule and Task 6 wiring):

```js
driveLieBreakdown(rounds, playerId) → {
  drives: number,                                  // holes with any derivable drive lie
  byLie: { fairway, rough, sand, trouble },        // counts
  troubleRate: number|null,                        // (sand+trouble)/drives, null when drives === 0
}
```

The test fixture `makeRound(holes, details)` exists near line 200 of the test file.

- [ ] **Step 1: Write the failing tests**

```js
describe('driveLieBreakdown', () => {
  test('counts lies (explicit + derived) and computes troubleRate', () => {
    const round = makeRound(
      [
        { par: 4, strokes: 4 }, { par: 4, strokes: 5 }, { par: 5, strokes: 6 },
        { par: 4, strokes: 5 }, { par: 3, strokes: 3 }, { par: 4, strokes: 4 },
      ],
      [
        { drive: 'fairway' },                          // fairway (derived)
        { drive: 'left' },                             // rough (derived default)
        { drive: 'right', driveLie: 'sand' },          // sand (explicit)
        { drive: 'left', driveLie: 'trouble' },        // trouble (explicit)
        { drive: 'fairway' },                          // par 3 — excluded (no drive category)
        {},                                            // no drive info → excluded
      ],
    );
    const r = driveLieBreakdown([round], 'me');
    expect(r.drives).toBe(4);
    expect(r.byLie).toEqual({ fairway: 1, rough: 1, sand: 1, trouble: 1 });
    expect(r.troubleRate).toBeCloseTo(0.5, 10);
  });
  test('null troubleRate with no drive data', () => {
    const round = makeRound([{ par: 4, strokes: 4 }], [{}]);
    const r = driveLieBreakdown([round], 'me');
    expect(r.drives).toBe(0);
    expect(r.troubleRate).toBeNull();
  });
});
```

Note the first test expects the par-3 hole to be EXCLUDED (drives only exist on par 4+, same rule as `sgOffTheTee`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/store/__tests__/statsEngine.test.js -t "driveLieBreakdown"`
Expected: FAIL — `driveLieBreakdown is not a function`. (Also add `driveLieBreakdown` to the test file's import list from `../statsEngine`.)

- [ ] **Step 3: Implement**

Add after `driveLieFromDetail` in `statsEngine.js`:

```js
// Distribution of drive lies across rounds — feeds the coach's club-down
// strategy rule. Par 3s are excluded (no drive category), matching sgOffTheTee.
export function driveLieBreakdown(rounds, playerId) {
  const byLie = { fairway: 0, rough: 0, sand: 0, trouble: 0 };
  let drives = 0;
  (rounds ?? []).forEach((round) => {
    const byHole = round?.shotDetails?.[playerId];
    if (!byHole) return;
    (round.holes ?? []).forEach((hole) => {
      if (hole.par < 4) return;
      const lie = driveLieFromDetail(byHole[hole.number]);
      if (lie == null) return;
      byLie[lie] += 1;
      drives += 1;
    });
  });
  return {
    drives,
    byLie,
    troubleRate: drives > 0 ? (byLie.sand + byLie.trouble) / drives : null,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/store/__tests__/statsEngine.test.js`
Expected: PASS (new and all pre-existing).

- [ ] **Step 5: Commit**

```bash
git add src/store/statsEngine.js src/store/__tests__/statsEngine.test.js
git commit -m "feat(coach): drive lie distribution for strategy rules"
```

---

### Task 2: Drill library — `coachDrills.js`

**Files:**
- Create: `src/store/coachDrills.js`
- Test: `src/store/__tests__/coachDrills.test.js` (create)

**Interfaces:**
- Consumes: coach insight objects `{ area, title }` — `area` is a normalized key from coachInsights (`driving | approach | putting | shortGame | penalties | roundShape | scoring | form`); `title` may contain a bucket like `"6+ m putts"` or `"150-200 m approaches"`.
- Produces (used by Tasks 4, 9):
  - `DRILLS` — array of `{ id, area, bucket, title, instruction, passTarget, location }` where `area ∈ 'offTheTee'|'approach'|'putting'|'shortGame'|'penalties'|'roundShape'|'scoring'`, `bucket` is a distance-bucket string or `null`, `location ∈ 'green'|'range'|'course'`.
  - `drillsForInsight(insight) → Drill[]` — bucket-matched drill first, then the area's generic drills; falls back to `scoring` drills for `form`/unknown areas; `[]` for null input.

- [ ] **Step 1: Write the failing tests**

Create `src/store/__tests__/coachDrills.test.js`:

```js
import { DRILLS, drillsForInsight } from '../coachDrills';

describe('DRILLS catalog', () => {
  test('every drill is complete and well-formed', () => {
    expect(DRILLS.length).toBeGreaterThanOrEqual(18);
    const ids = new Set();
    DRILLS.forEach((d) => {
      expect(ids.has(d.id)).toBe(false);
      ids.add(d.id);
      expect(['offTheTee', 'approach', 'putting', 'shortGame', 'penalties', 'roundShape', 'scoring']).toContain(d.area);
      expect(typeof d.title).toBe('string');
      expect(d.instruction.length).toBeGreaterThan(10);
      expect(d.passTarget.length).toBeGreaterThan(5);
      expect(['green', 'range', 'course']).toContain(d.location);
    });
  });
  test('every area has at least one bucketless (generic) drill', () => {
    ['offTheTee', 'approach', 'putting', 'shortGame', 'penalties', 'roundShape', 'scoring'].forEach((area) => {
      expect(DRILLS.some((d) => d.area === area && d.bucket == null)).toBe(true);
    });
  });
});

describe('drillsForInsight', () => {
  test('bucket-matched drill ranks first for a putting bucket leak', () => {
    const drills = drillsForInsight({ area: 'putting', title: '6+ m putts' });
    expect(drills[0].area).toBe('putting');
    expect(drills[0].bucket).toBe('6+');
  });
  test('approach bucket parsed from title', () => {
    const drills = drillsForInsight({ area: 'approach', title: '150-200 m approaches' });
    expect(drills[0].bucket).toBe('150-200');
  });
  test('driving area maps to offTheTee drills', () => {
    const drills = drillsForInsight({ area: 'driving', title: 'Off the tee' });
    expect(drills.length).toBeGreaterThan(0);
    expect(drills[0].area).toBe('offTheTee');
  });
  test('area without bucket returns generic drills for that area', () => {
    const drills = drillsForInsight({ area: 'shortGame', title: 'Short game' });
    expect(drills[0].area).toBe('shortGame');
  });
  test('form/unknown areas fall back to scoring drills', () => {
    expect(drillsForInsight({ area: 'form', title: 'Points / round' })[0].area).toBe('scoring');
    expect(drillsForInsight({ area: 'nonsense', title: 'x' })[0].area).toBe('scoring');
    expect(drillsForInsight(null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/store/__tests__/coachDrills.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/store/coachDrills.js`:

```js
// Deterministic practice-drill catalog (spec §2.1). Every drill has a
// measurable pass target so a session is objectively passed or failed.
// Areas use coach vocabulary; 'driving' insights map to 'offTheTee'.

export const DRILLS = [
  // ── Putting ──
  {
    id: 'putt-lag-ladder', area: 'putting', bucket: '6+', title: 'Lag ladder',
    instruction: 'Take 10 putts from 8 m to one hole. Focus only on pace — pick a 1 m circle around the cup as your target.',
    passTarget: '7 of 10 finish inside 1 m of the hole', location: 'green',
  },
  {
    id: 'putt-circle-4m', area: 'putting', bucket: '3-6', title: 'Circle drill 4 m',
    instruction: 'Place 4 balls at 4 m around one hole (N/S/E/W). Putt all 4, repeat 3 circuits (12 putts).',
    passTarget: 'Hole 3+, and none finish outside 1 m', location: 'green',
  },
  {
    id: 'putt-clock-2m', area: 'putting', bucket: '2-3', title: 'Clock drill 2.5 m',
    instruction: '12 putts from 2.5 m, moving between 4 stations around the hole so the break changes every putt.',
    passTarget: '9 of 12 holed', location: 'green',
  },
  {
    id: 'putt-gate-short', area: 'putting', bucket: '1-2', title: 'Gate drill',
    instruction: 'Build a gate of two tees just wider than the ball, 30 cm ahead. 15 putts from 1.5 m through the gate.',
    passTarget: '12 of 15 holed through the gate', location: 'green',
  },
  {
    id: 'putt-tap-in-pressure', area: 'putting', bucket: '0-1', title: 'Around the world',
    instruction: '12 putts from 1 m around one hole. Start over if you miss two in a row.',
    passTarget: '12 of 12 holed', location: 'green',
  },
  {
    id: 'putt-mixed-ladder', area: 'putting', bucket: null, title: 'Three-distance ladder',
    instruction: '9 putts alternating 3 m, 6 m and 9 m — never two in a row from the same spot.',
    passTarget: '8 of 9 finish inside 1 m (or holed)', location: 'green',
  },
  // ── Approach ──
  {
    id: 'appr-wedge-ladder', area: 'approach', bucket: '0-50', title: 'Wedge ladder',
    instruction: '12 balls alternating 20 / 30 / 40 m targets with your most lofted wedge. Land, do not run, the ball to the target.',
    passTarget: '8 of 12 inside 5 m', location: 'range',
  },
  {
    id: 'appr-distance-windows', area: 'approach', bucket: '50-100', title: 'Distance windows',
    instruction: '12 balls: 4 each at 60 / 80 / 100 m. Call the number before each swing.',
    passTarget: '8 of 12 inside 8 m of the called number', location: 'range',
  },
  {
    id: 'appr-green-reps-125', area: 'approach', bucket: '100-150', title: 'Green reps 125 m',
    instruction: '15 balls to a 125 m target with the club you actually use from that distance on course.',
    passTarget: '9 of 15 inside a green-sized 12 m circle', location: 'range',
  },
  {
    id: 'appr-long-iron-reps', area: 'approach', bucket: '150-200', title: 'Long-iron reps',
    instruction: '12 balls to a 175 m target. Swing at 80% — the goal is the circle, not distance.',
    passTarget: '6 of 12 inside 15 m', location: 'range',
  },
  {
    id: 'appr-layup-ladder', area: 'approach', bucket: '200+', title: 'Lay-up ladder',
    instruction: 'Alternate 5 full-length shots and 5 lay-ups to your favourite wedge distance. Commit to the number before each lay-up.',
    passTarget: 'All 5 lay-ups finish inside 10 m of the chosen number', location: 'range',
  },
  {
    id: 'appr-call-your-half', area: 'approach', bucket: null, title: 'Call your half',
    instruction: '9 balls at one target. Before each, call which half of the green you are hitting (left/right or front/back).',
    passTarget: '6 of 9 finish on the called half', location: 'range',
  },
  // ── Off the tee ──
  {
    id: 'tee-fairway-window', area: 'offTheTee', bucket: null, title: 'Fairway window',
    instruction: 'Pick two range markers about 30 m apart as an imaginary fairway. 10 drivers through the window.',
    passTarget: '7 of 10 inside the window', location: 'range',
  },
  {
    id: 'tee-club-comparison', area: 'offTheTee', bucket: null, title: 'Driver vs 3-wood test',
    instruction: '6 drivers and 6 3-woods (or hybrid) at the same 30 m window. Count each club’s hits and note the carry gap.',
    passTarget: 'A written verdict: which club keeps 5+ of 6 in the window, and the distance it costs',
    location: 'range',
  },
  {
    id: 'tee-tempo-80', area: 'offTheTee', bucket: null, title: '80% tempo reps',
    instruction: '10 drives at what feels like 80% effort, same window as the fairway drill.',
    passTarget: '8 of 10 in the window while losing no more than ~10 m', location: 'range',
  },
  // ── Short game ──
  {
    id: 'sg-updown-circle', area: 'shortGame', bucket: null, title: 'Up-and-down circle',
    instruction: '9 balls around one green from 3 different lies (fringe, rough, tight). Chip on and putt out every ball.',
    passTarget: '5 of 9 up-and-down (2 strokes total)', location: 'green',
  },
  {
    id: 'sg-landing-towel', area: 'shortGame', bucket: null, title: 'Landing-spot chips',
    instruction: 'Lay a towel where your chips should land (not finish). 10 chips aiming to carry onto the towel.',
    passTarget: '6 of 10 land on or within a club-length of the towel', location: 'green',
  },
  {
    id: 'sg-bunker-first-out', area: 'shortGame', bucket: null, title: 'Bunker first-out',
    instruction: '10 bunker shots. Priority one is escaping on the first swing; priority two is finishing close.',
    passTarget: '10 of 10 out first time, 5 of 10 inside 3 m', location: 'green',
  },
  // ── Penalties ──
  {
    id: 'pen-name-the-trouble', area: 'penalties', bucket: null, title: 'Name the trouble',
    instruction: 'Next round: before every tee shot, say out loud where the penalty trouble is and pick a target 20 m away from it.',
    passTarget: 'Zero tee penalties across 9 consecutive holes', location: 'course',
  },
  {
    id: 'pen-smart-drop-review', area: 'penalties', bucket: null, title: 'Smart-drop review',
    instruction: 'Review your last 3 penalty holes. For each, decide the recovery you will take next time (punch out sideways, drop zone, provisional).',
    passTarget: 'A written next-time plan for all 3 holes', location: 'course',
  },
  // ── Round shape ──
  {
    id: 'shape-closing-routine', area: 'roundShape', bucket: null, title: 'Closing-3 routine',
    instruction: 'On the final 3 holes: pick the conservative target and run your full pre-shot routine on every single shot, no exceptions.',
    passTarget: 'No worse than bogey on each of the last 3 holes', location: 'course',
  },
  // ── Scoring (generic fallback) ──
  {
    id: 'scoring-one-shot-reset', area: 'scoring', bucket: null, title: 'One-shot reset',
    instruction: 'After any double bogey or worse, the next tee shot is automatically your safest club at the widest target. No hero shots.',
    passTarget: 'Bogey or better on every hole that follows a blow-up, for one full round', location: 'course',
  },
];

// coachInsights area vocabulary → drill area.
const AREA_TO_DRILL_AREA = {
  driving: 'offTheTee',
  approach: 'approach',
  putting: 'putting',
  shortGame: 'shortGame',
  penalties: 'penalties',
  roundShape: 'roundShape',
  scoring: 'scoring',
};

// "6+ m putts" → '6+'; "150-200 m approaches" → '150-200'.
function bucketFromTitle(title) {
  const match = /(\d+(?:-\d+)?\+?)\s*m\b/.exec(String(title ?? ''));
  return match ? match[1] : null;
}

// Bucket-matched drill first, then the area's generic drills. Unknown areas
// (and 'form', which has no physical drill) fall back to scoring drills.
export function drillsForInsight(insight) {
  if (!insight) return [];
  const area = AREA_TO_DRILL_AREA[insight.area] ?? 'scoring';
  const bucket = bucketFromTitle(insight.title);
  const areaDrills = DRILLS.filter((d) => d.area === area);
  const pool = areaDrills.length > 0 ? areaDrills : DRILLS.filter((d) => d.area === 'scoring');
  const bucketMatch = bucket ? pool.filter((d) => d.bucket === bucket) : [];
  const generic = pool.filter((d) => d.bucket == null);
  const rest = pool.filter((d) => !bucketMatch.includes(d) && !generic.includes(d));
  return [...bucketMatch, ...generic, ...rest];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/store/__tests__/coachDrills.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/coachDrills.js src/store/__tests__/coachDrills.test.js
git commit -m "feat(coach): deterministic drill catalog with measurable pass targets"
```

---

### Task 3: Points framing on SG-per-round insights

**Files:**
- Modify: `src/store/coachInsights.js`
- Test: `src/store/__tests__/coachInsights.test.js`

**Interfaces:**
- Consumes: existing insight builders in `coachInsights.js` — `actionItemInsight(item, group, tone)` (items carry `unit`, e.g. `'SG / round'`, `'SG / shot'`, `'pts / hole'`) and `strokesGainedCategoryInsights(stats)` (always per-round SG).
- Produces (used by Tasks 4, 9, and UI): insights whose value is per-round SG gain a `pointsPerRound` number (≈ 1 SG = 1 pt, rounded to 2 dp, signed). Insights in other units never get the field.

- [ ] **Step 1: Write the failing tests**

Append to `src/store/__tests__/coachInsights.test.js`:

```js
describe('pointsPerRound framing', () => {
  test('SG-per-round category insights carry pointsPerRound ≈ impact', () => {
    const stats = {
      strokesGained: {
        byCategory: { offTheTee: 0, approach: -1.4, aroundGreen: 0, putting: 0, penalties: 0 },
        sampleHolesByCategory: { offTheTee: 30, approach: 30, aroundGreen: 30, putting: 30, penalties: 30 },
        sampleHoles: 30,
      },
    };
    const { board } = buildCoachInsights(stats);
    const approach = [...board.fixFirst, ...board.nextGains].find((i) => i.title === 'Approach');
    expect(approach.pointsPerRound).toBeCloseTo(-1.4, 2);
  });
  test('per-shot and pts-based insights never get pointsPerRound', () => {
    const stats = {
      actionPlan: {
        improvements: [
          { label: '150-200 m approaches', area: 'Approach', score: -0.31, sample: 14, unit: 'SG / shot', basis: 'vs target hcp' },
          { label: 'Left misses', area: 'Driving', score: -0.5, sample: 12, unit: 'pts / hole', basis: 'vs your avg' },
        ],
      },
    };
    const { board } = buildCoachInsights(stats);
    const all = [...board.fixFirst, ...board.nextGains, ...board.watch];
    all.forEach((insight) => {
      expect(insight.pointsPerRound).toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/store/__tests__/coachInsights.test.js -t "pointsPerRound"`
Expected: FAIL — `pointsPerRound` undefined on the approach insight (first test).

- [ ] **Step 3: Implement**

In `coachInsights.js`:

1. Extend `makeInsight` to accept and emit the field — add `pointsPerRound` to its destructured parameters and, inside the returned object after the `impact` spread, add:

```js
    ...(Number.isFinite(pointsPerRound) ? { pointsPerRound: round2(pointsPerRound) } : {}),
```

2. In `actionItemInsight`, compute it only for the per-round SG unit and pass it into the `makeInsight` call:

```js
  const isSgPerRound = String(item.unit || '') === 'SG / round';
```

and inside the `makeInsight({ ... })` argument object:

```js
    ...(isSgPerRound ? { pointsPerRound: item.score } : {}),
```

3. In `strokesGainedCategoryInsights`, pass `pointsPerRound: value` into its `makeInsight` call (the category values are always per-round).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/store/__tests__/coachInsights.test.js`
Expected: PASS (new and pre-existing).

- [ ] **Step 5: Commit**

```bash
git add src/store/coachInsights.js src/store/__tests__/coachInsights.test.js
git commit -m "feat(coach): SG-per-round insights carry a Stableford points equivalent"
```

---

### Task 4: Practice plan picks real drills

**Files:**
- Modify: `src/store/coachInsights.js` — `buildPracticePlan` (~line 415)
- Test: `src/store/__tests__/coachInsights.test.js`

**Interfaces:**
- Consumes: `drillsForInsight` from `./coachDrills` (Task 2); insights with optional `pointsPerRound` (Task 3).
- Produces: each practice-plan item whose source insight exists gains `drill` (`{ id, title, instruction, passTarget, location }` — first drill from `drillsForInsight`) and, when the source insight has `pointsPerRound`, `payoffPointsPerRound` (absolute value, 2 dp). Items without a source insight keep today's fallback copy and get neither field.

- [ ] **Step 1: Write the failing tests**

```js
describe('practice plan drills', () => {
  test('plan items carry a matched drill and payoff for SG leaks', () => {
    const stats = {
      strokesGained: {
        byCategory: { offTheTee: 0, approach: 0, aroundGreen: 0, putting: -1.8, penalties: 0 },
        sampleHolesByCategory: { offTheTee: 30, approach: 30, aroundGreen: 30, putting: 30, penalties: 30 },
        sampleHoles: 30,
      },
    };
    const { practicePlan } = buildCoachInsights(stats);
    const first = practicePlan.find((p) => p.role === 'practiceFirst');
    expect(first.drill).toBeDefined();
    expect(first.drill.passTarget.length).toBeGreaterThan(5);
    expect(first.payoffPointsPerRound).toBeCloseTo(1.8, 2);
  });
  test('empty stats plan items have no drill', () => {
    const { practicePlan } = buildCoachInsights({});
    practicePlan.forEach((item) => {
      expect(item.drill).toBeUndefined();
      expect(item.payoffPointsPerRound).toBeUndefined();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/store/__tests__/coachInsights.test.js -t "practice plan drills"`
Expected: FAIL — `first.drill` undefined.

- [ ] **Step 3: Implement**

In `coachInsights.js`: import at the top:

```js
import { drillsForInsight } from './coachDrills';
```

Add a helper above `buildPracticePlan`:

```js
// The drill and points payoff attached to a practice item, when its source
// insight exists. Payoff is absolute: "worth ≈ X pts / round" copy is
// direction-free.
function practiceExtras(insight) {
  if (!insight) return {};
  const drill = drillsForInsight(insight)[0];
  return {
    ...(drill ? { drill } : {}),
    ...(Number.isFinite(insight.pointsPerRound)
      ? { payoffPointsPerRound: Math.abs(round2(insight.pointsPerRound)) }
      : {}),
  };
}
```

In `buildPracticePlan`, spread the extras into each of the three returned items — for the first item add `...practiceExtras(first),` after the `sourceInsightId` spread, and likewise `...practiceExtras(secondary),` and `...practiceExtras(cue),` in the other two items.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/store/__tests__/coachInsights.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/coachInsights.js src/store/__tests__/coachInsights.test.js
git commit -m "feat(coach): practice plan items carry matched drills and points payoff"
```

---

### Task 5: Strategy rules — `coachStrategy.js`

**Files:**
- Create: `src/store/coachStrategy.js`
- Test: `src/store/__tests__/coachStrategy.test.js` (create)

**Interfaces:**
- Consumes (all already on the stats object built by `computeMyStats`, plus Task 6 adds `driveLies`):
  - `stats.approachTarget.buckets[bucket] → { holes, avgSg }`
  - `stats.puttingTarget.buckets['6+'] → { attempts, sgPerPutt, threePuttRate }` (threePuttRate is a 0-100 integer)
  - `stats.strokesGained.byCategory.offTheTee`, `stats.strokesGained.roundsByCategory.{approach,putting}`
  - `stats.driveImpact.buckets.{left,right,fairway} → { holes, avgPoints }`
  - `stats.upAndDown.byLie.{sand,nonSand} → { attempts, conversions, rate }` (rate 0-1 or null)
  - `stats.bunkerVisits.avgPerRound`, `stats.driveLies` (Task 1 shape), `stats.roundCount`
- Produces (used by Tasks 6, 10):

```js
buildStrategyTips(stats) → Tip[]   // 0-5 tips, sorted by payoffPointsPerRound desc
Tip = { id, title, reason, payoffPointsPerRound, sample, basis }
```

Exactly the five spec'd rules; every threshold below is binding.

- [ ] **Step 1: Write the failing tests**

Create `src/store/__tests__/coachStrategy.test.js`:

```js
import { buildStrategyTips } from '../coachStrategy';

describe('buildStrategyTips', () => {
  test('empty stats produce no tips', () => {
    expect(buildStrategyTips({})).toEqual([]);
    expect(buildStrategyTips(null)).toEqual([]);
  });

  test('lay-up rule fires when long approaches leak and short ones hold', () => {
    const stats = {
      approachTarget: { buckets: {
        '150-200': { holes: 10, avgSg: -0.4 },
        '50-100': { holes: 9, avgSg: 0.0 },
      } },
      strokesGained: { roundsByCategory: { approach: 5 } },
    };
    const tips = buildStrategyTips(stats);
    const tip = tips.find((t) => t.id === 'layup-150-200');
    expect(tip).toBeDefined();
    // (0.0 - (-0.4)) * (10 holes / 5 rounds) = 0.8 pts/round
    expect(tip.payoffPointsPerRound).toBeCloseTo(0.8, 2);
    expect(tip.sample).toBe(19);
  });
  test('lay-up rule suppressed under sample thresholds', () => {
    const stats = {
      approachTarget: { buckets: {
        '150-200': { holes: 7, avgSg: -0.4 },
        '50-100': { holes: 9, avgSg: 0.0 },
      } },
      strokesGained: { roundsByCategory: { approach: 5 } },
    };
    expect(buildStrategyTips(stats).find((t) => t.id === 'layup-150-200')).toBeUndefined();
  });

  test('club-down rule fires on high trouble rate + tee SG leak', () => {
    const stats = {
      driveLies: { drives: 20, byLie: { fairway: 8, rough: 6, sand: 3, trouble: 3 }, troubleRate: 0.3 },
      strokesGained: { byCategory: { offTheTee: -0.6 }, roundsByCategory: {} },
    };
    const tip = buildStrategyTips(stats).find((t) => t.id === 'tee-club-down');
    expect(tip).toBeDefined();
    // |−0.6| × 0.5 = 0.3
    expect(tip.payoffPointsPerRound).toBeCloseTo(0.3, 2);
  });

  test('3-putt rule fires on lag trouble', () => {
    const stats = {
      puttingTarget: { buckets: { '6+': { attempts: 12, sgPerPutt: -0.3, threePuttRate: 33 } } },
      strokesGained: { roundsByCategory: { putting: 6 } },
    };
    const tip = buildStrategyTips(stats).find((t) => t.id === 'lag-first-6plus');
    expect(tip).toBeDefined();
    // 0.3 × 12 / 6 = 0.6
    expect(tip.payoffPointsPerRound).toBeCloseTo(0.6, 2);
  });

  test('trouble-side rule fires on a dominant miss side', () => {
    const stats = {
      roundCount: 5,
      driveImpact: { buckets: {
        left: { holes: 12, avgPoints: 1.2 },
        right: { holes: 3, avgPoints: 1.8 },
        fairway: { holes: 20, avgPoints: 2.1 },
      } },
    };
    const tip = buildStrategyTips(stats).find((t) => t.id === 'tee-miss-side');
    expect(tip).toBeDefined();
    expect(tip.title).toContain('left');
    // (2.1 − 1.2) × (12 / 5) = 2.16
    expect(tip.payoffPointsPerRound).toBeCloseTo(2.16, 2);
  });

  test('bunker rule fires when sand conversion trails non-sand', () => {
    const stats = {
      upAndDown: { byLie: {
        sand: { attempts: 8, conversions: 1, rate: 0.125 },
        nonSand: { attempts: 12, conversions: 6, rate: 0.5 },
      } },
      bunkerVisits: { avgPerRound: 2.4 },
    };
    const tip = buildStrategyTips(stats).find((t) => t.id === 'avoid-short-side-sand');
    expect(tip).toBeDefined();
    // (0.5 − 0.125) × 2.4 = 0.9
    expect(tip.payoffPointsPerRound).toBeCloseTo(0.9, 2);
  });

  test('tips sorted by payoff descending, max 5', () => {
    const stats = {
      roundCount: 5,
      approachTarget: { buckets: { '150-200': { holes: 10, avgSg: -0.4 }, '50-100': { holes: 9, avgSg: 0.0 } } },
      driveLies: { drives: 20, byLie: { fairway: 8, rough: 6, sand: 3, trouble: 3 }, troubleRate: 0.3 },
      puttingTarget: { buckets: { '6+': { attempts: 12, sgPerPutt: -0.3, threePuttRate: 33 } } },
      driveImpact: { buckets: { left: { holes: 12, avgPoints: 1.2 }, right: { holes: 3, avgPoints: 1.8 }, fairway: { holes: 20, avgPoints: 2.1 } } },
      upAndDown: { byLie: { sand: { attempts: 8, conversions: 1, rate: 0.125 }, nonSand: { attempts: 12, conversions: 6, rate: 0.5 } } },
      strokesGained: { byCategory: { offTheTee: -0.6 }, roundsByCategory: { approach: 5, putting: 6 } },
      bunkerVisits: { avgPerRound: 2.4 },
    };
    const tips = buildStrategyTips(stats);
    expect(tips).toHaveLength(5);
    for (let i = 1; i < tips.length; i += 1) {
      expect(tips[i - 1].payoffPointsPerRound).toBeGreaterThanOrEqual(tips[i].payoffPointsPerRound);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/store/__tests__/coachStrategy.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/store/coachStrategy.js`:

```js
// On-course strategy tips (spec §2.3): exactly five deterministic rules,
// each firing only when its data threshold is met, each quantified from the
// player's own numbers in ≈ Stableford points per round (1 SG ≈ 1 pt).

const round2 = (n) => Math.round(n * 100) / 100;

function layUpRule(stats) {
  const long = stats.approachTarget?.buckets?.['150-200'];
  const short = stats.approachTarget?.buckets?.['50-100'];
  const rounds = stats.strokesGained?.roundsByCategory?.approach ?? 0;
  if (!long || !short || rounds <= 0) return null;
  if (long.holes < 8 || short.holes < 8) return null;
  if (!(long.avgSg <= -0.25 && short.avgSg >= long.avgSg + 0.3)) return null;
  const payoff = (short.avgSg - long.avgSg) * (long.holes / rounds);
  return {
    id: 'layup-150-200',
    title: 'Lay up from 150-200 m',
    reason: `From 150-200 m you average ${long.avgSg} SG per shot, but from 50-100 m you average ${short.avgSg}. Laying up to wedge range turns your worst distance into one of your best.`,
    payoffPointsPerRound: round2(payoff),
    sample: long.holes + short.holes,
    basis: 'your approach buckets',
  };
}

function clubDownRule(stats) {
  const lies = stats.driveLies;
  const teeSg = stats.strokesGained?.byCategory?.offTheTee;
  if (!lies || lies.drives < 15 || lies.troubleRate == null) return null;
  if (!(lies.troubleRate >= 0.25 && Number.isFinite(teeSg) && teeSg <= -0.3)) return null;
  // Assume clubbing down rescues about half the tee leak — stated approximation.
  const payoff = Math.abs(teeSg) * 0.5;
  return {
    id: 'tee-club-down',
    title: 'Club down on tight tee shots',
    reason: `${Math.round(lies.troubleRate * 100)}% of your tracked drives finish in sand or trouble, and the tee game costs ${round2(teeSg)} SG per round. A 3-wood that stays dry keeps roughly half of that.`,
    payoffPointsPerRound: round2(payoff),
    sample: lies.drives,
    basis: 'your drive lies',
  };
}

function lagFirstRule(stats) {
  const lag = stats.puttingTarget?.buckets?.['6+'];
  const rounds = stats.strokesGained?.roundsByCategory?.putting ?? 0;
  if (!lag || lag.attempts < 10 || rounds <= 0) return null;
  if (!(lag.threePuttRate >= 25 && Number.isFinite(lag.sgPerPutt) && lag.sgPerPutt < 0)) return null;
  const payoff = Math.abs(lag.sgPerPutt) * (lag.attempts / rounds);
  return {
    id: 'lag-first-6plus',
    title: 'Lag first from 6+ m',
    reason: `You three-putt ${lag.threePuttRate}% of putts from 6+ m. From that range the only goal is a tap-in: pick a 1 m circle, not the hole.`,
    payoffPointsPerRound: round2(payoff),
    sample: lag.attempts,
    basis: 'your long putts',
  };
}

function missSideRule(stats) {
  const buckets = stats.driveImpact?.buckets;
  const roundCount = stats.roundCount ?? 0;
  if (!buckets || roundCount <= 0) return null;
  const left = buckets.left ?? { holes: 0, avgPoints: 0 };
  const right = buckets.right ?? { holes: 0, avgPoints: 0 };
  const fairway = buckets.fairway;
  const missTotal = left.holes + right.holes;
  if (missTotal < 10 || !fairway || fairway.holes < 8) return null;
  const dominant = left.holes >= right.holes ? { side: 'left', ...left } : { side: 'right', ...right };
  const other = dominant.side === 'left' ? right : left;
  if (dominant.holes < 2 * Math.max(1, other.holes)) return null;
  const perHoleCost = Math.max(0, fairway.avgPoints - dominant.avgPoints);
  if (perHoleCost <= 0) return null;
  const payoff = perHoleCost * (dominant.holes / roundCount);
  return {
    id: 'tee-miss-side',
    title: `Guard the ${dominant.side} miss`,
    reason: `${dominant.holes} of your ${missTotal} tracked misses go ${dominant.side}, costing ${round2(perHoleCost)} pts per hole versus a fairway hit. Aim at the ${dominant.side === 'left' ? 'right' : 'left'} half of the fairway and let the miss find the middle.`,
    payoffPointsPerRound: round2(payoff),
    sample: missTotal,
    basis: 'your miss pattern',
  };
}

function avoidSandRule(stats) {
  const sand = stats.upAndDown?.byLie?.sand;
  const nonSand = stats.upAndDown?.byLie?.nonSand;
  const visits = stats.bunkerVisits?.avgPerRound ?? 0;
  if (!sand || !nonSand || sand.attempts < 6 || nonSand.attempts < 6) return null;
  if (sand.rate == null || nonSand.rate == null) return null;
  if (!(sand.rate <= nonSand.rate - 0.2 && visits > 0)) return null;
  const payoff = (nonSand.rate - sand.rate) * visits;
  return {
    id: 'avoid-short-side-sand',
    title: 'Take bunkers out of play',
    reason: `You convert ${Math.round(nonSand.rate * 100)}% of up-and-downs from grass but only ${Math.round(sand.rate * 100)}% from sand, and you visit ${visits} bunkers per round. Aim to the fat side of the green — long or wide beats short-sided sand.`,
    payoffPointsPerRound: round2(payoff),
    sample: sand.attempts + nonSand.attempts,
    basis: 'your up-and-down split',
  };
}

const RULES = [layUpRule, clubDownRule, lagFirstRule, missSideRule, avoidSandRule];

export function buildStrategyTips(stats) {
  if (!stats) return [];
  return RULES
    .map((rule) => rule(stats))
    .filter(Boolean)
    .sort((a, b) => b.payoffPointsPerRound - a.payoffPointsPerRound);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/store/__tests__/coachStrategy.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/coachStrategy.js src/store/__tests__/coachStrategy.test.js
git commit -m "feat(coach): five quantified on-course strategy rules"
```

---

### Task 6: Wire `driveLies` + strategy tips into `computeMyStats`

**Files:**
- Modify: `src/store/personalStats.js`
- Test: `src/store/__tests__/personalStats.test.js`

**Interfaces:**
- Consumes: `driveLieBreakdown` (Task 1, from `./statsEngine`), `buildStrategyTips` (Task 5, from `./coachStrategy`).
- Produces: `computeMyStats(...)` gains `driveLies` (Task 1 shape) and `coachStrategy` (Tip[]) on the full (non-baselineOnly) result. `coachStrategy` is computed from `baseStats` AFTER `driveLies` is on it.

- [ ] **Step 1: Write the failing test**

Append to `src/store/__tests__/personalStats.test.js` (reuse the `puttingRound(putts)` helper added in Phase 1's Task 6 — it builds an 18-hole MyRound with putt data):

```js
describe('computeMyStats coach strategy wiring', () => {
  test('driveLies and coachStrategy ride on the stats object', () => {
    const rounds = [puttingRound(2), puttingRound(2), puttingRound(2), puttingRound(2)];
    const stats = computeMyStats(rounds, { n: 1, targetHandicap: 0 });
    expect(stats.driveLies).toEqual({ drives: 0, byLie: { fairway: 0, rough: 0, sand: 0, trouble: 0 }, troubleRate: null });
    expect(Array.isArray(stats.coachStrategy)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/store/__tests__/personalStats.test.js -t "coach strategy wiring"`
Expected: FAIL — `stats.driveLies` undefined.

- [ ] **Step 3: Implement**

In `personalStats.js`:
- Extend the statsEngine import with `driveLieBreakdown`.
- Add `import { buildStrategyTips } from './coachStrategy';` next to the `buildCoachInsights` import.
- In `computeMyStats`, add to the `baseStats` object (near the other Phase A/B entries):

```js
    driveLies: driveLieBreakdown(synthetic.rounds, CANON_ID),
```

- Change the final return to also attach strategy tips:

```js
  return {
    ...baseStats,
    coach: buildCoachInsights(baseStats),
    coachStrategy: buildStrategyTips(baseStats),
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/store/__tests__/personalStats.test.js src/store/__tests__/coachInsights.test.js src/store/__tests__/coachStrategy.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/personalStats.js src/store/__tests__/personalStats.test.js
git commit -m "feat(coach): stats carry drive lies and strategy tips"
```

---

### Task 7: Committed focus — `coachFocus.js`

**Files:**
- Create: `src/store/coachFocus.js`
- Test: `src/store/__tests__/coachFocus.test.js` (create)

**Interfaces:**
- Consumes: `stats.roundCount`, `stats.coach` (hero + board groups of insights with `id`/`impact`/`metric`); AsyncStorage.
- Produces (used by Tasks 9, 11):

```js
makeFocusCommit(insight, stats, committedAt?) → Focus | null
Focus = { insightId, area, areaLabel, title, metric, baselineImpact, committedAt, roundCountAtCommit }

focusVerdict(focus, stats) → {
  state: 'needs-more-rounds'|'improving'|'flat'|'worse'|'resolved',
  roundsSince, baseline, current, currentMetric, delta?, roundsNeeded?
} | null

loadFocus(userId) → Promise<Focus|null>
saveFocus(userId, focus) → Promise<void>
clearFocus(userId) → Promise<void>
loadFocusHistory(userId) → Promise<Entry[]>
archiveFocus(userId, focus, verdict) → Promise<Entry[]>   // prepends, caps 10, clears active focus
```

Verdict rules (binding): fewer than 2 rounds since commit → `needs-more-rounds`; insight id no longer anywhere on the board/hero → `resolved`; else `delta = current.impact − baselineImpact`, threshold `max(0.1·|baseline|, 0.05)`, `improving` when `delta ≥ threshold`, `worse` when `delta ≤ −threshold`, else `flat`. (Insight impacts are universally higher-is-better: leaks are negative.)

- [ ] **Step 1: Write the failing tests**

Create `src/store/__tests__/coachFocus.test.js`:

```js
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  return {
    getItem: jest.fn((k) => Promise.resolve(store.has(k) ? store.get(k) : null)),
    setItem: jest.fn((k, v) => { store.set(k, v); return Promise.resolve(); }),
    removeItem: jest.fn((k) => { store.delete(k); return Promise.resolve(); }),
    __store: store,
  };
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  makeFocusCommit, focusVerdict,
  loadFocus, saveFocus, clearFocus, loadFocusHistory, archiveFocus,
} from '../coachFocus';

const insight = {
  id: 'putting:putting', area: 'putting', areaLabel: 'Putting',
  title: 'Putting', metric: '-1.8 SG / round', impact: -1.8,
};

function statsWith(roundCount, currentImpact) {
  return {
    roundCount,
    coach: {
      hero: null,
      board: {
        fixFirst: currentImpact == null ? [] : [{ ...insight, impact: currentImpact, metric: `${currentImpact} SG / round` }],
        keepDoing: [], gettingBetter: [], gettingWorse: [], nextGains: [], watch: [],
      },
    },
  };
}

describe('makeFocusCommit', () => {
  test('captures baseline and round count', () => {
    const focus = makeFocusCommit(insight, { roundCount: 8 }, '2026-07-15T00:00:00Z');
    expect(focus).toEqual({
      insightId: 'putting:putting', area: 'putting', areaLabel: 'Putting',
      title: 'Putting', metric: '-1.8 SG / round', baselineImpact: -1.8,
      committedAt: '2026-07-15T00:00:00Z', roundCountAtCommit: 8,
    });
    expect(makeFocusCommit(null, { roundCount: 8 })).toBeNull();
  });
});

describe('focusVerdict', () => {
  const focus = makeFocusCommit(insight, { roundCount: 8 }, '2026-07-15T00:00:00Z');

  test('needs-more-rounds under 2 post-commit rounds', () => {
    const v = focusVerdict(focus, statsWith(9, -1.8));
    expect(v.state).toBe('needs-more-rounds');
    expect(v.roundsSince).toBe(1);
    expect(v.roundsNeeded).toBe(1);
  });
  test('improving when impact recovers past the threshold', () => {
    const v = focusVerdict(focus, statsWith(10, -1.3));
    expect(v.state).toBe('improving');
    expect(v.delta).toBeCloseTo(0.5, 10);
  });
  test('worse when impact deteriorates past the threshold', () => {
    expect(focusVerdict(focus, statsWith(10, -2.4)).state).toBe('worse');
  });
  test('flat inside the threshold band', () => {
    expect(focusVerdict(focus, statsWith(10, -1.75)).state).toBe('flat');
  });
  test('resolved when the insight left the board', () => {
    expect(focusVerdict(focus, statsWith(10, null)).state).toBe('resolved');
  });
  test('roundsSince clamps at 0 when rounds were deselected', () => {
    expect(focusVerdict(focus, statsWith(5, -1.8)).roundsSince).toBe(0);
  });
  test('null without a focus', () => {
    expect(focusVerdict(null, statsWith(10, -1.8))).toBeNull();
  });
});

describe('persistence', () => {
  beforeEach(() => AsyncStorage.__store.clear());

  test('save/load/clear round-trip per user', async () => {
    const focus = makeFocusCommit(insight, { roundCount: 8 }, '2026-07-15T00:00:00Z');
    await saveFocus('u1', focus);
    expect(await loadFocus('u1')).toEqual(focus);
    expect(await loadFocus('u2')).toBeNull();
    await clearFocus('u1');
    expect(await loadFocus('u1')).toBeNull();
  });
  test('archive prepends history, caps at 10, clears active focus', async () => {
    const focus = makeFocusCommit(insight, { roundCount: 8 }, '2026-07-15T00:00:00Z');
    for (let i = 0; i < 12; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await saveFocus('u1', { ...focus, title: `Focus ${i}` });
      // eslint-disable-next-line no-await-in-loop
      await archiveFocus('u1', { ...focus, title: `Focus ${i}` }, { state: 'improving', current: -1.2 });
    }
    const history = await loadFocusHistory('u1');
    expect(history).toHaveLength(10);
    expect(history[0].title).toBe('Focus 11');
    expect(history[0].finalState).toBe('improving');
    expect(history[0].finalImpact).toBe(-1.2);
    expect(await loadFocus('u1')).toBeNull();
  });
  test('corrupt storage degrades to null/empty', async () => {
    await AsyncStorage.setItem('@mystats_coach_focus:u1', 'not json');
    await AsyncStorage.setItem('@mystats_coach_focus_history:u1', 'not json');
    expect(await loadFocus('u1')).toBeNull();
    expect(await loadFocusHistory('u1')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/store/__tests__/coachFocus.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/store/coachFocus.js`:

```js
// Committed coach focus (spec §2.2): one focus at a time, device-local,
// verdicted deterministically against the same stats pipeline that
// produced the insight. Pure logic first; AsyncStorage adapters below.
import AsyncStorage from '@react-native-async-storage/async-storage';

const FOCUS_PREFIX = '@mystats_coach_focus:';
const HISTORY_PREFIX = '@mystats_coach_focus_history:';
const HISTORY_MAX = 10;
const MIN_VERDICT_ROUNDS = 2;

export function makeFocusCommit(insight, stats, committedAt) {
  if (!insight?.id) return null;
  return {
    insightId: insight.id,
    area: insight.area,
    areaLabel: insight.areaLabel ?? insight.area,
    title: insight.title,
    metric: insight.metric ?? null,
    baselineImpact: Number.isFinite(insight.impact) ? insight.impact : null,
    committedAt: committedAt ?? new Date().toISOString(),
    roundCountAtCommit: stats?.roundCount ?? 0,
  };
}

function findInsightById(coach, id) {
  if (!coach) return null;
  if (coach.hero?.id === id) return coach.hero;
  const groups = coach.board ?? {};
  const keys = Object.keys(groups);
  for (let i = 0; i < keys.length; i += 1) {
    const found = (groups[keys[i]] ?? []).find((insight) => insight.id === id);
    if (found) return found;
  }
  return null;
}

// Verdicts are relative to the committed baseline. Insight impacts are
// universally higher-is-better (leaks negative), so a positive delta is
// improvement regardless of the insight's unit.
export function focusVerdict(focus, stats) {
  if (!focus) return null;
  const roundsSince = Math.max(0, (stats?.roundCount ?? 0) - (focus.roundCountAtCommit ?? 0));
  const current = findInsightById(stats?.coach, focus.insightId);
  const base = {
    roundsSince,
    baseline: focus.baselineImpact,
    current: Number.isFinite(current?.impact) ? current.impact : null,
    currentMetric: current?.metric ?? null,
  };
  if (roundsSince < MIN_VERDICT_ROUNDS) {
    return { ...base, state: 'needs-more-rounds', roundsNeeded: MIN_VERDICT_ROUNDS - roundsSince };
  }
  if (base.current == null || !Number.isFinite(focus.baselineImpact)) {
    return { ...base, state: 'resolved' };
  }
  const threshold = Math.max(Math.abs(focus.baselineImpact) * 0.1, 0.05);
  const delta = base.current - focus.baselineImpact;
  const state = delta >= threshold ? 'improving' : delta <= -threshold ? 'worse' : 'flat';
  return { ...base, state, delta };
}

const focusKey = (userId) => `${FOCUS_PREFIX}${userId ?? 'anon'}`;
const historyKey = (userId) => `${HISTORY_PREFIX}${userId ?? 'anon'}`;

async function readJson(key, fallback) {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

export function loadFocus(userId) {
  return readJson(focusKey(userId), null);
}

export function saveFocus(userId, focus) {
  return AsyncStorage.setItem(focusKey(userId), JSON.stringify(focus));
}

export function clearFocus(userId) {
  return AsyncStorage.removeItem(focusKey(userId));
}

export function loadFocusHistory(userId) {
  return readJson(historyKey(userId), []);
}

// Prepends the ended focus (with its final verdict) to a capped history and
// clears the active slot.
export async function archiveFocus(userId, focus, verdict) {
  const history = await loadFocusHistory(userId);
  const entry = {
    ...focus,
    endedAt: new Date().toISOString(),
    finalState: verdict?.state ?? 'unknown',
    finalImpact: verdict?.current ?? null,
  };
  const next = [entry, ...history].slice(0, HISTORY_MAX);
  await AsyncStorage.setItem(historyKey(userId), JSON.stringify(next));
  await clearFocus(userId);
  return next;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/store/__tests__/coachFocus.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/coachFocus.js src/store/__tests__/coachFocus.test.js
git commit -m "feat(coach): committed focus with deterministic verdicts and history"
```

---

### Task 8: PracticePlanCard renders drills and payoff

**Files:**
- Modify: `src/components/mystats/PracticePlanCard.js`
- Test: `src/components/mystats/__tests__/PracticePlanCard.test.js` (create)

**Interfaces:**
- Consumes: plan items now optionally carrying `drill` (`{ title, instruction, passTarget, location }`) and `payoffPointsPerRound` (Task 4).
- Produces: `PracticePlanCard({ plan, onInfo })` — add optional `onInfo` and pass `infoKey="coachPractice"` to its SectionCard. Rendering: when `item.drill` exists, show the drill title + instruction + a `Pass: <passTarget>` line + location chip (replacing the generic instruction); when `payoffPointsPerRound` exists, show `worth ≈ X pts / round`.

- [ ] **Step 1: Write the failing tests**

Create `src/components/mystats/__tests__/PracticePlanCard.test.js` (copy the ThemeContext jest.mock block verbatim from `src/components/mystats/__tests__/ShotDashboard.test.js`, top of file):

```js
import React from 'react';
import { render } from '@testing-library/react-native';
import PracticePlanCard from '../PracticePlanCard';

// <ThemeContext mock block here — copied verbatim>

const plan = [
  {
    id: 'practice-first', role: 'practiceFirst', title: 'Practice first: Putting',
    instruction: 'Spend the first block on putting.', reason: 'Putting is costing 1.8 SG / round.',
    sourceInsightId: 'putting:putting',
    drill: { id: 'putt-lag-ladder', title: 'Lag ladder', instruction: 'Take 10 putts from 8 m…', passTarget: '7 of 10 finish inside 1 m of the hole', location: 'green' },
    payoffPointsPerRound: 1.8,
  },
  {
    id: 'secondary-focus', role: 'secondaryFocus', title: 'Secondary focus',
    instruction: 'Review the strongest recent form trend.', reason: 'Balance.',
  },
];

describe('PracticePlanCard drills', () => {
  test('renders drill title, pass target, location and payoff', () => {
    const r = render(<PracticePlanCard plan={plan} />);
    expect(r.getByText('Lag ladder')).toBeTruthy();
    expect(r.getByText('Pass: 7 of 10 finish inside 1 m of the hole')).toBeTruthy();
    expect(r.getByText('green')).toBeTruthy();
    expect(r.getByText('worth ≈ 1.8 pts / round')).toBeTruthy();
  });
  test('items without a drill render as before', () => {
    const r = render(<PracticePlanCard plan={plan} />);
    expect(r.getByText('Review the strongest recent form trend.')).toBeTruthy();
    expect(r.queryAllByText(/Pass:/)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/components/mystats/__tests__/PracticePlanCard.test.js`
Expected: FAIL — 'Lag ladder' not found.

- [ ] **Step 3: Implement**

In `PracticePlanCard.js`, change the signature to `PracticePlanCard({ plan, onInfo })`, pass `infoKey="coachPractice"` and `onInfo={onInfo}` to `SectionCard`, and replace the item body with:

```js
        <View key={item.id ?? item.role} style={s.item}>
          <Text style={s.role}>{ROLE_LABELS[item.role] ?? 'Practice'}</Text>
          <Text style={s.title}>{item.title}</Text>
          {item.drill ? (
            <View style={s.drillBlock}>
              <View style={s.drillHead}>
                <Text style={s.drillTitle}>{item.drill.title}</Text>
                <Text style={s.drillLocation}>{item.drill.location}</Text>
              </View>
              <Text style={s.instruction}>{item.drill.instruction}</Text>
              <Text style={s.passTarget}>{`Pass: ${item.drill.passTarget}`}</Text>
            </View>
          ) : (
            item.instruction ? <Text style={s.instruction}>{item.instruction}</Text> : null
          )}
          {Number.isFinite(item.payoffPointsPerRound) ? (
            <Text style={s.payoff}>{`worth ≈ ${item.payoffPointsPerRound} pts / round`}</Text>
          ) : null}
          {item.reason ? <Text style={s.reason}>{item.reason}</Text> : null}
        </View>
```

New styles in `makeStyles`:

```js
    drillBlock: { gap: 2, marginTop: 2 },
    drillHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: theme.spacing.sm },
    drillTitle: { ...theme.typography.body, color: theme.text.primary, fontWeight: '800' },
    drillLocation: { ...theme.typography.tiny, color: theme.text.muted, textTransform: 'uppercase', fontWeight: '800' },
    passTarget: { ...theme.typography.caption, color: theme.accent.primary, fontWeight: '700' },
    payoff: { ...theme.typography.caption, color: theme.text.secondary, fontWeight: '800' },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/components/mystats/__tests__/`
Expected: PASS (new file + all pre-existing, including `CoachComponents.test.js`).

- [ ] **Step 5: Commit**

```bash
git add src/components/mystats/
git commit -m "feat(coach-ui): practice plan shows real drills, pass targets and payoff"
```

---

### Task 9: Focus commit button + FocusCard

**Files:**
- Modify: `src/components/mystats/CoachHero.js`
- Create: `src/components/mystats/FocusCard.js`
- Test: `src/components/mystats/__tests__/FocusCard.test.js` (create)

**Interfaces:**
- Consumes: `focusVerdict` result shape and `Focus` shape (Task 7); `drillsForInsight` (Task 2).
- Produces:
  - `CoachHero({ insight, onCommitFocus, focusActive })` — renders a "Make this my focus" button (accessibilityLabel `Make this my focus`) only when `onCommitFocus` is provided, `insight` exists, and `focusActive` is false. Pressing calls `onCommitFocus(insight)`.
  - `FocusCard({ focus, verdict, onEndFocus })` (default export, new file) — renders null without `focus`; shows area label + title, committed metric, verdict line per state, the first matched drill (`drillsForInsight({ area: focus.area, title: focus.title })[0]`), and an "End focus" button (accessibilityLabel `End focus`) calling `onEndFocus`.

Verdict copy (binding strings, used by tests):
- `needs-more-rounds`: `Play ${roundsNeeded} more round${roundsNeeded === 1 ? '' : 's'} for a verdict`
- `improving`: `Improving since you committed`
- `flat`: `Holding steady since you committed`
- `worse`: `Getting worse since you committed`
- `resolved`: `No longer flagged — nice work`

- [ ] **Step 1: Write the failing tests**

Create `src/components/mystats/__tests__/FocusCard.test.js` (ThemeContext mock block as in Task 8):

```js
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import FocusCard from '../FocusCard';
import CoachHero from '../CoachHero';

// <ThemeContext mock block here — copied verbatim>

const focus = {
  insightId: 'putting:putting', area: 'putting', areaLabel: 'Putting',
  title: '6+ m putts', metric: '-1.8 SG / round', baselineImpact: -1.8,
  committedAt: '2026-07-15T00:00:00Z', roundCountAtCommit: 8,
};

describe('FocusCard', () => {
  test('renders verdict copy and matched drill', () => {
    const r = render(
      <FocusCard
        focus={focus}
        verdict={{ state: 'improving', roundsSince: 3, baseline: -1.8, current: -1.1, currentMetric: '-1.1 SG / round', delta: 0.7 }}
        onEndFocus={jest.fn()}
      />,
    );
    expect(r.getByText('6+ m putts')).toBeTruthy();
    expect(r.getByText('Improving since you committed')).toBeTruthy();
    expect(r.getByText('-1.8 SG / round → -1.1 SG / round')).toBeTruthy();
    expect(r.getByText('Lag ladder')).toBeTruthy(); // bucket-matched drill
  });
  test('needs-more-rounds copy', () => {
    const r = render(
      <FocusCard focus={focus} verdict={{ state: 'needs-more-rounds', roundsSince: 1, roundsNeeded: 1, baseline: -1.8, current: null, currentMetric: null }} onEndFocus={jest.fn()} />,
    );
    expect(r.getByText('Play 1 more round for a verdict')).toBeTruthy();
  });
  test('end focus fires', () => {
    const onEnd = jest.fn();
    const r = render(<FocusCard focus={focus} verdict={null} onEndFocus={onEnd} />);
    fireEvent.press(r.getByLabelText('End focus'));
    expect(onEnd).toHaveBeenCalled();
  });
  test('null without focus', () => {
    expect(render(<FocusCard focus={null} verdict={null} onEndFocus={jest.fn()} />).toJSON()).toBeNull();
  });
});

describe('CoachHero focus button', () => {
  const insight = { id: 'putting:putting', group: 'fixFirst', area: 'putting', areaLabel: 'Putting', title: '6+ m putts', reason: 'r', metric: '-1.8 SG / round', impact: -1.8, tone: 'bad' };
  test('button commits the insight', () => {
    const onCommit = jest.fn();
    const r = render(<CoachHero insight={insight} onCommitFocus={onCommit} focusActive={false} />);
    fireEvent.press(r.getByLabelText('Make this my focus'));
    expect(onCommit).toHaveBeenCalledWith(insight);
  });
  test('hidden while a focus is active or without handler', () => {
    const withFocus = render(<CoachHero insight={insight} onCommitFocus={jest.fn()} focusActive />);
    expect(withFocus.queryByLabelText('Make this my focus')).toBeNull();
    const noHandler = render(<CoachHero insight={insight} />);
    expect(noHandler.queryByLabelText('Make this my focus')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/components/mystats/__tests__/FocusCard.test.js`
Expected: FAIL — FocusCard module not found.

- [ ] **Step 3: Implement FocusCard**

Create `src/components/mystats/FocusCard.js`:

```js
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import SectionCard from './SectionCard';
import { drillsForInsight } from '../../store/coachDrills';

const VERDICT_COPY = {
  improving: { icon: 'trending-up', text: 'Improving since you committed', tone: 'good' },
  flat: { icon: 'minus', text: 'Holding steady since you committed', tone: 'neutral' },
  worse: { icon: 'trending-down', text: 'Getting worse since you committed', tone: 'bad' },
  resolved: { icon: 'check-circle', text: 'No longer flagged — nice work', tone: 'good' },
};

// The player's committed focus: what they promised to work on, whether the
// numbers actually moved since, and the drill to keep working it.
export default function FocusCard({ focus, verdict, onEndFocus }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  if (!focus) return null;

  const drill = drillsForInsight({ area: focus.area, title: focus.title })[0] ?? null;
  const copy = verdict?.state === 'needs-more-rounds'
    ? {
      icon: 'clock',
      text: `Play ${verdict.roundsNeeded} more round${verdict.roundsNeeded === 1 ? '' : 's'} for a verdict`,
      tone: 'neutral',
    }
    : VERDICT_COPY[verdict?.state] ?? null;
  const toneColor = copy?.tone === 'good' ? theme.scoreColor('good')
    : copy?.tone === 'bad' ? theme.destructive : theme.text.secondary;

  return (
    <SectionCard title="Your Focus">
      <View style={s.head}>
        <View style={s.copy}>
          <Text style={s.area}>{focus.areaLabel ?? focus.area}</Text>
          <Text style={s.title}>{focus.title}</Text>
        </View>
        <TouchableOpacity
          onPress={onEndFocus}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="End focus"
          style={s.endBtn}
        >
          <Text style={s.endBtnText}>End focus</Text>
        </TouchableOpacity>
      </View>
      {copy ? (
        <View style={s.verdictRow}>
          <Feather name={copy.icon} size={15} color={toneColor} />
          <Text style={[s.verdictText, { color: toneColor }]}>{copy.text}</Text>
        </View>
      ) : null}
      {verdict?.currentMetric && focus.metric ? (
        <Text style={s.metricLine}>{`${focus.metric} → ${verdict.currentMetric}`}</Text>
      ) : (
        focus.metric ? <Text style={s.metricLine}>{`Committed at ${focus.metric}`}</Text> : null
      )}
      {drill ? (
        <View style={s.drillBlock}>
          <View style={s.drillHead}>
            <Text style={s.drillTitle}>{drill.title}</Text>
            <Text style={s.drillLocation}>{drill.location}</Text>
          </View>
          <Text style={s.drillInstruction}>{drill.instruction}</Text>
          <Text style={s.passTarget}>{`Pass: ${drill.passTarget}`}</Text>
        </View>
      ) : null}
    </SectionCard>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.spacing.md },
    copy: { flex: 1, minWidth: 0, gap: 2 },
    area: { ...theme.typography.overline, color: theme.accent.primary },
    title: { ...theme.typography.heading, color: theme.text.primary },
    endBtn: {
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 5,
      borderRadius: theme.radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border.default,
    },
    endBtnText: { ...theme.typography.caption, color: theme.text.secondary, fontWeight: '700' },
    verdictRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    verdictText: { ...theme.typography.subhead, fontWeight: '800' },
    metricLine: { ...theme.typography.caption, color: theme.text.secondary },
    drillBlock: {
      gap: 2,
      backgroundColor: theme.bg.secondary,
      borderRadius: theme.radius.sm,
      padding: theme.spacing.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border.subtle,
    },
    drillHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: theme.spacing.sm },
    drillTitle: { ...theme.typography.body, color: theme.text.primary, fontWeight: '800' },
    drillLocation: { ...theme.typography.tiny, color: theme.text.muted, textTransform: 'uppercase', fontWeight: '800' },
    drillInstruction: { ...theme.typography.body, color: theme.text.primary },
    passTarget: { ...theme.typography.caption, color: theme.accent.primary, fontWeight: '700' },
  });
}
```

- [ ] **Step 4: Implement the CoachHero button**

In `CoachHero.js`, change the signature to `CoachHero({ insight, onCommitFocus, focusActive = false })`, import `TouchableOpacity` from `react-native`, and add after the `bottomRow` view (inside the main card, last child):

```js
      {onCommitFocus && insight && !focusActive ? (
        <TouchableOpacity
          onPress={() => onCommitFocus(insight)}
          accessibilityRole="button"
          accessibilityLabel="Make this my focus"
          style={[s.focusBtn, { borderColor: tone.borderColor }]}
          activeOpacity={0.7}
        >
          <Feather name="target" size={14} color={tone.color} />
          <Text style={[s.focusBtnText, { color: tone.color }]}>Make this my focus</Text>
        </TouchableOpacity>
      ) : null}
```

with styles:

```js
    focusBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      marginTop: theme.spacing.xs,
      paddingVertical: theme.spacing.sm,
      borderRadius: theme.radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
    },
    focusBtnText: { ...theme.typography.caption, fontWeight: '800' },
```

- [ ] **Step 5: Run tests**

Run: `npx jest src/components/mystats/__tests__/`
Expected: PASS (new + all pre-existing, incl. `CoachComponents.test.js` — CoachHero renders without the new props unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/components/mystats/
git commit -m "feat(coach-ui): focus commit button and focus card with verdicts"
```

---

### Task 10: PlaySmarterCard + explainer entries

**Files:**
- Create: `src/components/mystats/PlaySmarterCard.js`
- Modify: `src/components/mystats/statExplainers.js`
- Test: `src/components/mystats/__tests__/PlaySmarterCard.test.js` (create)

**Interfaces:**
- Consumes: `Tip[]` from `stats.coachStrategy` (Task 5/6 shapes).
- Produces:
  - `PlaySmarterCard({ tips, onInfo })` (default export) — renders null with no tips; otherwise a SectionCard titled `Play smarter` (`infoKey="playSmarter"`) with one row per tip: title, reason, `≈ +X pts / round` value, and a `basis · N samples` caption.
  - `statExplainers.coachPractice` and `statExplainers.playSmarter` entries (plain objects: `{ title, subtitle, explainer }`).

- [ ] **Step 1: Write the failing tests**

Create `src/components/mystats/__tests__/PlaySmarterCard.test.js` (ThemeContext mock block as in Task 8):

```js
import React from 'react';
import { render } from '@testing-library/react-native';
import PlaySmarterCard from '../PlaySmarterCard';
import { statExplainers } from '../statExplainers';

// <ThemeContext mock block here — copied verbatim>

const tips = [
  { id: 'layup-150-200', title: 'Lay up from 150-200 m', reason: 'Long approaches leak.', payoffPointsPerRound: 0.8, sample: 19, basis: 'your approach buckets' },
  { id: 'lag-first-6plus', title: 'Lag first from 6+ m', reason: 'Three putts.', payoffPointsPerRound: 0.6, sample: 12, basis: 'your long putts' },
];

describe('PlaySmarterCard', () => {
  test('renders a row per tip with payoff and evidence', () => {
    const r = render(<PlaySmarterCard tips={tips} />);
    expect(r.getByText('Play smarter')).toBeTruthy();
    expect(r.getByText('Lay up from 150-200 m')).toBeTruthy();
    expect(r.getByText('≈ +0.8 pts / round')).toBeTruthy();
    expect(r.getByText('your approach buckets · 19 samples')).toBeTruthy();
  });
  test('renders nothing without tips', () => {
    expect(render(<PlaySmarterCard tips={[]} />).toJSON()).toBeNull();
    expect(render(<PlaySmarterCard tips={null} />).toJSON()).toBeNull();
  });
});

describe('coach explainers', () => {
  test('coachPractice and playSmarter entries exist with copy', () => {
    expect(statExplainers.coachPractice.title).toBe('Practice Plan');
    expect(statExplainers.playSmarter.title).toBe('Play Smarter');
    expect(statExplainers.playSmarter.explainer).toContain('1 stroke gained ≈ 1 Stableford point');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/components/mystats/__tests__/PlaySmarterCard.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/components/mystats/PlaySmarterCard.js`:

```js
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import SectionCard from './SectionCard';

// On-course strategy tips — decisions that pay off without practicing.
export default function PlaySmarterCard({ tips, onInfo }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  if (!tips || tips.length === 0) return null;

  return (
    <SectionCard title="Play smarter" infoKey="playSmarter" onInfo={onInfo}>
      {tips.map((tip, index) => (
        <View key={tip.id} style={[s.row, index === 0 && s.rowFirst]}>
          <View style={s.iconWrap}>
            <Feather name="map" size={15} color={theme.accent.primary} />
          </View>
          <View style={s.copy}>
            <Text style={s.title}>{tip.title}</Text>
            <Text style={s.reason}>{tip.reason}</Text>
            <Text style={s.evidence}>{`${tip.basis} · ${tip.sample} samples`}</Text>
          </View>
          <Text style={s.payoff}>{`≈ +${tip.payoffPointsPerRound} pts / round`}</Text>
        </View>
      ))}
    </SectionCard>
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
      borderTopColor: theme.border.subtle,
    },
    rowFirst: { borderTopWidth: 0, paddingTop: 0 },
    iconWrap: {
      width: 30, height: 30, borderRadius: theme.radius.sm,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: theme.accent.light,
    },
    copy: { flex: 1, minWidth: 0, gap: 1 },
    title: { ...theme.typography.body, color: theme.text.primary, fontWeight: '700' },
    reason: { ...theme.typography.caption, color: theme.text.secondary },
    evidence: { ...theme.typography.tiny, color: theme.text.muted },
    payoff: { ...theme.typography.caption, color: theme.scoreColor('good'), fontWeight: '800', maxWidth: 92, textAlign: 'right' },
  });
}
```

In `statExplainers.js`, add two entries to the `statExplainers` object (before the `strokesGained: strokesGainedExplainer,` line):

```js
  coachPractice: {
    title: 'Practice Plan',
    subtitle: 'Drills matched to your biggest leaks',
    explainer: 'Each block pairs your biggest measured leak with a specific drill and a pass '
      + 'target, so a practice session is objectively passed or failed. The "worth" line uses '
      + 'the approximation that 1 stroke gained ≈ 1 Stableford point per round.\n\n'
      + 'The order comes from the Coach board: fix-first leaks get the first block, a second '
      + 'area keeps practice balanced, and the on-course cue needs no range time at all.',
  },
  playSmarter: {
    title: 'Play Smarter',
    subtitle: 'Course decisions worth points without practice',
    explainer: 'These tips come from fixed rules over your own tracked shots — laying up when '
      + 'a distance band leaks, clubbing down when drives find trouble, lagging long putts, '
      + 'guarding a one-sided miss, and avoiding short-side bunkers. A tip only appears once '
      + 'there is enough data behind it, and each shows its payoff using the approximation '
      + 'that 1 stroke gained ≈ 1 Stableford point per round.',
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/components/mystats/__tests__/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/mystats/
git commit -m "feat(coach-ui): play-smarter strategy card and coach explainers"
```

---

### Task 11: CoachTab + MyStatsScreen wiring

**Files:**
- Modify: `src/components/mystats/tabs/CoachTab.js`
- Modify: `src/screens/MyStatsScreen.js`
- Test: `src/components/mystats/__tests__/CoachTab.test.js` (create)

**Interfaces:**
- Consumes: everything above — `stats.coachStrategy`, `coach.practicePlan` (with drills), `FocusCard`, `PlaySmarterCard`, `CoachHero` focus props, and `coachFocus` store functions.
- Produces:
  - `CoachTab({ stats, onInfo, targetHandicap, onChangeTarget, focus, focusVerdict, onCommitFocus, onEndFocus })` — renders `FocusCard` right after the target row when `focus` exists; passes `onCommitFocus`/`focusActive={!!focus}` to `CoachHero`; renders `PlaySmarterCard` between `CoachBoard` and `PracticePlanCard`; passes `onInfo` to `PracticePlanCard` and `PlaySmarterCard`.
  - `MyStatsScreen` owns focus state: loads it per user on mount, computes the verdict, and persists commit/end actions.

- [ ] **Step 1: Write the failing tests**

Create `src/components/mystats/__tests__/CoachTab.test.js` (ThemeContext mock block as in Task 8):

```js
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import CoachTab from '../tabs/CoachTab';

// <ThemeContext mock block here — copied verbatim, path stays '../../../theme/ThemeContext'>

const heroInsight = {
  id: 'putting:putting', group: 'fixFirst', area: 'putting', areaLabel: 'Putting',
  title: 'Putting', reason: 'Putting is costing 1.8 SG / round.', metric: '-1.8 SG / round',
  impact: -1.8, tone: 'bad', confidence: 'high',
};

const stats = {
  metrics: { avgPoints: 30 },
  form: { metrics: [], hasHistory: false },
  formSeries: { metrics: { avgPoints: [] } },
  coach: {
    hero: heroInsight,
    board: { fixFirst: [heroInsight], keepDoing: [], gettingBetter: [], gettingWorse: [], nextGains: [], watch: [] },
    practicePlan: [],
  },
  coachStrategy: [
    { id: 'lag-first-6plus', title: 'Lag first from 6+ m', reason: 'Three putts.', payoffPointsPerRound: 0.6, sample: 12, basis: 'your long putts' },
  ],
};

const focus = {
  insightId: 'putting:putting', area: 'putting', areaLabel: 'Putting', title: 'Putting',
  metric: '-1.8 SG / round', baselineImpact: -1.8, committedAt: '2026-07-15T00:00:00Z', roundCountAtCommit: 8,
};

describe('CoachTab focus + strategy wiring', () => {
  test('no focus: hero shows the commit button, no FocusCard', () => {
    const onCommit = jest.fn();
    const r = render(<CoachTab stats={stats} focus={null} focusVerdict={null} onCommitFocus={onCommit} onEndFocus={jest.fn()} />);
    fireEvent.press(r.getByLabelText('Make this my focus'));
    expect(onCommit).toHaveBeenCalledWith(heroInsight);
    expect(r.queryByText('Your Focus')).toBeNull();
  });
  test('active focus: FocusCard renders, commit button hidden', () => {
    const r = render(
      <CoachTab
        stats={stats}
        focus={focus}
        focusVerdict={{ state: 'needs-more-rounds', roundsSince: 0, roundsNeeded: 2, baseline: -1.8, current: null, currentMetric: null }}
        onCommitFocus={jest.fn()}
        onEndFocus={jest.fn()}
      />,
    );
    expect(r.getByText('Your Focus')).toBeTruthy();
    expect(r.queryByLabelText('Make this my focus')).toBeNull();
  });
  test('strategy tips render', () => {
    const r = render(<CoachTab stats={stats} focus={null} focusVerdict={null} onCommitFocus={jest.fn()} onEndFocus={jest.fn()} />);
    expect(r.getByText('Play smarter')).toBeTruthy();
    expect(r.getByText('Lag first from 6+ m')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/components/mystats/__tests__/CoachTab.test.js`
Expected: FAIL — 'Make this my focus' not found (CoachTab doesn't pass the new props yet).

- [ ] **Step 3: Implement CoachTab**

In `CoachTab.js`: import `FocusCard from '../FocusCard'` and `PlaySmarterCard from '../PlaySmarterCard'`; change the signature to:

```js
export default function CoachTab({ stats, onInfo, targetHandicap, onChangeTarget, focus, focusVerdict, onCommitFocus, onEndFocus }) {
```

and the return to:

```js
  return (
    <View style={s.wrap}>
      <TargetBenchmarkRow targetHandicap={targetHandicap} onChangeTarget={onChangeTarget} />
      {focus ? <FocusCard focus={focus} verdict={focusVerdict} onEndFocus={onEndFocus} /> : null}
      <FormTrendCard form={form} formSeries={formSeries} metrics={metrics} />
      <CoachHero insight={priorityInsight} onCommitFocus={onCommitFocus} focusActive={!!focus} />
      <CoachBoard
        board={coach.board}
        practicePlan={coach.practicePlan}
        excludeInsightIds={priorityInsight?.id ? [priorityInsight.id] : []}
      />
      <PlaySmarterCard tips={stats?.coachStrategy} onInfo={onInfo} />
      <PracticePlanCard plan={coach.practicePlan} onInfo={onInfo} />
    </View>
  );
```

(The existing destructuring `const { metrics = {}, form = {}, formSeries = {}, coach = {} } = stats ?? {};` stays. `onInfo` was already passed by MyStatsScreen but unused — it now feeds the two cards.)

- [ ] **Step 4: Implement MyStatsScreen wiring**

In `MyStatsScreen.js`:

Add the import:

```js
import { loadFocus, saveFocus, clearFocus, archiveFocus, makeFocusCommit, focusVerdict } from '../store/coachFocus';
```

Add state + effect after the `targetHandicap`/`pickerOpen` state block (~line 76):

```js
  const [coachFocus, setCoachFocus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    loadFocus(user?.id).then((focus) => { if (!cancelled) setCoachFocus(focus); }).catch(() => {});
    return () => { cancelled = true; };
  }, [user?.id]);
```

After the `stats` useMemo (~line 209):

```js
  const coachFocusVerdict = useMemo(
    () => (coachFocus && stats ? focusVerdict(coachFocus, stats) : null),
    [coachFocus, stats],
  );

  const onCommitFocus = useCallback((insight) => {
    const focus = makeFocusCommit(insight, stats);
    if (!focus) return;
    setCoachFocus(focus);
    saveFocus(user?.id, focus).catch(() => {});
  }, [stats, user?.id]);

  const onEndFocus = useCallback(() => {
    if (!coachFocus) return;
    const ended = coachFocus;
    const verdict = coachFocusVerdict;
    setCoachFocus(null);
    archiveFocus(user?.id, ended, verdict).catch(() => clearFocus(user?.id).catch(() => {}));
  }, [coachFocus, coachFocusVerdict, user?.id]);
```

And extend the CoachTab render (line ~390):

```js
        {tab === 'coach' && (
          <CoachTab
            stats={stats}
            onInfo={onInfo}
            targetHandicap={targetHandicap}
            onChangeTarget={() => setPickerOpen(true)}
            focus={coachFocus}
            focusVerdict={coachFocusVerdict}
            onCommitFocus={onCommitFocus}
            onEndFocus={onEndFocus}
          />
        )}
```

- [ ] **Step 5: Run tests**

Run: `npx jest src/components/mystats/__tests__/ src/screens/__tests__/ src/store/__tests__/coachFocus.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/mystats/ src/screens/MyStatsScreen.js
git commit -m "feat(coach): focus lifecycle and strategy tips wired into the Coach tab"
```

---

### Task 12: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all suites pass. Failures under `.claude/worktrees/`/`.worktrees/` copies are environment noise — ignore those paths only.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: 0 errors; no new warnings in touched files.

- [ ] **Step 3: Confirm clean tree**

```bash
git status --short
```

Expected: clean. Phase 2 complete.
