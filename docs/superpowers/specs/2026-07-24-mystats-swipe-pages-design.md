# My Stats — swipeable pages design

**Date:** 2026-07-24
**Status:** Approved, ready for implementation planning
**Screen:** `src/screens/MyStatsScreen.js` (+ `src/components/mystats/tabs/*`)

## Goal

Let the user slide laterally between the six My Stats tabs (Report Card,
Coach, Strokes Gained, Form, Breakdown, Handicap) instead of only tapping the
pill bar. Add polished, platform-correct motion (Emil Kowalski design
sensibility): the active-tab indicator tracks the finger during the drag.

## Constraints

- One codebase ships **web (react-native-web) + Android + iOS**. Every piece
  must work on all three.
- `react-native-reanimated ~4.1.1` is available; **`react-native-gesture-handler`
  is not installed** — do not add it.
- No My Stats tab contains an inner horizontal scroller (charts are static SVG,
  `ScoreMixBar` is a non-scrolling bar, the round selector is a modal), so a
  horizontal page swipe has no nested horizontal gesture to conflict with.

## Chosen approach: native paged scroll

Use React Native's core `ScrollView` with `pagingEnabled` (via reanimated's
`Animated.ScrollView` so scroll offset is readable on the UI thread). This is a
first-class primitive on iOS, Android, and web — momentum flick, rubber-band at
the ends, and interruptibility are inherited from the platform and run off the
main thread. No native module needed.

Rejected alternative: a custom PanResponder + spring implementation. It would
re-implement momentum/bounce physics that the native pager gets for free, adds
more edge cases on react-native-web, and produces the same visible result at
higher risk.

## Structure

```
Header
TabBar (pills) + animated active indicator that tracks scrollX
Animated.ScrollView  horizontal · pagingEnabled          ← the pager
 ├─ Page 0  Report Card   (own vertical ScrollView)
 ├─ Page 1  Coach              "
 ├─ Page 2  Strokes Gained     "
 ├─ Page 3  Form               "
 ├─ Page 4  Breakdown          "
 └─ Page 5  Handicap           "
```

- Each page is exactly the pager viewport width and owns its **own vertical
  `ScrollView`**. This replaces today's single shared vertical scroller.
- Page order is `ALL_TABS`, unchanged. No wrap-around; the pager rubber-bands at
  the first and last page.
- The pager viewport width is measured via `onLayout` and stored (shared value +
  ref) so page width, tap-to-scroll math, and the indicator interpolation all use
  the same value. Pages render at that measured width; before first measurement,
  fall back to window width to avoid a zero-width first frame.

## Pager ↔ tab bar sync

- **Swipe:** a `useAnimatedScrollHandler` writes `scrollX` (shared value) on the
  UI thread. On settle (`onMomentumScrollEnd`, plus `onScrollEndDrag` as the
  web/no-momentum fallback) compute `index = round(offsetX / width)`; if it
  differs from the current tab, set it and scroll that pill into view via the
  existing `getTabScrollTarget` helper.
- **Tap a pill:** set the active tab immediately (synchronous, so tests and
  perceived responsiveness are unaffected), activate that page index, and
  `scrollTo({ x: index * width, animated: !reducedMotion })` on the pager.
- **Live indicator (Kowalski touch):** an `Animated.View` pill/underline beneath
  the tab bar interpolates its `translateX` and `width` between the measured tab
  pill layouts using `scrollX / width` as the driver. The highlight follows the
  finger frame-by-frame off the main thread instead of snapping at the end.
  - Interpolation inputs: the array of per-tab `{x, width}` layouts already
    captured in `tabLayoutsRef`, promoted to a shared value so the UI-thread
    style worklet can read them. Indicator position = interpolate the fractional
    page `scrollX / width` across tab x-offsets; width = interpolate across tab
    widths.
  - Fallback: until all tab layouts are measured, the indicator renders under the
    active pill statically (no interpolation), so an unmeasured first frame never
    mispositions it.

## Performance — lazy pages

Mount a **window of current ± 1** so the neighbor being swiped toward is already
painted. Track an `activated` set of indices; once a page has been visited it
stays mounted (no re-mount cost on return). Unvisited pages render a cheap
full-width spacer. `computeMyStats` stays memoized once at the screen level and
is passed to each tab as props — unchanged.

## Empty / edge states

- **Full-screen short-circuits (before the pager mounts), unchanged:** loading
  spinner, load error + Retry, and "no rounds at all" empty state.
- **Per-page empty state (moved):** today "No rounds selected" short-circuits the
  whole screen for Coach / Strokes Gained / Form / Breakdown. In a pager these
  pages coexist, so that check moves **inside** each affected page — it renders a
  "No rounds selected → Choose rounds" empty view within its own page. Report
  Card and Handicap render normally even with zero selected rounds (matching
  today's `tab !== 'reportCard' && tab !== 'handicap'` carve-out).

## Motion spec

- Pager: native momentum + rubber-band, no wrap.
- Indicator: driven 1:1 by `scrollX / width` while dragging (no easing needed);
  tap-to-navigate uses the platform's animated scroll.
- **Remove the per-tab `Reveal` fade** — the swipe is now the transition; a
  second fade would be redundant motion (animation framework: one clear purpose
  per animation).
- `prefers-reduced-motion` (via `useReducedMotion`): swipe still works (native);
  the programmatic tap-to-navigate scroll becomes an instant jump
  (`animated: false`); the indicator still tracks the drag (user-driven, not an
  autoplay animation).

## Behavior changes (accepted)

1. Each tab remembers its **own vertical scroll position** instead of resetting
   to top on switch (the old `contentScrollRef` scroll-to-top effect is removed).
2. The active pill highlight **animates/tracks** the swipe instead of instantly
   toggling.

## Navigation / params

- `route.params.tab` still selects the initial tab. On mount, the pager starts
  at that tab's index without animating (initial `contentOffset` / one-shot
  `scrollTo({ animated: false })` after width is known) and that index is
  pre-activated.
- Changing `route.params.tab` while mounted (deep link / tab press) scrolls the
  pager to the new index.
- `route.params.roundKey` (Report Card selected round) is unaffected.

## Testing

- Keep `src/screens/__tests__/MyStatsScreen.test.js` and
  `src/components/mystats/tabs/__tests__/StatsTabs.test.js` green. The key
  invariant: tapping a pill synchronously sets the active tab **and** mounts that
  page (tap → setTab + activate index + scroll), so existing "tap tab → assert
  content" tests still pass under the jest react-native mock (where momentum
  scroll events do not fire).
- Add coverage for:
  - index-from-offset math (`round(offsetX / width)` → tab key), including
    clamping at both ends;
  - the per-page "No rounds selected" empty state on a non-Report-Card tab;
  - reduced-motion path uses a non-animated tap scroll.

## Out of scope

- No new gesture-handler dependency.
- No change to what each tab computes or displays.
- No wrap-around paging.
