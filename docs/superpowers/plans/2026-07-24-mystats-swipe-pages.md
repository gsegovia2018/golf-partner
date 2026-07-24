# My Stats Swipeable Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user swipe laterally between the six My Stats tabs, with a highlight indicator that tracks the finger during the drag.

**Architecture:** Replace the single vertical `ScrollView` that swaps tab content with a horizontal, `pagingEnabled` `Animated.ScrollView` (react-native-reanimated) holding six full-width pages, each owning its own vertical `ScrollView`. Native paging gives momentum + rubber-band + interruptibility for free on iOS/Android/web. Scroll offset drives (a) the active tab on settle and (b) a live-tracking accent pill under the tab bar. Pages mount lazily in a current±1 window.

**Tech Stack:** React Native 0.81, react-native-web, react-native-reanimated ~4.1.1. Jest (jest-expo) + @testing-library/react-native.

## Global Constraints

- One codebase ships **web (react-native-web) + Android + iOS** — every change must work on all three. Copy verbatim from spec.
- **Do NOT add `react-native-gesture-handler`** (not installed) or any native module.
- Only `transform`/`opacity` are animated (GPU-friendly); no `all` transitions.
- `computeMyStats` stays memoized once at screen level and passed to tabs as props — unchanged.
- The tab order is `ALL_TABS` = `['reportCard','coach','shots','form','breakdown','handicap']`, unchanged. No wrap-around.
- Existing tests in `src/screens/__tests__/MyStatsScreen.test.js` and `src/components/mystats/tabs/__tests__/StatsTabs.test.js` MUST stay green.

---

## File structure

- **Modify:** `src/screens/MyStatsScreen.js` — swap the content `ScrollView` for the pager; add `indexFromOffset` (exported pure helper); add scroll/settle sync, lazy mounting, and the tracking indicator; move the "no rounds selected" empty state into pages; remove the per-tab `Reveal` wrapper and the scroll-to-top-on-tab-change effect.
- **Modify:** `src/screens/__tests__/MyStatsScreen.test.js` — add tests for `indexFromOffset` and the per-page empty state.

All logic stays in `MyStatsScreen.js`, matching this codebase's screen-owns-its-chrome pattern (the tab bar, refs, and `getTabScrollTarget` already live there).

---

### Task 1: `indexFromOffset` pure helper

Add a testable pure function that maps a horizontal scroll offset to a tab index, mirroring the existing exported `getTabScrollTarget` helper.

**Files:**
- Modify: `src/screens/MyStatsScreen.js` (add function + export near `getTabScrollTarget` at the bottom, ~line 583)
- Test: `src/screens/__tests__/MyStatsScreen.test.js`

**Interfaces:**
- Produces: `indexFromOffset(offsetX: number, width: number, count: number) => number` — returns `round(offsetX / width)` clamped to `[0, count-1]`; returns `0` when `width` is not a positive finite number.

- [ ] **Step 1: Write the failing test**

Add to the `MyStatsScreen tab strip` describe block (or a new describe) in `src/screens/__tests__/MyStatsScreen.test.js`. Import is already `import MyStatsScreen, { getTabScrollTarget } from '../MyStatsScreen';` — extend it to also import `indexFromOffset`:

```js
import MyStatsScreen, { getTabScrollTarget, indexFromOffset } from '../MyStatsScreen';
```

```js
describe('indexFromOffset', () => {
  test('rounds the offset to the nearest page index', () => {
    expect(indexFromOffset(0, 390, 6)).toBe(0);
    expect(indexFromOffset(200, 390, 6)).toBe(1); // past halfway → next page
    expect(indexFromOffset(780, 390, 6)).toBe(2);
  });

  test('clamps to the valid range at both ends', () => {
    expect(indexFromOffset(-50, 390, 6)).toBe(0);
    expect(indexFromOffset(999999, 390, 6)).toBe(5);
  });

  test('returns 0 for a non-positive width', () => {
    expect(indexFromOffset(300, 0, 6)).toBe(0);
    expect(indexFromOffset(300, NaN, 6)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/screens/__tests__/MyStatsScreen.test.js -t indexFromOffset`
Expected: FAIL — `indexFromOffset is not a function`.

