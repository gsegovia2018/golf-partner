# Celebration Overlays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Birdie and NOELADA become a non-blocking top toast; eagle, albatross and hole-in-one keep the full-screen takeover — with per-tier hold time and haptic, which removes the fall-through that gave NOELADA the longest hold of any tier and a `success` buzz.

**Architecture:** All presentation policy moves into `CELEBRATION_TIERS` in `constants.js` (`presentation`, `holdMs`, `haptic`). `ScorecardScreen.triggerCelebration` reads the tier instead of branching on the label. `HoleView` picks `CelebrationToast` or `CelebrationOverlay` from `tier.presentation`; both live in their own files.

**Tech Stack:** React Native 0.81 / React 19, Expo SDK 54, `Animated` from `react-native` (native driver), Jest + `@testing-library/react-native`.

## Global Constraints

- Toast surface is `theme.bg.deep` (resolves to `DEEP_GREEN #00553c` in both themes — `tokens.js:20`, `:52`). Never the hardcoded `#003d27`.
- NOELADA is clay `#c9a08f`, never red. Red must be earned.
- Toast is **absolutely positioned** and `pointerEvents="none"` — it must never participate in layout or intercept touches. Pushing content down would shift the steppers under the user's finger mid-tap.
- Every tier declares all of `eyebrow`, `accent`, `glow`, `icon`, `presentation`, `holdMs`, `haptic`. No defaults, no `else` branch.
- All animation uses `useNativeDriver: true`.
- Existing behaviour of `celebrationFor()` and `classifyHoleResult()` is unchanged.
- Run tests with `npx jest <path>`. Lint with `npx eslint <path>` — must be 0 errors.

---

### Task 1: Tier configuration

**Files:**
- Modify: `src/components/scorecard/constants.js:92-123` (`CELEBRATION_TIERS`)
- Test: `src/components/scorecard/__tests__/celebrationTiers.test.js` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `CELEBRATION_TIERS[label]` gains `presentation: 'toast' | 'takeover'`, `holdMs: number`, `haptic: 'light' | 'selection' | 'success'`. Tasks 4 and 5 read these.

- [ ] **Step 1: Write the failing test**

Create `src/components/scorecard/__tests__/celebrationTiers.test.js`:

```javascript
import { CELEBRATION_TIERS, celebrationFor } from '../constants';

const LABELS = ['BIRDIE', 'EAGLE', 'ALBATROSS', 'HOLE IN ONE', 'NOELADA'];

describe('CELEBRATION_TIERS presentation policy', () => {
  it('every tier declares a complete config — no defaults to fall through to', () => {
    for (const label of LABELS) {
      const tier = CELEBRATION_TIERS[label];
      expect(tier).toBeDefined();
      expect(['toast', 'takeover']).toContain(tier.presentation);
      expect(typeof tier.holdMs).toBe('number');
      expect(tier.holdMs).toBeGreaterThan(0);
      expect(['light', 'selection', 'success']).toContain(tier.haptic);
      expect(typeof tier.accent).toBe('string');
      expect(typeof tier.icon).toBe('string');
      expect(typeof tier.eyebrow).toBe('string');
    }
  });

  it('common results toast; rare results take over', () => {
    const toast = LABELS.filter((l) => CELEBRATION_TIERS[l].presentation === 'toast');
    expect(toast.sort()).toEqual(['BIRDIE', 'NOELADA']);
  });

  // Regression: holdMs used to fall through a label chain whose `else` was
  // commented "HOLE IN ONE", so a double bogey held 1800ms — longest of any
  // tier, and twice a birdie.
  it('a bad hole never holds longer than a good one', () => {
    expect(CELEBRATION_TIERS.NOELADA.holdMs).toBeLessThan(CELEBRATION_TIERS.BIRDIE.holdMs);
    expect(CELEBRATION_TIERS.NOELADA.holdMs).toBeLessThan(CELEBRATION_TIERS['HOLE IN ONE'].holdMs);
  });

  // Regression: every celebration fired haptic('success'), including NOELADA.
  it('only good results get the success haptic', () => {
    expect(CELEBRATION_TIERS.NOELADA.haptic).not.toBe('success');
    expect(CELEBRATION_TIERS.EAGLE.haptic).toBe('success');
  });

  it('celebrationFor is unchanged', () => {
    expect(celebrationFor(4, 3)).toBe('BIRDIE');
    expect(celebrationFor(4, 2)).toBe('EAGLE');
    expect(celebrationFor(4, 1)).toBe('HOLE IN ONE');
    expect(celebrationFor(5, 2)).toBe('ALBATROSS');
    expect(celebrationFor(4, 6)).toBe('NOELADA');
    expect(celebrationFor(4, 4)).toBeNull();
    expect(celebrationFor(4, 5)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/scorecard/__tests__/celebrationTiers.test.js`
