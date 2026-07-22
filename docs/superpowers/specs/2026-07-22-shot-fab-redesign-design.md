# Shot UI redesign: club FAB + tappable pins

**Date:** 2026-07-22
**Status:** Approved for planning

## Goal

Make adding and managing shots on the hole map (`HoleFlyover`) smaller and
simpler. Replace the full-width bottom shot bar with a single small club-icon
FAB in the bottom-right corner, and let the player edit or delete a shot by
tapping its pin on the map.

## Current state

`ShotTracker.js` renders a full-width dark bar overlaid on the map bottom:

- a horizontal scroll of shot "pills" (Tee, then each shot with seq/club/carry),
- an Undo icon button,
- a "drop at my GPS" (navigation) icon button,
- a large green **Add shot** button (with a `≈ club` suggestion),
- the `ClubWheel` modal (vertical spin-wheel club picker + Move + Delete),
  opened after adding a shot or by tapping a pill.

Shot pins on the map (`holeMapHtml.js` `drawShots()`) are **non-interactive**;
all editing goes through the pill row.

## Target design

### 1. Bottom bar → small club FAB (`ShotTracker.js`)

Remove the pill row, Undo button, GPS-drop button, and the wide Add button.
In their place, a single circular **club FAB** anchored bottom-right of the map:

- ~48px circle, green (`#57ae5b`) background, an icon-only custom `ClubIcon`
  (SVG iron — no bundled icon set has a golf-club glyph).
- A tiny club-name badge floats just above the FAB showing the next-club
  suggestion (the existing `recommendClub` result, e.g. `7i`). Hidden when
  there is no suggestion.
- **Tap** = add a shot at the current white aim ring (`aimPos`), falling back
  to live GPS (`pos`) when there is no ring. Dimmed/disabled when neither
  exists.
- **Long-press** = add a shot at the player's exact live GPS location (`pos`),
  preserving the old "drop at me" capability without a separate button.
- After a shot is added, the `ClubWheel` opens on it (unchanged behaviour),
  pre-focused on the guessed club.

While a shot is being **moved** (move mode), the FAB swaps to a yellow ✓
"Confirm spot" affordance and the existing "tap the map to move" hint shows.
Confirming exits move mode.

`ClubWheel` is **kept as-is** — it remains the club picker + Move + Delete
surface. No new picker component.

### 2. Tappable shot pins (`holeMapHtml.js`)

Make the numbered gold pins interactive:

- `L.marker(..., { interactive: true })` (currently `false`).
- On pin `click`, post `{ type: 'shot-tap', index }` to the host, where
  `index` is the 0-based shot order (matches `shots[]` / `shotsForHole`).
- The dashed trail, carry chips, and aim-ring behaviour are unchanged. A pin
  tap must not also register as a map click that moves the aim ring (stop
  propagation on the marker click).
- In `placing` (move) mode, pin taps are ignored — the map click already
  handles repositioning.

### 3. Host relay (`HoleMapView.web.js`, `HoleMapView.native.js`)

Add an `onShotTap` prop to both hosts. Forward the `shot-tap` message:

- web: in the `message` listener, `if (m.type === 'shot-tap') onShotTap?.(m.index)`.
- native: same in the `onMessage` handler.

### 4. Flyover wiring (`HoleFlyover.js`)

Relay pin taps into `ShotTracker` the same way `pendingPoint` is relayed today:

- add a `tappedShotIndex` state; pass `onShotTap={setTappedShotIndex}` to
  `HoleMapView`.
- pass `tappedShotIndex` + an `onConsumeShotTap` clear callback to
  `ShotTracker`.
- `ShotTracker` resolves the index to a shot id and opens `ClubWheel` on it,
  then clears the relay.

### 5. `ClubIcon` (new, small SVG)

A minimalist iron rendered with `react-native-svg` (already a dependency):
a diagonal shaft with an angled club head. Props: `size`, `color`. Lives in
`src/components/scorecard/ClubIcon.js`.

## Interaction summary

- **Add:** drag ring → tap club FAB → `ClubWheel` opens on the new shot → set
  club (or dismiss). Long-press FAB adds at GPS instead of the ring.
- **Edit / delete / move:** tap a pin on the map → `ClubWheel` opens for that
  shot → change club, Move, or Delete.
- **Undo:** no dedicated button — delete the last pin via its wheel.

## Non-goals

- No change to `ClubWheel` internals, `shotStore`, `shotStats`, or the
  distance / aim-ring math.
- No change to the header `HoleDistanceBlock` (it keeps its own `≈ club`).
- No change to edit-mode geometry markers.

## Testing

- `HoleFlyover.sheet.test.js` mocks `HoleMapView` and only asserts header
  chrome + units → unaffected.
- New tests (React Native Testing Library):
  - FAB tap with an `aimPos` calls `logShot` and opens the wheel; disabled
    with no aim and no GPS.
  - FAB long-press adds at GPS `pos`.
  - `tappedShotIndex` relay opens `ClubWheel` for the matching shot id.
  - Deleting from the wheel calls `deleteShot`.
- `npm run lint` and full `npm test` stay green.
