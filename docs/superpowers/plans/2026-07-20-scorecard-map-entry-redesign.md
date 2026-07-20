# Scorecard Map Entry Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the standalone GPS distance strip with a distance block inside the hole header, and restyle the flyover modal as a full-height slide-up sheet.

**Architecture:** `HoleDistanceBlock` is a new presentational component rendered inside `HolePage`'s hole header (right side; PAR/SI move next to the hole number). `HoleView` keeps the single `useGpsDistances` watch and threads `gps` + a stable `onOpenFlyover` down; `holePagePropsEqual` ignores gps churn on inactive pages. `HoleFlyover` keeps its Modal host but becomes transparent with a rounded, grabber-topped sheet and swipe-down-to-dismiss on the header only.

**Tech Stack:** Expo SDK 54 / RN 0.81 / React 19, react-native-web, jest-expo + @testing-library/react-native. No new dependencies (no bottom-sheet library — plain `Animated` + `PanResponder`).

**Spec:** `docs/superpowers/specs/2026-07-20-scorecard-map-entry-redesign-design.md`

## Global Constraints

- **Work in the flyover worktree:** `/Users/marcospecker/golf-partner-worktrees/feat-flyover-distance-offline` (branch `feat/flyover-distance-offline`). This branch owns `HoleFlyover`; do NOT implement on master.
- Run tests from the worktree root: `npx jest <path>` (full suite: `npx jest`). Two pre-existing failures exist in the baseline — compare against baseline, don't chase them.
- Domain logic stays in `src/store` / `src/lib`; these are UI-only changes.
- Theme access via `useTheme()`; fonts are `PlusJakartaSans-*` / `PlayfairDisplay-*`; distances always meters, `Math.round`, `fontVariant: ['tabular-nums']`.
- `useGpsDistances` returns `{ available, distances, accuracy, position }` where `distances` is `{ front, center, back, pin, kind, hazards[] }|null` and each hazard is `{ kind: 'bunker'|'water', reach, carry }`. Do not modify the hook.

---

### Task 1: `HoleDistanceBlock` component

**Files:**
- Create: `src/components/scorecard/HoleDistanceBlock.js`
- Test: `src/components/scorecard/__tests__/HoleDistanceBlock.test.js`

**Interfaces:**
- Consumes: `useTheme()` from `src/theme/ThemeContext`; `gps` object shaped as in Global Constraints.
- Produces: `export function HoleDistanceBlock({ gps, onPress })` — renders `null` when `!gps?.available`; otherwise a right-aligned pressable block. Task 2 imports it by this exact name.

- [ ] **Step 1: Write the failing test**

