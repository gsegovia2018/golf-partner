# Responsive web/desktop layout

**Date:** 2026-05-17
**Status:** Approved — ready for implementation plan

## Problem

The app is built mobile-first with Expo / react-native-web. Almost no screen
has responsive logic: screens use `SafeAreaView` + `ScrollView` with a fixed
`padding: 20`, so on a wide PC monitor content stretches edge-to-edge and reads
as stretched and empty. The goal is for the app to look good on both PC and
mobile without regressing the mobile experience.

## Goals

- Constrain screen content to a centered, capped-width column on wide windows.
- Reflow card lists and stat grids into 2–3 columns where it reads well.
- Zero visual change on actual phones.
- Mechanical, low-risk per-screen changes — no screen restructuring.

## Non-goals

- No sidebar navigation / desktop dashboard redesign (bottom tabs stay).
- No reflow of the data-dense `ScorecardScreen` per-hole grid — it is only
  centered and width-capped.
- No unrelated refactoring of screen internals.

## Approach

Mobile-first stays. On windows wider than the content cap, each screen's body
(header + scroll content together) is constrained to a centered **960px
max-width column**; the app background shows as gutters on either side. Card
lists and stat grids reflow into multiple columns when width allows.

### Breakpoints

`width < 600` = compact (phone) · `600 ≤ width < 960` = regular ·
`width ≥ 960` = wide.

## Components

### 1. `src/theme/responsive.js` (new)

Single source of truth for responsive behaviour.

```js
export const BREAKPOINTS = { md: 600, lg: 960 };
export const CONTENT_MAX_WIDTH = 960;

// useResponsive() wraps useWindowDimensions() and returns:
//   { width, isCompact, isWide, gridColumns }
// isCompact  = width < 600
// isWide     = width >= 960
// gridColumns = 1 (compact) | 2 (regular) | 3 (wide)
export function useResponsive() { /* ... */ }
```

`useWindowDimensions` is already a React Native primitive and re-renders on
window resize, so resize handling is automatic.

### 2. `src/components/ScreenContainer.js` (new)

A thin wrapper `View` inserted directly under each screen's `SafeAreaView`:

```
SafeAreaView (flex:1, bg)
  └─ ScreenContainer (flex:1, width:100%, maxWidth:CONTENT_MAX_WIDTH, alignSelf:center)
       ├─ header
       └─ ScrollView
```

It centers the header and scroll content as one aligned column. On phones
`width:100%` is below the cap, so it is a visual no-op. Insert is one wrapper
element per screen; no other restructuring.

### 3. `CardGrid` helper

Card lists (History, Feed, Friends, Players/Courses libraries) and stat grids
reflow with a wrap layout: container is `flexDirection:'row', flexWrap:'wrap'`
with a gap; each card gets a `flexBasis` derived from
`useResponsive().gridColumns` (~48% for 2-col, ~31% for 3-col). On compact it
is a single stacked column — the current behaviour.

`HistoryScreen.statsGrid` already wraps; it only needs its `flexBasis` tied to
the hook instead of the hardcoded `30%`.

Implemented as a small reusable component (`src/components/CardGrid.js`) so the
list screens share one wrap implementation rather than each re-deriving it.

### 4. Floating tab bar (`App.js`)

The bottom pill bar's `bar` style gets `maxWidth: CONTENT_MAX_WIDTH` and
`alignSelf:'center'` (with `width:'100%'`) so on desktop it sits under the
content column instead of spanning the whole window.

### 5. Bottom sheets / modals

`CommentsSheet`, `StatDetailSheet`, `MediaLightbox`, and the attach/capture
sheets get a max-width cap and centered alignment so they do not span an
ultra-wide window. Mobile presentation (full-width bottom sheet) is unchanged.

## Affected screens

All ~24 screens get the `ScreenContainer` wrapper. Substantive per-screen work
is limited to:

- **Grid reflow:** History, Feed, Friends, PlayersLibrary, CoursesLibrary,
  StatsScreen (stat grids).
- **Width-cap pass only:** ScorecardScreen (dense per-hole grid — centered +
  capped, no reflow), plus the remaining editor/picker screens which just take
  the wrapper.

## Error handling / edge cases

- Resize: handled automatically by `useWindowDimensions` re-rendering.
- Very narrow windows (`< 600`): identical to current mobile layout.
- Screens that already use `Dimensions`/`useWindowDimensions`
  (`ScorecardScreen`, `ScoringModePicker`, `MediaLightbox`,
  `TournamentMemoriesSection`) are migrated to `useResponsive()` where it
  overlaps, but their existing logic is preserved.

## Testing

- Manual: resize the web build across compact / regular / wide widths and
  confirm content stays centered, grids reflow, tab bar stays under the column.
- Confirm phone layout (`expo start` device or narrow window) is pixel-unchanged.
- Run the existing Jest suite to confirm no regressions.
