# Collapsing Hole Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the scorecard's tall per-hole header collapse into a slim sticky bar (hole info + compact distance/club) as the player cards scroll, reclaiming vertical space.

**Architecture:** In `HolePage.js`, move the existing header inside the player-cards scroll view so it scrolls away, drive a per-page `scrollY` `Animated.Value` from an `Animated.ScrollView`, and overlay an absolutely-positioned slim bar that fades + slides in as `scrollY` passes the header height. The slim bar's right side reuses a new `compact` variant of `HoleDistanceBlock` so all GPS/shot/club logic stays in one place.

**Tech Stack:** React Native 0.81, React 19, Expo SDK 54, `react-native` `Animated`, `@testing-library/react-native`, Jest (jest-expo).

## Global Constraints

- Single codebase ships web (`react-native-web`) + Android. Only animate `opacity` and `translateY`, and use `useNativeDriver: Platform.OS !== 'web'` (native driver is unsupported on web).
- No new dependencies.
- `npm run lint` (ESLint 9 flat config) is CI-blocking — code must pass it.
- Follow existing test conventions in `src/components/scorecard/__tests__/` (theme mock via `jest.requireActual('../../../theme/tokens')`).
- The pager mounts all 18 `HolePage` instances at once. Per-page animation state MUST live in refs/local state, never in props (props feed the `holePagePropsEqual` memo comparator).
- Two `HoleDistanceBlock` instances now render per page (full + compact). Only the full one may register the `hole-distances` tour target, and the two must use **distinct** `accessibilityLabel`s and **distinct** visible text so existing `getByText`/`getByLabelText` queries stay unambiguous.

---

### Task 1: `compact` variant of `HoleDistanceBlock`

Add a `compact` prop that renders a single-line pressable (icon + center distance + unit + recommended club + chevron) reusing all existing distance/club logic, with a distinct accessibility label and no tour-target registration.

**Files:**
- Modify: `src/components/scorecard/HoleDistanceBlock.js`
- Test: `src/components/scorecard/__tests__/HoleDistanceBlock.test.js`

**Interfaces:**
- Consumes: existing `HoleDistanceBlock` props (`gps`, `courseName`, `holeNumber`, `roundId`, `roundIndex`, `onPress`).
- Produces: `HoleDistanceBlock` now also accepts `compact?: boolean` (default `false`). In compact mode it renders one row with `accessibilityLabel="Hole map"` and combined distance text `"<n><unit>"` (e.g. `"326m"`); returns `null` in the same no-GPS/no-geometry cases as the full block; does NOT register the `hole-distances` tour target.

- [ ] **Step 1: Write the failing tests**

Add to `src/components/scorecard/__tests__/HoleDistanceBlock.test.js`, inside the top-level `describe('HoleDistanceBlock', ...)` block (after the existing `it('fires onPress from every state...')`):

```jsx
  it('compact mode renders a single-line distance and no front/back line', () => {
    const { getByText, queryByText } = render(
      <HoleDistanceBlock compact gps={gpsBase()} onPress={() => {}} />,
    );
    getByText('326m');
    expect(queryByText(/F 312/)).toBeNull();
  });

  it('compact mode fires onPress via the "Hole map" label', () => {
    const onPress = jest.fn();
    const { getByLabelText } = render(
      <HoleDistanceBlock compact gps={gpsBase()} onPress={onPress} />,
    );
    fireEvent.press(getByLabelText('Hole map'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('compact mode does NOT register the hole-distances tour target', () => {
    __resetTourTargetsForTests();
    render(<HoleDistanceBlock compact gps={gpsBase()} onPress={() => {}} />);
    expect(__getRegisteredTourKeysForTests()).not.toContain('hole-distances');
  });

  it('compact mode renders nothing when gps is unavailable', () => {
    const { toJSON } = render(
      <HoleDistanceBlock compact gps={{ available: false, distances: null, accuracy: null, position: null }} onPress={() => {}} />,
    );
    expect(toJSON()).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- HoleDistanceBlock`
Expected: FAIL — the four new tests fail (e.g. `Unable to find an element with text: 326m`, and the tour-target test finds `hole-distances` registered because the current component always registers it).

- [ ] **Step 3: Implement the compact variant**

In `src/components/scorecard/HoleDistanceBlock.js`:

(a) Add `compact = false` to the destructured props:

```jsx
export function HoleDistanceBlock({
  gps, courseName, holeNumber, roundId, roundIndex, onPress, compact = false,
}) {
```

