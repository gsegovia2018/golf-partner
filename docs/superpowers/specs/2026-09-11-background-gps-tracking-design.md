# Background GPS tracking during a live round

**Date:** 2026-09-11
**Status:** approved (approach and notification variant B chosen by the owner)

## Problem

The scorecard header and the hole map read a live GPS fix from
`useGpsDistances`. Android stops delivering location to an app that is not
visible, and a browser tab does the same, so every time the phone comes out of
a pocket the fix is seconds behind or, before PR #93, a coarse network guess
hundreds of metres out. The wake probe and the fix-quality gate soften the
re-lock; they cannot remove it. For a precise distance the moment the phone
unlocks, something has to keep the GPS engine running while the screen is off.

## Decision

Run an **Android foreground location service** while a live scorecard is open.
The service posts a persistent notification, keeps fixes flowing with the
screen locked or the app switched away, and feeds them into the same hook that
already drives the header and the map. Tapping the notification opens the app,
which lands on the scorecard because tracking only runs while one is open.

Rejected: the "allow all the time" background permission without a service
(Android still throttles a backgrounded app to a few fixes per hour; heavy Play
scrutiny) and JS-only faster warm-up on wake (already what the probe does; it
cannot beat a cold lock).

Out of scope: iOS (the app ships web and Android) and web (browsers cannot run
location while hidden; nothing changes there).

## Components

### `src/lib/roundTracking.js`

Owns the service and the latest fix. Imported from `index.js` so the task is
defined before the app renders, as `expo-task-manager` requires.

- Defines the task `golf-round-location` at module scope (Android only). Each
  delivery publishes its newest location to subscribers and keeps it as the
  live fix.
- `getLiveFix()` and `subscribeLiveFix(fn)` — the feed `useGpsDistances`
  consumes.
- `setRoundTracking({ title, body } | null)` — the single control surface.
  Non-null starts the service if it is not running and updates the
  notification text; null stops it. Identical text is deduplicated; text
  changes are posted at most once every 3 s (trailing update). Calls are
  serialized so a start and a stop issued in the same tick cannot cross.
  Starting requires the app to be in the foreground and the when-in-use
  permission granted; a failed start is retried on the next text change and on
  the next return to the foreground.
- No-op on every platform except Android.

Service options: `Accuracy.High`, `timeInterval` 2000 ms, `distanceInterval`
2 m, `killServiceOnDestroy: true`, notification colour `#006747`.

### `src/hooks/useRoundTracking.js`

Turns the scorecard's state into notification text and drives
`setRoundTracking`.

Input: `{ active, courseName, holeNumber, distances, source, units }`.

Text (variant B, "Live distance"):

| State | Title | Body |
|---|---|---|
| Live fix on the hole | `Hole 7 · 143 m to the centre` | `131 m front · 156 m back · Lomas-Bosque` |
| Far from the hole (tee fallback) | `Hole 7 · 380 m from the tee` | same shape |
| No distance yet | `Hole 7 · Getting GPS fix` | `Lomas-Bosque · tap to open the scorecard` |

Updates are sent when the hole or the source changes, or when the centre
distance has moved 5 m or more since the last update. `active: false` and
unmount both stop the service.

### `useGpsDistances` changes

- On native, seed the run from `getLiveFix()` and subscribe to the feed; both
  go through `apply()`, so the fix-quality gate from PR #93 applies unchanged.
- Expose `permissionGranted` so the caller can wait for the when-in-use
  permission before starting the service. The hook's own foreground watch and
  wake probe stay as they are.

### `ScorecardScreen`

Owns the tracking lifecycle because it knows whether the round is live and
stays mounted while the user flips between the hole view and the card
overview. It calls `useGpsDistances(round.courseName, currentHole)` and
`useRoundTracking` with

```
active = !viewOnly && !tournament?.finishedAt && gps.hasMap
      && gps.permissionGranted && gps.fixState !== 'disabled'
```

so tracking never runs for a finished round, a course without geometry, a
denied permission, or the GPS setting turned off.

### Config

- `app.json`: `isAndroidForegroundServiceEnabled: true` on the `expo-location`
  plugin (adds `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_LOCATION`).
- `expo-task-manager` added as a dependency.
- Both change the native side, so the runtime fingerprint changes: field
  testing needs a new `preview-arm64` build, not an OTA update.

## Error handling

- Start failures (app not foregrounded, permission missing) are swallowed and
  retried; the foreground watch keeps working meanwhile.
- Stop is only issued when the task reports started; errors are swallowed.
- Process death kills the service (`killServiceOnDestroy`); the next cold start
  gets its fix from the foreground watch as today.

## Testing

- `roundTracking.test.js`: task delivery publishes to subscribers; first
  `setRoundTracking` starts with the given text; identical text is deduped;
  text changes inside 3 s coalesce into one trailing post; null stops only when
  started; a failed start is retried on the next call; web is a no-op.
- `useRoundTracking.test.js`: text for the three states; no update for a
  centre move under 5 m; update on hole change; stop on inactive and unmount.
- `useGpsDistances.native.test.js`: a live fix seeds the position on mount and
  later task fixes update it.