```js
// src/components/scorecard/__tests__/HoleDistanceBlock.test.js
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { HoleDistanceBlock } from '../HoleDistanceBlock';

jest.mock('../../../theme/ThemeContext', () => ({
  useTheme: () => {
    const { light, typography, fonts, spacing, radius } = jest.requireActual('../../../theme/tokens');
    return { theme: { ...light, typography, fonts, spacing, radius, mode: 'light', isDark: false } };
  },
}));

const gpsBase = (over = {}, dist = {}) => ({
  available: true,
  accuracy: 8,
  position: [38.5577, -0.1491],
  distances: {
    front: 312.4, center: 326.2, back: 339.1, pin: null, kind: 'hole',
    hazards: [],
    ...dist,
  },
  ...over,
});

describe('HoleDistanceBlock', () => {
  it('renders nothing when gps is unavailable', () => {
    const { toJSON } = render(<HoleDistanceBlock gps={{ available: false, distances: null, accuracy: null, position: null }} onPress={() => {}} />);
    expect(toJSON()).toBeNull();
  });

  it('shows centre hero plus front/back line', () => {
    const { getByText } = render(<HoleDistanceBlock gps={gpsBase()} onPress={() => {}} />);
    getByText('326');
    getByText(/F 312\s+B 339/);
  });

  it('shows one joined hazard line when both kinds are ahead', () => {
    const gps = gpsBase({}, { hazards: [
      { kind: 'bunker', reach: 96.2, carry: 118.4 },
      { kind: 'water', reach: 120.7, carry: 139.2 },
    ] });
    const { getByText } = render(<HoleDistanceBlock gps={gps} onPress={() => {}} />);
    getByText('Bunker 96–118 · Water 121–139');
  });

  it('shows only the nearest hazard of each kind', () => {
    const gps = gpsBase({}, { hazards: [{ kind: 'bunker', reach: 96, carry: 118 }, { kind: 'bunker', reach: 140, carry: 160 }] });
    const { getByText, queryByText } = render(<HoleDistanceBlock gps={gps} onPress={() => {}} />);
    getByText('Bunker 96–118');
    expect(queryByText(/140/)).toBeNull();
  });

  it('shows the NEAREST GREEN overline for nearest-mode courses', () => {
    const { getByText } = render(<HoleDistanceBlock gps={gpsBase({}, { kind: 'nearest' })} onPress={() => {}} />);
    getByText('NEAREST GREEN');
  });

  it('shows accuracy caption on a poor fix', () => {
    const { getByText } = render(<HoleDistanceBlock gps={gpsBase({ accuracy: 31 })} onPress={() => {}} />);
    getByText('±31m');
  });

  it('collapses to an off-course line beyond 3km', () => {
    const { getByText, queryByText } = render(
      <HoleDistanceBlock gps={gpsBase({}, { center: 4620 })} onPress={() => {}} />,
    );
    getByText('Off course · 4.6 km');
    expect(queryByText('4620')).toBeNull();
  });

  it('shows a getting-fix state before the first fix', () => {
    const { getByText } = render(
      <HoleDistanceBlock gps={{ available: true, distances: null, accuracy: null, position: null }} onPress={() => {}} />,
    );
    getByText('Getting GPS fix');
  });

  it('fires onPress from every state (block is the map entry)', () => {
    const onPress = jest.fn();
    const { getByLabelText } = render(<HoleDistanceBlock gps={gpsBase()} onPress={onPress} />);
    fireEvent.press(getByLabelText('Open hole map'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/scorecard/__tests__/HoleDistanceBlock.test.js`
Expected: FAIL — `Cannot find module '../HoleDistanceBlock'`

- [ ] **Step 3: Write the implementation**