(b) Change the tour-target line (currently `const tourRef = useTourTarget('hole-distances');`) so the compact instance never claims the key:

```jsx
  const tourRef = useTourTarget(compact ? null : 'hole-distances');
```

(c) Inside the existing `if (onGreen) { ... }` block, add a compact early-return as the FIRST statement of the block (before the full putting return):

```jsx
  if (onGreen) {
    if (compact) {
      return (
        <Pressable onPress={onPress} hitSlop={8} style={s.compactRow} accessibilityRole="button" accessibilityLabel="Hole map">
          <Feather name="flag" size={13} color={theme.accent.primary} />
          <Text style={s.compactPutt}>Putting</Text>
          <Feather name="chevron-right" size={16} color={theme.text.muted} />
        </Pressable>
      );
    }
    return (
      // ...existing full putting Pressable unchanged...
```

(d) Immediately AFTER the line `const distances = shotDist ? { ...gps.distances, ...shotDist } : gps.distances;`, add the compact distance return (this sits after `const fmt`, `const { accuracy, source } = gps;` and `distances` are all defined, and after the `if (!gps?.available) return null;` guard — so compact also returns null with no fix):

```jsx
  if (compact) {
    const c = distances?.center;
    if (c == null) return null;
    if (source !== 'tee' && c > 3000) return null;
    return (
      <Pressable onPress={onPress} hitSlop={8} style={s.compactRow} accessibilityRole="button" accessibilityLabel="Hole map">
        <Feather name="navigation" size={13} color={theme.accent.primary} />
        <Text style={s.compactDist}>{`${fmt(c)}${unitSuffix(units)}`}</Text>
        {suggestion && <Text style={s.compactClub}>{`· ${clubLabel(suggestion.club)}`}</Text>}
        <Feather name="chevron-right" size={16} color={theme.text.muted} />
      </Pressable>
    );
  }
```

(e) Add the compact styles to the object returned by `makeStyles(theme)` (alongside the existing `block`, `hero`, etc.):

```jsx
    compactRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    compactDist: {
      color: theme.accent.primary,
      fontSize: 15,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      fontVariant: ['tabular-nums'],
    },
    compactClub: {
      color: theme.accent.primary,
      fontSize: 13,
      fontFamily: 'PlusJakartaSans-Bold',
    },
    compactPutt: {
      color: theme.accent.primary,
      fontSize: 14,
      fontFamily: 'PlusJakartaSans-ExtraBold',
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- HoleDistanceBlock`
Expected: PASS — all existing + four new tests green.

- [ ] **Step 5: Lint**

