# Scorecard tee-distance fallback — design

**Date:** 2026-07-20
**Status:** Approved

## Problem

The scorecard header's distance block (`HoleDistanceBlock`) only shows GPS-based
distances to the green. When the player is far from the course it shows
"Off course · X km" (beyond 3 km) or meaningless long GPS numbers (1–3 km), and
when location is denied or no fix has arrived it shows a spinner or nothing.
Meanwhile the hole flyover map already solves this: `anchorFor` in
`src/lib/flyoverModel.js` anchors its measuring line to live GPS only while the
player is within `ANCHOR_MAX_GPS_METERS` (1000 m) of the green, falling back to
the hole's tee point.

The scorecard header should do the same: when a usable GPS fix isn't in play,
show the hole's distances measured from the tee, when tee geometry exists.

## Decision drivers

- One source of truth for the "GPS vs tee" rule — the map and the header must
  never disagree on which anchor is in play.
- Domain logic lives in `src/lib` / hooks, not in screen components
  (project convention).
- Useful numbers from home: tee distances also apply when location permission
  is denied, no fix has arrived yet, or the platform has no location support
  (user decision, 2026-07-20).

## Design

### Hook — `useGpsDistances` (src/hooks/useGpsDistances.js)

- GPS watching (permission request, watch + poll fallback) is unchanged.
- Position resolution reuses `anchorFor({ player, tee, greenCenter })` from
  `flyoverModel.js` with the current hole's tee (`hole.start`) and green center:
  - Anchor resolves to `gps` (fix within 1 km of the green): behavior identical
    to today — distances from the fix, `source: 'gps'`.
  - Anchor resolves to `tee`: distances computed via
    `courseTargetDistances(teePos, courseName, holeNumber)`, `source: 'tee'`.
  - No tee point available (hole without `start`, or `greens`-mode course):
    today's behavior, `source: 'gps'` — including the existing
    "Off course · X km" rendering beyond 3 km.
- `available` becomes: course has geometry. Location denial no longer makes the
  block disappear, because tee numbers can still show. Courses without geometry
  still render nothing.
- Return shape: `{ available, distances, accuracy, position, source }` —
  `source` is the only new field; `position` remains the raw GPS fix (or null)
  for the map.
- The source-resolution step is extracted as a small pure helper in
  `flyoverModel.js` next to `anchorFor` (it already imports from `geo.js`,
  avoiding an import cycle) so it is unit-testable without mocking
  expo-location.

### Header — `HoleDistanceBlock` (src/components/scorecard/HoleDistanceBlock.js)

- `source === 'tee'`: overline **FROM TEE**; same hero center distance,
  F/B line, and hazards line (bunker/water reach–carry from the tee). No
  navigation icon, no ±accuracy caption, no "Getting GPS fix" spinner, no
  off-course text.
- `source === 'gps'`: unchanged from today.

### Out of scope

- The flyover map sheet — already anchors correctly via `anchorFor`.
- Tee-card yardage (`hole.distance` on course data) as a further fallback for
  holes without tee geometry.
- Any change to hazard filtering or green-edge math in `geo.js`.

## Testing

- Unit tests for the pure source-resolution helper: gps-within-1km,
  gps-beyond-1km-with-tee, no-fix-with-tee, denied-with-tee, no-tee fallback.
- Component test for the `FROM TEE` render state of `HoleDistanceBlock`
  (label present, no accuracy caption/spinner).
- Existing `useGpsDistances` / `HoleDistanceBlock` tests updated for the new
  `available` semantics and return shape.