- [ ] **Step 3: Write minimal implementation**

At the bottom of `src/screens/MyStatsScreen.js`, next to `getTabScrollTarget`, add and export:

```js
function indexFromOffset(offsetX, width, count) {
  if (!Number.isFinite(width) || width <= 0) return 0;
  const raw = Math.round(offsetX / width);
  return Math.max(0, Math.min(count - 1, raw));
}
```

Update the final export line from:

```js
export { getTabScrollTarget };
```

to:

```js
export { getTabScrollTarget, indexFromOffset };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/screens/__tests__/MyStatsScreen.test.js -t indexFromOffset`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/screens/MyStatsScreen.js src/screens/__tests__/MyStatsScreen.test.js
git commit -m "feat(mystats): add indexFromOffset page helper"
```

---

### Task 2: Horizontal paged content (pager core)

Replace the single content `ScrollView` with a horizontal `pagingEnabled` `Animated.ScrollView` of six full-width pages, each with its own vertical `ScrollView`. Wire swipe-settle → active tab, and active-tab → programmatic scroll. Move the "no rounds selected" empty state into the affected pages. Remove the `Reveal` wrapper and the scroll-to-top effect. All six pages mount in this task (lazy mounting comes in Task 3).

**Files:**
- Modify: `src/screens/MyStatsScreen.js`
- Test: `src/screens/__tests__/MyStatsScreen.test.js`

**Interfaces:**
- Consumes: `indexFromOffset` (Task 1), existing `getTabScrollTarget`, `scrollTabIntoView`, `ALL_TABS`, `normalizeStatsTab`.
- Produces: pager ref `pagerRef`; state `pageWidth`; `onSettle(e)` handler; `currentOffsetRef`; `testID="my-stats-pager"` on the pager.

- [ ] **Step 1: Update imports**

In `src/screens/MyStatsScreen.js`:

Change line 2 to add `Dimensions`:

```js
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Dimensions } from 'react-native';
```

Add a reanimated import after the existing imports (near line 8) and **remove** the `Reveal` import (line 6):

```js
import Animated, {
  useSharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
  useReducedMotion,
} from 'react-native-reanimated';
```

(Delete `import Reveal from '../components/ui/Reveal';`.)

- [ ] **Step 2: Add pager state, refs, and helpers inside the component**

After the existing refs (around line 99, after `tabScrollXRef`), add:

```js
  const pagerRef = useRef(null);
  const currentOffsetRef = useRef(0);
  const reduced = useReducedMotion();
  const [pageWidth, setPageWidth] = useState(() => Dimensions.get('window').width);
  const scrollX = useSharedValue(0);

  const activeIndex = useMemo(
    () => Math.max(0, ALL_TABS.findIndex((t) => t.key === tab)),
    [tab],
  );

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => { scrollX.value = event.contentOffset.x; },
  });

  const onSettle = useCallback((event) => {
    const x = event.nativeEvent.contentOffset?.x ?? 0;
    currentOffsetRef.current = x;
    const key = ALL_TABS[indexFromOffset(x, pageWidth || 1, ALL_TABS.length)].key;
    setTab((prev) => (prev === key ? prev : key));
  }, [pageWidth]);
```

- [ ] **Step 3: Keep the route-param tab effect and add the pager-scroll effect**

Leave the existing effect at lines 106-108 (`setTab(normalizeStatsTab(route?.params?.tab))`) unchanged. Add directly below it a new effect that keeps the pager aligned to the active tab:

```js
  // Keep the pager aligned with the active tab. Skip when the pager is already
  // at that offset (i.e. the change came from a finger swipe, whose onSettle
  // updated currentOffsetRef first) so we never fight the native scroll.
  useEffect(() => {
    const targetX = activeIndex * pageWidth;
    if (Math.abs(currentOffsetRef.current - targetX) < 2) return;
    currentOffsetRef.current = targetX;
    pagerRef.current?.scrollTo?.({ x: targetX, animated: !reduced });
  }, [activeIndex, pageWidth, reduced]);