```js
// src/components/scorecard/HoleDistanceBlock.js
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';

function fmt(meters) {
  return meters == null ? '—' : `${Math.round(meters)}`;
}

// Right-hand side of the hole header: live GPS distances to the green, and
// the tap target that opens the hole map sheet. Replaces the old standalone
// GpsDistancePanel strip. Renders nothing when the course has no geometry or
// location is denied — the header then looks exactly like the pre-GPS layout.
export function HoleDistanceBlock({ gps, onPress }) {
  const { theme } = useTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  if (!gps?.available) return null;

  const { distances, accuracy } = gps;
  // Same thresholds as the old strip: >3km = not on the course; >25m = the
  // fix is too loose to trust to the meter.
  const offCourse = distances && distances.center > 3000;
  const poorFix = accuracy != null && accuracy > 25;
  // One entry per hazard kind — the nearest ahead is the one in play.
  const bunker = distances?.hazards?.find((h) => h.kind === 'bunker');
  const water = distances?.hazards?.find((h) => h.kind === 'water');
  const hazardLine = [
    bunker && `Bunker ${fmt(bunker.reach)}–${fmt(bunker.carry)}`,
    water && `Water ${fmt(water.reach)}–${fmt(water.carry)}`,
  ].filter(Boolean).join(' · ');

  return (
    <Pressable onPress={onPress} hitSlop={10} style={s.block} accessibilityRole="button" accessibilityLabel="Open hole map">
      {distances?.kind === 'nearest' && <Text style={s.overline}>NEAREST GREEN</Text>}
      {offCourse ? (
        <Text style={s.off}>{`Off course · ${(distances.center / 1000).toFixed(1)} km`}</Text>
      ) : distances ? (
        <>
          <View style={s.heroRow}>
            <Feather name="navigation" size={13} color={theme.accent.primary} />
            <Text style={s.hero}>{fmt(distances.center)}</Text>
            <Text style={s.unit}>m</Text>
            <Feather name="chevron-right" size={14} color={theme.text.muted} />
          </View>
          <Text style={s.fb}>{`F ${fmt(distances.front)}  B ${fmt(distances.back)}`}</Text>
          {poorFix && <Text style={s.caption}>{`±${Math.round(accuracy)}m`}</Text>}
          {!!hazardLine && <Text style={s.hzd}>{hazardLine}</Text>}
        </>
      ) : (
        <>
          <View style={s.heroRow}>
            <Feather name="navigation" size={13} color={theme.accent.primary} />
            <Text style={s.hero}>…</Text>
          </View>
          <Text style={s.caption}>Getting GPS fix</Text>
        </>
      )}
    </Pressable>
  );
}

function makeStyles(theme) {
  return StyleSheet.create({
    block: { alignItems: 'flex-end', gap: 1 },
    overline: {
      color: theme.text.muted,
      fontSize: 9,
      fontFamily: 'PlusJakartaSans-Bold',
      letterSpacing: 1.2,
    },
    heroRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    hero: {
      color: theme.accent.primary,
      fontSize: 24,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      letterSpacing: -0.5,
      fontVariant: ['tabular-nums'],
    },
    unit: {
      color: theme.accent.primary,
      fontSize: 12,
      fontFamily: 'PlusJakartaSans-Bold',
    },
    fb: {
      color: theme.text.muted,
      fontSize: 11,
      fontFamily: 'PlusJakartaSans-Bold',
      fontVariant: ['tabular-nums'],
    },
    hzd: {
      color: theme.text.muted,
      fontSize: 10,
      fontFamily: 'PlusJakartaSans-SemiBold',
      fontVariant: ['tabular-nums'],
    },
    caption: { color: theme.text.muted, fontSize: 10 },
    off: {
      color: theme.text.muted,
      fontSize: 12,
      fontFamily: 'PlusJakartaSans-SemiBold',
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/components/scorecard/__tests__/HoleDistanceBlock.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/scorecard/HoleDistanceBlock.js src/components/scorecard/__tests__/HoleDistanceBlock.test.js
git commit -m "feat(scorecard): HoleDistanceBlock — header-resident GPS distances"
```

---

### Task 2: Header integration — strip deleted, block threaded through

**Files:**
- Modify: `src/components/scorecard/HolePage.js` (header JSX ~lines 135–156; `holePagePropsEqual` ~lines 42–78; props destructure)
- Modify: `src/components/scorecard/styles.js` (hole header styles ~lines 249–295)
- Modify: `src/components/scorecard/HoleView.js` (~lines 11, 197, and the `HolePage` render loop)
- Delete: `src/components/scorecard/GpsDistancePanel.js`
- Test: `src/components/scorecard/__tests__/HolePage.test.js` (extend)

**Interfaces:**
- Consumes: `HoleDistanceBlock({ gps, onPress })` from Task 1.
- Produces: `HolePage` gains props `gps` (hook return object) and `onOpenFlyover` (stable `() => void`); `holePagePropsEqual` compares them as specified below. Task 3 relies on `HoleView`'s existing `flyoverOpen` state being set by `onOpenFlyover`.

- [ ] **Step 1: Write the failing tests** — append to `src/components/scorecard/__tests__/HolePage.test.js` (reuse its existing `baseProps()` helper and theme mock):

