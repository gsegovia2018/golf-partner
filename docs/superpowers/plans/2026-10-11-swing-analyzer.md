# Swing analyzer: on-device down-the-line swing check

**Date:** 2026-10-11
**Status:** Plan. Architecture decided (§2). Design step done: option B with borrowed pieces (D8). Pre-build validation in the swing lab (§8.5) is in progress: rules folded in from the first clip (2026-10-11, D17); ≥ 10 owner-labelled clips must pass before N1/N2 merge.
**Branch:** `feat/swing-analyzer` (worktree `~/Projects/golf-partner-swing`), from `master`.
**Prototype:** `docs/superpowers/specs/2026-10-11-swing-analyzer-prototype/` (`pose.py`, `traj.py`, `plane.py`, `annotate.py`, copied from the 2026-10-10 Python run) and the landmark fixture `src/swing/__tests__/fixtures/proto-swing-pose.json` (§8.1). Both were placed in the worktree while writing this plan and are not committed yet; they ship with PR S1.
**Adds:** a local Expo native module (`modules/golf-swing`, Kotlin: high-speed capture, frame decoding, MediaPipe pose, club heuristics), a pure JS analysis package (`src/swing/`), a local swing store, six screens, a Profile entry row.
**Keeps:** everything else. No Supabase change. No new server. The video never leaves the phone.

## 1. Required behaviour

Golf Partner's users are the same group of friends; the analyzer is for the one who films a swing at the range and wants to know *the one thing* to work on, now, without uploading anything.

| # | Situation | Required |
|---|---|---|
| S1 | Marcos opens **My swing** from Profile. | A list of his past swings (date, club, main fault, a thumbnail at impact) with an empty state and two actions: **Record** and **Import**. |
| S2 | He taps Record. | A camera screen with a set-up guide (down-the-line, phone on the toe line at hand height, aimed at the hands (D24), whole body in frame, room above the head) and a pill showing the real frame rate the phone will record at: **240 fps** (green), **120 fps** (amber, "good enough"), below (red, "approximate analysis", plus "record in slow-mo with your camera app and import it"). Record, swing, stop. The file goes to app storage; no audio. |
| S3 | He taps Import. | The gallery picker (videos). A slow-motion clip from the stock camera, or a WhatsApp copy of one, is accepted. The slow-motion factor is detected from metadata when present and from the motion itself when stripped (§4.4). Fake (frame-doubled) slow-mo is detected and the result is labelled. |
| S4 | The clip is analysed. | On a mid-range Android, a 4 s clip at 720p/240 fps produces a result in **≤ 6 s** (§4.1 budget), with a progress screen naming the stage. Nothing runs on the JS thread except the final maths. |
| S5 | Results. | A summary card: traffic-light counts, **one main thing to work on** with the measured evidence ("early extension: you lose 7° of spine tilt, hands 10 cm higher at impact"), and 2–3 drills for it. Below, every check as green / yellow / red with its value in cm or degrees. |
| S6 | Checkpoints. | A stepper through the 12 checkpoints (address … finish) over the frame still, with the pose skeleton, hands (square), clubhead (dot, ring when estimated), ball (ring), and the shaft and shoulder plane lines from address. ±2 frame steps around each checkpoint. A normal video player for slow playback. |
| S7 | The proposed club marks are wrong. | **Edit marks**: drag the clubhead (or mark it hidden) and the hands per checkpoint; drag the ball on the address frame. Plane checks recompute instantly. Every correction is stored as training data for a future learned club detector (§7.3). |
| S8 | He films again next week. | History on the Swing home; **Compare** shows two swings side by side (checks and the impact still). |
| S9 | Privacy. | A one-line statement on the Swing home and the capture screen: the video and the analysis stay on this phone; nothing is uploaded. The only way data leaves is the explicit **Export training data** action (§7.3). |
| S10 | Web / older binaries. | On web the Profile row is hidden. An OTA bundle that is newer than the installed APK never calls a native method the binary lacks: the JS checks the module's `apiVersion` before offering capture or analysis and shows "Update the app" otherwise. |

Face-on view, iOS, a learned club detector, sharing results, and coaching between friends are **out of scope** (§12).

## 2. Architecture

### 2.1 Options evaluated

**(a) react-native-vision-camera v4 + frame processors + react-native-fast-tflite / MediaPipe.**
- New architecture: supported on RN 0.81 (v4.6+), with an Expo config plugin.
- Frame processors need `react-native-worklets-core`, a second worklet runtime beside the `react-native-worklets` that Reanimated 4 already installs. Two runtimes coexist but are a known source of build and Jest friction (this repo already composes a custom Jest resolver just for worklets).
- **High-speed capture is not exposed.** VisionCamera's Android formats come from `CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES` (typically ≤ 60). True 120/240 fps needs Camera2's `createConstrainedHighSpeedCaptureSession`, which VisionCamera does not use (long-standing open request).
- **Frame processors cannot run at 240 fps even in principle.** A constrained high-speed session accepts only preview and recorder surfaces (no `ImageReader`), so no code can see the frames while recording. Analysis has to happen on the saved file afterwards, with a decoder, whichever library captures.
- fast-tflite would run a TFLite pose model but not the MediaPipe PoseLandmarker *task* (detector + tracker + ROI logic); re-implementing that pipeline in JS is weeks of work and slower.

Net: (a) buys a camera that cannot do what we need, and still leaves decoding and pose to native code we'd write anyway. Rejected.

**(b) A local Expo module (`modules/golf-swing`, Kotlin, expo-modules-core).** Camera2 constrained high-speed recording behind an `ExpoView` preview, MediaCodec decoding, MediaPipe Tasks `PoseLandmarker` (VIDEO mode, GPU delegate), club heuristics on the checkpoint frames, returning compact JSON and files. **Chosen.**

### 2.2 Why (b)

