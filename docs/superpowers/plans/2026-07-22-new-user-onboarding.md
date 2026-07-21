# New-User Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the first-run gate to collect username + display name + gender with live availability feedback, and add a two-chapter coach-marks tour (4 stops on Home's tab bar, 3 stops on the first scorecard).

**Architecture:** The blocking `OnboardingScreen` gains a display-name field and a debounced live username check. The tour is three new units: a module-scope target registry (`tourTargets.js`) that deep components register measurable refs into; a presentational spotlight overlay (`CoachMarks.js`) that measures targets at runtime and renders scrim/ring/card; and a wiring component (`TourOverlay.js`) that gates on settings-synced completion flags (`profiles.settings.tour`), auth (guests excluded), and settings hydration. Flags default `null` (= show); Skip/Done stamp an ISO timestamp; a Settings row resets both.

**Tech Stack:** Expo SDK 54 / RN 0.81 / React 19, plain JS store modules, Jest (jest-expo) + @testing-library/react-native, Supabase `profiles.settings` jsonb via existing `settingsStore`.

**Spec:** `docs/superpowers/specs/2026-07-22-onboarding-design.md` (as amended — chapter 2 has 3 stops).

## Global Constraints

- No new dependencies. Pure RN `View`/`Pressable` overlay — works on web + Android.
- Copy is fixed by the spec — use the exact title/body strings in `tourSteps.js` below, verbatim.
- Tour flags live under `settings.tour` = `{ home: string|null, scorecard: string|null }` (ISO timestamp when completed/skipped; missing key ⇒ `null` ⇒ show).
- Anonymous users (`user.is_anonymous`) never see the tour; signed-out users can't reach it (auth gate).
- Unmeasurable target ⇒ skip that stop silently; zero measurable stops ⇒ mark chapter complete without rendering.
- Never block onboarding Continue on the availability probe (offline ⇒ fall back to save-time validation).
- Respect reduced motion: fade only, no ring pulse (the plan's overlay has no pulse at all — nothing extra to do beyond not adding motion).
- All touchables ≥44px, accessibilityRole/label on every new control.
- Theme: gold ring `semantic.winner.dark` (#ffd700) on the dark scrim in both themes; card uses `theme.bg.card` / standard text tokens.
- Lint (`npm run lint`) and full `npm test` must stay green; run per-task targeted tests in each task.

---

### Task 1: settingsStore — tour defaults + hydration signal

**Files:**
- Modify: `src/store/settingsStore.js`
- Test: `src/store/__tests__/settingsStore.tour.test.js` (create)

**Interfaces:**
- Produces: `DEFAULT_APP_SETTINGS.tour = { home: null, scorecard: null }`; `isSettingsHydrated(): boolean`; `subscribeSettingsHydration(cb): unsubscribe`. Hydration flips to `true` at the end of every `hydrateAppSettings()` call (success, signed-out, or offline) and notifies subscribers. `__resetAppSettingsForTests()` resets it.
- Consumes: existing store internals only.

- [ ] **Step 1: Write the failing test**

Create `src/store/__tests__/settingsStore.tour.test.js`:

```js
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_APP_SETTINGS, mergeAppSettings, getAppSettings, updateAppSettings,
  hydrateAppSettings, isSettingsHydrated, subscribeSettingsHydration,
  __resetAppSettingsForTests,
} from '../settingsStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../profileStore', () => ({
  loadProfile: jest.fn(),
  upsertProfile: jest.fn().mockResolvedValue({}),
}));
const { loadProfile } = require('../profileStore');

beforeEach(async () => {
  __resetAppSettingsForTests();
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe('tour defaults', () => {
  it('defaults both chapters to null (= show)', () => {
    expect(DEFAULT_APP_SETTINGS.tour).toEqual({ home: null, scorecard: null });
  });

  it('merges a one-chapter patch without losing the other', () => {
    const out = mergeAppSettings(DEFAULT_APP_SETTINGS, { tour: { home: '2026-07-22T00:00:00.000Z' } });
    expect(out.tour).toEqual({ home: '2026-07-22T00:00:00.000Z', scorecard: null });
  });

  it('old server blobs without tour still expose defaults', async () => {
    loadProfile.mockResolvedValue({ userId: 'u1', settings: { gpsEnabled: false } });
    await hydrateAppSettings();
    expect(getAppSettings().tour).toEqual({ home: null, scorecard: null });
  });
});

describe('hydration signal', () => {
  it('starts false and flips true after hydrate resolves (signed out)', async () => {
    loadProfile.mockResolvedValue(null);
    expect(isSettingsHydrated()).toBe(false);
    await hydrateAppSettings();
    expect(isSettingsHydrated()).toBe(true);
  });

  it('flips true even when loadProfile throws (offline)', async () => {
    loadProfile.mockRejectedValue(new Error('offline'));
    await hydrateAppSettings();
    expect(isSettingsHydrated()).toBe(true);
  });

  it('notifies subscribers exactly once', async () => {
    loadProfile.mockResolvedValue(null);
    const cb = jest.fn();
    subscribeSettingsHydration(cb);
    await hydrateAppSettings();
    await hydrateAppSettings();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('updateAppSettings persists tour stamps through the normal pipeline', async () => {
    await updateAppSettings({ tour: { home: '2026-07-22T10:00:00.000Z' } });
    expect(getAppSettings().tour.home).toBe('2026-07-22T10:00:00.000Z');
    const mirrored = JSON.parse(await AsyncStorage.getItem('@golf_settings'));
    expect(mirrored.tour.home).toBe('2026-07-22T10:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/store/__tests__/settingsStore.tour.test.js`
Expected: FAIL — `tour` undefined in defaults, `isSettingsHydrated is not a function`.

- [ ] **Step 3: Implement**

In `src/store/settingsStore.js`:

(a) Add to `DEFAULT_APP_SETTINGS` (after `notifications`):

```js
  // Coach-marks tour: ISO timestamp when a chapter was completed/skipped,
  // null (or missing — same thing) means the chapter hasn't run yet.
  tour: { home: null, scorecard: null },
```

(b) After the `hydratedUserId` declaration, add the hydration mini-store:

```js
// True once hydrateAppSettings has completed at least once this app run
// (any outcome — server, signed-out reset, or offline fallback). Consumers
// that must not act on pre-hydration defaults (the tour) wait on this.
let settingsHydrated = false;
const hydrationListeners = new Set();
export function isSettingsHydrated() { return settingsHydrated; }
export function subscribeSettingsHydration(cb) {
  hydrationListeners.add(cb);
  return () => hydrationListeners.delete(cb);
}
function markSettingsHydrated() {
  if (settingsHydrated) return;
  settingsHydrated = true;
  hydrationListeners.forEach((cb) => cb());
}
```

(c) In `__resetAppSettingsForTests()` add:

```js
  settingsHydrated = false;
  hydrationListeners.clear();
```

(d) Guarantee the flag flips on every exit path of `hydrateAppSettings` by wrapping the existing body in `try { ... } finally { markSettingsHydrated(); }` — the two existing inner `try/catch` blocks stay untouched inside it. (The early `return`s inside still pass through `finally`.)

- [ ] **Step 4: Run tests**

Run: `npx jest src/store/__tests__/settingsStore.tour.test.js src/store/__tests__/settingsStore.test.js`
Expected: PASS (both new and pre-existing settings suites).

- [ ] **Step 5: Commit**

```bash
git add src/store/settingsStore.js src/store/__tests__/settingsStore.tour.test.js
git commit -m "feat(tour): tour completion flags in app settings + hydration signal"
```

---

### Task 2: tourStore — chapter gating

**Files:**
- Create: `src/store/tourStore.js`
- Test: `src/store/__tests__/tourStore.test.js`

**Interfaces:**
- Consumes: `getAppSettings`, `updateAppSettings` from `./settingsStore` (Task 1 shape).
- Produces: `shouldShowTour(chapter: 'home'|'scorecard'): boolean`; `completeTour(chapter): Promise<void>` (stamps ISO now); `resetTour(): Promise<void>` (both chapters → null). Later tasks import these names exactly.

- [ ] **Step 1: Write the failing test**

Create `src/store/__tests__/tourStore.test.js`:

```js
import { shouldShowTour, completeTour, resetTour } from '../tourStore';
import { getAppSettings, updateAppSettings, __resetAppSettingsForTests } from '../settingsStore';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../profileStore', () => ({
  loadProfile: jest.fn().mockResolvedValue(null),
  upsertProfile: jest.fn().mockResolvedValue({}),
}));

beforeEach(() => { __resetAppSettingsForTests(); });

it('shows both chapters by default', () => {
  expect(shouldShowTour('home')).toBe(true);
  expect(shouldShowTour('scorecard')).toBe(true);
});

it('completeTour stamps an ISO timestamp and hides only that chapter', async () => {
  await completeTour('home');
  expect(shouldShowTour('home')).toBe(false);
  expect(shouldShowTour('scorecard')).toBe(true);
  expect(new Date(getAppSettings().tour.home).toISOString()).toBe(getAppSettings().tour.home);
});

it('treats a settings blob without tour as "show"', async () => {
  await updateAppSettings({ tour: undefined });
  expect(shouldShowTour('home')).toBe(true);
});

it('resetTour re-arms both chapters', async () => {
  await completeTour('home');
  await completeTour('scorecard');
  await resetTour();
  expect(shouldShowTour('home')).toBe(true);
  expect(shouldShowTour('scorecard')).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/store/__tests__/tourStore.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/store/tourStore.js`:

```js
import { getAppSettings, updateAppSettings } from './settingsStore';

// Coach-marks tour gating (spec: docs/superpowers/specs/2026-07-22-onboarding-design.md).
// A chapter shows while its flag is null/missing; completing or skipping
// stamps an ISO timestamp, synced cross-device through profiles.settings.

export function shouldShowTour(chapter) {
  const tour = getAppSettings().tour ?? {};
  return tour[chapter] == null;
}

export async function completeTour(chapter) {
  await updateAppSettings({ tour: { [chapter]: new Date().toISOString() } });
}

export async function resetTour() {
  await updateAppSettings({ tour: { home: null, scorecard: null } });
}
```

- [ ] **Step 4: Run tests** — `npx jest src/store/__tests__/tourStore.test.js` — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/tourStore.js src/store/__tests__/tourStore.test.js
git commit -m "feat(tour): tourStore chapter gating over settings flags"
```

---

### Task 3: tour target registry + useTourTarget

**Files:**
- Create: `src/components/tour/tourTargets.js`
- Test: `src/components/tour/__tests__/tourTargets.test.js`

**Interfaces:**
- Produces: `registerTourTarget(key, node)` (node `null` ⇒ unregister); `measureTourTarget(key): Promise<{x,y,width,height}|null>`; `useTourTarget(key|null): refCallback` (null key ⇒ inert callback); `__resetTourTargetsForTests()`. Registered nodes need `measureInWindow(cb)`; anything else resolves `null`. Later tasks attach the ref callback to `View`/`Animated.View`/`Pressable` (with `collapsable={false}` on plain Views for Android measurability).

- [ ] **Step 1: Write the failing test**

Create `src/components/tour/__tests__/tourTargets.test.js`:

```js
import React from 'react';
import { View } from 'react-native';
import { render } from '@testing-library/react-native';
import {
  registerTourTarget, measureTourTarget, useTourTarget, __resetTourTargetsForTests,
} from '../tourTargets';

beforeEach(() => __resetTourTargetsForTests());

it('measures a registered node via measureInWindow', async () => {
  registerTourTarget('k', { measureInWindow: (cb) => cb(10, 20, 30, 40) });
  await expect(measureTourTarget('k')).resolves.toEqual({ x: 10, y: 20, width: 30, height: 40 });
});

it('resolves null for unknown keys, zero-size nodes, and non-measurable nodes', async () => {
  await expect(measureTourTarget('missing')).resolves.toBeNull();
  registerTourTarget('zero', { measureInWindow: (cb) => cb(0, 0, 0, 0) });
  await expect(measureTourTarget('zero')).resolves.toBeNull();
  registerTourTarget('plain', {});
  await expect(measureTourTarget('plain')).resolves.toBeNull();
});

it('resolves null when measureInWindow never calls back (300ms timeout)', async () => {
  jest.useFakeTimers();
  registerTourTarget('silent', { measureInWindow: () => {} });
  const p = measureTourTarget('silent');
  jest.advanceTimersByTime(400);
  await expect(p).resolves.toBeNull();
  jest.useRealTimers();
});

it('useTourTarget registers on mount and unregisters on unmount', async () => {
  function Probe() { return <View ref={useTourTarget('probe')} collapsable={false} />; }
  const { unmount } = render(<Probe />);
  // jsdom Views have no real measureInWindow — presence is what we assert.
  registerTourTarget('probe', { measureInWindow: (cb) => cb(1, 2, 3, 4) }); // overwrite with measurable stub
  await expect(measureTourTarget('probe')).resolves.toEqual({ x: 1, y: 2, width: 3, height: 4 });
  unmount();
  await expect(measureTourTarget('probe')).resolves.toBeNull();
});

it('useTourTarget(null) is inert', () => {
  function Probe() { return <View ref={useTourTarget(null)} />; }
  expect(() => render(<Probe />)).not.toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx jest src/components/tour/__tests__/tourTargets.test.js` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `src/components/tour/tourTargets.js`:

```js
import { useCallback, useEffect } from 'react';

// Registry of spotlight-able UI nodes, keyed by tour-step key. Deep
// components (tab bar items, scorecard widgets) register a ref here; the
// CoachMarks overlay measures them at runtime — no coordinates are ever
// hardcoded, so layout changes degrade to a skipped stop, not a mis-aimed
// ring.

const targets = new Map();

export function __resetTourTargetsForTests() { targets.clear(); }

export function registerTourTarget(key, node) {
  if (!key) return;
  if (node) targets.set(key, node);
  else targets.delete(key);
}

// Resolves {x, y, width, height} in window coordinates, or null when the
// target is missing, unmeasurable, zero-sized, or doesn't answer within
// 300ms (native measure can go silent on detached nodes).
export function measureTourTarget(key) {
  return new Promise((resolve) => {
    const node = targets.get(key);
    if (!node || typeof node.measureInWindow !== 'function') { resolve(null); return; }
    let settled = false;
    const settle = (value) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => settle(null), 300);
    try {
      node.measureInWindow((x, y, width, height) => {
        settle(width > 0 && height > 0 ? { x, y, width, height } : null);
      });
    } catch { settle(null); }
  });
}

// Ref callback that keeps `key` registered while the component is mounted.
// A null key produces an inert callback so callers can register
// conditionally without breaking the rules of hooks.
export function useTourTarget(key) {
  const refCb = useCallback((node) => registerTourTarget(key, node), [key]);
  useEffect(() => () => registerTourTarget(key, null), [key]);
  return refCb;
}
```

- [ ] **Step 4: Run tests** — `npx jest src/components/tour/__tests__/tourTargets.test.js` — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/tour/tourTargets.js src/components/tour/__tests__/tourTargets.test.js
git commit -m "feat(tour): runtime-measured tour target registry"
```

---

### Task 4: step definitions + CoachMarks overlay

**Files:**
- Create: `src/components/tour/tourSteps.js`
- Create: `src/components/tour/CoachMarks.js`
- Test: `src/components/tour/__tests__/CoachMarks.test.js`

**Interfaces:**
- Consumes: `measureTourTarget` (Task 3).
- Produces: `HOME_TOUR_STEPS` (4 entries, keys `tab-play|tab-stats|tab-feed|tab-profile`), `SCORECARD_TOUR_STEPS` (3 entries, keys `score-entry|hole-distances|hole-nav`), each `{ key, title, body }`; default export `CoachMarks({ steps, onDone, onSkip })` — measures each step's target, silently skips null measurements, calls `onDone()` untriggered-by-user when nothing was measurable, renders scrim (4 panels), gold ring, card with "TOUR · N OF M" overline, Skip tour / Next (last stop: Done), and an invisible pressable over the target rect that advances.

- [ ] **Step 1: Write the failing test**

Create `src/components/tour/__tests__/CoachMarks.test.js`:

```js
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import CoachMarks from '../CoachMarks';
import { HOME_TOUR_STEPS, SCORECARD_TOUR_STEPS } from '../tourSteps';
import { measureTourTarget } from '../tourTargets';

jest.mock('../tourTargets', () => ({
  ...jest.requireActual('../tourTargets'),
  measureTourTarget: jest.fn(),
}));

const RECT = { x: 10, y: 500, width: 60, height: 60 };
const steps = [
  { key: 'a', title: 'Alpha title', body: 'Alpha body.' },
  { key: 'b', title: 'Beta title', body: 'Beta body.' },
];

beforeEach(() => jest.clearAllMocks());

it('step copy matches the spec', () => {
  expect(HOME_TOUR_STEPS).toHaveLength(4);
  expect(HOME_TOUR_STEPS[0]).toEqual({
    key: 'tab-play',
    title: 'Everything starts here',
    body: 'Tap the flag to start a round or a weekend tournament — pairs and scoring are set up for you.',
  });
  expect(SCORECARD_TOUR_STEPS.map((s) => s.key)).toEqual(['score-entry', 'hole-distances', 'hole-nav']);
});

it('renders the first measurable step with counter, then advances on Next', async () => {
  measureTourTarget.mockResolvedValue(RECT);
  const onDone = jest.fn();
  const { findByText, getByText } = render(<CoachMarks steps={steps} onDone={onDone} onSkip={jest.fn()} />);
  await findByText('Alpha title');
  expect(getByText('TOUR · 1 OF 2')).toBeTruthy();
  fireEvent.press(getByText('Next'));
  await findByText('Beta title');
  expect(getByText('Done')).toBeTruthy();
  fireEvent.press(getByText('Done'));
  expect(onDone).toHaveBeenCalledTimes(1);
});

it('tapping the spotlighted area advances', async () => {
  measureTourTarget.mockResolvedValue(RECT);
  const { findByText, getByTestId } = render(
    <CoachMarks steps={steps} onDone={jest.fn()} onSkip={jest.fn()} />,
  );
  await findByText('Alpha title');
  fireEvent.press(getByTestId('coachmarks-target-press'));
  await findByText('Beta title');
});

it('skips unmeasurable steps silently', async () => {
  measureTourTarget.mockImplementation((key) => Promise.resolve(key === 'a' ? null : RECT));
  const { findByText, queryByText } = render(
    <CoachMarks steps={steps} onDone={jest.fn()} onSkip={jest.fn()} />,
  );
  await findByText('Beta title');
  expect(queryByText('Alpha title')).toBeNull();
});

it('auto-completes without rendering when nothing is measurable', async () => {
  measureTourTarget.mockResolvedValue(null);
  const onDone = jest.fn();
  const { queryByText } = render(<CoachMarks steps={steps} onDone={onDone} onSkip={jest.fn()} />);
  await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  expect(queryByText('Alpha title')).toBeNull();
});

it('Skip tour calls onSkip', async () => {
  measureTourTarget.mockResolvedValue(RECT);
  const onSkip = jest.fn();
  const { findByText, getByText } = render(<CoachMarks steps={steps} onDone={jest.fn()} onSkip={onSkip} />);
  await findByText('Alpha title');
  fireEvent.press(getByText('Skip tour'));
  expect(onSkip).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx jest src/components/tour/__tests__/CoachMarks.test.js` — Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

Create `src/components/tour/tourSteps.js`:

```js
// Fixed tour copy — spec: docs/superpowers/specs/2026-07-22-onboarding-design.md.
// Keys resolve against the tour target registry; a key nothing registered
// for is skipped at runtime.

export const HOME_TOUR_STEPS = [
  { key: 'tab-play', title: 'Everything starts here', body: 'Tap the flag to start a round or a weekend tournament — pairs and scoring are set up for you.' },
  { key: 'tab-stats', title: 'Your game, measured', body: 'Handicap evolution, strokes gained and a coach that tells you what to fix first.' },
  { key: 'tab-feed', title: 'The group’s memories', body: 'Photos and moments from every round land here.' },
  { key: 'tab-profile', title: 'Your player card', body: 'Avatar, handicap, friends — and Settings, where you can tune the defaults.' },
];

export const SCORECARD_TOUR_STEPS = [
  { key: 'score-entry', title: 'Score the hole', body: 'Tap your strokes — points are worked out for you, extra handicap shots included.' },
  { key: 'hole-distances', title: 'Distances & the map', body: 'Live GPS distances to front, middle and back — tap them any time to fly over the hole.' },
  { key: 'hole-nav', title: 'Move through the round', body: 'This button carries you to the next hole; the running points keep the match in view.' },
];
```

Create `src/components/tour/CoachMarks.js`:

```js
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { semantic } from '../../theme/tokens';
import { measureTourTarget } from './tourTargets';

const SCRIM = 'rgba(10, 20, 15, 0.62)';
const RING_PAD = 6;

// Presentational spotlight overlay. Measures each step's registered target
// at show time; a step whose target can't be measured is skipped silently,
// and a run where nothing measures calls onDone() without rendering — the
// tour must never point at the wrong place or trap the user.
export default function CoachMarks({ steps, onDone, onSkip }) {
  const { theme } = useTheme();
  const { width: winW, height: winH } = useWindowDimensions();
  const [current, setCurrent] = useState(null); // { index, rect } | null
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const showFrom = useCallback(async (startIndex) => {
    for (let i = startIndex; i < steps.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const rect = await measureTourTarget(steps[i].key);
      if (!alive.current) return;
      if (rect) { setCurrent({ index: i, rect }); return; }
    }
    setCurrent(null);
    onDone();
  }, [steps, onDone]);

  useEffect(() => { showFrom(0); }, [showFrom]);

  if (!current) return null;
  const { index, rect } = current;
  const isLast = index >= steps.length - 1;
  const step = steps[index];
  const next = () => { if (isLast) onDone(); else showFrom(index + 1); };

  const ring = {
    left: rect.x - RING_PAD,
    top: rect.y - RING_PAD,
    width: rect.width + RING_PAD * 2,
    height: rect.height + RING_PAD * 2,
  };
  // Card above the target when the target sits in the lower half.
  const cardBelow = rect.y + rect.height / 2 < winH / 2;
  const cardPos = cardBelow
    ? { top: Math.min(ring.top + ring.height + 12, winH - 180) }
    : { bottom: Math.max(winH - ring.top + 12, 24) };
  const s = styles(theme);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" testID="coachmarks-overlay">
      {/* Scrim as four panels around the target — RN can't punch holes. */}
      <View pointerEvents="none" style={[s.scrim, { left: 0, top: 0, right: 0, height: Math.max(ring.top, 0) }]} />
      <View pointerEvents="none" style={[s.scrim, { left: 0, top: ring.top + ring.height, right: 0, bottom: 0 }]} />
      <View pointerEvents="none" style={[s.scrim, { left: 0, top: ring.top, width: Math.max(ring.left, 0), height: ring.height }]} />
      <View pointerEvents="none" style={[s.scrim, { left: ring.left + ring.width, top: ring.top, width: Math.max(winW - ring.left - ring.width, 0), height: ring.height }]} />
      <View pointerEvents="none" style={[s.ring, ring]} />
      <Pressable
        testID="coachmarks-target-press"
        accessibilityRole="button"
        accessibilityLabel={`${step.title} — next tour stop`}
        onPress={next}
        style={[s.targetPress, ring]}
      />
      <View style={[s.card, cardPos]}>
        <Text style={s.overline}>{`TOUR · ${index + 1} OF ${steps.length}`}</Text>
        <Text style={s.title}>{step.title}</Text>
        <Text style={s.body}>{step.body}</Text>
        <View style={s.row}>
          <Pressable accessibilityRole="button" onPress={onSkip} hitSlop={10} style={s.skipBtn}>
            <Text style={s.skip}>Skip tour</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={next} style={s.nextBtn}>
            <Text style={s.nextText}>{isLast ? 'Done' : 'Next'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = (theme) => StyleSheet.create({
  scrim: { position: 'absolute', backgroundColor: SCRIM },
  ring: {
    position: 'absolute', borderWidth: 2.5, borderColor: semantic.winner.dark,
    borderRadius: 26,
  },
  targetPress: { position: 'absolute' },
  card: {
    position: 'absolute', left: 20, right: 20, maxWidth: 420, alignSelf: 'center',
    backgroundColor: theme.bg.card, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: theme.border.default,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 }, elevation: 12,
  },
  overline: {
    fontFamily: 'PlusJakartaSans-Bold', fontSize: 10, letterSpacing: 1.6,
    color: theme.accent.primary,
  },
  title: {
    fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 15,
    color: theme.text.primary, marginTop: 5, marginBottom: 3,
  },
  body: {
    fontFamily: 'PlusJakartaSans-Medium', fontSize: 12.5, lineHeight: 18,
    color: theme.text.secondary, marginBottom: 12,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  skipBtn: { minHeight: 44, justifyContent: 'center' },
  skip: { fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 12.5, color: theme.text.muted },
  nextBtn: {
    minHeight: 44, minWidth: 88, alignItems: 'center', justifyContent: 'center',
    backgroundColor: theme.accent.primary, borderRadius: 12, paddingHorizontal: 20,
  },
  nextText: { fontFamily: 'PlusJakartaSans-ExtraBold', fontSize: 13, color: theme.text.inverse },
});
```

- [ ] **Step 4: Run tests** — `npx jest src/components/tour/__tests__/CoachMarks.test.js` — Expected: PASS. (If the theme mock complains, check how sibling component tests set up `ThemeContext` — mirror the pattern used in `src/components/mystats/__tests__/`.)

- [ ] **Step 5: Commit**

```bash
git add src/components/tour/tourSteps.js src/components/tour/CoachMarks.js src/components/tour/__tests__/CoachMarks.test.js
git commit -m "feat(tour): CoachMarks spotlight overlay + fixed step copy"
```

---

### Task 5: TourOverlay wiring component

**Files:**
- Create: `src/components/tour/TourOverlay.js`
- Test: `src/components/tour/__tests__/TourOverlay.test.js`

**Interfaces:**
- Consumes: `useAuth()` from `../../context/AuthContext` (`user.is_anonymous` marks guests); `useAppSettings()`; `isSettingsHydrated`/`subscribeSettingsHydration` (Task 1); `shouldShowTour`/`completeTour` (Task 2); `CoachMarks` (Task 4).
- Produces: default export `TourOverlay({ chapter, steps })` — renders `CoachMarks` only when settings are hydrated, the user is a signed-in non-guest, and the chapter flag is unset; Done and Skip both stamp the flag. Screens render it as their last child.

- [ ] **Step 1: Write the failing test**

Create `src/components/tour/__tests__/TourOverlay.test.js`:

```js
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import TourOverlay from '../TourOverlay';

const mockCoach = jest.fn(() => null);
jest.mock('../CoachMarks', () => (props) => { mockCoach(props); return null; });
jest.mock('../../../context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../../../store/tourStore', () => ({
  shouldShowTour: jest.fn(), completeTour: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../store/settingsStore', () => ({
  ...jest.requireActual('../../../store/settingsStore'),
  isSettingsHydrated: jest.fn(), subscribeSettingsHydration: jest.fn(() => () => {}),
}));
const { useAuth } = require('../../../context/AuthContext');
const { shouldShowTour, completeTour } = require('../../../store/tourStore');
const { isSettingsHydrated } = require('../../../store/settingsStore');

const steps = [{ key: 'k', title: 'T', body: 'B' }];

beforeEach(() => {
  jest.clearAllMocks();
  useAuth.mockReturnValue({ user: { id: 'u1', is_anonymous: false } });
  shouldShowTour.mockReturnValue(true);
  isSettingsHydrated.mockReturnValue(true);
});

it('renders CoachMarks when hydrated, signed-in, and flag unset', () => {
  render(<TourOverlay chapter="home" steps={steps} />);
  expect(mockCoach).toHaveBeenCalled();
});

it.each([
  ['not hydrated', () => isSettingsHydrated.mockReturnValue(false)],
  ['flag already stamped', () => shouldShowTour.mockReturnValue(false)],
  ['anonymous guest', () => useAuth.mockReturnValue({ user: { id: 'g', is_anonymous: true } })],
  ['signed out', () => useAuth.mockReturnValue({ user: null })],
])('renders nothing when %s', (_label, arrange) => {
  arrange();
  render(<TourOverlay chapter="home" steps={steps} />);
  expect(mockCoach).not.toHaveBeenCalled();
});

it('stamps the chapter flag on done and on skip, and unmounts', async () => {
  const { rerender } = render(<TourOverlay chapter="scorecard" steps={steps} />);
  mockCoach.mock.calls[0][0].onDone();
  await waitFor(() => expect(completeTour).toHaveBeenCalledWith('scorecard'));
  mockCoach.mockClear();
  rerender(<TourOverlay chapter="scorecard" steps={steps} />);
  expect(mockCoach).not.toHaveBeenCalled(); // locally dismissed even before settings round-trip
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx jest src/components/tour/__tests__/TourOverlay.test.js` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `src/components/tour/TourOverlay.js`:

```js
import React, { useState, useSyncExternalStore } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAppSettings } from '../../hooks/useAppSettings';
import { isSettingsHydrated, subscribeSettingsHydration } from '../../store/settingsStore';
import { shouldShowTour, completeTour } from '../../store/tourStore';
import CoachMarks from './CoachMarks';

// Gates a CoachMarks chapter: settings must be hydrated (so a reinstall
// doesn't flash the tour at a veteran before the server copy lands), the
// user must be a signed-in non-guest, and the chapter flag must be unset.
// Dismissal is local-first: the overlay drops immediately; the flag write
// rides the normal settings pipeline (offline-safe).
export default function TourOverlay({ chapter, steps }) {
  const { user } = useAuth();
  useAppSettings(); // re-render when synced flags arrive
  const hydrated = useSyncExternalStore(subscribeSettingsHydration, isSettingsHydrated, isSettingsHydrated);
  const [dismissed, setDismissed] = useState(false);

  const eligible = hydrated && !dismissed && !!user && !user.is_anonymous && shouldShowTour(chapter);
  if (!eligible) return null;

  const finish = () => { setDismissed(true); completeTour(chapter); };
  return <CoachMarks steps={steps} onDone={finish} onSkip={finish} />;
}
```

- [ ] **Step 4: Run tests** — `npx jest src/components/tour/__tests__/TourOverlay.test.js` — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/tour/TourOverlay.js src/components/tour/__tests__/TourOverlay.test.js
git commit -m "feat(tour): TourOverlay gate (hydration, auth, chapter flag)"
```

---

### Task 6: OnboardingScreen — display name + live username availability

**Files:**
- Modify: `src/screens/OnboardingScreen.js`
- Test: `src/screens/__tests__/OnboardingScreen.test.js` (create)

**Interfaces:**
- Consumes: `isUsernameAvailable(username)` and `upsertProfile(patch)` from `../store/profileStore` (both exist).
- Produces: the save payload becomes `{ username, displayName, gender }`. No other module consumes this screen.

- [ ] **Step 1: Write the failing test**

Create `src/screens/__tests__/OnboardingScreen.test.js`:

```js
import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import OnboardingScreen from '../OnboardingScreen';

jest.mock('../../store/profileStore', () => ({
  upsertProfile: jest.fn().mockResolvedValue({}),
  isUsernameAvailable: jest.fn().mockResolvedValue(true),
}));
const { upsertProfile, isUsernameAvailable } = require('../../store/profileStore');

const profile = { email: 'marco@example.com', username: null, displayName: 'marco', gender: null };

beforeEach(() => { jest.clearAllMocks(); jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

async function settleDebounce() {
  await act(async () => { jest.advanceTimersByTime(500); });
}

it('prefills username from email and display name from the profile', () => {
  const { getAllByDisplayValue } = render(<OnboardingScreen profile={profile} onDone={jest.fn()} />);
  expect(getAllByDisplayValue('marco').length).toBe(2); // both fields prefill "marco"
});

it('shows "Available" after the debounced check passes', async () => {
  const { findByText } = render(<OnboardingScreen profile={profile} onDone={jest.fn()} />);
  await settleDebounce();
  expect(isUsernameAvailable).toHaveBeenCalledWith('marco');
  await findByText(/Available — friends find you as @marco/);
});

it('shows "taken" and disables Continue when the handle is taken', async () => {
  isUsernameAvailable.mockResolvedValue(false);
  const { findByText, getByLabelText } = render(<OnboardingScreen profile={profile} onDone={jest.fn()} />);
  await settleDebounce();
  await findByText(/already taken/);
  expect(getByLabelText('Continue')).toBeDisabled();
});

it('offline availability check does not block Continue', async () => {
  isUsernameAvailable.mockRejectedValue(new Error('offline'));
  const { getByLabelText, getByText } = render(<OnboardingScreen profile={profile} onDone={jest.fn()} />);
  fireEvent.press(getByText('Male'));
  await settleDebounce();
  expect(getByLabelText('Continue')).toBeEnabled();
});

it('requires a non-empty display name', async () => {
  const { getByLabelText, getByText } = render(<OnboardingScreen profile={profile} onDone={jest.fn()} />);
  fireEvent.press(getByText('Male'));
  await settleDebounce();
  fireEvent.changeText(getByLabelText('Display name'), '   ');
  expect(getByLabelText('Continue')).toBeDisabled();
});

it('saves all three fields and calls onDone', async () => {
  const onDone = jest.fn();
  const { getByLabelText, getByText } = render(<OnboardingScreen profile={profile} onDone={onDone} />);
  fireEvent.changeText(getByLabelText('Display name'), 'Marco S');
  fireEvent.press(getByText('Male'));
  await settleDebounce();
  await act(async () => { fireEvent.press(getByLabelText('Continue')); });
  await waitFor(() => expect(upsertProfile).toHaveBeenCalledWith({
    username: 'marco', displayName: 'Marco S', gender: 'male',
  }));
  expect(onDone).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx jest src/screens/__tests__/OnboardingScreen.test.js` — Expected: FAIL (no Display name field, no availability copy).

- [ ] **Step 3: Implement**

In `src/screens/OnboardingScreen.js`:

(a) Extend state (after the `gender` line):

```js
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  // 'idle' | 'checking' | 'available' | 'taken' | 'unknown' (unknown = probe
  // failed, e.g. offline — never blocks Continue, save-time check stands).
  const [availability, setAvailability] = useState('idle');
```

(b) Debounced live check (after the `usernameValid` line):

```js
  useEffect(() => {
    if (!usernameValid) { setAvailability('idle'); return undefined; }
    setAvailability('checking');
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const ok = await isUsernameAvailable(trimmedUsername);
        if (!cancelled) setAvailability(ok ? 'available' : 'taken');
      } catch {
        if (!cancelled) setAvailability('unknown');
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [trimmedUsername, usernameValid]);
```

Add `useEffect` to the React import.

(c) Update `canContinue`:

```js
  const trimmedDisplayName = displayName.trim();
  const canContinue = usernameValid
    && availability !== 'taken'
    && trimmedDisplayName.length > 0 && trimmedDisplayName.length <= 40
    && (gender === 'male' || gender === 'female')
    && !saving;
```

(d) In `submit()`, change the upsert to include the display name:

```js
      await upsertProfile({ username: trimmedUsername, displayName: trimmedDisplayName, gender });
```

(e) Username hint line becomes availability-aware — replace the existing `fieldHint` Text under the username input with:

```js
          <Text style={[
            s.fieldHint,
            availability === 'available' && { color: theme.accent.primary, fontFamily: 'PlusJakartaSans-SemiBold' },
            availability === 'taken' && { color: theme.destructive ?? '#c8102e' },
          ]}>
            {username.length > 0 && !usernameValid
              ? 'Must be 3–20 characters: lowercase letters, digits or underscores.'
              : availability === 'taken'
                ? 'That username is already taken. Pick another one.'
                : availability === 'available'
                  ? `✓ Available — friends find you as @${trimmedUsername}`
                  : 'Unique handle friends use to find you. You can change it later.'}
          </Text>
```

(Check how the destructive color is exposed — other screens reference `theme.destructive` or `semantic.destructive`; mirror whatever `ProfileScreen`/`SettingsScreen` use for error text.)

(f) Add the Display name field group between the username and gender groups:

```js
        <View style={s.fieldGroup}>
          <Text style={s.fieldLabel}>Display name</Text>
          <TextInput
            style={s.input}
            accessibilityLabel="Display name"
            placeholder="Your name"
            placeholderTextColor={theme.text.muted}
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            selectionColor={theme.accent.primary}
            value={displayName}
            onChangeText={setDisplayName}
            maxLength={40}
          />
          <Text style={s.fieldHint}>How you appear on scorecards and leaderboards.</Text>
        </View>
```

Also add `accessibilityLabel="Username"` to the username `TextInput`, and change the subtitle to `Three quick things before you tee off.`

- [ ] **Step 4: Run tests** — `npx jest src/screens/__tests__/OnboardingScreen.test.js` — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/screens/OnboardingScreen.js src/screens/__tests__/OnboardingScreen.test.js
git commit -m "feat(onboarding): display name field + live username availability"
```

---

### Task 7: chapter 1 — tab bar targets + Home overlay

**Files:**
- Modify: `src/navigation/FloatingTabBar.js`
- Modify: `src/screens/HomeScreen.js`
- Test: `src/navigation/__tests__/FloatingTabBar.test.js` (extend)

**Interfaces:**
- Consumes: `useTourTarget` (Task 3), `TourOverlay` (Task 5), `HOME_TOUR_STEPS` (Task 4).
- Produces: tab bar registers targets `tab-play` (Home center button), `tab-stats` (MyStats), `tab-feed` (Feed), `tab-profile` (Profile). History registers nothing.

- [ ] **Step 1: Write the failing test**

In `src/navigation/__tests__/FloatingTabBar.test.js`, add a describe block (reusing the file's existing render helper/mocks — read the file first and follow its setup). To make registration observable in jsdom (where nodes lack `measureInWindow`), first add a test-only inspector to `tourTargets.js`:

```js
// tourTargets.js — test-only visibility into what is currently registered.
export function __getRegisteredTourKeysForTests() { return [...targets.keys()]; }
```

Then the test:

```js
import { __getRegisteredTourKeysForTests, __resetTourTargetsForTests } from '../../components/tour/tourTargets';

describe('tour target registration', () => {
  beforeEach(() => __resetTourTargetsForTests());

  it('registers spotlight targets for play, stats, feed and profile — not history', () => {
    renderTabBar(); // the file's existing helper rendering all 5 routes
    const keys = __getRegisteredTourKeysForTests();
    expect(keys).toEqual(expect.arrayContaining(['tab-play', 'tab-stats', 'tab-feed', 'tab-profile']));
    expect(keys).not.toContain('tab-history');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `npx jest src/navigation/__tests__/FloatingTabBar.test.js` — Expected: new describe FAILS (no keys registered).

- [ ] **Step 3: Implement**

(a) `src/navigation/FloatingTabBar.js` — import and key map at top:

```js
import { useTourTarget } from '../components/tour/tourTargets';

// Route name → tour target key; History deliberately has no stop.
const TOUR_TARGET_KEYS = {
  Home: 'tab-play', MyStats: 'tab-stats', Feed: 'tab-feed', Profile: 'tab-profile',
};
```

(b) In `TabItem`, register the ref on the measurable surface (the `Animated.View` already carries `testID={...-tab-surface}`; Animated.View forwards native measure methods):

```js
function TabItem({ route, item, center, focused, onPress, theme, styles }) {
  const scale = usePopOnFocus(focused);
  const tourRef = useTourTarget(TOUR_TARGET_KEYS[route.name] ?? null);
  ...
      <Animated.View
        ref={tourRef}
        testID={`${route.name}-tab-surface`}
        ...
```

(If route names differ from `Home/MyStats/Feed/Profile`, read `src/navigation/tabBarModel.js` for the actual names and key the map off those.)

(c) `src/screens/HomeScreen.js` — imports:

```js
import TourOverlay from '../components/tour/TourOverlay';
import { HOME_TOUR_STEPS } from '../components/tour/tourSteps';
```

Render `<TourOverlay chapter="home" steps={HOME_TOUR_STEPS} />` as the **last child of the component's outermost container** (find the final closing tag of the root view/container in HomeScreen's return and insert directly before it). Caveat: the tab bar lives outside HomeScreen's view tree (it's the navigator's tab bar), but `measureInWindow` yields window coordinates and the overlay is absolute-filled over HomeScreen — if HomeScreen's root doesn't cover the tab bar region, the ring/panels will clip. If Task 10's manual verification shows clipping, move the `TourOverlay` render to `App.js` beside `MainTabs` (inside the same parent, after the navigator) gated on the Home tab being focused; prefer the HomeScreen placement first because it's simpler and scopes the overlay naturally.

- [ ] **Step 4: Run tests**

Run: `npx jest src/navigation/__tests__/FloatingTabBar.test.js src/screens/__tests__/HomeScreen.quickStart.test.js`
Expected: PASS. If the HomeScreen suite starts failing on tour internals (auth/settings), mock `../../components/tour/TourOverlay` to `() => null` in that suite's setup.

- [ ] **Step 5: Commit**

```bash
git add src/navigation/FloatingTabBar.js src/screens/HomeScreen.js src/navigation/__tests__/FloatingTabBar.test.js src/components/tour/tourTargets.js
git commit -m "feat(tour): chapter 1 — tab bar spotlight targets + Home overlay"
```

---

### Task 8: chapter 2 — scorecard targets + overlay

**Files:**
- Modify: `src/components/scorecard/HoleDistanceBlock.js`
- Modify: `src/components/scorecard/HolePage.js`
- Modify: `src/components/scorecard/HoleView.js`
- Modify: `src/screens/ScorecardScreen.js`
- Test: `src/components/scorecard/__tests__/HoleDistanceBlock.test.js` (extend)

**Interfaces:**
- Consumes: `useTourTarget` + `__getRegisteredTourKeysForTests` (Tasks 3/7), `TourOverlay` (Task 5), `SCORECARD_TOUR_STEPS` (Task 4).
- Produces: registered keys `hole-distances` (distance block Pressable), `score-entry` (first player card wrapper in HolePage), `hole-nav` (next-hole button wrapper in HoleView).

- [ ] **Step 1: Write the failing test**

In `src/components/scorecard/__tests__/HoleDistanceBlock.test.js`, add (following the file's existing render setup):

```js
import { __getRegisteredTourKeysForTests, __resetTourTargetsForTests } from '../../tour/tourTargets';

it('registers itself as the hole-distances tour target', () => {
  __resetTourTargetsForTests();
  renderDistanceBlock(); // the file's existing helper
  expect(__getRegisteredTourKeysForTests()).toContain('hole-distances');
});
```

- [ ] **Step 2: Run to verify it fails** — `npx jest src/components/scorecard/__tests__/HoleDistanceBlock.test.js` — Expected: new test FAILS (key not registered).

- [ ] **Step 3: Implement**

(a) `HoleDistanceBlock.js` — hook + ref on **both** return-branch Pressables:

```js
import { useTourTarget } from '../tour/tourTargets';
...
  const tourRef = useTourTarget('hole-distances');
  // both branches:
  <Pressable ref={tourRef} onPress={onPress} hitSlop={10} style={s.block} ... >
```

(b) `HolePage.js` — where the players array maps to `PlayerCard` (around line 240-250), register the first card:

```js
import { useTourTarget } from '../tour/tourTargets';
...
  const scoreEntryRef = useTourTarget('score-entry');
...
  // in the map — wrap only the first card; collapsable={false} keeps the
  // wrapper measurable on Android:
  i === 0 ? (
    <View key={player.id} ref={scoreEntryRef} collapsable={false}>
      <PlayerCard ... />
    </View>
  ) : (
    <PlayerCard key={player.id} ... />
  )
```

(Adapt to the file's actual map variables/props — keep the existing `PlayerCard` props identical; only the wrapper is new. Hooks go at `HolePage`'s top level. If `HolePage` is memoized with a custom comparator (lines ~50-60), the ref callback is stable so no comparator change is needed.)

(c) `HoleView.js` — wrap the next-hole `TouchableOpacity` (~line 397, the `s.saveBtn` one rendering `Hole ${currentHole + 1}` / Finish):

```js
import { useTourTarget } from '../tour/tourTargets';
...
  const holeNavRef = useTourTarget('hole-nav');   // top level, beside other hooks
...
  <View ref={holeNavRef} collapsable={false}>
    <TouchableOpacity style={[s.saveBtn, primaryDisabled && s.saveBtnDisabled]} ... >
      ...
    </TouchableOpacity>
  </View>
```

Hooks must be called at `HoleView`'s top level (not inside the IIFE that renders the button).

(d) `src/screens/ScorecardScreen.js` — after the `view === 'hole' ? <HoleView .../> : <GridView .../>` block (line ~1722), add:

```js
      {view === 'hole' && (
        <TourOverlay chapter="scorecard" steps={SCORECARD_TOUR_STEPS} />
      )}
```

with imports:

```js
import TourOverlay from '../components/tour/TourOverlay';
import { SCORECARD_TOUR_STEPS } from '../components/tour/tourSteps';
```

- [ ] **Step 4: Run tests**

Run: `npx jest src/components/scorecard/__tests__/ --silent`
Expected: PASS — all existing scorecard suites stay green; if any mounts `HoleView`/`HolePage` and fails on the tour import, mock `../tour/tourTargets` to `{ useTourTarget: () => () => {} }` in that suite's setup.

- [ ] **Step 5: Commit**

```bash
git add src/components/scorecard/HoleDistanceBlock.js src/components/scorecard/HolePage.js src/components/scorecard/HoleView.js src/screens/ScorecardScreen.js src/components/scorecard/__tests__/HoleDistanceBlock.test.js
git commit -m "feat(tour): chapter 2 — scorecard spotlight targets + overlay"
```

---

### Task 9: Settings — "Replay app tour" row

**Files:**
- Modify: `src/screens/SettingsScreen.js`
- Test: `src/screens/__tests__/SettingsScreen.test.js` (extend)

**Interfaces:**
- Consumes: `resetTour` (Task 2).

- [ ] **Step 1: Write the failing test**

In `src/screens/__tests__/SettingsScreen.test.js` add, following the file's existing mock/render conventions (it already mocks settings internals — extend, don't duplicate):

```js
jest.mock('../../store/tourStore', () => ({ resetTour: jest.fn().mockResolvedValue(undefined) }));
const { resetTour } = require('../../store/tourStore');

it('replays the app tour from the DISPLAY section', async () => {
  const { getByTestId } = renderSettings(); // existing helper
  await act(async () => { fireEvent.press(getByTestId('setting-replayTour')); });
  expect(resetTour).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run to verify it fails** — `npx jest src/screens/__tests__/SettingsScreen.test.js` — Expected: FAIL, testID not found.

- [ ] **Step 3: Implement**

In `src/screens/SettingsScreen.js`, inside the DISPLAY `<Reveal>` block, after the `s.appearanceRow` view (line ~174), add:

```js
          <PressableScale
            testID="setting-replayTour"
            style={s.replayRow}
            onPress={async () => { haptic('selection'); await resetTour(); }}
            accessibilityRole="button"
            accessibilityLabel="Replay app tour"
          >
            <Feather name="refresh-ccw" size={16} color={theme.accent.primary} />
            <View style={{ flex: 1 }}>
              <Text style={s.replayLabel}>Replay app tour</Text>
              <Text style={s.fieldHint}>The spotlights show again on Home and the scorecard.</Text>
            </View>
          </PressableScale>
```

Import `resetTour` from `../store/tourStore`. Add styles beside the other DISPLAY styles (match the screen's existing row styling conventions — reuse an existing hint style if `s.fieldHint` doesn't exist in this file; check first):

```js
    replayRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      marginTop: 14, minHeight: 44,
    },
    replayLabel: {
      fontFamily: 'PlusJakartaSans-SemiBold', fontSize: 14, color: theme.text.primary,
    },
```

- [ ] **Step 4: Run tests** — `npx jest src/screens/__tests__/SettingsScreen.test.js` — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/screens/SettingsScreen.js src/screens/__tests__/SettingsScreen.test.js
git commit -m "feat(tour): Replay app tour row in Settings"
```

---

### Task 10: full-suite green + manual verification

**Files:** none new — fixes only if the sweep finds breakage.

- [ ] **Step 1: Lint** — Run: `npm run lint` — Expected: 0 errors (warnings only if pre-existing).
- [ ] **Step 2: Full test suite** — Run: `npm test -- --silent` — Expected: all suites pass, no new failures vs master (ignore known `.claude/worktrees` / `.worktrees` scan noise if it appears; it predates this work).
- [ ] **Step 3: Manual smoke via the `verify` skill (Playwright on Expo web):**
  1. Fresh (or username-cleared) account → gate shows username/display name/gender; type a taken username → inline "already taken", Continue disabled; valid input → "✓ Available".
  2. Continue → Home → chapter 1 spotlights the center Play button with "TOUR · 1 OF 4"; Next through Stats/Feed/Profile; Done.
  3. Reload → no tour (flag stamped).
  4. Start a quick round → scorecard → chapter 2 spotlights score entry → distance block → next-hole button ("TOUR · 1 OF 3" … "3 OF 3").
  5. Settings → Replay app tour → Home shows chapter 1 again.
  If the ring/scrim clips at the tab bar in step 2, apply the Task 7 fallback (overlay at navigator level) and re-verify.
- [ ] **Step 4: Commit any fixes**

```bash
git add -A && git commit -m "fix(tour): verification fixes"
```
