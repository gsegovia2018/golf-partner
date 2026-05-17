# My Stats — Tabs & PC Layout

**Date:** 2026-05-17
**Status:** Approved design

## Problem

The `MyStatsScreen` renders every section in one long vertical stack inside a
single `ScrollView`. This is a long scroll on a phone and looks sparse on a
wide desktop window — content runs full-width as a single column.

This change:
- Splits the sections into **tabs**, matching the per-tournament
  `StatsScreen` pattern.
- Makes the screen **look good on PC** — centered, width-capped, with
  breakdown cards tiled in a responsive grid instead of one tall column.

## Goals

- A tab bar under the header with four tabs: Overview, Form, Breakdown, Shots.
- Each tab renders only its own cards.
- On wide windows, content is centered and capped; breakdown/shot cards tile
  2–3 across.

## Non-goals

- No data-layer changes (`personalStats.js`, `statsEngine.js` untouched).
- No new components — reuse the existing `ScreenContainer` and `CardGrid`.
- No changes to the round selector, the metric toggle, or the N chips.

## Approach

One file changes: `src/screens/MyStatsScreen.js`. It reuses two primitives
already in the codebase:

- `ScreenContainer` (`src/components/ScreenContainer.js`) — a drop-in
  `SafeAreaView` replacement that centers content and caps it at
  `CONTENT_MAX_WIDTH` (960px). No-op on phones.
- `CardGrid` (`src/components/CardGrid.js`) — lays children out in a wrapping
  row; column count comes from `useResponsive()` (3 wide / 2 regular / 1
  compact).

## Tabs

A module-level constant and screen state, mirroring `StatsScreen`:

```js
const ALL_TABS = [
  { key: 'overview',  label: 'Overview' },
  { key: 'form',      label: 'Form' },
  { key: 'breakdown', label: 'Breakdown' },
  { key: 'shots',     label: 'Shots' },
];
```

- `const [tab, setTab] = useState('overview');`
- A `tabBar` row renders under the header (only in the data render state — not
  in loading/error/empty states). It is styled to match `StatsScreen`'s tab
  bar: a horizontal row of `TouchableOpacity` pills with `tab`/`tabActive`/
  `tabText`/`tabTextActive` styles.
- The `ScrollView` body renders the active tab's cards via `tab === '...'`
  conditionals.

### Section → tab mapping

| Tab | Cards |
|---|---|
| Overview | Snapshot card · Strengths & Pain Points |
| Form | Recent vs History table + sparkline |
| Breakdown | Par type · Hole difficulty · Round shape · Score distribution · Recovery |
| Shots | Tee shot impact · Putting & driving · the "log putts and drives" notice (shown when neither has data) |

- The round-selector chip stays in the **header** — it applies to every tab.
- The Points/Strokes toggle stays inside the Snapshot card (Overview tab).
- The Last 3/5/10 chips stay inside the Form card (Form tab).
- The Shots tab's cards remain individually gated on
  `stats.teeShot.hasData` / `stats.shots.hasData`; when neither has data the
  tab shows only the existing muted notice.

## PC layout

- The screen root changes from `SafeAreaView` to `ScreenContainer`. The
  `style` and `edges` props pass through unchanged. This centers and
  width-caps the header, tab bar, and content together.
- The **Breakdown** and **Shots** tabs wrap their cards in `<CardGrid>` so on
  wide windows they tile 3-across (desktop) / 2-across (small window) and
  collapse to a single column on phones (`gridColumns === 1` — visually
  identical to today).
- The **Overview** and **Form** tabs stay single-column full-width: the
  Snapshot stat row and the Form table are designed to use the full width.
- Loading, error, and both empty states also render inside `ScreenContainer`
  so they stay centered on wide windows. These states do **not** render the
  tab bar.

## Tab / state interaction

- Default tab is `overview`.
- Switching the round selection or the N value recomputes `stats`; the active
  tab is unaffected.
- The no-rounds and all-deselected empty states are reached before the tabbed
  render, so they never show the tab bar.

## Testing

UI-only change; `MyStatsScreen` has no unit tests (the project has no React
Native component-test setup). Verification:

- `npm test` — the existing 125-test suite stays green (no data-layer change).
- `npx expo export --platform web` — bundles cleanly.
- Manual: each tab shows its cards; the tab bar highlights the active tab;
  on a wide browser window content is centered and the Breakdown/Shots cards
  tile in a grid; on a narrow window it is a single column; loading/empty
  states still render centered.
