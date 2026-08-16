# Flag finder — camera direction to the flag

When the flag isn't visible from the ball, a flag icon in the scorecard header
opens a full-screen camera view that shows which way the flag is. Direction is
pure math: `bearing(GPS fix → target) − compass heading`; the camera is the
backdrop that makes "point your phone" intuitive.

## Existing infrastructure (reused, not built)

- Live position + accuracy: `useGpsDistances` (`src/hooks/useGpsDistances.js`).
- Target coordinates: course geometry holes carry `pin` / `greenCenter` /
  `green` polygon (`src/lib/geo.js`, `holeFeatures`).
- Bearing math: private `bearingDeg(a, b)` in `geo.js`.
- Entry surface: `headerRight` icon row in `ScorecardScreen` (sync, view
  switch, leaderboard, notes, camera); `currentHole` state lives there too.

## Build items

1. **Geo helpers** (`src/lib/geo.js` + tests) — export `bearingDeg`; add
   `holeTargetPoint(courseName, holeNumber)` resolving `pin ?? greenCenter ??
   centroid(green)` via `holeFeatures`; add `normalizeDeltaDeg` → [−180, 180).
2. **`useCompassHeading` hook** (`src/hooks/useCompassHeading.js` + tests) —
   Android native: `Location.watchHeadingAsync` (expo-location already a dep),
   prefer `trueHeading`. Mobile web: `deviceorientationabsolute` /
   `webkitCompassHeading`, with iOS `DeviceOrientationEvent.requestPermission`
   exposed as a callable (must run inside a tap gesture). Desktop web:
   unavailable. Circular low-pass smoothing; low-accuracy flag for the
   figure-8 calibration hint. Static `compassLikelyAvailable()` gates the
   header icon.
3. **expo-camera** — `npx expo install expo-camera`; Spanish
   `cameraPermission` plugin string like the existing ones. Native module ⇒
   requires a new EAS build; not OTA-able.
4. **`FlagFinderView`** (`src/components/scorecard/FlagFinderView.js`) —
   full-screen modal; camera backdrop (dark fallback when camera denied);
   flag marker positioned by `(bearing − heading)` when within ~±30°, edge
   chevron ("◀ Flag · 75° left") otherwise; pin/center distance via
   `formatDistance`; caveats for GPS accuracy > 15 m and low compass accuracy.
   Mounts its own `useGpsDistances` — watch lives only while open.
5. **Wiring** — `IconButton icon="flag"` in `headerRight` next to the camera
   icon, gated on `findCourseGeometry(round.courseName)` and
   `compassLikelyAvailable()`; opens the modal for `currentHole`. Visible in
   both hole and grid views.
6. **Ship** — new EAS preview build; real-device check: arrow agrees with a
   known landmark.

## Known limits

- Phone magnetometers are ±5–15° (worse near carts/magnet cases) — good for
  "the flag is over there", not aiming precision.
- Fallback to green center when no pin is mapped (~15 m worst case).
- Desktop web has no compass → the button never appears there.
