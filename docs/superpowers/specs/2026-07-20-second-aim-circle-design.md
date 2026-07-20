# Second Aim Circle for Par-5 Planning — Design

**Date:** 2026-07-20
**Status:** Approved by user (conversation), pending spec review

## Goal

Let a player plan two shots on long holes (typically par 5s) by placing a
second draggable circle on the hole map, splitting the line into three
measured legs: anchor → circle A → circle B → green.

## Current behavior (baseline)

The hole map (`src/lib/holeMapHtml.js`, inline Leaflet page) draws one
draggable ring (`target`). Lines: anchor (tee or GPS position) → ring as a
solid polyline with a distance chip, ring → green center as a dashed
polyline with a chip. Tap anywhere moves the ring; dragging moves it too.

## New behavior

### Adding / removing circles

- **Long-press on empty map** (Leaflet `contextmenu` event — long tap on
  touch, right-click on desktop web) adds a second circle at that point.
- **Long-press on an existing circle** removes it.
- **Minimum one circle** — the last circle can never be removed; single-ring
  behavior is the baseline and is unchanged.
- **Maximum two circles** — long-press with two circles present is a no-op
  (on empty map; on a circle it still removes).
- Circles reset when the hole changes (the map page is rebuilt per
  `holeKey`, so this already holds).

### Lines and distances

- Chain: anchor → circle A → circle B → green center, where A/B are
  **ordered by distance from the anchor** (re-sorted live during drag), so
  drop/drag order never produces a crossed path. With no anchor the chain
  starts at the first circle (matching today's no-anchor behavior).
- Shot legs (anchor→A, A→B) are solid white polylines; the final leg into
  the green stays dashed (today's "remaining" style).
- Every leg keeps its own distance chip — on a par 5: drive, layup,
  approach.

### Interactions with existing behavior

- **Tap anywhere** moves the **nearest** circle to the tapped point.
- **Drag** works on both circles, as today.
- HUD (Back/Center/Front distances from the anchor), recenter button, GPS
  anchor logic, and edit mode are untouched.

## Implementation shape

- Entirely inside the inline script of `src/lib/holeMapHtml.js`:
  - Generalize the single `target` variable to a `targets` array
    (1–2 entries).
  - `redrawLines` walks the sorted chain and emits polylines + chips per
    leg.
  - `contextmenu` handlers on the map (add) and on each circle marker
    (remove).
- No changes to `HoleFlyover.js`, `HoleView.js`, `flyoverModel.js`, or the
  host↔page message protocol.

## Testing

Extend `src/lib/__tests__/holeMapHtml.test.js` in the existing style
(the generated script parses; presence checks for the contextmenu handlers,
the two-circle cap, and the chain-drawing code).