Run: `npm run lint -- src/components/scorecard/HoleDistanceBlock.js`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/scorecard/HoleDistanceBlock.js src/components/scorecard/__tests__/HoleDistanceBlock.test.js
git commit -m "feat: add compact variant to HoleDistanceBlock for slim header"
```

---

### Task 2: Collapsing slim header in `HolePage`

Move the hole header inside the player-cards scroll view, convert it to an `Animated.ScrollView` driving a per-page `scrollY`, and overlay a slim sticky bar that fades/slides in as the header scrolls away, using the Task 1 compact distance block.

**Files:**
- Modify: `src/components/scorecard/HolePage.js`
- Modify: `src/components/scorecard/styles.js`
- Test: `src/components/scorecard/__tests__/HolePage.test.js`

**Interfaces:**
- Consumes: `HoleDistanceBlock`'s new `compact` prop (Task 1); existing `HolePage` props including `gps`, `onOpenFlyover`, `pageHole`, `courseName`, `roundIndex`, `round`.
- Produces: no prop changes to `HolePage` (animation state is internal). New styles `s.holeSlimBar` and `s.holeSlimBarInfo` in `styles.js`.

- [ ] **Step 1: Write the failing tests**

Add to `src/components/scorecard/__tests__/HolePage.test.js` a new `describe` block at the end of the file (the file already imports `render`, `fireEvent`, and `Animated`):

```jsx
describe('HolePage collapsing slim header', () => {
  const gps = (center) => ({
    available: true, accuracy: 5, source: 'gps', position: [1, 2],
    distances: { front: center - 14, center, back: center + 13, pin: null, kind: 'hole', hazards: [] },
  });

  it('renders the slim bar with combined HOLE · PAR · SI info', () => {
    const props = { ...baseProps(), isActive: true, gps: gps(326), onOpenFlyover: jest.fn() };
    const { getByText } = render(<HolePage {...props} />);
    getByText('HOLE 3 · PAR 4 · SI 6');
  });

  it('slim bar compact distance opens the flyover on tap ("Hole map")', () => {
    const props = { ...baseProps(), isActive: true, gps: gps(326), onOpenFlyover: jest.fn() };
    const { getByLabelText } = render(<HolePage {...props} />);
    fireEvent.press(getByLabelText('Hole map'));
    expect(props.onOpenFlyover).toHaveBeenCalledTimes(1);
  });

  it('still renders the full header block as the primary map entry ("Open hole map")', () => {
    const props = { ...baseProps(), isActive: true, gps: gps(326), onOpenFlyover: jest.fn() };
    const { getByText, getByLabelText } = render(<HolePage {...props} />);
    getByText('326'); // full-block hero number (unit rendered separately)
    fireEvent.press(getByLabelText('Open hole map'));
    expect(props.onOpenFlyover).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- HolePage`
Expected: FAIL — `Unable to find an element with text: HOLE 3 · PAR 4 · SI 6` and `Unable to find an element with accessibilityLabel: Hole map` (the slim bar does not exist yet).

- [ ] **Step 3: Add the slim-bar styles**

In `src/components/scorecard/styles.js`, add these two entries next to the existing `holeHeaderCard` block (around line 204-244):

```jsx
    holeSlimBar: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      backgroundColor: theme.bg.primary,
      borderBottomWidth: 1,
      borderBottomColor: theme.isDark ? theme.glass?.border ?? theme.border.default : theme.border.default,
      zIndex: 5,
    },
    holeSlimBarInfo: {
      color: theme.text.primary,
      fontSize: 13,
      fontFamily: 'PlusJakartaSans-ExtraBold',
      letterSpacing: 0.5,
      flexShrink: 1,
    },
```

- [ ] **Step 4: Update the imports in `HolePage.js`**

Change the React import (line 1) and the `react-native` import (line 2) to add `useRef, useState, useEffect` and `Animated`:

```jsx
import React, { useMemo, useRef, useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal, Platform, Animated } from 'react-native';
```

(`ScrollView` stays imported — it is still used by `MePicker`/other code paths; leave it.)

- [ ] **Step 5: Add the module-scope constant**

In `HolePage.js`, just below the existing `PAGER_PAGE_SNAP_STYLE` constant (around line 21), add:

```jsx
// Height of the collapsed slim header bar; the full header collapses into it.
const SLIM_BAR_HEIGHT = 44;
```

- [ ] **Step 6: Add the animation hooks inside `HolePage`**

In `HolePage`, immediately after the existing `const scoreEntryRef = useTourTarget(...)` line (around line 115) — these hooks must run unconditionally on every render to keep hook order stable:

```jsx
  // Collapsing header: the player-cards scroll drives scrollY; the slim bar
  // fades/slides in once the (measured) full header has scrolled past. State
  // is per-page and internal, so it never touches holePagePropsEqual.
  const scrollY = useRef(new Animated.Value(0)).current;
  const [headerH, setHeaderH] = useState(120);
  const [collapsed, setCollapsed] = useState(false);
  const threshold = Math.max(SLIM_BAR_HEIGHT, headerH - SLIM_BAR_HEIGHT);
  const thresholdRef = useRef(threshold);
  thresholdRef.current = threshold;
  useEffect(() => {
    const id = scrollY.addListener(({ value }) => {
      const next = value >= thresholdRef.current - 1;
      setCollapsed((c) => (c === next ? c : next));
    });
    return () => scrollY.removeListener(id);
  }, [scrollY]);
  const appearStart = Math.max(0, threshold - 24);
  const barOpacity = scrollY.interpolate({
    inputRange: [appearStart, threshold], outputRange: [0, 1], extrapolate: 'clamp',
  });
  const barTranslateY = scrollY.interpolate({
    inputRange: [appearStart, threshold], outputRange: [-SLIM_BAR_HEIGHT, 0], extrapolate: 'clamp',
  });
```

- [ ] **Step 7: Restructure the render**

Replace the entire returned JSX (currently the outer `<View style={[{ width, height }, ...]}>` containing the `holeHeaderCard` sibling followed by the `<ScrollView>`, i.e. lines ~144-283) with the version below. The header inner content and the `orderedPlayers.map(...)` body are UNCHANGED — only their wrappers move: the header goes inside the scroll, the cards get a wrapper `View` (replacing the old `contentContainerStyle`), and the slim bar is added as a pinned sibling.

```jsx
  return (
    <View
      style={[{ width, height }, PAGER_PAGE_SNAP_STYLE]}
      dataSet={Platform.OS === 'web' ? { pagerpage: '1' } : undefined}
    >
      <Animated.ScrollView
        style={s.flex}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: Platform.OS !== 'web' },
        )}
      >
        {/* Hole header — now scrolls away with the cards. PAR/SI ride with the
            hole number; the right side is the live GPS distance block and the
            map entry point. */}
        <View style={s.holeHeaderCard} onLayout={(e) => setHeaderH(e.nativeEvent.layout.height)}>
          <View style={s.holeHeaderLeft}>
            <Text style={s.holeHeaderRound}>{courseName} -- Round {roundIndex + 1}</Text>
            <View style={s.holeNumberRow}>
              <Text style={s.holeNumberLabel}>HOLE</Text>
              <Text style={s.holeNumber}>{pageHole.number}</Text>
            </View>
            <View style={s.holeMetaRow}>
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
          <View style={s.holeHeaderRightWrap}>
            <HoleDistanceBlock
              gps={gps}
              courseName={courseName}
              holeNumber={pageHole.number}
              roundId={round.id}
              roundIndex={roundIndex}
              onPress={onOpenFlyover}
            />
          </View>
        </View>

        {/* Player score cards. */}
        <View style={s.playerCardsContent}>
          {orderedPlayers.map((player, i) => {
            // ...UNCHANGED map body: keep exactly the existing lines that
            // compute handicap/strokes/points/etc. and return `card` /
            // the scoreEntryRef-wrapped first card...
          })}
        </View>
      </Animated.ScrollView>

      {/* Slim collapsed bar — pinned; fades/slides in as the header scrolls
          away. Non-interactive until collapsed so it never blocks the full
          header's distance tap while expanded. */}
      <Animated.View
        style={[s.holeSlimBar, { opacity: barOpacity, transform: [{ translateY: barTranslateY }] }]}
        pointerEvents={collapsed ? 'auto' : 'none'}
      >
        <Text style={s.holeSlimBarInfo} numberOfLines={1}>
          {`HOLE ${pageHole.number} · PAR ${pageHole.par} · SI ${pageHole.strokeIndex}`}
        </Text>
        <HoleDistanceBlock
          compact
          gps={gps}
          courseName={courseName}
          holeNumber={pageHole.number}
          roundId={round.id}
          roundIndex={roundIndex}
          onPress={onOpenFlyover}
        />
      </Animated.View>
    </View>
  );