- **It is the only route to real 240 fps on Android.** Camera2 high-speed sessions are a module-level concern; the module owns the preview surface and the `MediaRecorder` surface, which a high-speed session requires together.
- **New arch is a non-issue.** expo-modules-core modules are new-arch native (the app already runs `newArchEnabled: true` with expo-camera, expo-video, expo-location). No worklets, no extra runtime, no config plugin: autolinking picks `modules/*` up on its own.
- **Performance where it matters.** Decoding 700–1900 frames and running pose live on a Kotlin coroutine (`Dispatchers.Default`) and the GPU. JS receives ~350 landmark rows and does milliseconds of arithmetic.
- **Testability.** The analysis contract is JSON. Everything that *decides* (phases, checks, scoring, priority, drills) is pure JS in `src/swing/`, unit-tested with Jest against the fixture from the prototype run. The native side is a producer of landmarks and candidates with a small, fixed contract.
- **Fingerprint and shipping.** The module is a native change, so it lands in a new `preview-arm64` APK (CLAUDE.md "Shipping to Android"). After that, every screen and analysis PR is JS and ships OTA with `GOLF_ANDROID_BUILD_ARCHS=arm64-v8a npx eas-cli update --branch preview`. The `apiVersion` gate (S10) keeps OTA bundles safe on older binaries. `app.config.js` is untouched: there is no plugin to add; the module declares its own Gradle dependencies and assets.
- **Already-present pieces reused:** expo-image-picker (import), expo-video (playback), expo-file-system `File`/`Paths` (storage, same API the repo uses in `mediaUpload.js` and `profileStore.js`), react-native-svg (overlay), AsyncStorage (index), `PanResponder` from RN core (dragging — there is no gesture-handler dependency and we don't add one).

### 2.3 Split of responsibilities

```
modules/golf-swing (Kotlin)                      src/swing (pure JS, Jest)            src/store + screens
──────────────────────────────                   ──────────────────────────            ───────────────────
probeVideo(path)       → fps, capture fps,       fpsModel.js  slow-mo factor, fake     swingStore.js   index + files
                         duplicate-frame ratio   smoothing.js One-Euro + gates         SwingHome / Capture /
analyzePose(path,opts) → sampled landmarks,      phases.js    13 checkpoints           Results / EditMarks /
                         ball candidate, timings scale.js     px → cm                  Compare
extractCheckpoints(…)  → stills (jpg) + shaft    club.js      marks ⊕ candidates
                         candidates per frame    checks.js    21 checks (20 ids; clubhead_vs_plane is evaluated at pre-impact and impact), traffic light
GolfSwingCameraView    → high-speed preview      priority.js  the one main fault
startRecording/stop    → mp4 in app storage      drills.js    catalogue (English)
listRecordingModes()   → fps the device offers   labels.js    training-data export
apiVersion (constant)                            analyze.js   orchestration
```

Native never decides a phase or a verdict; JS never touches a pixel.

## 3. Native module contract (`modules/golf-swing`)

Created with `npx create-expo-module@latest --local golf-swing` (Android only in `expo-module.config.json`; a JS stub for web). `src/swing/native.js` is the only importer (lazy `requireNativeModule('GolfSwing')`), so Jest mocks one file.

```
GolfSwing.apiVersion: number                       // 1 in the first APK; bump on every contract change

probeVideo(path) → {
  width, height, durationMs, frameCount,
  containerFps,                                     // from MediaExtractor KEY_FRAME_RATE / timestamps
  captureFps | null,                                // MediaMetadataRetriever METADATA_KEY_CAPTURE_FRAMERATE (API 28+)
  rotationDeg,
  duplicateFrameRatio                               // share of near-identical consecutive frames in a 60-frame probe (fake slow-mo)
}

analyzePose(path, { model: 'full'|'lite', sampling: { sparseEvery: 8, afterImpactEvery: 2, denseEvery: 1 } }) → {   // policy in 4.2
  video: { width, height, containerFps, frameCount },
  frames: [ { i, tMs, lm: [[x, y, vis] × 33] } ],   // normalised coords, irregular sampling (see 4.2)
  ball: { x, y, r, conf, frame } | null,            // searched after the club leaves: lead-arm → top frames (4.3, D17)
  ballGoneFrame: number | null,                     // first frame where the ball patch changes sharply (impact refinement)
  timings: { decodeMs, inferMs, totalMs, inferences, delegate: 'gpu'|'cpu' }
}
events: 'progress' { stage: 'decode'|'pose', done, total }

extractCheckpoints(path, {
  frames: [ { key, i, hands: [x, y], neighbours: 2 } ],   // the 13 checkpoints (D22) with the smoothed grip estimate (4.5)
  trackRanges: [ [i0, i1, every] ],                        // v1 (D16): empty; clubhead only at address and impact
  ball: { x, y, r } | null,
  expectedShaftPx,                                         // from scale.js
  addressSearch: { run: [a, b], latest, quiet: [a, b], minRun } | null,   // phases.js, detect.py clubhead_onset (N2, apiVersion 2)
  outDir
}) → {
  stills: { [key]: { [i]: 'file://…/frames/556.jpg' } },   // checkpoint ±neighbours, full decode resolution, JPEG q85
  shaft: { [i]: { angleDeg, lengthPx, head: [x, y] | null, hidden, conf, source: 'edge'|'prior' } },   // v1: 'edge' at address and impact only (D16)
  addressFrame: number | null,                              // image-based P1 (onset in the ball patch − 1)
  timings: { totalMs, scanMs, decodeMs, addressDecodeMs, jpegWaitMs, onsetMs, shaftMs, decoded, stills }
}

listRecordingModes() → [ { width, height, fps, highSpeed: bool } ]   // sorted by fps desc
startRecording({ width, height, fps, outPath }) / stopRecording() → { path, fps, durationMs }
```

Implementation notes for the Opus items (§10):
- **Decode:** `MediaExtractor` + `MediaCodec` to an `ImageReader` (`YUV_420_888`); frames not selected by the sampling policy are released without rendering. Feed MediaPipe with `MediaImageBuilder(image)` (no Bitmap round-trip); fall back to a half-resolution Bitmap only if the device's decoder output isn't accepted. Decoding must overlap inference (producer/consumer, bounded queue of 4).
- **Pose:** `tasks-vision` ≥ 0.10.14, `RunningMode.VIDEO`, `numPoses = 1`, `BaseOptions.Delegate.GPU` with automatic fallback to CPU (XNNPACK, 4 threads) and `timings.delegate` reporting which ran. Timestamps are the frame's presentation time in **captured** time (container time × slow-mo factor is applied in JS; native just reports `tMs` as in the container).
- **Model file:** `pose_landmarker_full.task` (9.4 MB) in `modules/golf-swing/android/src/main/assets/`. `lite` (5.5 MB) is the fallback if the benchmark gate (§4.1) fails on the reference device; only one is bundled. `heavy` (30 MB, ~3× slower) is for the Python prototype only.
- **Pass 2 decode** is one sequential decode from the sync frame before the first requested frame to the last, rendering only requested frames. Never seek per checkpoint (12 seeks × up to 480 frames of I-frame distance would cost seconds).
- **Camera:** `CameraManager` → the back camera whose `StreamConfigurationMap.getHighSpeedVideoSizes()` is non-empty; choose the size/fps pair with the highest fps ≥ 120 that is ≤ 1080p (prefer 1280×720 @ 240 over 1080p @ 120: impact sharpness matters more than pixels). Session: `createConstrainedHighSpeedCaptureSession([previewSurface, recorderSurface])`, `createHighSpeedRequestList`. `MediaRecorder` with `setVideoFrameRate(fps)` and `setCaptureRate(fps)` (real-time file, accurate timestamps, no retiming), `setOrientationHint` for portrait, no audio source, H.264, ~20 Mbps at 720p240. If no high-speed capability: an ordinary session at the highest `CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES` (usually 60 or 30) and `highSpeed: false` in `listRecordingModes` so the UI warns. Lock AF/AE once the user frames the shot (tap), so exposure doesn't pump mid-swing.
- **Lifecycle:** release the camera in `onDetachedFromWindow` / app background; one analysis at a time (a mutex); cancel on screen leave.
- **Permissions:** `CAMERA` is declared by the module's own config plugin (`modules/golf-swing/app.plugin.js`, N3), so capture does not depend on expo-camera staying in `app.json`; no `RECORD_AUDIO` use. Nothing to add to `app.json`.
- **As built (N3):** capture is a second native module, `GolfSwingCamera` (`camera/` package: `listRecordingModes`, `GolfSwingCameraView` with `startRecording({ outPath })` / `stopRecording()` as view functions, the mode as a view prop). `GolfSwing.apiVersion` is 2; `native.js` gates capture on `CAPTURE_API_VERSION = 2` and the module's presence (`captureSupport()`), while import and analysis stay on `REQUIRED_API_VERSION = 1`, so an apiVersion 1 APK keeps analysing and the capture screen offers the import instead. The recorder input is a persistent surface, so one session serves every take.

## 4. Processing strategy

### 4.1 Budget (reference: a 2023 mid-range Snapdragon 7-series / Dimensity 7000-class phone, 4 s clip, 720p, 240 fps ≈ 960 frames)

| Stage | Work | Target |
|---|---|---|
| Probe | metadata + 60-frame duplicate check | 0.2 s |
| Pass 1 decode | 960 frames hardware decode, most not rendered | ~2 s, overlapped with inference |
| Pass 1 pose | ~300 inferences for this 960-frame reference (policy below: dense motionStart→impact ≈ 170, ≈ 40 after impact, ≈ 90 sparse) × 12–18 ms (full, GPU) | 3.6–5.4 s on top of overlap ⇒ **≤ 6 s wall** |
| JS | smoothing, phases, scale | < 50 ms |
| Pass 2 | decode the checkpoint span (~500 frames), 60 JPEG encodes, shaft search on ~200 frames | ~1.5 s |
| JS | club merge, checks, priority, drills, store | < 50 ms |

The result screen opens after pass 1 + JS phases (summary without club-dependent checks shows "calculating planes…" for pass 2's second and a half). **Gate:** if `timings.totalMs` for pass 1 on the reference device exceeds 6 s with `full` **on the 4 s / 960-frame reference clip**, switch the bundled model to `lite` (S-N1 acceptance criterion). The golden clip is longer (1297 frames, 5.4 s; lab: 455 inferences under the old fixed-rate policy; ≈ 400 with dense in-swing sampling, see 4.2), so on the phone it measures 4.8–7.2 s with `full`; judge the gate on the reference clip or scale by inference count, not on the raw golden-clip time. Longer clips cost linearly; the capture screen auto-stops at 8 s and the importer warns above 15 s ("trim the video to the swing").

### 4.2 Sampling (native policy, JS-authoritative phases)

The swing itself is sampled **every frame**; only the dead time around it is sparse. One pass, no second decode, no phase logic in Kotlin:

| Zone | Policy |
|---|---|
| before `motionStart` (address, waggle) | every 8th frame (30 Hz at 240 fps) |
| `motionStart` → impact | **every frame**; when the sparse zone first sees the grip leave its still position by > 3σ, native back-fills the skipped frames from an 8-frame ring buffer, so density starts at `motionStart` |
| impact → finish | every 2nd frame until grip and nose are stopped (below), then sparse |
| after finish | every 8th frame |

**Why not every-8th inside the swing (lab, 2026-10-11, D17).** The old policy put `top` 4 frames early (sparse samples straddled the reversal) and fed the arm-level and plateau rules too few points. Dense in-swing sampling is what the zero-lag filter (4.5) and the frame-resolution crossings of 5.1 assume.

**Thresholds are per-clip, noise-derived, never a fixed H/s constant.** Pose jitter at 240 fps is 0.5–1.5 px/frame, so a constant like the old `v_still = 0.03 × H/s` is either above the real signal or inside the noise depending on phone, codec and framing. Native and JS derive them from the clip:

- **σ** = robust jitter of the grip (and the nose): 1.4826 × MAD of raw − smoothed. Native uses the first 0.5 s of sparse samples (still address) for its online trigger; JS recomputes it over the whole clip.
- **moving** = displacement beyond 3σ.
- **stopped** = 3 × the 25th percentile of the 0.15 s-averaged speed over the clip (assumes address + finish are held still, which any swing clip satisfies).

At 30 fps container (imported slow-mo), the same policy holds in container frames; the fixture clip (30 fps playback of 240 fps capture) therefore samples like a native 240 fps recording. JS always works in **captured time** (`tMs × slowMoFactor`) and never assumes regular spacing.

**Inference count.** Golden clip (1297 frames): dense ≈ 232 (frames ~326–557) + ≈ 42 after impact (every 2nd to the finish) + ≈ 123 sparse (the other ≈ 980 frames ÷ 8) ≈ **400**, against 455 for the lab's old fixed-rate policy (7.5 s of lab-Mac CPU for 455). Not yet run in the lab; the lab `d15` variant still uses the old pass 1. The 960-frame reference clip of 4.1 comes to ≈ 300.

### 4.3 Assisted club heuristics (v1)

**v1 scope (D16, D17):** the ball is detected once in pass 1; the clubhead is proposed **only at address and impact**, seeded from the hands→ball direction (lab: 7 cm off at impact); the shaft search below is **not run elsewhere in v1** (it failed in the lab: 75–110 cm off at every other checkpoint) and stays as the v2 starting point. **As shipped in N2:** the impact clubhead is ONE search at the impact frame, seeded hands → ball (±15°). The lab instead tracks top → trailArm + 2 and reseeds hands → ball at impact − 2. v1 keeps the single search on purpose: no tracking cost, and the golden clip lands at 3.8 cm through the native module, against 6.9 cm for the lab's tracked result. The address search runs on the image-based address frame. Pure Kotlin on a grayscale, half-resolution copy; no OpenCV (20 MB and a second native dependency for two functions).

**Ball (camera static; searched AFTER the club leaves).** At address the soled club hides the ball, so the search frames are the lead-arm→top frames (club in the air, scene static), median over three of them. ROI: x from the lead-foot toe to the hands x + 0.3 W, y from ankle y − 0.1 H to ankle y + 0.05 H (pose gives feet and hands). Expected diameter from scale: 4.27 cm × px/cm (≈ 12–18 px at 720p with the golfer filling the frame). Candidate = connected component of the top 2 % brightness in the ROI with area within ±50 % of expected, circularity > 0.7, closest to the extension of the address shaft (hands → down-and-toward-the-target). Confidence from circularity and brightness contrast. **Impact refinement:** the patch at the ball position is compared frame to frame after top; the first frame whose patch difference exceeds 4× the noise of the static window (lead-arm→top, per clip) is `ballGoneFrame`; impact = `ballGoneFrame − 1`. Lab: ball 1.8 cm, impact +1 frame. The same ball patch gives the address frame (5.1, P1).

**Shaft (v2 only; v1 runs it at address and impact seeds only).** From the smoothed grip estimate, sample 360 rays at 1° steps over radius r ∈ [0.15, 1.0] × `expectedShaftPx` (shaft ≈ 95–115 cm for irons/drivers; use 105 cm × px/cm, the user's club class refines later). Score(θ) = sum of gradient magnitude perpendicular to the ray, minus the parallel component, over r; the shaft is a 1–3 px bright/dark pair of parallel edges, so it scores far above grass or clothing. Temporal continuity: at 240 fps the shaft rotates ≤ 10°/frame even at impact (~2000°/s), so within a tracked range the search is ±15° around the previous frame's angle, seeded at address by the hands→ball direction. **Length** = the radius where the sustained score drops below 35 % of its peak; **clubhead** = the end point plus a small dark/bright blob search in a 1.5× ball-diameter window. **Hidden:** when the best score is < 2.5× the median of all rays, or the length < 0.3 × expected (shaft end-on to the camera: takeaway, downswing shaft-parallel, transition), the frame is `hidden: true` with the angle kept as a prior. **Prior fallback** (`source: 'prior'`): hands + the expected direction for that checkpoint (address/impact: toward the ball; top: toward the target), confidence 0.1, so the UI always has something to drag.

**Honest accuracy** (from the prototype frames, uncluttered range mat, 478×850 WhatsApp copy): address, pre-impact, impact and post-impact should be within 10 px ~80–90 % of the time; takeaway and lead-arm parallel ~60 %; late backswing, top and transition are the weak ones (foreshortening, the shaft crossing the body or the head, motion blur) — expect the user to drag those a third of the time. Busy backgrounds (netting, other golfers) will hurt. That is why v1 is *assisted*: every proposal is draggable, "hidden" is one tap, and §7.3 collects the corrections for v2.

### 4.4 Frame rate and slow-motion factor (`fpsModel.js`)

1. `captureFps` present (stock camera slow-mo, Pixel/Samsung/Xiaomi all write it) → factor = captureFps / containerFps.
2. Absent (WhatsApp, Telegram, most editors strip it; the fixture clip is one) → estimate from the swing: the downswing (top → impact) is 0.22–0.32 s in every real swing. factor = the member of {1, 2, 4, 8} that brings `(impact − top) / containerFps` closest to 0.27 s. Fixture: 61 frames / 29.97 = 2.03 s → factor 8 ✓.
3. `duplicateFrameRatio > 0.4` → the clip was frame-doubled: effective fps halves and the result carries `approximate: true` ("interpolated slow-mo: impact is approximate").
4. Effective capture fps < 100 → the impact and pre-impact checks are marked approximate and the capture pill rule (S2) applies.

### 4.5 Smoothing and sanity (`smoothing.js`)

**Offline, zero-lag.** The whole clip is in hand, so each landmark coordinate runs through the One-Euro filter **forward and backward in time and the two outputs are averaged**, in **pixels and captured time** (handles the irregular sampling). The causal filter lags ~25 frames at 240 fps when the hands move slowly (takeaway), a bias in every "first frame that…" rule. Causal filtering only if the analysis is ever run live. Parameters: hands/grip `minCutoff 1.5 Hz, beta 0.05, dCutoff 1 Hz` (the hands trajectory must keep its reversal at the top within ±2 frames on the fixture); hips, shoulders and nose `minCutoff 1.0`.

**Hands = grip estimate, not the wrist midpoint (D17).** MediaPipe gives wrist joints, the golfer holds the club about half a hand further on. Per arm: `grip = wrist + k·(wrist − elbow)`, **k = 0.35**, in image space (foreshortened like the forearm). Anatomy, not a fit: hand ≈ 0.74 × forearm (Winter), the shaft crosses the palm at ~½ hand ⇒ k ≈ 0.37. Lab k sweep: 0.2–0.35 best. Known residual: wrist hinge at P2 and the trail-wrist landmark at P9 stay ~12 cm off. Hands = the midpoint of the two arms' grip points.

**Wrist gate (before filtering).** A wrist with visibility < 0.5 is dropped when the other is visible (that arm's grip point is dropped with it); if both are < 0.5 keep both and interpolate from neighbours. A jump of more than 1.5 × forearm length (elbow→wrist) since the previous sample is also rejected and interpolated. For the "arm level" rules (5.1) each arm's end point blends its wrist with the gated midpoint by the wrist's visibility (down the line the lead wrist is hidden much of the time).

### 4.6 Pixel → cm (`scale.js`)

Body-segment scale, not frame height, because the golfer is tilted at address: `legPx` = median over the address window of (hip→knee + knee→ankle) of the camera-nearer leg, and anthropometrically hip-joint-to-ankle ≈ 0.49 × height. `pxPerCm = legPx / (0.49 × heightCm)`. `heightCm` is asked once on the first analysis (a sheet on the Swing home, stored **locally** in the swing store, D5) and defaults to 176 (male) / 163 (female) from the profile's gender with `approx: true` when unanswered. Expected error ±8–10 %; cm values are shown rounded to the nearest cm and the summary says "approx." when approximate.

## 5. Analysis (pure JS, `src/swing/`)

### 5.1 Phases (`phases.js`) — ports the lab's `detect.py --variant d15` (D17)

Input: the zero-lag smoothed series (4.5) in captured time, interpolated to **every frame** so crossings land at frame resolution. H = body height px. Output: the checkpoint frame indices plus `motionStart`, and a `confidence` per checkpoint (0.7–0.9 when the rule fired, 0.2 when a fallback to the window midpoint was used).

The rules are **geometric**, one per D15 definition (below); there are no timing fractions of the backswing or downswing. Notation: σ = per-clip grip jitter (4.2); stopped = per-clip stopped speed (4.2); **level band** = arm length × sin 5°, arm length = 95th percentile over the clip of the projected shoulder→wrist distance (at address the arms hang nearly in the image plane); "grip" = the grip estimate of 4.5; "wrist" = that arm's end point of 4.5.

| Key | Rule |
|---|---|
| `motionStart` (internal) | From the half-rise of the final backswing, walk back to the last frame whose preceding 0.15 s of grip speed (averaged over the window) is ≤ stopped. |
| `address` P1 | From the **clubhead/ball image patch** (±1.5 ball diameters around the ball): mean absolute frame-to-frame difference, 3-frame median. Noise ceiling = the max of the same signal while the ball sits alone (lead-arm → top, scene static; measured on the clip). Onset = the start of the **last** run above the ceiling that starts inside the hands' still run, runs shorter than 0.02 s ignored (compression keyframe jumps; waggles come earlier); address = onset − 1, the last still frame before the hands move. Fallback: `motionStart`. |
| `takeaway` P2 | First frame in `motionStart → top` where the grip rises to the **trail-hip height**. |
| `leadArm` P3 | First frame in `takeaway → top` where the lead wrist enters the level band around the lead shoulder's height. |
| `top` P4 | Downswing anchor = the **fastest descent of the grip** (mean speed) among descents ≥ 0.2 H. `top` = the **end of the hands' plateau**: from the hands' highest point before the anchor, the last frame before the grip drops more than 3σ below it. (The club keeps going back after the hands stop, so the plateau start is always too early.) |
| `transition` P5 | First frame in `top → impact` where the lead wrist is back in the level band. |
| `shaftDown` P6 | First frame in `transition → impact` where the grip falls to trail-hip height (the shaft is end-on there; no image check). |
| `impact` P7 | `ballGoneFrame − 1` when the ball leaves inside `top < ballGone ≤ descent end + 0.02 s`; otherwise the bottom of the hands' largest descent (confidence 0.5). |
| `shaftThrough` P8 (D22) | First frame in `impact → trailArm` where the grip rises back to the **lead-hip height** (the mirror of P6; the shaft points along the target line there, no image check). |
| `trailArm` P9 | First frame in `impact → end` where the trail wrist enters the level band around the trail shoulder's height. |
| `finish` P10 | First frame after `trailArm` where grip **and** nose both stay below stopped speed for 0.15 s. Fallback: the last frame. |

After any change to `impact` the rules between `address` and `finish` are re-run. **Order is enforced** P1 < P2 < … < P10: a checkpoint at or before its predecessor moves to predecessor + 1 and its confidence is capped at 0.2.

Internal frames: `lateBackswing` = midpoint of `leadArm` → `top`; `preImpact` = impact − 6 captured frames (25 ms); `postImpact` = impact + 10; `followThrough` is `trailArm` (the old separate rule is dropped). The 13 stills of the contract (3) are these ten (D22) plus the three internal frames.

Backswing = `motionStart` → `top`; downswing = `top` → `impact`.

#### User-facing checkpoint definitions (D15)

Down-the-line view, right-handed (mirror left/right for left-handed). Source of truth for the swing lab editor (`tools/swing-lab/editor/checkpoints.js`); the detector rules above and the golden tests target these. Where a definition is about the shaft (P2, P6, P8), v1 detects it from the grip's height (trail hip for P2/P6, lead hip for P8), not from the shaft.

| Key | P | Definition | Stop on |
|---|---|---|---|
| `address` | P1 | Set up and still, club resting behind the ball. | The last frame before the clubhead starts moving back. |
| `takeaway` | P2 | Shaft parallel to the ground on the way back. | The first frame the shaft is level. From behind the club points along the target line, so it looks very short or disappears behind the hands: mark the head hidden if it cannot be seen. |
| `leadArm` | P3 | Left arm parallel to the ground in the backswing. | The first frame the left arm is level. |
| `top` | P4 | End of the backswing: the club stops going back. | The last frame before the club starts down. Watch the clubhead, not the hands: it keeps moving a little after the hands stop. |
| `transition` | P5 | Left arm parallel to the ground on the way down. | The first frame the left arm is level again in the downswing. |
| `shaftDown` | P6 | Shaft parallel to the ground in the downswing, hands around the right hip. | The first frame the shaft is level. From behind it often points at the camera: mark the clubhead hidden. |
| `impact` | P7 | The clubface meets the ball. | The last frame where the ball is still sitting where it was (on the next frame it has gone or moved). |
| `shaftThrough` | P8 | Shaft parallel to the ground after impact, hands around the left hip (D22). | The first frame the shaft is level on the way through. From behind it often points away from the camera: mark the clubhead hidden. |
| `trailArm` | P9 | Right arm parallel to the ground after impact. | The first frame the right arm is level in the follow-through. |
| `finish` | P10 | Swing complete and held. | The first frame where the body and the club have stopped moving. |

### 5.2 Geometry (`geometry.js`) — ports `plane.py`

- `angleAboveHorizontal(p, q)` = atan2(−(q.y−p.y), |q.x−p.x|) in degrees.
- `sideOfLine(pt, a, b)` = signed perpendicular distance from line a→b, positive on the ball side (above/outside), in px; converted to cm by the caller.
- `extendToY(p, q, y)` → x where the line p→q crosses height y (butt-end extension).
- `spineTiltDeg(hips, shoulders)` = atan2(sh.x − hip.x, hip.y − sh.y) in degrees from vertical; mid-hip and mid-shoulder from pose.
- `trailShoulder(lm)` = the shoulder nearer the camera (smaller x for a right-hander filmed from behind — the prototype's rule; mirrored for left-handers, D6).
- Reference lines at address: **shaft plane** = ball → hands (52° in the fixture); **shoulder plane** = ball → trail shoulder (67°).

### 5.3 Club (`club.js`)

`resolveClub(checkpoint, candidate, userMark)`: a user mark always wins; otherwise the candidate if `conf ≥ 0.35`, else `prior`. Returns `{ hands, head | null, hidden, source: 'user'|'edge'|'prior', conf }`. Plane checks that need the clubhead return `status: 'unknown'` ("hidden in this frame") when `head` is null and never fail the swing for it.

### 5.4 Checks (`checks.js`)

Every check returns `{ id, phase, status: 'green'|'yellow'|'red'|'unknown', value, unit, text, approximate }`. Thresholds (cm after scale; degrees as measured). The fixture's values are in brackets.

| id | Where | Measure | green | yellow | red |
|---|---|---|---|---|---|
| `posture_address` | address | spine tilt from vertical [32°] | 25–40 | 20–25 / 40–45 | else |
| `hands_under_shoulders` (D21) | address | grip x − shoulder-midpoint x along the target-line normal, cm; + = out toward the ball [+8, red] | \|d\| ≤ 4 | ≤ 8 | > 8 ("too far out" / "too close") |
| `waist_bend` (D21) | address | angle at the mid-hip between torso (→ mid-shoulder) and thigh (→ mid-knee), ideal ~135° [134°] | 125–145 | 115–125 / 145–155 | else ("bent over" / "too tall") |
| `back_line` (D21) | address | angle between ear→shoulder and shoulder→hip (mid-points); side says "head dropped / rounded" or "head lifted" [38°, dropped] | ≤ 10° | ≤ 20° | > 20° |
| `hand_gap` (D21) | address | grip x − the lead thigh line (hip→knee, extended to the grip's height), cm [29, red] | 10–20 | 6–10 / 20–25 | else ("too close" / "reaching") |
| `hands_between_planes` | leadArmParallel, lateBackswing, top | hands side vs shaft plane (+) and shoulder plane (−) | between | ≤ 4 cm outside either | > 4 cm outside |
| `butt_extension` "Halfway back: steep" (D23) | leadArmParallel | butt-end line hits ground between toes and ball | between (10 % margin): steep enough | beyond ball ≤ 15 cm (shallow/flat) / inside toes ≤ 15 cm (too steep) | further |
| `top_direction` | top | clubhead x − hands x, in H units; foreshortened | \|dx\| ≤ 0.08 H | > 0.08 H ("crossed" if +, "laid off" if −) | never red |
| `hands_over_heels` (D21) | top | grip x − trail heel x (pose heel landmark), cm; − = behind the heel [+16, red] | \|d\| ≤ 6 | ≤ 12 | > 12 ("too deep" if −, "not enough depth" if +) |
| `lead_arm_shoulder_plane` (D21) | top | 2D angle of the lead arm (shoulder→wrist) minus the address shoulder plane (ball→trail shoulder); + = above (more upright) [−16°, yellow] | \|d\| ≤ 10° | ≤ 20° | > 20° ("above" / "below the plane") |
| `shaft_down_shallow` "Halfway down: shallow" (D23) | shaftDown (P6) | shaft line (grip → clubhead) extended to ball height, cm from the ball; needs the clubhead | beyond the ball (shallow) | between toes and ball | inside the toes (steep, over the top) |
| `shaft_through_steep` "Halfway through: steep" (D23) | shaftThrough (P8) | the same line at P8; needs the clubhead | between toes and ball, or inside (steep again) | beyond the ball ≤ 15 cm (flat) | further (flip) |
| `downswing_path` | shaftParallelDown | hands x vs the backswing hand path interpolated at the same y | ≤ 3 cm inside/under (shallower) or ±3 | 3–6 cm outside | > 6 cm outside (over the top) |
| `clubhead_vs_plane` | preImpact, impact | clubhead side vs shaft plane | −4…+4 cm | +4…+8 (steep) / < −4 (under) | > +8 cm |
| `hands_height_impact` | impact vs address | Δy of hands [≈ +10 cm high] | ≤ 5 | 5–8 | > 8 |
| `hands_out_impact` | impact vs address | horizontal distance of the hands at impact toward the ball line, cm [≈ 9 cm] | ≤ 4 | 4–8 | > 8 |
| `shaft_angle_impact` | impact vs address | Δ shaft angle above horizontal [+8°, more upright] | ≤ 6 | 6–10 | > 10 |
| `spine_loss` | impact vs address | tilt loss [32→25, 7°] | ≤ 3 | 3–6 | > 6 |
| `hip_drift` | impact vs address | trail hip x toward the ball | ≤ 3 cm | 3–6 | > 6 |
| `head_drift` | impact vs address | nose Δx, Δy | ≤ 5 cm | 5–10 | > 10 |
| `tempo` | backswing : downswing frames [110 : 61 ≈ 1.8] | ratio | 2.5–3.5 | 1.6–2.5 or 3.5–4.5 | < 1.6 or > 4.5 |
| `finish_balance` | finish | quiet ≥ 0.4 s and mid-hip x within 0.08 H of lead ankle x | both | one | neither |

Impact-dependent checks inherit `approximate` from `fpsModel` (effective fps < 100 or interpolated).

The six D21 rows are pose-only (no clubhead needed). Their limits are **provisional (2026-10-12)** and identical for iron and driver (`SETUP_TOP` in `THRESHOLDS`) until real swings calibrate them. Bracketed values are the owner swing with the owner marks.

**Per club (D19).** The table above is the **iron** column (the default, and the reading for every swing saved before the picker). Exactly one more club, **driver**, changes seven rows; every other row is identical for both. The values live in one constant, `THRESHOLDS[club]` in `checks.js`. **The driver values are provisional starting points (2026-10-12), to be calibrated on real driver swings.**

| id | iron green | iron yellow | driver green | driver yellow | red (either club) |
|---|---|---|---|---|---|
| `posture_address` (spine tilt) | 25–40 | 20–25 / 40–45 | 20–35 | 15–20 / 35–40 | beyond yellow |
| `clubhead_vs_plane` | \|d\| ≤ 4 cm | 4 < d ≤ 8; d < −4 | \|d\| ≤ 6 cm | 6 < d ≤ 10; d < −6 | beyond yellow |
| `butt_extension` | between | beyond ball / inside toes ≤ 15 cm | between | ≤ 20 cm | beyond yellow |
| `hands_height_impact` | ≤ 5 | 5–8 | ≤ 8 | 8–12 | beyond yellow |
| `shaft_angle_impact` | ≤ 6 | 6–10 | ≤ 8 | 8–12 | beyond yellow |
| `spine_loss` | ≤ 3 | 3–6 | ≤ 4 | 4–7 | beyond yellow |
| `head_drift` | ≤ 5 | 5–10 | ≤ 6 | 6–12 | beyond yellow |

### 5.5 Priority (`priority.js`) — earliest fault first (D21)

Faults are clusters of checks, each with a swing phase and a weight:

| fault | phase | checks | weight |
|---|---|---|---|
| `posture` | setup | posture_address, hands_under_shoulders, waist_bend, back_line, hand_gap | 0.7 |
| `steep_backswing` / `flat_backswing` | backswing | hands_between_planes, butt_extension | 0.8 |
| `top_position` | backswing | hands_over_heels, lead_arm_shoulder_plane | 0.8 |
| `across_the_line` / `laid_off` | — | top_direction | never main (no cluster) |
| `tempo_fast` / `tempo_slow` | transition | tempo | 0.6 |
| `over_the_top` | transition | downswing_path (outside), clubhead_vs_plane (steep), shaft_down_shallow (steep, D23) | 0.95 |
| `early_extension` | impact | spine_loss, hip_drift, hands_height_impact, hands_out_impact, shaft_angle_impact | 1.0 |
| `head_sway` | impact | head_drift | 0.7 |
| `flip` (D23) | impact | shaft_through_steep (flat) | 0.6 |
| `balance` | finish | finish_balance | 0.5 |

A fault is **significant** when its cluster has ≥ 1 red or ≥ 2 yellows (a single yellow is a "watch"). The **main fault is the significant fault of the earliest phase** (setup → backswing → transition/downswing → impact → finish): an early fault usually causes what shows up later, so it is the one to fix first. Within one phase the weighted score decides — score = weight × (red: 1, yellow: 0.5) summed over the cluster, × (1 + 0.25 × (agreeing signals − 1)) — and an exact tie goes to the table order. With no significant fault there is no main fault (the old weighted rule never promoted a lone yellow either). The significant faults of **later** phases are returned as `consequences`; the Results hero shows them as one line, "Likely also causing: …" (the first two by phase, then "and N more"). Output: `{ fault, label, phase, score, evidence: [checks], drills: [ids], consequences: [faultIds] }`.

### 5.6 Drills (`drills.js`) — original English text, same shape as `store/coachDrills.js`

| fault | id | title | instruction (abridged in the plan; full text in the module) | passTarget |
|---|---|---|---|---|
| early_extension | `ee-silla` | The chair | Place a chair (or a bag) touching your glutes at address. Swing at 70 % keeping contact until impact. | 8 of 10 without losing contact |
| early_extension | `ee-pared` | Glutes on the wall | Address with your glutes lightly touching a wall. Half up and down to impact without pulling away. | 10 in a row touching |
| early_extension | `ee-palo-talones` | Club behind the heels | A club on the ground 5 cm behind your heels. If your hips step on it on the way down, you have extended. | 8 of 10 without stepping on it |
| over_the_top | `ott-toalla` | Towel under the arm | A towel under the trail armpit for the whole swing; if it drops before impact, you came down from outside. | 8 of 10 without dropping |
| over_the_top | `ott-caja` | Outside box | A box of balls (or a headcover) 10 cm outside and behind the ball. Hit without touching it. | 8 of 10 clean |
| over_the_top | `ott-pausa` | Pause at the top | Stop for one second at the top and go down feeling the hands drop before you rotate. | 10 with the pause |
| steep_backswing | `sb-plano` | Club on the plane | Stick a club in the ground at the shaft angle from address. Backswing to lead arm parallel: your shaft parallel to the club. | 8 of 10 parallel |
| flat_backswing | `fb-codo` | Trail elbow up | Backswing to lead arm parallel with the trail elbow pointing at the ground and hands in front of your chest. | 8 of 10 |
| across_the_line | `atl-objetivo` | Shaft at the target | At the top, pause and look: the shaft should point at the flag. Short swings with a mirror behind you. | 8 of 10 |
| laid_off | `lo-objetivo` | Same drill | Same as above; here the shaft stays pointing left of the target. | 8 of 10 |
| head_sway | `hs-bola-cabeza` | Ball on the head | A partner holds a ball resting on your head (or film with a line on screen). Half backswing without moving it. | 8 of 10 |
| tempo_fast | `tf-tres-uno` | Three to one | Count "one-two-three" on the backswing and "one" on the downswing; record yourself and check the ratio. | ratio ≥ 2.5 in 3 of 5 |
| tempo_slow | `ts-suelta` | Let the downswing go | Normal backswing, downswing without thinking: the target is a ratio ≤ 3.5. | ratio ≤ 3.5 in 3 of 5 |
| balance | `bal-tres-seg` | Three seconds | End every swing and hold the finish three seconds on your lead leg. | 10 of 10 still |
| posture | `po-espejo` | Address in the mirror | Address side-on to a mirror: tilt from the hips 30°, soft knees, arms hanging. | 10 reps |
| posture (`hands_under_shoulders`) | `su-brazos` | Let the arms hang (D24) | Tilt until the club touches the ground, take the grip where the loose arms fall. | 10 setups on video |
| posture (`waist_bend`) | `su-bisagra` | Hinge, do not slump (D24) | Hands in the hip creases, push the hips back until the chest points at the ball. | 10 setups in the green band |
| posture (`back_line`) | `su-palo-espalda` | Club along the spine (D24) | A club touching head, upper back and tailbone; tilt without losing a contact. | 10 tilts |
| posture (`hand_gap`) | `su-palmo` | One hand of space (D24) | A spread hand fits between the butt of the club and the lead thigh. | 10 balls in a row |
| top_position (+ steep_backswing, across_the_line) | `pl-vidrio` | Pane of glass (Hogan's image, D24) | A stick from the ball to ~5 cm above the trail shoulder; at the top hands, arms and club stay under it. | 8 of 10 |
| over_the_top (+ flat_backswing, flip) | `pl-palo-atras` | Stick behind you (D24) | A stick 60–90 cm behind, covering the hands from down the line: hands inside it going back, club outside, then the club drops under it. | 8 of 10 without touching |
| flip | `fl-freeze` | Freeze past impact (D23) | Three-quarter shots, freeze with the shaft level after the ball: it should point inside the ball. | 8 of 10 |

`drillsForFault(fault)` returns the catalogue rows in order, then drills borrowed from a neighbouring fault (`also`: `top_position` borrows `fb-codo` and `atl-objetivo` until it has drills of its own); the results card shows the first two. `posture` (now five setup checks, D21) keeps `po-espejo`. **D24:** a drill may name the `checks` it targets; `drillsForMain(main)` puts the drills aimed at the main fault's evidence checks first, then the fault's own and borrowed ones, and `main.drills` stores that order. Every drill card shows one progression line: start slow with a 7-iron, film it, build to full speed once the position holds.

### 5.7 Strings (`strings.js`)

The app has **no i18n layer**: UI strings are inline English literals (`'Cancel'` × 21, tab labels, Settings sections), and the permission strings in `app.json` are Spanish. The swing screens still keep their copy in one module, `strings.js` (`SWING_STRINGS`), so a later translation or app-wide i18n is a one-file change.

## 6. Screens and navigation

Entry: a **My swing** row in Profile's quick-links card, next to Bag and Settings (`ProfileScreen.js` ~L335), hidden on web. Stack routes in `App.js`: `SwingHome`, `SwingCapture`, `SwingResults` (which also hosts the processing state), `SwingEditMarks`, `SwingCompare`. All `headerShown: false` like the rest; Results and EditMarks use `forHorizontalIOS`.

Per the owner's workflow every screen below goes through the **three-option design step (A fits in · B better · C bold)** before implementation; this plan lists what each screen must contain and stops there.

| Screen | Must contain | Reuse |
|---|---|---|
| **SwingHome** (list + history) | Privacy line; Record / Import; swings list (date, club chip, main fault, impact thumbnail, fps badge); empty state; height sheet on first use; storage used + delete (swipe); Compare (select two). | `ScreenContainer`, `IconButton`, `PressableScale`, `Reveal`, `SwipeToDelete`, `BottomSheet`, `SectionCard` |
| **SwingCapture** | Native preview (`GolfSwingCameraView`); set-up guide overlay (DTL silhouette + 4 tips, dismissable, remembered); fps pill (green/amber/red states); record button with elapsed time; auto-stop at 8 s; tap-to-lock exposure; fallback card when no high-speed ("import a slow-mo video"). Dark viewfinder chrome (DESIGN.md HUD palette). | `hud` tokens, `FlagFinderView` layout as the precedent for a full-screen camera modal |
| **SwingResults** — processing state | Stage list (Reading video → Detecting pose → Calculating planes) with progress, the clip's fps and factor, cancel. | `LoadingSplash` style |
| **SwingResults** — results | Summary card (counts, approximate flag); **Main thing to fix** card: fault name, evidence lines, two drills; checks list grouped by phase with status + value; checkpoint stepper (9 chips, D10 → still with SVG overlay: skeleton, hands square, clubhead dot/ring, ball ring, plane lines; ±2 frame arrows); "Edit marks"; video player (expo-video, rate 0.125). | `SectionCard`, `StatTile`, `MetricRow`, `CoachInsightRow`, `PracticePlanCard` patterns from mystats |
| **SwingEditMarks** | Per checkpoint: the still, draggable hands square and clubhead dot (`PanResponder`), "hidden" toggle, ball ring draggable on address, ±2 frame choice, Undo, live recompute of the three club-dependent checks, Save. | overlay component shared with Results |
| **SwingCompare** | Two swings side by side: date/club, impact stills with overlay, check rows paired with deltas, main fault each. | `ReportDeltaRow` |

Results follow design B (D8). The stepper and the checkpoint stills show the ten user-facing checkpoints of D10 + D22 (address, takeaway, leadArm, top, transition, shaftDown, impact, shaftThrough, trailArm, finish); the other frames are internal and reachable with the ±2 nudge where useful.

Shared component: `src/components/swing/SwingOverlay.js` (react-native-svg over an `Image` of the still, normalised coordinates → view coordinates; used by Results, EditMarks, Compare).

## 7. Data model and storage

### 7.1 Files — `Paths.document/swings/<swingId>/`

```
video.mp4            the recording or the imported copy (never modified)
probe.json           probeVideo result
pose.json            analyzePose result (landmarks, ball, timings)
analysis.json        the derived result (below)
marks.json           user corrections (below)
frames/<i>.jpg       checkpoint stills ±2 (≈ 60 files, ~3 MB at 720p)
thumb.jpg            impact still, 320 px wide, for the list
```

### 7.2 `analysis.json` (schema `swing-analysis/1`)

```
{ schema, swingId, createdAt, source: 'camera'|'import', club: 'driver'|'wood'|'iron'|'wedge'|null,
  handedness: 'right'|'left', view: 'dtl',
  fps: { container, capture, factor, effective, interpolated, approximate },
  scale: { pxPerCm, heightCm, approx },
  checkpoints: { address: { i, conf }, …, finish: { i, conf } },
  reference: { ball: [x, y], handsAddress: [x, y], trailShoulder: [x, y], shaftPlaneDeg, shoulderPlaneDeg },
  club: { [checkpoint]: { hands, head, hidden, source, conf } },
  checks: [ … §5.4 ],
  main: { fault, evidence, drills },
  timings }
```

Coordinates are normalised (0–1 of the decoded frame) everywhere on disk; px only inside the maths.

### 7.3 `marks.json` — the training data for v2 (schema `swing-club-labels/1`)

```
{ schema, swingId, video: { width, height, fps }, view: 'dtl', handedness,
  ball: { proposed: [x, y, r] | null, final: [x, y, r] | null, corrected },
  frames: [ { i, checkpoint, hands: { proposed, final }, 
              head: { proposed: [x, y] | null, proposedHidden, proposedConf, proposedSource,
                      final: [x, y] | null, finalHidden }, corrected, editedAt } ] }
```

Written on every save in EditMarks. **Export training data** (Swing home, gear menu) zips `marks.json` + `frames/*.jpg` of the selected swings into `Paths.cache` and hands it to `expo-sharing` — the explicit, user-initiated exception to "nothing leaves the phone". v2's detector trains on `(frame still, hands, final head, hidden)`.

### 7.4 Index — `src/store/swingStore.js`

Same shape as `shotStore.js` (module state, `useSyncExternalStore`, AsyncStorage mirror `golf_swings.v1`), **no Supabase**. Index rows: `{ id, createdAt, name, club, source, fps, mainFault, counts: { green, yellow, red }, thumb, bytes }`. Also holds `heightCm` and `handedness`. `deleteSwing(id)` removes the directory; `storageBytes()` for the home footer; a soft cap warning at 1 GB.

## 8. Testing

### 8.1 Fixture

`src/swing/__tests__/fixtures/proto-swing-pose.json` (364 KB): frames 200–700 of the prototype run, `[x, y, visibility]` × 33 at 4 decimals, plus the expected numbers from the run. **Landmarks only — no pixels, no video, no faces**; it is the owner's own swing and fine to commit. It carries `containerFps 29.97` and no capture-fps, so it also exercises the slow-mo estimation path (§4.4 step 2). The window starts 185 frames (0.77 s captured) before motion so the quiet-run logic has room.

### 8.2 Jest (CI, `npm test`)

- `fpsModel.test.js`: metadata path, estimation path (fixture → factor 8), interpolated detection, approximate flags.
- `smoothing.test.js`: zero-lag One-Euro (forward + backward) keeps the reversal within ±2 frames and adds no lag on a ramp; the wrist gate drops a wrist at visibility < 0.5 when the other is visible, and rejects a planted 200 px jump at visibility 0.2; grip = wrist + 0.35·(wrist − elbow).
- `phases.test.js` — **golden** against the owner-labelled frames of `tools/swing-lab/out/marcos-2026-10-10/truth.json` (the same tolerances as `eval.py`, in 240 fps-equivalent frames): address 300\* ±3, takeaway 414 ±6, leadArm 434 ±6, top 495 ±3, transition 536\* ±6, shaftDown 544 ±6, impact 556 ±3, trailArm 576 ±6, finish 640 ±6 (\* = disputed, under owner review: assert the final label once confirmed); `motionStart` stays a loose internal range [375, 395]. Plus synthetic series (no quiet start → confidence low, clip ends before finish, a 1-frame keyframe jump in the ball patch is ignored, a pose glitch inside the hold window does not end the finish).
- `scale.test.js`: fixture with 176 cm → `pxPerCm` within ±10 % of the prototype's implied scale (hands 10 cm ≈ the 20 px measured at impact → ~2 px/cm).
- `geometry.test.js`: ports the numbers from `plane.py` (shaft plane 52° ± 2, shoulder plane 67° ± 2, butt-end x at lead-arm parallel between toes and ball, impact hands side ≈ 0).
- `checks.test.js` — **golden** with the prototype's manual club marks as `userMark`s: `spine_loss` red (7° ± 2), `hands_height_impact` red (10 ± 3 cm), `hands_out_impact` red or yellow (≈ 9 cm; verify against the fixture), `shaft_angle_impact` yellow/red (+8° ± 3), `tempo` yellow (≈ 1.8), `top_direction` yellow (crossed), `clubhead_vs_plane` green at impact, `hidden` at transition → `unknown`. D21 rows on the same marks: `hands_under_shoulders` red (+8 cm, out), `waist_bend` green (134°), `back_line` red (38°, dropped), `hand_gap` red (29 cm, reaching), `hands_over_heels` red (+16 cm, not enough depth), `lead_arm_shoulder_plane` yellow (−16°, below).
- `priority.test.js` — **golden (D21)**: main fault `posture` (setup: hands under the shoulders, back line, hand gap), `consequences` = `flat_backswing`, `top_position`, `over_the_top`, `early_extension` (the pre-D21 verdict, still significant). Through `analyze()` with detected frames, `tempo_fast` joins the consequences (top detected at 483 → 1.2:1, red). Synthetic: the earliest significant phase beats a bigger later score; same-phase faults are not consequences; a lone early yellow never leads; over-the-top beats tempo; single yellow never becomes main.
- `drills.test.js`: every fault has ≥ 1 drill; ids unique; all strings non-empty English.
- `club.test.js`: user mark wins; low-confidence candidate → prior; hidden propagation.
- `labels.test.js`: marks.json round-trip, `corrected` flags, normalised coordinates.
- `swingStore.test.js`: index CRUD with the AsyncStorage mock; delete removes files (expo-file-system `File`/`Directory` mocked, as in `mediaUpload.test.js`).
- Screens: `SwingHomeScreen.test.js` (empty state, list, Android-only gating), `SwingResultsScreen.test.js` (renders a fixture analysis: main fault, 21 checks (20 ids; clubhead_vs_plane is evaluated at pre-impact and impact), stepper), `SwingEditMarksScreen.test.js` (drag updates marks and recomputes the clubhead check). `src/swing/native.js` mocked via `moduleNameMapper` entry `^.*/swing/native$`.

### 8.3 Kotlin (local, not CI)

`android/` is generated (gitignored) so Kotlin tests run after `npx expo prebuild --platform android` with `./gradlew :golf-swing:testDebugUnitTest`. Keep them few and JVM-pure (no Bitmap): the radial shaft search on a synthetic gray buffer with a drawn 2 px line (angle ± 2°, length ± 5 %), the hidden decision on a buffer with no line, `duplicateFrameRatio` on a doubled sequence, and the sampling policy's state machine on a synthetic speed series. The decoder and camera are verified on the device (§8.4).

### 8.4 Device verification (the "UAT" of this feature)

1. EAS **development** build once per native PR (`eas build -p android --profile development`), then Metro for the JS. `npx expo run:android` locally if the Android SDK is installed (optional).
2. Native PRs: `timings` logged for a 4 s 720p240 clip on the owner's phone and on one mid-range phone; the §4.1 gate.
3. **The golden swing on device:** import the owner's original slow-mo clip (not the WhatsApp copy) → the owner-labelled frames within the 8.2 tolerances (top 495, impact 556) in container frames (the original is 240 fps real-time or 30 fps slow-mo; either way the captured-time result matches), main fault early extension, ball found within 10 px of (273, 505) scaled.
4. Capture: on a phone with 240 fps the pill shows 240; recording plays at 1/8 speed with `playbackRate 0.125`; on a phone without high-speed the fallback card appears.
5. Preview APK (`preview-arm64`) with the module, then OTA for the screen PRs; `fingerprint:compare` before each update.

### 8.5 Swing lab (pre-build validation)

`tools/swing-lab` (git-ignored `clips/` and `out/`) runs the planned detection algorithms in Python on real clips before the Kotlin is written. `detect.py` runs the §4.2–§5.1 steps on a clip; **`--variant d15` is the reference implementation (D17)** that the Kotlin/JS port must match on the lab clips. The editor (`serve.py`) is design B's Edit marks screen on real frames, used to correct and label the proposals. `eval.py` compares the automatic output with the labelled truth against the acceptance targets: phase ≤ 3 capture frames at 240 fps for address, top and impact, ≤ 6 for the others; hands ≤ 4 cm; ball ≤ 2 cm; clubhead ≤ 6 cm where visible, and hidden agreement. The lab's labelled truth becomes the Jest and Kotlin fixtures.

**Gate before N1/N2 merge:** ≥ 10 owner-labelled **original-quality** clips (not WhatsApp copies) from different phones, clubs and light, each passing **≥ 8/9 phases and ≥ 7/9 hands**, with ball and impact inside target on every clip.

#### Validation status (2026-10-11, 1 clip, WhatsApp 478×850, `d15`, `full` model, 8.0 → 240 fps)

| Metric | Result | Target | Status |
|---|---|---|---|
| Phases | **6/9** (median error 4 frames) | ≥ 8/9 | open: address +25 and transition −10 differ from labels still **under owner review**; top −4 is caused by sparse sampling, fixed by the dense in-swing policy of 4.2 (not yet re-run) |
| Hands (grip estimate, k = 0.35) | **5/9**, median 3.7 cm | ≥ 7/9, ≤ 4 cm | open: wrist hinge at P2 and the trail wrist at P9 stay ~12 cm off; transition 37 cm follows its phase error |
| Ball | 1.8 cm (2.2 px) | ≤ 2 cm | pass |
| Impact | +1 frame (`ballGoneFrame − 1`) | ≤ 3 | pass |
| Clubhead | per D16: address and impact only; 7 cm at impact (6.7 cm at the labelled frame) | ≤ 6 cm | near; every other checkpoint is user-placed |
| Cost | 455 pose inferences / 1297 frames, 7.5 s pose on a lab Mac CPU (old policy) | phone gate in 4.1 | unmeasured on a phone |

The earlier variants (plan as written: 3/9 phases, 0/9 hands, ball not found; `fixed`: 3/9, 0/9) are in `tools/swing-lab/out/report.md`; D17 records what changed.

## 9. Verification per PR

- `npm test` and `npm run lint` green at every commit (CI).
- Native PRs: dev build boots, `apiVersion` reported, the device checks of §8.4 noted in the PR body (How verified).
- UI PRs: built on the approved design option; walkthrough on the device with a real clip; screenshots in the PR body.

## 10. Build items (one PR each, ideally < 400 changed lines; native PRs may exceed)

Model routing per the owner's rule: Haiku = mechanical, Sonnet = feature work against this plan, Opus = native module, camera, cross-cutting, performance. Review of the native and the navigation/gating changes stays at the top tier.

| # | Build item | Files | Acceptance | Model | Depends on | Size |
|---|---|---|---|---|---|---|
| **S1** | Fixture, prototype docs, `geometry.js`, `smoothing.js`, `scale.js` with tests | `src/swing/__tests__/fixtures/proto-swing-pose.json`, `docs/superpowers/specs/2026-10-11-swing-analyzer-prototype/*` (both already in the worktree), `src/swing/{geometry,smoothing,scale}.js` + tests | geometry numbers match `plane.py` (§8.2); smoothing keeps the reversal; scale within ±10 % | Sonnet (fixture/docs commit: Haiku) | — | M |
| **S2** | `fpsModel.js`, `phases.js` with the golden test | `src/swing/{fpsModel,phases}.js` + tests | §8.2 golden frames and tolerances; factor 8 on the fixture; matches `detect.py --variant d15` on the lab clips | Sonnet; escalate to Opus if the golden test does not converge in two attempts | S1 | M |
| **S3** | `club.js`, `checks.js`, `priority.js`, `drills.js`, `strings.js`, `analyze.js` | `src/swing/*` + tests | §8.2 golden: early extension main; all 15 checks (14 ids; clubhead_vs_plane is evaluated at pre-impact and impact) produce a status on the fixture with the prototype marks; drills in English | Sonnet (drills/strings typing from §5.6–5.7: Haiku) | S2 | L (split drills+strings into their own PR if > 400 lines) |
| **N1** | Native module: skeleton, `apiVersion`, `probeVideo`, `analyzePose` (MediaCodec → MediaPipe, dense in-swing sampling with ring-buffer back-fill (4.2), ball detection after the club leaves, `ballGoneFrame`, progress events, timings), JS bridge `src/swing/native.js` + web stub + Jest mock, `tasks-vision` dependency, bundled `full` model | `modules/golf-swing/**`, `src/swing/native.js`, `jest.config.js` mapper | dev build runs the fixture clip on device: 100 % frames with pose, `timings.totalMs ≤ 6000` on the reference phone (else switch to `lite` and record it in the PR), JSON contract exactly §3 | **Opus** | — (parallel with S1–S3) | XL |
| **S4** | `swingStore.js` + files layout + `labels.js` + height/handedness | `src/store/swingStore.js`, `src/swing/labels.js` + tests | index CRUD, delete removes the directory, marks round-trip | Sonnet | S3 | M |
| **D** | **Design step**: three options for the six screens (§6) | artifact, not code | owner picks | Fable | — | — |
| **S5** | SwingHome + Import flow + navigation + Profile row + Android gating + privacy line + processing state (design B, D8; errors per D12) | `src/screens/SwingHomeScreen.js`, `App.js`, `ProfileScreen.js`, `src/swing/importVideo.js` | import a clip → analysis runs → row appears; web hides the row; `apiVersion` gate message | Sonnet (App.js/Profile wiring reviewed by Opus) | S4, N1, D | L |
| **S6** | SwingResults per design B (D8): verdict hero (summary, main fault, drills), checkpoint still with timeline and the checks at that checkpoint, flat "All checks" list (no chapters), `SwingOverlay`, video player | `src/screens/SwingResultsScreen.js`, `src/components/swing/SwingOverlay.js` + tests | renders the fixture analysis; checkpoint view shows the 9 user-facing stills (D10) with overlay; ±2 frames | Sonnet | S5 | L |
| **N2** | Native `extractCheckpoints`: sequential pass-2 decode, stills ±2, clubhead proposal at address and impact only (seeded hands→ball, D16), prior/hidden states elsewhere; no shaft tracking in v1; JS `analyze.js` wires pass 2 | `modules/golf-swing/**`, `src/swing/analyze.js` | on the golden clip: impact clubhead within 7 cm (lab result), address clubhead proposed; every other checkpoint `prior`/hidden; pass 2 ≤ 1.5 s; Kotlin unit tests §8.3 (shaft-search test only if the v2 search is ported); merge gated by §8.5 | **Opus** | N1, S3 | L |
| **S7** | SwingEditMarks = design B's Edit marks mode (D8), the same screen as Results in edit mode: drag hands/clubhead/ball, hidden toggle, frame choice, undo, live recompute, save → `marks.json` | `src/screens/SwingEditMarksScreen.js` + tests | a drag changes `clubhead_vs_plane` instantly; marks persisted and re-applied on reopen; `corrected` flags | Sonnet | S6, N2 | L |
| **N3** | High-speed capture: `GolfSwingCameraView`, `listRecordingModes`, `startRecording`/`stopRecording`, lifecycle, fallback session; SwingCapture screen with guide overlay, fps pill, auto-stop, retake/analyse review step after stop and before decoding (D8) | `modules/golf-swing/**`, `src/screens/SwingCaptureScreen.js` | 240 fps file on a capable phone (verified by `probeVideo`), review step (retake / analyse, D8) before any decode, fallback card on an incapable one, no leaked camera on back/background, portrait orientation correct | **Opus** | N1, S5, D | XL |
| **S8** | SwingCompare + delete/storage footer + training-data export (zip + `expo-sharing`) | `src/screens/SwingCompareScreen.js`, `SwingHomeScreen.js`, `src/swing/exportLabels.js` | two swings side by side with deltas; export produces a zip with `marks.json` + stills | Sonnet | S7 | M |
| **S9** | Docs: CLAUDE.md/AGENTS.md architecture note (module, `apiVersion` gate, "native change ⇒ APK"), MediaPipe attribution line in the Swing home footer | `CLAUDE.md`, `AGENTS.md`, `SwingHomeScreen.js` | docs match the shipped contract | Haiku | S8 | S |

### PR sequence

```
S1 → S2 → S3 ─┐
               ├→ S4 → S5 → S6 → S7 → S8 → S9
N1 ────────────┘        ↑          ↑
                 (APK 1) N2 ───────┘
                         N3 (APK 2; or fold into APK 1 if N3 lands before S5 ships)
```

S1–S3 and N1 run in parallel from day one. **APK 1** (`preview-arm64`) after N1 + N2 merge; **APK 2** after N3 (or a single APK if N3 is ready before the first device round). Everything else ships OTA behind the `apiVersion` gate. The design step D runs while S1–S3/N1 are being built, so it never blocks the pure work.

## 11. Risks and open questions

| # | Risk / question | Position |
|---|---|---|
| R1 | **240 fps fragmentation.** Many mid-range phones expose only 120 (or none) through Camera2 high-speed even when the stock camera does 240 via vendor paths; some Samsungs report the capability only on the main sensor. | `listRecordingModes` is the truth; the pill says what it got; "import a slow-mo video" is a first-class path, not an apology. Collect `(model, modes)` in the PR body from every phone tested. |
| R2 | **Fake/interpolated slow-mo** on import (some phones, all "slow-mo" editors). | `duplicateFrameRatio` + the `interpolated` flag; impact checks marked approximate; never silently wrong. |
| R3 | **Model size and APK.** `tasks-vision` native libs (~15 MB arm64) + `full` model 9.4 MB ⇒ APK grows ~25 MB; `heavy` is excluded. The 9.4 MB model in git: acceptable once (models don't churn), no LFS in this repo. | Bundle `full`; `lite` is the fallback knob (D2). Download-on-first-use is the alternative if the repo-size objection wins. |
| R4 | **Speed target** on mid-range: pass 1 depends on decoder throughput and the GPU delegate actually engaging (some Mali drivers fall back to CPU). | The §4.1 gate with `timings.delegate` reported; lite fallback; auto-stop at 8 s; "trim the video" warning on long imports. |
| R5 | **Licensing.** MediaPipe Tasks: Apache 2.0 (attribution line, S9). Drill text: written for this plan, original. The OnForm set-up images from the web prototype are **not** used — the guide overlay is our own silhouette. | Done in S9/N3. |
| R6 | **Battery/thermal.** 240 fps capture + GPU inference heats the phone; a range session is 10–20 swings. | Camera released the moment the screen is left; analysis is one-shot; no background work; no preview analysis in v1. |
| R7 | **Expo Go** cannot run the module. | Dev builds only (the app already uses the `development` profile); document in CLAUDE.md. |
| R8 | **OTA vs APK.** A JS bundle that calls a method the installed binary lacks crashes. | `apiVersion` gate in `native.js`; every contract change bumps it and is called out in the PR. |
| R9 | **Privacy text.** | "Your video and analysis stay on this phone. Nothing is uploaded." on Swing home and capture; export is explicit and named. No analytics on this feature. |
| R10 | **Left-handers / mirrored clips.** The trail-shoulder rule and the ball-side sign flip. | `handedness` in the store (asked with height); geometry mirrors x. Golden tests are right-handed only; one synthetic mirrored test in S2. |
| R11 | **Clutter behind the golfer** defeats the shaft heuristic. | Assisted by design; the prior keeps the UI usable; corrections feed v2. |
| R12 | **The `expo-modules-core` patch** (`patches/expo-modules-core+3.0.29.patch`, activity-result re-registration) must still apply after any SDK bump the module work might tempt. | No SDK bump in this feature. |

### Decisions (confirmed by the owner 2026-10-11)

| # | Question | Decision |
|---|---|---|
| D1 | UI language of the swing screens. | Swing screens in English like the rest of the app; copy in `strings.js`. |
| D2 | Pose model. | `full`, measured; `lite` if the gate fails. Only one bundled. |
| D3 | Entry point. | Profile quick-links row "My swing". |
| D4 | Checkpoint stills ±2 frames (≈ 60 JPEGs, ~3 MB/swing) instead of frame-accurate video scrubbing. | Yes — checkpoint stills ±2 frames. |
| D5 | Height stored locally in the swing store, not in `profiles.settings`. | Yes — height stored locally. |
| D6 | Handedness asked once (default right). | Yes — asked once, default right. |
| D7 | Compare in v1 as a two-column check table + impact stills (no ghost overlay). | Yes — two-column check table + impact stills. |
| D8 | Design direction | Option B "the still leads": results open on the checkpoint still with the selected measure drawn, verdict hero above, timeline below, checks at that checkpoint; Edit marks = the same screen in edit mode. From A: a flat "All checks" list (plain scroll, no collapsible chapters). From C: a retake/analyse review step after recording stops, before decoding. No pins, no gesture navigation. Design page: https://claude.ai/artifact/LP34gefW9UbDHVxbRM96f7 |
| D9 | Tempo thresholds | green 2.5–3.5 : 1, yellow 1.6–2.5 or 3.5–4.5, red < 1.6 or > 4.5 (the golden swing's ~1.8–2.0 is yellow; the upper band keeps `tempo_slow` meaningful). |
| D10 | User-facing checkpoints | Exactly 9: address, takeaway, leadArm, top, transition, shaftDown, impact, trailArm, finish (10 since D22: shaftThrough between impact and trailArm). lateBackswing / preImpact / followThrough remain internal frames, reachable with the ±2 nudge only where useful; preImpact = impact − 6 capture frames for the clubhead_pre check. `motionStart` stays internal (tempo and takeaway search only). |
| D11 | Hands out at impact | New check `hands_out_impact`: horizontal distance of the hands at impact vs address toward the ball line, cm; green ≤ 4, yellow ≤ 8, red > 8; part of the early_extension cluster. |
| D12 | Errors | `analyze.js` returns `{ error: 'no_pose' \| 'partial_pose' \| 'too_long' }`; the processing screen renders them ("No golfer found — keep your whole body in frame"). |
| D13 | Swing name | Default name = capture date ("Sat 11 Oct · 18:42"); rename from the results menu; optional club class chip. |
| D14 | Status display | Always a dot + word (Good / Watch / Fix / Hidden); values in ink colour; never yellow text (fails AA on white). |
| D15 | Checkpoint definitions | Checkpoint definitions follow the P-system (P1–P7, P9, P10; P1–P10 since D22) as in editor/checkpoints.js; detector rules and golden tests must target these definitions. |
| D16 | Clubhead in v1 | The shaft-tracking heuristic (§4.3) failed in the swing lab (2026-10-11: 75–110 cm off at every checkpoint except impact, 13 cm there with the old rules; 7 cm with the D17 seeding). v1 proposes the clubhead only at address and impact (seeded from the ball and the hands); at every other checkpoint the user places it (or marks it hidden) in Edit marks, and club-dependent checks stay 'unknown' until placed. Every placement is stored as a label for the v2 learned detector (§7 marks.json). N2 scope shrinks accordingly: no backswing/downswing shaft tracking in v1. |
| D17 | Validated detection rules | Folded in from the swing lab (2026-10-11, one clip; reference implementation `tools/swing-lab/detect.py --variant d15`, which the Kotlin/JS port must match on the lab clips): (1) **sampling** every frame from `motionStart` to impact, sparse only before and after, thresholds per-clip from the pose jitter (σ, moving > 3σ, stopped = 3 × P25 of the 0.15 s speed), never a fixed H/s (4.2); (2) **zero-lag One-Euro** offline, in px and captured time (4.5); (3) **hands = grip estimate** `wrist + 0.35·(wrist − elbow)` with the visibility < 0.5 wrist gate (4.5); (4) **geometric phase rules**, P1 from the ball patch, P2/P6 grip at trail-hip height, P3/P5/P9 wrist in the shoulder band, P4 end of the hands' plateau, P7 `ballGone − 1`, P10 grip and nose stopped 0.15 s, order enforced (5.1); ball searched after the club leaves; clubhead per D16. Status and the ≥ 10-clip gate: 8.5. |
| D18 | Ship before the 10-clip gate | Owner decision 2026-10-11: build and ship v1 now; accuracy improves from real use. The §8.5 gate becomes a tracking target, not a merge blocker. Consequence: S8's "Export swing" is required in v1 — one explicit share action producing a zip (original clip + `analysis.json` + `marks.json` with the user's corrected frames/marks) that `tools/swing-lab/import_export.py` unpacks into `clips/` + `out/<clip>/truth.json`, so every corrected swing becomes a lab test case. Nothing is sent automatically. |
| D19 | Club | Club: `iron` \| `driver`, per-club thresholds table in `checks.js` `THRESHOLDS` (§5.4); driver values provisional (2026-10-12), to be calibrated on real swings; picker on Home (remembers the last choice) and on Results (re-scores the stored pose and marks, no native call); default iron, also for swings saved before the picker. Supersedes the "optional club class chip" of D13. Carried in `swing.json` and `truth.json` as `club`. |
| D20 | Drag loupe | Drag loupe in Edit marks, 3×, above finger, flips below at top edge. A ~120 px circle shows the same still at 3× around the mark being dragged (hands, clubhead or ball), a crosshair at the exact mark, ~80 px above the fingertip, clamped inside the still; arrow nudges show it for ~600 ms; hidden on release; no fade under reduced motion; decorative for screen readers (`src/swing/loupe.js`, `DragLoupe`). |
| D21 | Earliest fault first; setup and top checks | Owner-approved 2026-10-12, from a coaching guide the owner shared (all wording our own). **Priority (§5.5):** the main fault is the significant fault (≥ 1 red or ≥ 2 yellows) of the earliest phase, setup → backswing → transition → impact → finish, weights break ties within a phase; later significant faults are `consequences`, shown in the hero as "Likely also causing: …". **Six pose-only checks (§5.4):** `hands_under_shoulders`, `waist_bend`, `back_line`, `hand_gap` at address (posture cluster) and `hands_over_heels`, `lead_arm_shoulder_plane` at the top (new `top_position` cluster). Limits provisional (2026-10-12), the same for iron and driver. Consequence on the golden swing: the main fault moves from early extension to posture at address, with early extension a consequence (§8.2). Calibration caveat: MediaPipe's shoulder landmark is the shoulder joint, not the base of the neck, and the lead hip is partly hidden down the line, so `back_line` and `hand_gap` read high on the one labelled clip; recalibrate on more clips before trusting their reds. |
| D22 | P8 checkpoint `shaftThrough` | Owner-approved 2026-10-12. A 10th user-facing checkpoint, **shaft parallel after impact (P8)**, between impact and trailArm: the first frame after impact the grip rises back to lead-hip height (the mirror of P6), order enforced; confidence 0.2 on the window-midpoint fallback. Now **10 user-facing checkpoints** (D10, D15): timeline, Edit marks, scrubber, Compare, export and pass 2 (13 stills) carry it. Lab: optional `shaftThrough` in CONTRACT.md, editor cue, `detect.py --variant d15` (same rule; 568 on the golden clip, impact 557, trailArm 575) and `eval.py` (scored when the truth has it). The owner has not labelled P8 yet, so the golden test checks order and lab parity only. |
| D23 | Steep → shallow → steep | Owner-approved 2026-10-12. Three readings of the shaft line (grip → clubhead extended to ball height) against the ball and the toes: halfway back (`butt_extension`, relabelled: just inside the ball = steep enough = green), halfway down (`shaft_down_shallow` at P6: beyond the ball = shallow = green, toes…ball = yellow, inside the toes = steep, red, feeds `over_the_top`) and halfway through (`shaft_through_steep` at P8: inside the ball = green, beyond ≤ 15 cm yellow, further red, new fault `flip`). P6 and P8 need a clubhead the user places (D16) and stay 'unknown' with the "Place clubhead" CTA until then. Results shows one "Swing pattern: steep → shallow → steep" row with the three statuses. Driver = iron for now (provisional). |
| D24 | Drills, camera tip, practice plan | Owner-approved 2026-10-12, inspired by a coaching guide (all wording our own; a well-known drill is credited by name only). **Drills:** "Stick behind you" (over the top, flat backswing, flip), "Pane of glass" (Hogan's image; top position, steep backswing, across the line) and one setup drill each for `hands_under_shoulders`, `waist_bend`, `back_line`, `hand_gap`; drills aimed at the main fault's evidence lead (§5.6); each drill carries the 7-iron, film it, build to speed progression. **Camera tip:** every "phone at hip height" becomes "phone on your toe line, at hand height, aimed at your hands" (down the line): Swing home empty state, the no-pose error, the capture guide (S2). **Practice plan:** a collapsible card under the drills on Results, open/closed remembered in the swing profile (`practiceOpen`): a 60-minute session, Program 0–5 (slow, filmed, positions), Block 5–25 (one drill station, positions only; the main fault's first drill is named here), Random 25–45 (full routine, change clubs, ball flight matters), Compete 45–60 (something on the line). |


## 12. Out of scope

Face-on view (the second camera position; most checks have face-on variants — sway, head, weight shift — and the capture guide already has the second card ready), iOS (the module is Android-only; an AVFoundation high-speed recorder and the same MediaPipe task would fit the same contract), a learned club detector (v2, trained on §7.3 exports), live pose on the preview (framing feedback), sharing results outside the phone, coach/friend review, and any server component.
