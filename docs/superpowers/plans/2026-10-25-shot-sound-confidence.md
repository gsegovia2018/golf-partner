# Shot sound confidence — plan

Date: 2026-10-25. Status: built (design B, graded pins + evidence chips); waiting for the APK and a round on the course.

## Goal

The GPS trail keeps suggesting the same "seen" shots (`store/shotDetection` →
`shotProposalStore` → `useShotProposals`). We add two on-device signals, the
microphone (a club-on-ball strike) and the phone's motion (my own swing),
score each proposal with them, and **highlight the probable ones on the hole
map**. Nothing is added automatically yet. Every Add / Not a shot answer
already labels a proposal (`status`), so each round is training data; the
sensing logs features and keeps a 1 s clip per strike on the phone so the
detector can be tuned later and, eventually, auto-detect.

Decisions (Marcos, 2026-10-25): log motion too; keep 1 s clips on the phone;
APK build and the mic indicator are fine.

## Pieces

### 1. Native: `modules/golf-shot-sense` (Kotlin, Android only) — needs an APK

- `ShotSenseService`: a foreground service, `foregroundServiceType="microphone"`
  (Android 11+ silences a background mic without it; Android 14 needs
  `FOREGROUND_SERVICE_MICROPHONE`). Own low-importance notification
  ("Listening for shots"). Started only while the app is visible (same rule as
  the location service), stopped with it.
- Audio: `AudioRecord` 44.1 kHz mono PCM16, source `UNPROCESSED` when the
  device supports it, else `VOICE_RECOGNITION` (no AGC / noise suppression,
  which flatten transients). Detector: 1.5 kHz high-pass biquad → energy per
  128-sample frame (2.9 ms) → onset when the frame is ≥ 18 dB over a slow
  background estimate and above an absolute floor; 300 ms refractory.
  Features per strike: `t` (epoch ms), `peakDb` (dBFS), `bgDb`, `riseMs`,
  `decayMs` (time to fall 20 dB), `centroidHz` (1024-point FFT at the onset).
- Motion: `SensorManager` accelerometer + gyroscope at 100 Hz into a 3 s
  ring buffer. Per strike: `gyroPeak` (rad/s) and `accPeak` (m/s², |a| − g)
  over [−1.0 s, +0.3 s]. Standalone `swing` events too (gyro peak ≥ 3 rad/s,
  2 s refractory) so practice swings and shots without a heard strike are
  logged.
- Clips: 0.5 s before to 0.5 s after each strike, decimated to 22.05 kHz,
  written as WAV to `filesDir/shot-sense/<session>/<t>.wav` (~44 KB).
- Events go to `filesDir/shot-sense/<session>/events.jsonl` (one JSON per
  line). JS reads the file; it never depends on JS running while the screen
  is off. Sessions beyond the newest 10 are deleted on start.
- JS API: `start(session)`, `stop()`, `readEvents(session)`,
  `sessionFiles(session)`, `isRunning()`, `apiVersion`.
- Manifest (module's own): service + `FOREGROUND_SERVICE_MICROPHONE`.
  `RECORD_AUDIO` is already in `app.json`.

### 2. JS wrapper and wiring (OTA from here on)

- `src/lib/shotSense.js` (+ `.web.js` no-op): `requireOptionalNativeModule`,
  so a binary without the module simply has no sound data.
- New setting `listenForShots` ("Listen for shots (test)"), under the GPS
  trail switch; turning it on asks for the mic permission. Gate: setting on,
  GPS trail on, live round active, Android.
- `hooks/useRoundTracking` starts / stops the sense service next to
  `setRoundTracking`, session = `proposalRoundKey(roundId, roundIndex)`.

### 3. Scoring (pure, tested): `src/store/shotSound.js`

`soundLevel(stop, events, { listening })` →
- `'shot'`: a strike in [stop.start − 5 s, stop.end + 10 s] with own motion
  (`gyroPeak` ≥ GYRO_MIN) within its window;
- `'heard'`: a strike there, no own motion;
- `'quiet'`: listening covered the stop and heard nothing;
- `null`: no sound data for that time (setting off, old binary, web).
Thresholds are uncalibrated (`shortcut:` note, as in shotDetection).
`useShotProposals` loads the session's events (`readEvents`, refreshed when
proposals change) and adds `sound` to each open proposal.

### 4. UI — the chosen design (three options in the design page)

Map pins in `lib/holeMapHtml.js` (`drawSeen`) take a `level`; `SeenMapCard`
shows the evidence; settings get the switch and the export. Proposals are
**never hidden**: same list as today, the cue only ranks them.

### 5. Data for tuning

- Settings → "Export shot sound data": one JSON per round (stops with their
  answers, strike/swing events, clips as base64) through the share sheet
  (`expo-sharing`, already a dependency). Nothing leaves the phone otherwise.
- `scripts/analyzeShotSound.mjs <export.json>`: per level, how many proposals
  were added vs dismissed (precision / recall), and feature distributions for
  added vs dismissed, to set the thresholds.

## Risks

- Partners' strikes near my stops → `'heard'` stays a weak level; `'shot'`
  needs my own motion. To be checked on real rounds.
- Phone in the bag or on a cart: no motion, muffled mic → no highlight
  (safe failure: the pin looks as today).
- Battery: AudioRecord + 100 Hz sensors for ~4 h. Measure on the first round.
- Two notifications during a round (location + mic).
- Fingerprint: a new native module ⇒ new `preview-arm64` APK; master is
  already ahead of the APK runtime (expo-blur), so it rides that build.

## Verification

- `npm test` + `npm run lint`: `shotSound` scoring, `useShotProposals`
  annotation, map HTML pin levels, settings switch, export builder.
- `/verify` on Expo web with seeded proposals + seeded events (localStorage)
  for every pin level and card state.
- On the phone (Marcos): mic + motion actually logged with screen off,
  notification, battery over a round, levels against real shots.