```

- [ ] **Step 4: Remove the scroll-to-top-on-tab-change effect**

Delete lines 269-271:

```js
  useEffect(() => {
    contentScrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [tab]);
```

Also delete the now-unused `contentScrollRef` declaration (line 95: `const contentScrollRef = useRef(null);`). Its only other use is the `ScrollView ref` being replaced in Step 6.

- [ ] **Step 5: Remove the whole-screen "every round deselected" short-circuit**

Delete the block at lines 444-460 (the `if (selected.length === 0 && tab !== 'reportCard' && tab !== 'handicap') { ... }` early return). This state now renders inside the affected pages (Step 6). Keep `const Selector = (...)` immediately above it.

- [ ] **Step 6: Replace the content ScrollView with the pager**

Add a `renderPage` helper inside the component, just before the `return (` of the main render (around line 462):

```js
  const renderPage = (key) => {
    const needsRounds = key === 'coach' || key === 'shots' || key === 'form' || key === 'breakdown';
    if (needsRounds && selected.length === 0) {
      return (
        <View style={[s.page, { width: pageWidth }, s.pageEmpty]}>
          <Feather name="filter" size={44} color={theme.text.muted} />
          <Text style={s.emptyText}>No rounds selected.</Text>
          <PressableScale style={s.retryBtn} onPress={() => setSelectorOpen(true)}>
            <Text style={s.retryText}>Choose rounds</Text>
          </PressableScale>
        </View>
      );
    }
    let body = null;
    if (key === 'reportCard') {
      body = (
        <RoundReportCard
          card={reportCard}
          rounds={myRounds}
          selectedKey={reportRoundKey}
          onSelect={setReportRoundKey}
          onOpenRound={openReportRound}
        />
      );
    } else if (key === 'coach') {
      body = (
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
      );
    } else if (key === 'form') {
      body = <FormTab stats={stats} n={n} onChangeN={setN} onInfo={onInfo} />;
    } else if (key === 'breakdown') {
      body = <BreakdownTab stats={stats} onInfo={onInfo} onSelectCourse={openCourseStats} />;
    } else if (key === 'shots') {
      body = <ShotsTab stats={stats} onInfo={onInfo} targetHandicap={targetHandicap} onChangeTarget={() => setPickerOpen(true)} />;
    } else if (key === 'handicap') {
      body = (
        <HandicapTab
          myRounds={myRounds}
          profileHandicap={profileHandicap}
          onInfo={onInfo}
          onApplied={setProfileHandicap}
          excludedKeys={handicapExclusions}
          onToggleExcluded={toggleHandicapExclusion}
        />
      );
    }
    return (
      <ScrollView
        style={[s.page, { width: pageWidth }]}
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
      >
        {body}
      </ScrollView>
    );
  };
```

Then replace the main content block (lines 466-503, the `<ScrollView ref={contentScrollRef} ...> <Reveal key={tab} ...> ... </Reveal> </ScrollView>`) with:

```js
      <Animated.ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={scrollHandler}
        onMomentumScrollEnd={onSettle}
        onScrollEndDrag={onSettle}
        style={s.pager}
        contentContainerStyle={s.pagerContent}
        testID="my-stats-pager"
        onLayout={(event) => {
          const w = event.nativeEvent.layout.width;
          if (w && Math.abs(w - pageWidth) > 1) setPageWidth(w);
        }}
      >
        {ALL_TABS.map((t) => (
          <View key={t.key} style={{ width: pageWidth }}>
            {renderPage(t.key)}
          </View>
        ))}
      </Animated.ScrollView>
```

- [ ] **Step 7: Add the new styles**

In `makeStyles`, add these entries (keep `scroll` as-is; it still supplies page padding + gap):

```js
    pager: { flex: 1 },
    pagerContent: { alignItems: 'stretch' },
    page: { flex: 1 },
    pageEmpty: { alignItems: 'center', justifyContent: 'center', gap: theme.spacing.md, padding: theme.spacing.xl },
```

Note: each `<View style={{ width: pageWidth }}>` is a direct horizontal child (fixed width, stretches to full height via the row's default cross-axis stretch). The inner `ScrollView`/empty `View` use `flex: 1` (`s.page`) to fill that height.

- [ ] **Step 8: Write the per-page empty-state test**

Add to `MyStatsScreen tab strip` in the test file:

```js
test('shows the empty state inside a stats page when no rounds are selected', async () => {
  const { resolveSelection } = require('../../store/personalStats');
  resolveSelection.mockReturnValue([]); // every round deselected
  const { findByText, queryByText } = renderScreen({ params: { tab: 'coach' } });

  expect(await findByText('No rounds selected.')).toBeTruthy();
  expect(queryByText('Coach content')).toBeNull();
  resolveSelection.mockImplementation((rounds) => rounds); // reset for other tests
});
```

- [ ] **Step 9: Run the full MyStatsScreen + StatsTabs suites**

Run: `npx jest src/screens/__tests__/MyStatsScreen.test.js src/components/mystats/tabs/__tests__/StatsTabs.test.js`
Expected: PASS (all existing tests + the two new ones). If any "tap tab → assert content" test fails, confirm the tapped tab's page renders (all pages mount in this task).

- [ ] **Step 10: Lint**

Run: `npm run lint -- src/screens/MyStatsScreen.js`
Expected: clean. Confirm `Reveal` and `contentScrollRef` are fully removed (no unused-var errors).

- [ ] **Step 11: Commit**

```bash
git add src/screens/MyStatsScreen.js src/screens/__tests__/MyStatsScreen.test.js
git commit -m "feat(mystats): swipeable paged tab content"
```

---

### Task 3: Lazy page mounting (current ± 1 window)

Mount only the pages near the active one; keep visited pages mounted so returning is instant. Unvisited pages render a cheap full-width spacer.

**Files:**
- Modify: `src/screens/MyStatsScreen.js`

**Interfaces:**
- Consumes: `activeIndex` (Task 2), `ALL_TABS`, `normalizeStatsTab`.
- Produces: `activated: Set<number>` state; module-level `windowAround(i, n) => Set<number>`.

- [ ] **Step 1: Add the window helper (module scope, bottom of file near the other helpers)**

```js
function windowAround(index, count) {
  const set = new Set();
  for (let j = index - 1; j <= index + 1; j += 1) {
    if (j >= 0 && j < count) set.add(j);
  }
  return set;
}
```

- [ ] **Step 2: Add `activated` state and growth effect inside the component**

Below the `activeIndex` memo (Task 2, Step 2), add:

```js
  const [activated, setActivated] = useState(
    () => windowAround(
      Math.max(0, ALL_TABS.findIndex((t) => t.key === normalizeStatsTab(route?.params?.tab))),
      ALL_TABS.length,
    ),
  );

  // Grow the mounted window to include the active page's neighbours; once a
  // page has been visited it stays mounted (no re-mount cost on return).
  useEffect(() => {
    setActivated((prev) => {
      const next = windowAround(activeIndex, ALL_TABS.length);
      let grew = false;
      next.forEach((j) => { if (!prev.has(j)) grew = true; });
      if (!grew) return prev;
      const merged = new Set(prev);
      next.forEach((j) => merged.add(j));
      return merged;
    });
  }, [activeIndex]);
```

- [ ] **Step 3: Gate page bodies on `activated`**

In the pager's `.map`, change:

```js
        {ALL_TABS.map((t) => (
          <View key={t.key} style={{ width: pageWidth }}>
            {renderPage(t.key)}
          </View>
        ))}
```

to:

```js
        {ALL_TABS.map((t, i) => (
          <View key={t.key} style={{ width: pageWidth }}>
            {activated.has(i) ? renderPage(t.key) : null}
          </View>
        ))}
```

- [ ] **Step 4: Run the suites (distant-tab mount is covered by the Handicap tests)**

Run: `npx jest src/screens/__tests__/MyStatsScreen.test.js`
Expected: PASS. The `handicap tab` tests tap Handicap (index 5, outside the initial window) and then assert its content — this verifies tapping activates a distant page. If they fail, confirm the `activated` growth effect runs on `tab` change.

- [ ] **Step 5: Lint + commit**

Run: `npm run lint -- src/screens/MyStatsScreen.js`

```bash
git add src/screens/MyStatsScreen.js
git commit -m "perf(mystats): lazily mount pager pages in a current±1 window"
```

---

### Task 4: Live tracking indicator

Add an accent pill under the tab bar that tracks the swipe frame-by-frame, interpolating `translateX` and `width` between the measured tab-pill layouts from `scrollX`.

**Files:**
- Modify: `src/screens/MyStatsScreen.js`

**Interfaces:**
- Consumes: `scrollX`, `pageWidth`, `tabLayoutsRef`, `scrollTabIntoView`, `ALL_TABS`, reanimated `interpolate`/`Extrapolation`/`useAnimatedStyle`.
- Produces: `tabLayoutsSV` shared value `{ xs:number[], ws:number[] }`; `pageWidthSV` shared value; `pillBox` state `{ y:number, height:number }`; `syncTabLayoutsSV()`; `indicatorStyle`.

Design note (surface to the user at review): the active tab's filled pill becomes this **moving** accent pill. Inactive tabs render as bare labels (muted text); the active label is inverse-colored and sits over the moving pill. This preserves the filled-pill look while making the highlight track the drag.

- [ ] **Step 1: Add shared value + pillBox state (inside component, near the other pager state)**

```js
  const tabLayoutsSV = useSharedValue({ xs: [], ws: [] });
  const pageWidthSV = useSharedValue(pageWidth);
  const [pillBox, setPillBox] = useState({ y: 0, height: 0 });

  const syncTabLayoutsSV = useCallback(() => {
    const xs = [];
    const ws = [];
    for (const t of ALL_TABS) {
      const l = tabLayoutsRef.current[t.key];
      if (!l) return; // wait until every pill is measured
      xs.push(l.x);
      ws.push(l.width);
    }
    tabLayoutsSV.value = { xs, ws };
    const first = tabLayoutsRef.current[ALL_TABS[0].key];
    setPillBox((prev) => (
      prev.height === first.height && prev.y === first.y ? prev : { y: first.y, height: first.height }
    ));
  }, [tabLayoutsSV]);
```

Keep `pageWidthSV` in sync — in the pager `onLayout` (Task 2, Step 6), replace the body with:

```js
          const w = event.nativeEvent.layout.width;
          if (w && Math.abs(w - pageWidth) > 1) { setPageWidth(w); pageWidthSV.value = w; }
```

- [ ] **Step 2: Add the animated indicator style**

```js
  const indicatorStyle = useAnimatedStyle(() => {
    const { xs, ws } = tabLayoutsSV.value;
    if (!xs || xs.length < 2) return { opacity: 0, width: 0 };
    const w = pageWidthSV.value > 0 ? pageWidthSV.value : 1;
    const frac = scrollX.value / w; // 0 .. count-1
    const input = xs.map((_, i) => i);
    const x = interpolate(frac, input, xs, Extrapolation.CLAMP);
    const width = interpolate(frac, input, ws, Extrapolation.CLAMP);
    return { opacity: 1, width, transform: [{ translateX: x }] };
  });
```

- [ ] **Step 3: Render the indicator inside the tab scroller and call `syncTabLayoutsSV` on pill layout**

In the `TabBar` `ScrollView`, add the indicator as the FIRST child of the content (so pills paint over it), before the `ALL_TABS.map`:

```js
      <Animated.View
        pointerEvents="none"
        style={[s.tabIndicator, { top: pillBox.y, height: pillBox.height }, indicatorStyle]}
      />
```

In each pill's `onLayout`, add the sync call:

```js
          onLayout={(event) => {
            tabLayoutsRef.current[t.key] = event.nativeEvent.layout;
            if (tab === t.key) scrollTabIntoView(t.key, false);
            syncTabLayoutsSV();
          }}
```

- [ ] **Step 4: Restyle the pills so the moving pill is the fill**

In `makeStyles`, change the pill styles so inactive tabs are bare and the moving indicator provides the accent fill:

```js
    tab: {
      paddingVertical: 6, paddingHorizontal: 14,
      borderRadius: theme.radius.pill,
      backgroundColor: 'transparent',
      borderWidth: 1, borderColor: 'transparent',
      flexShrink: 0,
    },
    tabActive: {}, // fill now provided by the animated indicator
    tabText: { ...theme.typography.caption, color: theme.text.muted, fontWeight: '700' },
    tabTextActive: { color: theme.text.inverse },
    tabIndicator: {
      position: 'absolute',
      left: 0,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.accent.primary,
    },
```

(`tab` and `tabActive` are still both applied in the pill's `style={[s.tab, tab === t.key && s.tabActive]}`; `tabActive` is now a no-op object. Leave the JSX as-is.)

- [ ] **Step 5: Verify tests still pass (no new text layers, so `getByText` stays unique)**

Run: `npx jest src/screens/__tests__/MyStatsScreen.test.js src/components/mystats/tabs/__tests__/StatsTabs.test.js`
Expected: PASS. In jsdom the pills measure 0, so `tabLayoutsSV` stays `{xs:[],ws:[]}` and the indicator renders at `opacity:0` — harmless.

- [ ] **Step 6: Lint + commit**

Run: `npm run lint -- src/screens/MyStatsScreen.js`

```bash
git add src/screens/MyStatsScreen.js
git commit -m "feat(mystats): finger-tracking accent pill under the tab bar"
```

---

### Task 5: Full verification + runtime check

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: the whole suite passes (~330+ tests). Investigate any regression before proceeding.

- [ ] **Step 2: Lint the whole project**

Run: `npm run lint`
Expected: clean (CI-blocking).

- [ ] **Step 3: Runtime verification (web = same codebase as Android/iOS)**

Use the `verify` skill (Playwright MCP) to drive the Expo web app:
- Open My Stats.
- Swipe/drag horizontally across the content → the page changes and the tab-bar highlight follows the drag, settling on the nearest tab.
- Tapping a distant pill animates the pager to it; the active tab scrolls into view in the tab bar.
- Rubber-bands (does not wrap) at Report Card (first) and Handicap (last).
- Each tab keeps its own vertical scroll position when you swipe away and back.
- With every round deselected (rounds selector), Coach/Strokes Gained/Form/Breakdown show "No rounds selected → Choose rounds" while Report Card and Handicap still render.

- [ ] **Step 4: Reduced-motion spot check**

With OS "reduce motion" on (or `useReducedMotion` returning true), tapping a pill jumps instantly (no animated scroll); dragging still works. (Not unit-tested — the reanimated jest mock hardcodes `useReducedMotion → false` — so verify at runtime.)

- [ ] **Step 5: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "test(mystats): verify swipeable pages end-to-end"
```

---

## Self-review

**Spec coverage:**
- Native paged scroll (Animated.ScrollView, pagingEnabled) → Task 2. ✓
- Per-page vertical ScrollView / independent scroll position → Task 2 (renderPage), behavior change #1. ✓
- Swipe→active tab on settle; tap→animated scroll; tab-into-view → Task 2 (onSettle, pager-scroll effect, existing scrollTabIntoView). ✓
- Live tracking indicator interpolated from scrollX → Task 4. ✓
- Lazy current±1 window, visited stays mounted, spacer for unvisited → Task 3. ✓
- Empty state moved into pages; loading/error/no-rounds-at-all stay full-screen → Task 2, Steps 5-6. ✓
- Remove Reveal + scroll-to-top → Task 2, Steps 1 & 4. ✓
- Reduced motion (native swipe kept; tap scroll instant) → Task 2 (`!reduced`) + Task 5 Step 4. ✓
- route.params.tab initial + change → normalizeStatsTab effect (kept) + pager-scroll effect keyed on activeIndex. ✓
- No gesture-handler; transform/opacity only → Global Constraints, honored. ✓
- Tests green + index math + per-page empty coverage → Tasks 1, 2, 5. ✓

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `indexFromOffset(offsetX,width,count)` used identically in Task 1 (def) and Task 2 (`onSettle`). `windowAround(index,count)` def (Task 3 Step 1) matches both call sites. `tabLayoutsSV.value` shape `{xs,ws}` written in `syncTabLayoutsSV` and read in `indicatorStyle` — consistent. `activeIndex` defined once (Task 2) and consumed in Tasks 2-3.

**Deliberate behavior changes (from spec, accepted):** (1) per-tab vertical scroll position persists instead of resetting; (2) active pill highlight moves/tracks and inactive pills become bare labels.
