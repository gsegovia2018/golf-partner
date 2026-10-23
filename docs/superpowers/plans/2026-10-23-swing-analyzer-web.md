# Swing analyzer on the web (iPhone PWA)

**Goal:** iPhone users without the Android app analyse swings in the web build: Chrome or Safari on
iOS (both WebKit), including the home-screen web app. Import a clip, get the same analysis, mark it,
compare. Desktop Chrome works too.

## What changes

All native access already goes through `src/swing/native.js`. The web gets its own implementation
of that same contract, `src/swing/native.web.js` (Metro picks `.web.js` for web), so `runAnalysis`,
`frames.js`, `analyze()` and every screen keep calling the same functions.

| Android (`modules/golf-swing`) | Web (`src/swing/web/`) |
|---|---|
| MediaExtractor sample table | `mp4.js`: our own ISO-BMFF reader on `Blob.slice` (moov only, mdat never read whole) |
| MediaCodec sequential decode | `source.js`: WebCodecs `VideoDecoder`; fallback: a `<video>` element seeked frame by frame (HEVC on WebKit) |
| `YuvFrame` (display-oriented grey/RGB) | `webFrame.js`: the decoded frame drawn rotated onto a canvas; grey = BT.601 luma of the RGB (what the lab's `cv2` gives) |
| MediaPipe Tasks 1.1.0 (Android) | `@mediapipe/tasks-vision` 1.1.0 (same release, same `pose_landmarker_full.task`), VIDEO mode, GPU then CPU |
| `PoseAnalyzer` (threads, ring, back-fill epochs) | `analyzePose.js`: one sequential loop; the ring and the back-fill re-run stay, the threading goes |
| `SamplingPolicy`, `Ball`, `BallWindow`, `Grip`, `Stats`, `Probe.duplicateRatio` | `core/*.js`, line-for-line ports with the Kotlin unit tests ported to Jest |
| `Checkpoints`, `ShaftSearch`, `ClubheadTrack`, `ClubRules`, `ClubDecode` | `checkpoints.js` + `core/*.js` ports |
| `FrameSessions` (warm decoder) | `frameSessions.js` |
| LiteRT (Android) club detector | LiteRT.js (`@litertjs/core`), the same `club_yolox_tiny_v1.tflite`, wasm |
| Camera2 240 fps capture | none: no browser records high-speed video. Web is import-only |

**Storage.** `expo-file-system` has no web implementation of `Paths`/`File`/`Directory`. A small
seam, `src/swing/fs.js` (re-exports expo-file-system) / `fs.web.js` (the same subset over
IndexedDB, with a synchronous in-memory index and `blob:` URIs), replaces the imports in
`swingStore`, `frames.js` and `runAnalysis`. A `blob:` URI does not survive a reload, so the list's
`thumb` is stored as its `swingfs:/` path (`storableUri`) and shown with `displayUri`. Ask
`navigator.storage.persist()` on the first import (Safari evicts a site's storage after 7 days
unused unless it is a home-screen web app).

**Gates.** `native.web.js` reports apiVersion 6 when the browser has what it needs (canvas, wasm,
WebCodecs or a `<video>` to seek; `web/support.js`). A club model that can't load leaves the edge
proposals, as on a phone without it. `availability.js` asks `web/support.js` on web.

**UI.** No new screens. On web: the Record button is hidden (Import becomes the primary action),
the Profile row to the swing analyzer shows, and an unsupported browser gets the existing banner
with a "this browser can't analyse videos" text. The import hint says to pick from Files for the
full-quality clip (Photos re-encodes to 720p; slow motion survives as a 30 fps render, which the
fps model already handles). No design step: nothing new to lay out.

**Privacy.** Unchanged: the clip and the analysis stay in the browser's storage, nothing is
uploaded. The models and the wasm runtimes are static files served with the app.

## Risks

- HEVC through WebCodecs on iOS is not reliably supported: the `<video>` fallback is slower
  (a seek per needed frame), and the sampling policy keeps the frame count down.
- iOS Safari tab memory (~1–1.5 GB): every `VideoFrame` is closed right after use, the ring is
  capped by bytes, the clip is read in slices.
- Numbers differ slightly from Android (decoder, resize, GPU). Measured against the lab's
  `truth.json` for the lab clips, not assumed equal.
- Only desktop Chromium can be driven here: the iPhone itself is verified by Marcos.

## As built (2026-10-23)

- MediaPipe's ESM bundle can't go through Metro (`import()` of a computed URL): it is served from
  `public/swing-web/mediapipe/vision_bundle.js` and imported at run time. LiteRT.js bundles.
- The club model runs on LiteRT.js's wasm path only. On WebGPU a node fails inside LiteRT and
  `run()` still resolves with garbage boxes. On wasm it matches the lab's golden boxes for all three
  fixtures (scores within 0.001), ~0.3 s a frame on a desktop CPU.
- No frame ring: a back-fill decodes again from the sync frame before it, so it always reaches the
  frames it wants.
- Desktop Chrome, lab clips: 298-frame AVC clip 9 s pass 1 + 4.5 s pass 2; 1297-frame HEVC 240 fps
  clip 23 s + 12 s. The `<video>` fallback gives the same frames and heads, ~3× slower.
- Positions against the owner's marks: within ±3 frames except the address (pass 2 image rule:
  −10 and −43 frames on two clips) and the finish (+10 / +19). Android's own proposals for these
  clips aren't in the exports, so the gap to the phone is not measured.

## Verify

1. Jest: the ported Kotlin tests + mp4 reader + fs.web; `npm test`, `npm run lint`.
2. A Node/Chromium harness runs the web pipeline on the lab clips and scores the checkpoint frames
   against `tools/swing-lab/out/<clip>/truth.json`.
3. `/verify` on the Expo web build: import a clip, analysis, Results, Edit marks, Compare,
   reload (storage survives), delete.
4. iPhone (Marcos): Safari and Chrome, Files and Photos picks, home-screen app.