Expected: FAIL — `expect(['toast','takeover']).toContain(undefined)`, because no tier declares `presentation` yet.

- [ ] **Step 3: Write minimal implementation**

In `src/components/scorecard/constants.js`, replace the whole `CELEBRATION_TIERS` object (currently lines 92-123) with:

```javascript
// Presentation policy per tier, not just colour. `presentation` decides whether
// a result gets the non-blocking top toast (common results, where a takeover
// would interrupt score entry) or the full-screen takeover (rare enough to
// earn it). `holdMs` and `haptic` live here too: they used to be a label chain
// in ScorecardScreen whose final `else` was commented "HOLE IN ONE", so
// NOELADA silently inherited the longest hold of any tier plus a celebratory
// buzz. Declaring all five fields on every tier makes that class of bug
// impossible rather than merely fixed.
export const CELEBRATION_TIERS = {
  BIRDIE: {
    eyebrow: 'A BIRDIE',
    accent: semantic.rank.gold,
    glow: 'rgba(212,175,55,0.35)',
    icon: 'star',
    presentation: 'toast',
    holdMs: 900,
    haptic: 'light',
  },
  EAGLE: {
    eyebrow: 'AN EAGLE',
    accent: semantic.winner.dark, // Augusta gold
    glow: 'rgba(255,215,0,0.45)',
    icon: 'award',
    presentation: 'takeover',
    holdMs: 1200,
    haptic: 'success',
  },
  ALBATROSS: {
    eyebrow: 'AN ALBATROSS',
    accent: '#ffffff',
    glow: 'rgba(255,255,255,0.55)',
    icon: 'star',
    presentation: 'takeover',
    holdMs: 1500,
    haptic: 'success',
  },
  'HOLE IN ONE': {
    eyebrow: 'A HOLE IN ONE',
    accent: semantic.winner.dark,
    glow: 'rgba(255,215,0,0.65)',
    icon: 'target',
    presentation: 'takeover',
    holdMs: 1800,
    haptic: 'success',
  },
  NOELADA: {
    // Muted clay, not red — red is reserved for things the player must act on.
    // A double bogey among friends is a dry aside, not a red alert.
    // The eyebrow is deliberately left as-is: the toast does not render one, so
    // changing the copy would be churn on a string only the fallback path sees.
    eyebrow: 'WHAT A NOELADA!',
    accent: '#c9a08f',
    glow: 'rgba(201,160,143,0.22)',
    icon: 'frown',
    presentation: 'toast',
    holdMs: 600,
    haptic: 'selection',
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/components/scorecard/__tests__/celebrationTiers.test.js`
Expected: PASS, 5 tests.

Then confirm nothing else read the old values:
Run: `npx jest src/components/scorecard/ && npx eslint src/components/scorecard/constants.js`
Expected: all pass, 0 lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/scorecard/constants.js src/components/scorecard/__tests__/celebrationTiers.test.js
git commit -m "feat(scorecard): per-tier presentation, hold and haptic on celebration tiers"
```

---

### Task 2: Extract CelebrationOverlay to its own file

A pure move, no behaviour change. Doing it before the toast exists keeps the diff readable and stops `HoleView.js` (652 lines) growing a third concern.

**Files:**
- Create: `src/components/scorecard/CelebrationOverlay.js`
- Modify: `src/components/scorecard/HoleView.js` — delete the local `CelebrationOverlay` (lines 589-652), add an import

**Interfaces:**
- Consumes: `CELEBRATION_TIERS` from Task 1.
- Produces: `export function CelebrationOverlay({ celebration, celebrationAnim, players })` — Task 4 imports this.

- [ ] **Step 1: Create the new file**

Create `src/components/scorecard/CelebrationOverlay.js` by moving the function verbatim out of `HoleView.js` (lines 589-652), adding the imports it needs:

```javascript
import React, { useMemo } from 'react';
import { View, Text, Animated } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { makeScorecardStyles } from './styles';
import { CELEBRATION_TIERS } from './constants';