```

IMPORTANT: do not retype or alter the `orderedPlayers.map(...)` body — copy the existing lines verbatim into the new `<View style={s.playerCardsContent}>` wrapper. The old `<ScrollView style={s.flex} contentContainerStyle={s.playerCardsContent} ...>` is replaced by `<Animated.ScrollView style={s.flex} ...>` plus the inner wrapper `View` that now carries `s.playerCardsContent`.

- [ ] **Step 8: Run the HolePage tests to verify they pass**

Run: `npm test -- HolePage`
Expected: PASS — new slim-bar tests green, and all pre-existing HolePage tests (tour target, handicap, scramble, conflict, `holePagePropsEqual`, header distance wiring) still pass.

- [ ] **Step 9: Run the full scorecard suite + lint**

Run: `npm test -- src/components/scorecard`
Expected: PASS — no regressions across scorecard component tests.

Run: `npm run lint -- src/components/scorecard/HolePage.js src/components/scorecard/styles.js`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add src/components/scorecard/HolePage.js src/components/scorecard/styles.js src/components/scorecard/__tests__/HolePage.test.js
git commit -m "feat: collapse hole header into a slim sticky bar on scroll"
```

---

## Notes for the reviewer / verifier

- The collapse is purely scroll-driven: when the player cards already fit without scrolling, `scrollY` never moves, the slim bar stays hidden, and the full header remains — this is intended (no wasted space to reclaim).
- Runtime check (web, same codebase as Android): open a round scorecard, scroll the player cards up on a hole → the tall header scrolls away and the slim `HOLE n · PAR · SI  <dist> · <club> ›` bar appears pinned; tapping it opens the hole map; scroll back to top → full header returns.
