# Collapsing hole header (slim sticky bar)

**Date:** 2026-07-23
**Status:** Approved design — ready for implementation plan

## Problem

On the scorecard, each hole page (`src/components/scorecard/HolePage.js`) renders
a tall header card (`holeHeaderCard`) *pinned above* the player-cards `ScrollView`.
The header carries the big hole number (44pt), a course/round line, PAR/SI, and the
rich multi-line `HoleDistanceBlock` (live GPS distances). It always occupies
~120px of vertical space, crowding the interactive player cards — worst on short
screens and 4-player rounds where the cards already overflow.

## Goal

Reclaim that vertical space while keeping the live distance-to-pin reachable at a
glance. The header should **collapse into a slim sticky bar as the player cards
scroll**, and re-expand when scrolled back to the top.

## Behavior

- **At the top of a hole:** the full header shows exactly as today (big hole
  number, course/round line, PAR/SI, full `HoleDistanceBlock`).
- **On scroll up:** the tall header scrolls away with the cards, and a slim bar
  fades + slides in, pinned to the top of the page:
  - Left: `HOLE 7 · PAR 4 · SI 11`
  - Right: compact distance + recommended club + chevron, e.g. `142m · 7i ›`,
    tappable to open the hole map (same action as the full block).
- **On scroll back to top:** the slim bar retracts and the full header returns.
- **When cards already fit (no scroll):** nothing collapses. There is no wasted
  space to reclaim in that case, so the full header simply stays.

## Architecture

All changes are local to the scorecard hole page; no store or data-flow changes.

### `HolePage.js` (primary)

1. **Move** the existing `holeHeaderCard` from above the `ScrollView` to *inside*
   it, as the first child of the content container, so it scrolls away naturally.
2. **Convert** the player-cards `ScrollView` to `Animated.ScrollView`, driving a
   per-page `scrollY` `Animated.Value` (held in a `useRef`) via `onScroll` with
   `scrollEventThrottle={16}`. Driver: `useNativeDriver: Platform.OS !== 'web'`
   (we only animate `opacity` and `translateY`, both driver-safe; native driver
   is unsupported on web).
3. **Add** an absolutely-positioned slim bar overlay as a sibling of the
   `Animated.ScrollView` (outside the scroll, so it stays pinned at the top). It
   interpolates on `scrollY`:
   - `opacity`: `0 → 1` across roughly `[headerHeight − slimHeight − 20,
     headerHeight − slimHeight]`.
   - `translateY`: `−slimHeight → 0` across the same range (slides down into place).
   - The bar is non-interactive until visible so it never blocks the full
     header's distance tap while expanded (gate via `pointerEvents` tied to the
     collapsed state, or keep it `box-none` when hidden).

   Constants (`headerHeight ≈ 120`, `slimHeight ≈ 44`) live at module scope in
   `HolePage.js` and are tuned during implementation.

The per-page `Animated.Value` is internal state (a ref), so it does **not** touch
the `holePagePropsEqual` memo comparator. The slim bar's tap reuses the existing
`onOpenFlyover` prop already passed to `HolePage`.

### `HoleDistanceBlock.js` (compact variant)

Add a `compact` boolean prop. In compact mode the component renders a single
`Pressable` row instead of the multi-line block:

- `navigation` icon + center distance + unit + `· <club>` (recommended club from
  the existing `suggestion` logic) + a chevron (`chevron-right`).
- Reuses all existing GPS/shot/geo/club computation and the same `onPress` →
  open map.
- Honors the same null/empty cases as the full block: no GPS fix or no geometry →
  renders nothing (the slim bar then shows only the hole-info left side); on the
  green → `Putting ›`.

This keeps a single source of truth for distance/club logic; the slim bar just
consumes the compact rendering.

### `styles.js`

Add slim-bar styles: `holeSlimBar` (absolute, top-anchored, full width, row,
space-between, background matching the page, subtle bottom border, ~44px tall,
`zIndex` above the scroll content) and `holeSlimBarLeft` text style
(`HOLE 7 · PAR 4 · SI 11`). Compact distance styling lives in
`HoleDistanceBlock`'s local styles.

## Testing

Behavioral tests (Animated interpolation isn't asserted directly):

- `HolePage` renders the slim bar containing the hole-info text (`HOLE`, number,
  `PAR`, `SI`) and a compact distance/club readout.
- Tapping the compact distance in the slim bar calls `onOpenFlyover`.
- The expanded `holeHeaderCard` now lives inside the scroll container (structure
  assertion) — the full `HoleDistanceBlock` is still present and tappable.
- Existing HolePage / shot-FAB / scorecard tests continue to pass.

## Out of scope

- No change to GPS acquisition, shot logic, map sheet, or the pager.
- No manual collapse toggle (collapse is purely scroll-driven).
- No change to grid/compact scorecard view.

## Files

- `src/components/scorecard/HolePage.js` — header move, animated scroll, slim bar.
- `src/components/scorecard/HoleDistanceBlock.js` — `compact` variant.
- `src/components/scorecard/styles.js` — slim-bar styles.
- Tests under `src/components/scorecard/__tests__/`.