// Full-screen takeover for the rare tiers (eagle, albatross, hole-in-one):
// scrim + expanding ring + centred card. Common results use CelebrationToast
// instead — a takeover on every birdie interrupts score entry.
export function CelebrationOverlay({ celebration, celebrationAnim, players }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeScorecardStyles(theme), [theme]);

  if (!celebration?.label) return null;
  const tier = CELEBRATION_TIERS[celebration.label] ?? CELEBRATION_TIERS.BIRDIE;
  const player = players.find((p) => p.id === celebration.playerId);
  const firstName = player?.name?.split(' ')[0] ?? '';

  const scrimOpacity = celebrationAnim.interpolate({
    inputRange: [0, 1], outputRange: [0, 0.55],
  });
  const cardOpacity = celebrationAnim;
  const cardScale = celebrationAnim.interpolate({
    inputRange: [0, 1], outputRange: [0.75, 1],
  });
  const cardTranslate = celebrationAnim.interpolate({
    inputRange: [0, 1], outputRange: [16, 0],
  });
  const ringScale = celebrationAnim.interpolate({
    inputRange: [0, 1], outputRange: [0.6, 1.35],
  });
  const ringOpacity = celebrationAnim.interpolate({
    inputRange: [0, 0.5, 1], outputRange: [0, 0.6, 0],
  });

  return (
    <View pointerEvents="none" style={s.celebrationRoot}>
      <Animated.View style={[s.celebrationScrim, { opacity: scrimOpacity }]} />
      <Animated.View
        style={[
          s.celebrationRing,
          {
            borderColor: tier.glow,
            opacity: ringOpacity,
            transform: [{ scale: ringScale }],
          },
        ]}
      />
      <Animated.View
        style={[
          s.celebrationCard,
          {
            opacity: cardOpacity,
            borderColor: tier.accent,
            shadowColor: tier.accent,
            transform: [{ scale: cardScale }, { translateY: cardTranslate }],
          },
        ]}
      >
        <View style={[s.celebrationIconWrap, { borderColor: tier.accent }]}>
          <Feather name={tier.icon} size={22} color={tier.accent} />
        </View>
        <Text style={[s.celebrationEyebrow, { color: tier.accent }]}>{tier.eyebrow}</Text>
        <Text style={s.celebrationLabelBig}>{celebration.label}</Text>
        {!!firstName && (
          <Text style={s.celebrationSubtitle}>
            {firstName} · Hole {celebration.holeNumber}
          </Text>
        )}
      </Animated.View>
    </View>
  );
}
```

- [ ] **Step 2: Delete the local copy and import instead**

In `src/components/scorecard/HoleView.js`:
1. Delete lines 589-652 (the whole local `function CelebrationOverlay(...)`).
2. Add to the imports at the top, after the `HolePage` import:

```javascript
import { CelebrationOverlay } from './CelebrationOverlay';
```

3. Remove `CELEBRATION_TIERS` from the `./constants` import if nothing else in `HoleView.js` uses it (check with `grep -n "CELEBRATION_TIERS" src/components/scorecard/HoleView.js` — if the only hit is the import line, delete the whole import statement).

- [ ] **Step 3: Verify nothing changed**

Run: `npx jest src/components/scorecard/ src/screens/__tests__/ScorecardScreen`
Expected: PASS — this is a pure move, so every existing test must still pass with no edits.

Run: `npx eslint src/components/scorecard/CelebrationOverlay.js src/components/scorecard/HoleView.js`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/scorecard/CelebrationOverlay.js src/components/scorecard/HoleView.js
git commit -m "refactor(scorecard): extract CelebrationOverlay from HoleView"
```

---

### Task 3: CelebrationToast component

**Files:**
- Create: `src/components/scorecard/CelebrationToast.js`
- Test: `src/components/scorecard/__tests__/CelebrationToast.test.js` (create)

**Interfaces:**
- Consumes: `CELEBRATION_TIERS` from Task 1.
- Produces: `export function CelebrationToast({ celebration, celebrationAnim, players })` — same prop shape as `CelebrationOverlay` so Task 4's branch is symmetrical. `celebration` is `{ playerId, holeNumber, label, delta }`.

Styles live in a local `makeStyles` in this file, following `HoleDistanceBlock.js`. Deliberately **not** added to the shared `makeScorecardStyles`: that sheet is ~430 rules and is rebuilt per consuming component, so keeping the toast out of it avoids making every other rebuild bigger.

- [ ] **Step 1: Write the failing test**

Create `src/components/scorecard/__tests__/CelebrationToast.test.js`:

```javascript
import React from 'react';
import { Animated } from 'react-native';
import { render } from '@testing-library/react-native';
import { CelebrationToast } from '../CelebrationToast';
import { ThemeProvider } from '../../../theme/ThemeContext';

jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));

const PLAYERS = [{ id: 'p1', name: 'Marcos Specker' }, { id: 'p2', name: 'Noé' }];

function renderToast(celebration) {
  return render(
    <ThemeProvider>
      <CelebrationToast
        celebration={celebration}
        celebrationAnim={new Animated.Value(1)}
        players={PLAYERS}
      />
    </ThemeProvider>,
  );
}

describe('CelebrationToast', () => {
  it('renders the label, first name, hole and delta for a birdie', () => {
    const r = renderToast({ playerId: 'p1', holeNumber: 7, label: 'BIRDIE', delta: -1 });
    expect(r.queryByText('BIRDIE')).toBeTruthy();
    // First name only — surnames make the toast wrap on narrow phones.
    expect(r.queryByText('Marcos · Hole 7')).toBeTruthy();
    expect(r.queryByText('−1')).toBeTruthy();
  });

  it('shows a positive delta for a noelada', () => {
    const r = renderToast({ playerId: 'p2', holeNumber: 7, label: 'NOELADA', delta: 3 });
    expect(r.queryByText('NOELADA')).toBeTruthy();
    expect(r.queryByText('Noé · Hole 7')).toBeTruthy();
    expect(r.queryByText('+3')).toBeTruthy();
  });

  it('omits the delta rather than rendering NaN when it is absent', () => {
    const r = renderToast({ playerId: 'p1', holeNumber: 7, label: 'BIRDIE' });
    expect(r.queryByText('BIRDIE')).toBeTruthy();
    expect(r.queryByText('NaN')).toBeNull();
    expect(r.queryByText('−1')).toBeNull();
  });

  it('renders nothing without a label', () => {
    const r = renderToast({ playerId: null, holeNumber: null, label: null });
    expect(r.toJSON()).toBeNull();
  });

  it('omits the subtitle when the player is unknown', () => {
    const r = renderToast({ playerId: 'ghost', holeNumber: 4, label: 'BIRDIE', delta: -1 });
    expect(r.queryByText('BIRDIE')).toBeTruthy();
    expect(r.queryByText(/Hole 4/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/scorecard/__tests__/CelebrationToast.test.js`