```js
describe('header distance block wiring', () => {
  const gps = (center) => ({
    available: true, accuracy: 5, position: [1, 2],
    distances: { front: center - 14, center, back: center + 13, pin: null, kind: 'hole', hazards: [] },
  });

  it('propsEqual re-renders the ACTIVE page when gps changes', () => {
    const prev = { ...baseProps(), isActive: true, gps: gps(326), onOpenFlyover: () => {} };
    const next = { ...prev, gps: gps(320) };
    expect(holePagePropsEqual(prev, next)).toBe(false);
  });

  it('propsEqual skips INACTIVE pages on gps churn', () => {
    const prev = { ...baseProps(), isActive: false, gps: gps(326), onOpenFlyover: () => {} };
    const next = { ...prev, gps: gps(320) };
    expect(holePagePropsEqual(prev, next)).toBe(true);
  });

  it('propsEqual re-renders when onOpenFlyover identity changes', () => {
    const prev = { ...baseProps(), gps: gps(326), onOpenFlyover: () => {} };
    const next = { ...prev, onOpenFlyover: () => {} };
    expect(holePagePropsEqual(prev, next)).toBe(false);
  });

  it('renders PAR and SI beside the hole number and the distance block on the right', () => {
    const props = { ...baseProps(), isActive: true, gps: gps(326), onOpenFlyover: jest.fn() };
    const { getByText, getByLabelText } = render(<HolePage {...props} />);
    getByText('PAR');
    getByText('SI');
    getByText('326');
    fireEvent.press(getByLabelText('Open hole map'));
    expect(props.onOpenFlyover).toHaveBeenCalledTimes(1);
  });

  it('renders the plain header when gps is unavailable', () => {
    const props = { ...baseProps(), gps: { available: false, distances: null, accuracy: null, position: null }, onOpenFlyover: () => {} };
    const { getByText, queryByLabelText } = render(<HolePage {...props} />);
    getByText('PAR');
    expect(queryByLabelText('Open hole map')).toBeNull();
  });
});
```

Add `fireEvent` to the existing `@testing-library/react-native` import if it isn't imported yet.

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx jest src/components/scorecard/__tests__/HolePage.test.js`
Expected: the five new tests FAIL (propsEqual ignores `gps`; header shows no `326`); pre-existing tests still pass.

- [ ] **Step 3: Update `holePagePropsEqual` in `HolePage.js`**

Add `onOpenFlyover` to the big strict-compare list, and after that `if (...) return false;` block add:

```js
  // GPS distances tick every second; only the visible page pays for them.
  // isActive flipping already forces a re-render on swipe, so a page that
  // becomes active immediately catches up to the latest fix.
  if ((prev.isActive || next.isActive) && prev.gps !== next.gps) return false;
```

- [ ] **Step 4: Rework the header JSX in `HolePage.js`**

Destructure the new props (`gps`, `onOpenFlyover`) alongside the existing ones, import the block —

```js
import { HoleDistanceBlock } from './HoleDistanceBlock';
```

— and replace the header (current lines ~136–156):

```jsx
      {/* Hole header — PAR/SI ride with the hole number; the right side is
          the live GPS distance block, which is also the map entry point. */}
      <View style={s.holeHeaderCard}>
        <View style={s.holeHeaderLeft}>
          <Text style={s.holeHeaderRound}>{courseName} -- Round {roundIndex + 1}</Text>
          <View style={s.holeNumberRow}>
            <Text style={s.holeNumberLabel}>HOLE</Text>
            <Text style={s.holeNumber}>{pageHole.number}</Text>
            <View style={s.holeMetaInline}>
              <View style={s.holeMetaItem}>
                <Text style={s.holeMetaLabel}>PAR</Text>
                <Text style={s.holeMetaValue}>{pageHole.par}</Text>
              </View>
              <View style={s.holeMetaItem}>
                <Text style={s.holeMetaLabel}>SI</Text>
                <Text style={s.holeMetaValue}>{pageHole.strokeIndex}</Text>
              </View>
            </View>
          </View>
        </View>
        <View style={s.holeHeaderRightWrap}>
          <HoleDistanceBlock gps={gps} onPress={onOpenFlyover} />
        </View>
      </View>
