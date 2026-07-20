# Scorecard map entry redesign — merged header distances + sheet-style flyover

**Date:** 2026-07-20
**Status:** Approved (visual companion session; option "A1 merged header" + full-screen sheet)

## Problem

The GPS distance strip (`GpsDistancePanel`) sits above the hole pager as a separate
bordered row. It reads as "one more container" glued onto the scorecard, and its map
entry point is a bare 15px glyph at the end of the row — easy to miss and off-theme.

## Decision

1. **Delete the standalone GPS strip.** Its information moves into the hole header
   card that each `HolePage` already renders.
2. **The hole header's right side becomes the distance block** — and the tap target
   that opens the hole map.
3. **`HoleFlyover` keeps its Modal host but presents as a full-height sheet**:
   slide-up entrance, rounded top corners with a grabber, swipe-down to dismiss.
   No intermediate half state.

Explicitly rejected during brainstorming: map chip inside the old strip (strip
itself is the problem), inline peek map under the strip (adds a second map surface
with little value over the header numbers), floating pill (kills glanceability),
half-height sheet (gesture conflict with Leaflet pan/drag inside a WebView; its
"glance" job is already done by the header block), navigation push to a new screen
(adds back-stack handling on three platforms for no user-visible gain over the
existing modal).

## Header distance block (`HolePage`)

The hole header card (`s.holeHeaderCard`, `HolePage.js`) currently shows course
name + HOLE n on the left and PAR / SI columns on the right. New layout:

- Left: unchanged (course line, HOLE n). PAR / SI move next to the hole number.
- Right: distance block, right-aligned, replacing the freed space:
  - Line 1 (hero): navigation icon + **centre distance** in `theme.accent.primary`,
    ~24px weight-800 tabular, small "m" unit, trailing chevron (affordance).
  - Line 2: `F 312  B 339` — 10.5px, `text.muted`, tabular.
  - Line 3 (only when hazards exist): `Bunker 169–190` / `Water 121–139` — one
    10px muted line; both kinds joined with `·` when both are ahead.
- When `distances.kind === 'nearest'` (courses without per-hole numbering), a tiny
  `NEAREST GREEN` overline sits above line 1; lines 1–3 are otherwise unchanged.
- Degraded states (same logic as today's strip):
  - GPS available, no fix yet → hero shows `…` with "Getting GPS fix" caption.
  - `accuracy > 25` → `±Nm` caption under line 2.
  - `distances.center > 3000` (off course) → compact single line
    `Off course · N.N km`, not tappable-looking but still opens the map.
  - `gps.available === false` (no geometry / permission denied) → the block is
    absent and the header renders exactly as it does today.
- Tap target: the whole distance block (hit-slopped), opens the flyover. The rest
  of the header stays inert.

### Data flow

`useGpsDistances(courseName, currentHole)` stays where it is — called once in
`HoleView` (one location watch). `HoleView` passes `gps` plus an `onOpenFlyover`
callback down to `HolePage`. Only the **active** page renders live values
(`isActive` already exists and forces re-render on swipe); inactive pages render
the block from the same prop without extra subscriptions. `holePagePropsEqual`
must compare the new `gps`-derived props for the active page (distances object
identity) so live GPS updates re-render the active header.

`GpsDistancePanel.js` is deleted along with its render site in `HoleView`.

## Flyover sheet presentation (`HoleFlyover`)

Host stays `Modal` (scorecard stays mounted; no navigation changes). Changes:

- Container animates in from the bottom (RN `Animated` translate, ~250ms) instead
  of the default modal fade; full height minus a top inset (~24px) showing the
  dimmed scorecard behind.
- Top of the sheet: rounded 20px corners, centered grabber, header row with
  `Hole N · Par x · SI y` on the left, live centre distance on the right, and an
  explicit ✕ (kept for web/mouse and accessibility).
- Dismiss: swipe/drag down **on the grabber/header area only** — never on the map
  itself (Leaflet owns all gestures inside the WebView) — plus ✕ and Android back,
  as today.
- Everything inside the map (aim ring, two-leg line, F/C/B chips, hazard taps,
  admin Edit) is untouched.

## Sequencing

The flyover two-leg-line + offline-maps plan
(`2026-07-20-flyover-distance-line-offline-design.md`) is mid-implementation on
its feature branch and modifies `HoleFlyover`/host components. This redesign
builds **on top of that branch** as follow-on tasks (or lands after it merges) —
it must not fork a second copy of `HoleFlyover`.

## Testing

- Unit (jest): header block render states — normal, nearest-green, hazards line
  (one kind / both), poor fix, off-course, gps unavailable (block absent); tap
  fires `onOpenFlyover`; `holePagePropsEqual` re-renders active page on distance
  change and skips inactive pages.
- Runtime (verify skill): Villaitana + faked geolocation — strip gone, header
  block shows F/C/B, tap opens sheet, swipe-down/✕/back dismiss, Leaflet pan
  does not move the sheet.

## Out of scope

- Any change to distance computation (`useGpsDistances`, `geo.js`).
- Map content/behavior changes (covered by the flyover plan).
- Tablet/landscape layouts.