Expected: FAIL — `Cannot find module '../CelebrationToast'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/scorecard/CelebrationToast.js`:

```javascript
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { CELEBRATION_TIERS } from './constants';

// Non-blocking celebration for the common tiers (birdie, noelada). Slides in at
// the top, holds, slides out — the scorecard stays visible and usable, so a
// birdie no longer interrupts score entry the way the full-screen takeover did.
//
// Absolutely positioned and pointerEvents="none" on purpose: a toast that
// participated in layout would push the score card and its +/- steppers down
// mid-tap, which is worse than the takeover it replaces.
export function CelebrationToast({ celebration, celebrationAnim, players }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);

  if (!celebration?.label) return null;
  const tier = CELEBRATION_TIERS[celebration.label] ?? CELEBRATION_TIERS.BIRDIE;
  const player = players.find((p) => p.id === celebration.playerId);
  const firstName = player?.name?.split(' ')[0] ?? '';

  // Strokes relative to par. Rendered with a true minus sign (U+2212) so the
  // number lines up with the tabular figures used elsewhere on the scorecard.
  const delta = celebration.delta;
  const deltaLabel = typeof delta === 'number' && Number.isFinite(delta)
    ? (delta < 0 ? `−${Math.abs(delta)}` : `+${delta}`)
    : null;

  const translateY = celebrationAnim.interpolate({
    inputRange: [0, 1], outputRange: [-40, 0],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[s.root, { opacity: celebrationAnim, transform: [{ translateY }] }]}
    >
      <View style={[s.toast, { borderColor: tier.accent, borderLeftColor: tier.accent }]}>
        <View style={[s.iconWrap, { borderColor: tier.accent }]}>
          <Feather name={tier.icon} size={13} color={tier.accent} />
        </View>
        <View style={s.textWrap}>
          <Text style={s.label}>{celebration.label}</Text>
          {!!firstName && (
            <Text style={s.subtitle}>{`${firstName} · Hole ${celebration.holeNumber}`}</Text>
          )}
        </View>
        {!!deltaLabel && (
          <Text style={[s.delta, { color: tier.accent }]}>{deltaLabel}</Text>
        )}
      </View>
    </Animated.View>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    root: {
      position: 'absolute',
      top: 8,
      left: 12,
      right: 12,
      zIndex: 60,
      elevation: 60,
    },
    toast: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      // bg.deep is the theme's surface for play & results (LiveRoundCard,
      // leaderboard). The old takeover card hardcoded #003d27, which is in no
      // palette — a leftover from before the light theme.
      backgroundColor: theme.bg.deep,
      borderRadius: 12,
      borderWidth: 1,
      borderLeftWidth: 3,
      paddingVertical: 10,
      paddingHorizontal: 13,
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
    },
    iconWrap: {
      width: 26,
      height: 26,
      borderRadius: 13,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.05)',
    },
    textWrap: { flex: 1 },
    label: {
      color: '#ffffff',
      fontFamily: 'PlayfairDisplay-Black',
      fontSize: 16,
      letterSpacing: 1,
    },
    subtitle: {
      color: 'rgba(255,255,255,0.6)',
      fontFamily: 'PlusJakartaSans-Medium',
      fontSize: 10,
      letterSpacing: 0.4,
      marginTop: 3,
    },
    delta: {
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontSize: 17,
      fontVariant: ['tabular-nums'],
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/components/scorecard/__tests__/CelebrationToast.test.js`
Expected: PASS, 5 tests.