```

- [ ] **Step 5: Adjust `styles.js`**

In the hole header section add one style (keep all existing ones — `holeHeaderRight` stays for now if referenced elsewhere; delete it only if `grep -rn holeHeaderRight src/` shows no other consumer):

```js
    holeMetaInline: { flexDirection: 'row', gap: 16, marginLeft: 14, alignSelf: 'flex-end', paddingBottom: 6 },
```

- [ ] **Step 6: Rewire `HoleView.js`**

- Remove the `GpsDistancePanel` import (line 11) and its render (line ~197).
- Above the return, add a stable callback:

```js
  const openFlyover = useCallback(() => setFlyoverOpen(true), []);
```

(`useCallback` is already imported or add it to the React import.)
- In the pager loop, pass the two new props to every `HolePage`:

```jsx
                gps={gps}
                onOpenFlyover={openFlyover}
```

- Delete the file: `git rm src/components/scorecard/GpsDistancePanel.js`
- Run `grep -rn "GpsDistancePanel" src/` — expected: no matches.

- [ ] **Step 7: Run the scorecard tests**

Run: `npx jest src/components/scorecard`
Expected: PASS, including the five new tests.

- [ ] **Step 8: Run the full suite and compare to baseline**

Run: `npx jest 2>&1 | tail -20`
Expected: only the two pre-existing baseline failures; no new ones.

- [ ] **Step 9: Commit**

```bash
git add -A src/components/scorecard
git commit -m "feat(scorecard): move GPS distances into the hole header, delete the strip"
```

---

### Task 3: Flyover sheet presentation

**Files:**
- Modify: `src/components/scorecard/HoleFlyover.js` (whole presentation shell; map content untouched)
- Modify: `src/components/scorecard/HoleView.js` (`HoleFlyover` call site ~line 198)
- Test: `src/components/scorecard/__tests__/HoleFlyover.sheet.test.js` (new)

**Interfaces:**
- Consumes: `HoleView`'s `gps` (for `centerDistance`) and `round.holes` (for `par`/`strokeIndex`).
- Produces: `HoleFlyover({ courseName, holeNumber, par, strokeIndex, centerDistance, position, visible, onClose, onEdit })` — the three new props are optional; header omits what's missing.

- [ ] **Step 1: Write the failing test**

```js
// src/components/scorecard/__tests__/HoleFlyover.sheet.test.js
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { HoleFlyover } from '../HoleFlyover';

// The map itself is a WebView/iframe — out of scope for this test.
jest.mock('../HoleMapView', () => ({ HoleMapView: () => null }));
jest.mock('../../../lib/geo', () => ({
  holeFeatures: () => ({
    start: [38.5577, -0.1491], greenCenter: [38.5551, -0.1475],
    green: [], greenFront: null, greenBack: null, pin: null, hazards: [],
  }),
  subscribeCourseGeometry: () => () => {},
  getCourseGeometryVersion: () => 1,
}));

const props = {
  courseName: 'Villaitana Levante', holeNumber: 7, par: 4, strokeIndex: 5,
  centerDistance: 326.4, position: [38.5577, -0.1491],
  visible: true, onClose: jest.fn(),
};