Run: `npx eslint src/components/scorecard/CelebrationToast.js`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/scorecard/CelebrationToast.js src/components/scorecard/__tests__/CelebrationToast.test.js
git commit -m "feat(scorecard): non-blocking CelebrationToast for common results"
```

---

### Task 4: HoleView picks the presentation

**Files:**
- Modify: `src/components/scorecard/HoleView.js` — the `<CelebrationOverlay .../>` render site (line 584 before Task 2; re-grep after)
- Test: `src/components/scorecard/__tests__/HoleView.celebration.test.js` (create)

**Interfaces:**
- Consumes: `CELEBRATION_TIERS` (Task 1), `CelebrationOverlay` (Task 2), `CelebrationToast` (Task 3).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Create `src/components/scorecard/__tests__/HoleView.celebration.test.js`:

```javascript
import React from 'react';
import { Animated } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { HoleView } from '../HoleView';
import { ThemeProvider } from '../../../theme/ThemeContext';

jest.mock('../../../hooks/useGpsDistances', () => ({
  useGpsDistances: () => ({
    available: false, distances: null, source: 'gps', fixState: 'disabled',
    accuracy: null, position: null, offTee: false,
  }),
}));
jest.mock('@react-native-community/netinfo', () => ({
  default: {
    fetch: () => Promise.resolve({ type: 'cellular', isConnected: true }),
    addEventListener: () => () => {},
  },
  fetch: () => Promise.resolve({ type: 'cellular', isConnected: true }),
  addEventListener: () => () => {},
}));
jest.mock('../../../store/tileCache', () => ({ prefetchCourseTiles: () => Promise.resolve() }));
jest.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));

const PLAYERS = [{ id: 'a', name: 'Marcos', handicap: 12 }];
const HOLES = [{ number: 1, par: 4, strokeIndex: 1 }, { number: 2, par: 4, strokeIndex: 2 }];
const ROUND = {
  id: 'r1', courseName: 'Test GC', holes: HOLES,
  scores: { a: {} }, shotDetails: { a: {} },
  playerHandicaps: { a: 12 }, pairs: [['a']], notes: {},
};
const CONFLICT_HOLES = new Set();
const noop = () => {};

function renderWithCelebration(celebration) {
  const props = {
    round: ROUND, roundIndex: 0, players: PLAYERS, scores: ROUND.scores,
    shotDetails: ROUND.shotDetails, meId: 'a',
    onSetShot: noop, onPickMe: noop, notes: {},
    currentHole: 1, hole: HOLES[0], isBestBall: false, bbResult: null,
    settings: { scoringMode: 'stableford' },
    onStep: noop, onSetScore: noop, editable: () => true,
    onNext: noop, onGoToHole: noop, onFinish: noop,
    holeCount: 2, showQuickFinish: false, finishBusy: false, showRunning: false,
    getScoreAnim: () => new Animated.Value(1),
    celebration, celebrationAnim: new Animated.Value(1),
    refreshing: false, onRefresh: noop, official: false,
    conflictHoles: CONFLICT_HOLES,
  };
  const r = render(<ThemeProvider><HoleView {...props} /></ThemeProvider>);
  const wrap = r.UNSAFE_root.findAll((n) => typeof n.props?.onLayout === 'function')[0];
  act(() => {
    wrap.props.onLayout({ nativeEvent: { layout: { width: 390, height: 700 } } });
  });
  return r;
}

describe('HoleView celebration presentation', () => {
  it('a birdie shows the toast, with its delta, and no takeover scrim', () => {
    const r = renderWithCelebration({ playerId: 'a', holeNumber: 1, label: 'BIRDIE', delta: -1 });
    expect(r.queryByText('BIRDIE')).toBeTruthy();
    expect(r.queryByText('−1')).toBeTruthy();
    // The takeover renders the tier eyebrow; the toast does not.
    expect(r.queryByText('A BIRDIE')).toBeNull();
  });

  it('a noelada shows the toast', () => {
    const r = renderWithCelebration({ playerId: 'a', holeNumber: 1, label: 'NOELADA', delta: 3 });
    expect(r.queryByText('NOELADA')).toBeTruthy();
    expect(r.queryByText('+3')).toBeTruthy();
    // The takeover would render the eyebrow; the toast never does.
    expect(r.queryByText('WHAT A NOELADA!')).toBeNull();
  });

  it('an eagle still takes over the screen', () => {
    const r = renderWithCelebration({ playerId: 'a', holeNumber: 1, label: 'EAGLE', delta: -2 });
    // The takeover's eyebrow proves it is the overlay, not the toast.
    expect(r.queryByText('AN EAGLE')).toBeTruthy();
    expect(r.queryByText('EAGLE')).toBeTruthy();
  });

  it('a hole in one still takes over the screen', () => {
    const r = renderWithCelebration({ playerId: 'a', holeNumber: 1, label: 'HOLE IN ONE', delta: -3 });
    expect(r.queryByText('A HOLE IN ONE')).toBeTruthy();
  });

  it('renders neither when there is no celebration', () => {
    const r = renderWithCelebration({ playerId: null, holeNumber: null, label: null });
    expect(r.queryByText('BIRDIE')).toBeNull();
    expect(r.queryByText('AN EAGLE')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/scorecard/__tests__/HoleView.celebration.test.js`
Expected: FAIL on the first test — `queryByText('A BIRDIE')` finds the takeover eyebrow, because every tier still renders `CelebrationOverlay`.

- [ ] **Step 3: Write minimal implementation**

In `src/components/scorecard/HoleView.js`:

1. Add the imports next to the `CelebrationOverlay` import from Task 2:

```javascript
import { CelebrationToast } from './CelebrationToast';
import { CELEBRATION_TIERS } from './constants';
```

2. Replace the single render site (was line 584):

```javascript
      <CelebrationOverlay celebration={celebration} celebrationAnim={celebrationAnim} players={players} />
```

with:

```javascript
      {/* Presentation escalates by rarity — the tier decides, not this file.
          Common results (birdie, noelada) get the non-blocking toast so score
          entry continues; rare ones keep the full-screen takeover. */}
      {CELEBRATION_TIERS[celebration?.label]?.presentation === 'toast' ? (
        <CelebrationToast celebration={celebration} celebrationAnim={celebrationAnim} players={players} />
      ) : (
        <CelebrationOverlay celebration={celebration} celebrationAnim={celebrationAnim} players={players} />
      )}
```

Both components return `null` when `celebration.label` is falsy, so the no-celebration case needs no extra guard.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/components/scorecard/__tests__/HoleView.celebration.test.js`
Expected: PASS, 5 tests.

Run: `npx jest src/components/scorecard/ && npx eslint src/components/scorecard/HoleView.js`
Expected: all pass (including `HoleView.window.test.js`), 0 lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/scorecard/HoleView.js src/components/scorecard/__tests__/HoleView.celebration.test.js
git commit -m "feat(scorecard): route celebrations to toast or takeover by tier"
```

---

### Task 5: Tier-driven timing, haptic and delta

**Files:**
- Modify: `src/screens/ScorecardScreen.js:336` (celebration state), `:1024-1043` (`triggerCelebration`), `:1204-1205` and `:1240-1241` (the two call sites)
- Test: `src/screens/__tests__/ScorecardScreen.celebration.test.js` (create)

**Interfaces:**
- Consumes: `CELEBRATION_TIERS` (Task 1).
- Produces: `triggerCelebration(playerId, holeNumber, label, delta)` — a fourth parameter. Celebration state becomes `{ playerId, holeNumber, label, delta }`.

- [ ] **Step 1: Write the failing test**

Create `src/screens/__tests__/ScorecardScreen.celebration.test.js`. Assert on the haptic, because that is the user-visible half of the bug and it is directly observable:

```javascript
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { ThemeProvider } from '../../theme/ThemeContext';
import ScorecardScreen from '../ScorecardScreen';
import { haptic } from '../../lib/haptics';

jest.mock('../../lib/haptics', () => ({ haptic: jest.fn() }));

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (cb) => {
    const ReactModule = require('react');
    ReactModule.useEffect(() => cb(), [cb]);
  },
  useIsFocused: () => true,
}));

let mockOfficialRoundState;

const mockPlayers = [{ id: 'p1', name: 'Noé' }];
const mockTournament = {
  id: 't1', kind: 'game', currentRound: 0, meId: 'p1',
  settings: { scoringMode: 'stableford' },
  players: mockPlayers,
  rounds: [{
    id: 'r1', courseName: 'Neguri',
    // Par 3 so a birdie is 2 and a double bogey is 5 — both reachable with a
    // single direct setScore, independent of stepper arithmetic.
    holes: [{ number: 1, par: 3, strokeIndex: 1 }, { number: 2, par: 4, strokeIndex: 2 }],
    scores: {}, shotDetails: {}, notes: {}, pairs: [[mockPlayers[0]]],
  }],
};

jest.mock('@expo/vector-icons', () => ({ Feather: 'Feather' }));
jest.mock('expo-screen-orientation', () => ({
  lockAsync: jest.fn(() => Promise.resolve()),
  unlockAsync: jest.fn(() => Promise.resolve()),
  OrientationLock: { PORTRAIT_UP: 'PORTRAIT_UP' },
}));

jest.mock('../../components/scorecard/HoleView', () => {
  const React = require('react');
  const { Text, TouchableOpacity, View } = require('react-native');
  return {
    HoleView: ({ onSetScore }) => (
      <View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Set birdie"
          onPress={() => onSetScore('p1', 1, '2')}
        >
          <Text>Set birdie</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Set noelada"
          onPress={() => onSetScore('p1', 1, '5')}
        >
          <Text>Set noelada</Text>
        </TouchableOpacity>
      </View>
    ),
  };
});

jest.mock('../../components/scorecard/GridView', () => ({
  ...jest.requireActual('../../components/scorecard/GridView'),
  GridView: () => null,
}));
jest.mock('../../components/MediaLightbox', () => () => null);
jest.mock('../../components/AttachMediaSheet', () => () => null);
jest.mock('../../components/CaptureMenuSheet', () => () => null);
jest.mock('../../components/SyncStatusSheet', () => () => null);
jest.mock('../../components/ScoringModeChangeSheet', () => () => null);
jest.mock('../../hooks/useRoundMedia', () => ({ useRoundMedia: () => ({ items: [] }) }));
jest.mock('../../hooks/useOfficialRound', () => ({ useOfficialRound: () => mockOfficialRoundState }));
jest.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }));