describe('HoleFlyover sheet chrome', () => {
  it('shows hole meta and live centre distance in the sheet header', () => {
    const { getByText } = render(<HoleFlyover {...props} />);
    getByText('Hole 7');
    getByText('Par 4 · SI 5');
    getByText('326 m');
  });

  it('renders a grabber and fires onClose from the close button', () => {
    const { getByTestId } = render(<HoleFlyover {...props} />);
    getByTestId('flyover-grabber');
    fireEvent.press(getByTestId('flyover-close'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('omits meta it was not given', () => {
    const { queryByText, getByText } = render(
      <HoleFlyover {...props} par={undefined} strokeIndex={undefined} centerDistance={null} />,
    );
    getByText('Hole 7');
    expect(queryByText(/Par/)).toBeNull();
    expect(queryByText(/ m$/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/components/scorecard/__tests__/HoleFlyover.sheet.test.js`
Expected: FAIL — no `Par 4 · SI 5`, no grabber testID.

- [ ] **Step 3: Restyle `HoleFlyover` as a sheet**

Keep all data-building code (`feat`, `anchorInfo`, `data`) unchanged. Replace imports, signature, and the returned JSX/styles:

```js
import React, { useMemo, useRef, useSyncExternalStore } from 'react';
import {
  View, Text, StyleSheet, Modal, Pressable, Animated, PanResponder,
} from 'react-native';
```

```js
export function HoleFlyover({
  courseName, holeNumber, par, strokeIndex, centerDistance,
  position, visible, onClose, onEdit,
}) {
```

Inside the component (after the `data` memo), the drag-to-dismiss plumbing. The
pan responder must live on the grabber/header only — the map keeps every
gesture:

```js
  // Swipe-down on the grabber/header dismisses; the map owns its own gestures.
  const dragY = useRef(new Animated.Value(0)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderMove: (_, g) => { if (g.dy > 0) dragY.setValue(g.dy); },
    onPanResponderRelease: (_, g) => {
      if (g.dy > 120 || g.vy > 0.8) {
        dragY.setValue(0);
        onCloseRef.current?.();
      } else {
        Animated.spring(dragY, { toValue: 0, useNativeDriver: true }).start();
      }
    },
    onPanResponderTerminate: () => { dragY.setValue(0); },
  })).current;
```

New return:

```jsx
  if (!visible) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <Pressable style={s.backdropTouch} onPress={onClose} accessibilityLabel="Close hole map" />
        <Animated.View style={[s.sheet, { transform: [{ translateY: dragY }] }]}>
          <View {...pan.panHandlers}>
            <View style={s.grabber} testID="flyover-grabber" />
            <View style={s.header}>
              <View style={s.titleWrap}>
                <Text style={s.title} numberOfLines={1}>{feat ? `Hole ${holeNumber}` : 'No map data'}</Text>
                {par != null && strokeIndex != null && (
                  <Text style={s.subtitle}>{`Par ${par} · SI ${strokeIndex}`}</Text>
                )}
              </View>
              <View style={s.hbtns}>
                {centerDistance != null && (
                  <Text style={s.distance}>{`${Math.round(centerDistance)} m`}</Text>
                )}
                {onEdit && feat && (
                  <Pressable onPress={onEdit} style={s.editBtn} hitSlop={8}>
                    <Feather name="edit-2" size={15} color="#0a0d10" />
                    <Text style={s.editTxt}>Edit</Text>
                  </Pressable>
                )}
                <Pressable onPress={onClose} style={s.closeBtn} hitSlop={8} testID="flyover-close">
                  <Feather name="x" size={22} color="#fff" />
                </Pressable>
              </View>
            </View>
          </View>
          {data ? (
            <HoleMapView data={data} player={position} anchor={anchorInfo} style={s.map} />
          ) : (
            <View style={s.center}><Text style={s.muted}>This course has no green geometry yet.</Text></View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
```

New styles (replacing `root`/`header`/`title`; keep `editBtn`, `editTxt`, `closeBtn`, `map`, `center`, `muted` as they are):

```js
const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(12,26,20,0.38)', justifyContent: 'flex-end' },
  backdropTouch: { position: 'absolute', top: 0, left: 0, right: 0, height: 28 },
  sheet: {
    height: '96%',
    backgroundColor: '#0a0d10',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  grabber: {
    alignSelf: 'center', width: 36, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.35)', marginTop: 8,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingTop: 8, paddingBottom: 10,
  },
  titleWrap: { flex: 1, gap: 1 },
  title: { color: '#fff', fontSize: 17, fontWeight: '800' },
  subtitle: { color: '#9fb0a4', fontSize: 12, fontWeight: '600' },
  hbtns: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  distance: { color: '#57ae5b', fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#57ae5b', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  editTxt: { color: '#0a0d10', fontWeight: '700', fontSize: 13 },
  closeBtn: { padding: 4 },
  map: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: '#9fb0a4', fontSize: 15 },
});
```

Note the old `paddingTop: 52` status-bar spacer is gone — the sheet's top inset (4% of the screen) plays that role now.

- [ ] **Step 4: Pass the new props from `HoleView.js`**

At the `HoleFlyover` call site (~line 198):

```jsx
      <HoleFlyover
        visible={flyoverOpen}
        courseName={round.courseName}
        holeNumber={currentHole}
        par={round.holes[currentHole - 1]?.par}
        strokeIndex={round.holes[currentHole - 1]?.strokeIndex}
        centerDistance={gps.distances?.center ?? null}
        position={gps.position}
        onClose={() => setFlyoverOpen(false)}
        onEdit={isAdmin ? () => { setFlyoverOpen(false); setEditorOpen(true); } : undefined}
      />
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest src/components/scorecard`
Expected: PASS including the three new sheet tests.

- [ ] **Step 6: Run the full suite and compare to baseline**

Run: `npx jest 2>&1 | tail -20`
Expected: only the two pre-existing baseline failures.

- [ ] **Step 7: Commit**

```bash
git add src/components/scorecard/HoleFlyover.js src/components/scorecard/HoleView.js src/components/scorecard/__tests__/HoleFlyover.sheet.test.js
git commit -m "feat(flyover): present as slide-up sheet with grabber, meta header and swipe-down dismiss"
```

---

### Task 4: Lint + runtime verification

**Files:** none created — verification only.

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: clean (CI-blocking).

- [ ] **Step 2: Launch the app from the worktree**

```bash
cd /Users/marcospecker/golf-partner-worktrees/feat-flyover-distance-offline
[ -f .env ] || cp /Users/marcospecker/Documents/golf-partner/.env .
npx expo start --web --port 8091 > /tmp/expo-flyover.log 2>&1 &
```

Wait ~25s, then confirm `curl -s -o /dev/null -w "%{http_code}" http://localhost:8091` → `200`.

- [ ] **Step 3: Verify in the browser (Playwright MCP, per the project `verify` skill)**

Before navigating, grant + fake geolocation on Villaitana hole 1's tee:

```js
async (page) => {
  const ctx = page.context();
  await ctx.grantPermissions(['geolocation'], { origin: 'http://localhost:8091' });
  await ctx.setGeolocation({ latitude: 38.557702, longitude: -0.149173, accuracy: 5 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://localhost:8091');
}
```

Port 8091 has fresh localStorage — sign in (mint a throwaway per the verify skill) and create a game on **Meliã Villaitana Golf Club → Levante**. Then check, screenshotting each state:

1. Scorecard shows **no** GPS strip above the pager; the hole header shows PAR/SI beside the hole number and the green distance block (≈326m centre) on the right.
2. Tapping the distance block slides the map sheet up: rounded top, grabber, `Hole 1` + `Par 4 · SI 18` + live distance in the header, satellite map below.
3. Dragging/panning **on the map** pans the map — the sheet does not move.
4. ✕ closes the sheet; reopening and clicking the backdrop sliver above the sheet also closes it.
5. Swipe the currently scored hole to hole 2 and back — the header block updates with the hole.

- [ ] **Step 4: Baseline test-count sanity**

Run: `npx jest 2>&1 | tail -5` — record suite counts in the task report; only the two known baseline failures allowed.

- [ ] **Step 5: Kill the dev server**

```bash
pkill -f "expo start --web --port 8091"
```

No commit — verification only.