jest.mock('../../store/tournamentStore', () => ({
  loadTournament: jest.fn(() => Promise.resolve(mockTournament)),
  subscribeTournamentChanges: jest.fn(() => jest.fn()),
  calcBestWorstBall: jest.fn(() => null),
  DEFAULT_SETTINGS: { scoringMode: 'stableford' },
  roundPairClinched: jest.fn(() => null),
  setScoringModeRoundPatches: jest.fn(() => ({ patches: [] })),
  isRoundComplete: jest.fn(() => false),
  isTournamentFinished: jest.fn(() => false),
  subscribeSyncStatus: jest.fn(() => jest.fn()),
  getActiveTournamentSnapshot: jest.fn(() => mockTournament),
  getTournament: jest.fn(() => Promise.resolve(mockTournament)),
  getTournamentSnapshot: jest.fn(() => mockTournament),
  readLocal: jest.fn(() => Promise.resolve(mockTournament)),
}));
jest.mock('../../store/mutate', () => {
  const actual = jest.requireActual('../../store/mutate');
  return { ...actual, mutate: jest.fn(async (t) => t) };
});
jest.mock('../../store/syncWorker', () => ({
  scheduleSync: jest.fn(), syncNow: jest.fn(() => Promise.resolve()),
  syncSettled: jest.fn(() => Promise.resolve()), retrySync: jest.fn(),
}));
jest.mock('../../store/libraryStore', () => ({ fetchPlayers: jest.fn(() => Promise.resolve([])) }));
jest.mock('../../store/notificationStore', () => ({ notifyRoundFinished: jest.fn(() => Promise.resolve()) }));
jest.mock('../../store/officialScoring', () => ({
  cardDiscrepancyHoles: jest.fn(() => []), officialHolesFromCourse: jest.fn(() => []),
}));
jest.mock('../../store/officialLeaderboard', () => ({ buildLeaderboard: jest.fn(() => []) }));
jest.mock('../../store/officialStore', () => ({ attestCard: jest.fn(() => Promise.resolve()) }));
jest.mock('../../lib/mediaCapture', () => ({
  pickMedia: jest.fn(() => Promise.resolve(null)), attachMedia: jest.fn(() => Promise.resolve()),
}));

describe('ScorecardScreen celebration haptics', () => {
  const navigation = { canGoBack: jest.fn(() => true), goBack: jest.fn(), navigate: jest.fn() };
  const route = { params: { roundIndex: 0 } };
  const originalPlatformOS = Platform.OS;
  const wrap = (ui) => <ThemeProvider>{ui}</ThemeProvider>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockOfficialRoundState = {
      loading: false, error: null, round: null, members: [], scores: [],
      myRosterId: null, refresh: jest.fn(), setScore: jest.fn(),
      hasAttested: false, editableSource: jest.fn(() => null),
    };
    // Native, so the real haptic() would not be short-circuited by its web
    // guard — the mock records the style either way, but this keeps the fixture
    // honest about the platform the behaviour matters on.
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => originalPlatformOS });
  });

  it('a birdie fires the light haptic, not success', async () => {
    const { findByLabelText } = render(wrap(
      <ScorecardScreen navigation={navigation} route={route} />
    ));
    fireEvent.press(await findByLabelText('Set birdie'));
    await waitFor(() => {
      expect(haptic).toHaveBeenCalledWith('light');
    });
    expect(haptic).not.toHaveBeenCalledWith('success');
  });

  // Regression: NOELADA used to fire haptic('success') — the same celebratory
  // buzz as an albatross — for a double bogey.
  it('a noelada never fires the success haptic', async () => {
    const { findByLabelText } = render(wrap(
      <ScorecardScreen navigation={navigation} route={route} />
    ));
    fireEvent.press(await findByLabelText('Set noelada'));
    await waitFor(() => {
      expect(haptic).toHaveBeenCalledWith('selection');
    });
    expect(haptic).not.toHaveBeenCalledWith('success');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/__tests__/ScorecardScreen.celebration.test.js`
Expected: FAIL both tests — `triggerCelebration` calls `haptic('success')` unconditionally, so `'light'` and `'selection'` are never seen.

- [ ] **Step 3: Write minimal implementation**

In `src/screens/ScorecardScreen.js`:

1. Add `CELEBRATION_TIERS` to the existing `./components/scorecard/constants` import (the one that already brings in `celebrationFor` at line 54):

```javascript
  CELEBRATION_TIERS,
  celebrationFor,
```

2. Add `delta` to the celebration state at line 336:

```javascript
  const [celebration, setCelebration] = useState({
    playerId: null, holeNumber: null, label: null, delta: null,
  });
```

3. Replace `triggerCelebration` (lines 1024-1043) with:

```javascript
  // Hold time and haptic come from the tier, not from a chain here. The old
  // chain ended in `else 1800 // HOLE IN ONE`, which silently gave NOELADA the
  // longest hold of any tier, and it fired haptic('success') for every result
  // including a double bogey.
  const triggerCelebration = useCallback((playerId, holeNumber, label, delta) => {
    const tier = CELEBRATION_TIERS[label] ?? CELEBRATION_TIERS.BIRDIE;
    haptic(tier.haptic);
    celebrationAnim.stopAnimation();
    celebrationAnim.setValue(0);
    setCelebration({ playerId, holeNumber, label, delta });
    Animated.sequence([
      Animated.spring(celebrationAnim, {
        toValue: 1, friction: 6, tension: 80, useNativeDriver: true,
      }),
      Animated.delay(tier.holdMs),
      Animated.timing(celebrationAnim, { toValue: 0, duration: 420, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) setCelebration({ playerId: null, holeNumber: null, label: null, delta: null });
    });
  }, [celebrationAnim]);
```

4. Pass the delta at both call sites. In `setScore` (line 1205):

```javascript
      if (label) triggerCelebration(playerId, holeNumber, label, parsed - holePar);
```

In `stepScore` (line 1241):

```javascript
      if (label) triggerCelebration(playerId, holeNumber, label, newStrokes - holePar);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/__tests__/ScorecardScreen.celebration.test.js`
Expected: PASS, 2 tests.

Run: `npx jest src/screens/__tests__/ScorecardScreen src/components/scorecard/`
Expected: all pass — especially `ScorecardScreen.saveDebounce.test.js`, which drives the same `stepScore` path.

Run: `npx eslint src/screens/ScorecardScreen.js`
Expected: 0 errors (10 pre-existing warnings are acceptable).

- [ ] **Step 5: Full suite and commit**

```bash
npx jest --testPathIgnorePatterns "/node_modules/" "\.claude/worktrees" "\.worktrees"
git add src/screens/ScorecardScreen.js src/screens/__tests__/ScorecardScreen.celebration.test.js
git commit -m "feat(scorecard): tier-driven celebration hold and haptic, plus score delta"
```

---

### Task 6: Runtime verification

Unit tests cannot show that the toast sits in the right place or that the scorecard stays usable underneath it. Verify in the browser.

**Files:** none modified.

- [ ] **Step 1: Start the web app**

```bash
npx expo start --web --port 8090 > /tmp/expo-web.log 2>&1 &
```

Wait ~25s for the bundle. Only one dev server should run at a time — three concurrent instances previously caused a stale-bundle scare.

- [ ] **Step 2: Drive it with Playwright MCP**

Use the `verify` skill's guidance. Start a game (Home → New game → pick course → Start Game), then on hole 1 tap the stepper down to a birdie (`Decrease strokes on hole 1`) and confirm:

1. The toast appears at the top with the label, `Name · Hole 1`, and the delta.
2. **No scrim covers the screen** — the score card and its steppers are still visible and clickable while the toast is up. Assert this rather than eyeball it:

```javascript
// In browser_evaluate — the stepper must remain hittable during the toast.
() => {
  const plus = document.querySelector('[aria-label="Increase strokes on hole 1"]');
  const r = plus.getBoundingClientRect();
  const topEl = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { stepperStillHittable: plus.contains(topEl) || topEl === plus };
}
```

3. The toast clears itself (~600–900ms plus the 420ms fade) without a tap.

- [ ] **Step 3: Screenshot both presentations**

Capture the birdie toast and, by setting a hole to two under par, the eagle takeover. Confirm the toast is deep green (`#00553c`), not the old `#003d27`.

- [ ] **Step 4: Commit nothing, report findings**

If the toast overlaps the hole header badly or the delta wraps on a narrow viewport, fix in a follow-up commit rather than editing earlier tasks retroactively.

---

## Notes for the implementer

- **Android is unverified.** Everything here is checked on web, which shares the codebase. `elevation: 60` on the toast root is set for Android stacking; if the toast renders under the hole header on a device, raise it rather than reordering the tree.
- **Do not reintroduce `#003d27`.** If a colour looks wrong, reach for a token in `src/theme/tokens.js`.
- **The `noSpoilers` setting does not gate celebrations today.** That is pre-existing and out of scope — do not "fix" it here.
