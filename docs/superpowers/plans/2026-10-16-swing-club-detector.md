# Swing club detector: a learned clubhead on the phone

**Date:** 2026-10-16 · **Status:** plan, awaiting the owner's answers to §9 · **Lifecycle:** `deliver` (full; no UI design step, see §5.4)
**Branch:** `feat/swing-club-detector` (worktree `.claude/worktrees/club-detector`), from `master`.
**Parent plan:** `docs/superpowers/plans/2026-10-11-swing-analyzer.md` — §4.3 (club heuristics), §5.3 (`club.js`), §7.3 (`marks.json` as training data), D16 (clubhead at address and impact only), D17, D25–D28. This plan is the "v2 learned club detector" that D16 and §12 deferred.
**Lab:** `tools/swing-lab/{train_yolox.py,eval_yolo.py}` in the `swing-track` worktree (2026-10-15/16). Those two files are the reference for pre- and post-processing; the Kotlin port must match them.

## 1. Goal

Pass 2 (`extractCheckpoints`, `Checkpoints.kt`) proposes the clubhead at **every checkpoint where it is visible**, not only at address and impact, by running a small learned detector (YOLOX-tiny fine-tuned on a public club dataset) on the checkpoint frames it already decodes. The marking canvas then opens most positions with a clubhead to confirm instead of "Missing", and the club-dependent checks (`butt_extension` at P3, `top_direction` at P4, `shaft_down_shallow` at P6, `clubhead_vs_plane` at pre-impact and impact, `shaft_through_steep` at P8, `shaft_angle_impact`) get a value before the golfer touches anything.

**The bar (lab, 2026-10-16, run 2 epoch 8, 3 owner clips, 16 marked clubheads):** 16/16 found, median 4.1 cm, 9 within 5 cm, 11 within 10 cm; address 3.5–4.2 cm, impact 1.7–4.0 cm, lead arm 2.1–3.6 cm, top 8–27 cm (shaft-corner fallback), transition 101 cm on a low-resolution clip, P6 behind the thigh 72 cm (a false head near the feet); never fired on a frame marked hidden except that P6. Today's heuristic (`ShaftSearch`, §4.3 of the parent plan): 7–30 cm at impact, nothing elsewhere. The phone must reproduce the lab numbers on the same clips through the native module (§6) before an APK ships.

### Scope

- The detector, its export, its Kotlin runtime and post-rules, the pass-2 contract, the JS merge, the licences, the device evaluation.
- Checkpoints covered: the 13 frames pass 2 already decodes (`PASS2_KEYS` in `runAnalysis.js`: the ten of D22 plus `lateBackswing`, `preImpact`, `postImpact`), the address at its final (image-based) frame.

### Non-goals

- **No live analysis** (nothing on the camera preview; the parent plan's R6 stands).
- **No training-data upload, no telemetry.** Videos and frames never leave the phone (CLAUDE.md, parent S9). The only exit stays the explicit Export swing (D18). The detector's boxes are stored in `pose.json` beside the stills so that an export carries them, nothing more.
- **P6 / P8 behind the body stay manual or Hidden.** A frame with no detection stays `source: 'prior'` (the canvas's Missing); it is never auto-marked hidden, because the model cannot tell hidden from missed.
- No change to the hands proposal (the pose grip estimate of §4.5 stays the hands; the detector's `hands` class is recorded, not used — §4.4).
- No new screen, no canvas change beyond more positions opening with a proposal (§5.4).
- No iOS, no face-on.

## 2. What exists today (read 2026-10-16)

**Pass 2, native.** `Checkpoints.run()` (`modules/golf-swing/android/src/main/java/expo/modules/golfswing/Checkpoints.kt`) does one sequential decode of the checkpoint span (`decodeSplit` → `decodeSpan` → `Media.decode`, two decoder threads when a sync frame makes it worth it) and, per decoded frame `f` with its `YuvFrame y`: the ball patch for the image-based address (`y.grayStrip(onsetRect, 1)`), the grey ROI for the shaft search at the requested address frame and at impact, the scrub proxy (`Proxies.pixels`, D28), the JPEG still (`Stills.writeJpeg` on a 3-thread pool, 8 in flight). `ClubheadOnset.detect` then moves the address; a short second decode fetches the moved address's grey and missing stills. `ShaftSearch.search` (`Clubhead.kt`) runs **twice per swing**: at impact (inside the decode loop) and at the final address frame, both seeded hands → ball (`seeded()`). Output `shaft[frame]` = `entry(ShaftFound)` → `{ head: [x, y] display px | null, hidden, conf, source: 'edge', angleDeg, lengthPx }` at those two frames, `prior()` → `{ head: null, hidden: false, conf: 0.1, source: 'prior' }` at the other eleven. Timings carry `shaftMs`. The request (`Pass2Request`) already brings per checkpoint the **smoothed grip estimate** `hands` (normalised; converted to display px in `run()`), the ball, and `expectedShaftPx` (105 cm × px/cm), from which `pxPerCm` is derived — the same scale the lab's `eval_yolo.py` uses (`debug.scale.pxPerCm`).

**Frames.** `YuvFrame` (`YuvFrame.kt`) owns one decoded I420 frame in coded orientation; `toRgb(outW, outH, dst)` writes a display-oriented RGB buffer at any size, **nearest-neighbour** when scaling down (`Tables`), BT.601 limited range unless tagged full — this is what feeds MediaPipe in pass 1 (`toRgba`). A stretched 640 × 640 input is therefore one call away. `keep(f)` decides whether a frame is a fresh copy (stills) or the reused scratch frame, so anything the detector needs must be copied out inside the handler.

**Model loading.** `PoseAnalyzer.PoseWorker.create()` loads `pose_landmarker_full.task` from the module's `assets/` (9.4 MB, committed in git) through `BaseOptions.setModelAssetBuffer`, GPU delegate first with CPU fallback, reported as `timings.delegate`.

**What is on the classpath.** `modules/golf-swing/android/build.gradle` declares one dependency, `com.google.mediapipe:tasks-vision:1.1.0`. Its AAR ships `libmediapipe_tasks_jni.so` (14 MB arm64) with TFLite **statically linked inside** and a 277 KB `classes.jar` of task APIs; `tasks-core` pulls flogger, protobuf-javalite, guava and datatransport (telemetry, already disabled by `modules/golf-swing/app.plugin.js`). **No `org.tensorflow.lite` / LiteRT Java interpreter is reachable** (the Gradle cache holds only `org.tensorflow:tensorflow-lite-metadata`, from ML Kit's barcode scanner, and no LiteRT runtime). So the detector needs **one new native dependency**: the LiteRT runtime (§3.3). MediaPipe's own `ObjectDetector` task was considered and rejected: it expects an SSD-style model with metadata and the `TFLite_Detection_PostProcess` op (or anchor metadata), its preprocessing graph decides letterboxing and normalisation for us, and YOLOX's anchor-free head would have to be re-expressed inside the TFLite graph — a fragile export for no runtime saving.

**JS.** `src/swing/native.js` gates on `REQUIRED_API_VERSION = 2`, `CAPTURE_API_VERSION = 2`, `PROXY_API_VERSION = 3` (`proxySupport()`), with the binary's `GolfSwingModule.API_VERSION = 3`. `runAnalysis.js` builds the pass-2 request (`PASS2_KEYS`, `hands: first.clubMarks[key].hands`, `neighbours: 2`, `expectedShaftPx(first.scale.pxPerCm)`, the proxies when supported) and stores the result as `pose.pass2 = { shaft, addressFrame, timings, proxies }`. `analyze.js` reads `pass2.shaft?.[frame]` per `CLUB_KEYS` and calls `resolveClub(key, hands, cand, mark, ball)` (`club.js`): a user mark wins; else a candidate with `conf ≥ CANDIDATE_MIN_CONF (0.35)` and `source !== 'prior'` becomes `{ head, hidden: !head, source: 'edge', conf }`; else the prior, with `priorHead = ball` at `SEEDED_CHECKPOINTS` (address, impact) so the overlay draws a dashed ring to drag. `clubMarks[key]` therefore carries `source: 'user' | 'edge' | 'prior'`, which `editMarks.buildDraft` copies into `base.cps[key].source` and `draftToMarks` writes to `marks.json` as `head.proposedSource` (`labels.frameLabel`). The canvas (`SwingEditMarksScreen.js`, `markStatus` in `editMarks.js`) shows a head as `proposed` when it equals the base proposal, `missing` when the proposal had none; `primaryAction` says `noHead` for a missing head. `SwingOverlay` draws `club.head` as a dot and `club.priorHead` as the ring only when there is no head. `checks.js` treats `source === 'prior'` as `unplaced` (reason text "place the clubhead") and null heads as `hidden`.

**Lab.** `train_yolox.py`: YOLOX-tiny (`exps/default/yolox_tiny.py`, `num_classes = 3`, names `shaft / head / hands`), COCO `yolox_tiny.pth` start, Roboflow `club-head-tracking/golf-club-tracking` v2 (4,729 frames, 640 × 640 stretched), input = `cv2.resize(img, (640, 640))` (bilinear) of the BGR frame, **raw 0–255 float, CHW, no normalisation**; `--aug strong` (zoom/shift/aspect squash, motion blur, flip, HSV). `eval_yolo.py yolox_predictor`: `postprocess(out, 3, conf=0.03, nms=0.45, class_agnostic=False)` (YOLOX's: cxcywh → xyxy, class_conf = max class, keep `obj × class_conf ≥ conf`, per-class NMS), boxes scaled back by `w/640, h/640`; `drop_static` (a box whose place — same class, IoU ≥ 0.5 — is occupied in ≥ 50 % of the span's frames is scenery; `hands` exempt); `head_track` (the most confident `head` box within 150 cm of the `hands` box; else the `shaft` box corner farthest from the hands box). Run 2 (`models/yolox-club-v2/epoch_8.pth`) gave the bar; run 3 (`models/yolox-club-v3`, 20 epochs) is at epoch 13 as of writing.

## 3. Model export

### 3.1 Which checkpoint

Whichever of run 2 epoch 8 and run 3's best epoch scores better on `eval_yolo.py` **under the on-phone configuration of §4** (L1). The plan never names an epoch; `tools/swing-lab/models/club/README.md` (new, L2) records the chosen file, its SHA-256, the eval table and the export command, and the shipped asset's name carries a version (`club_yolox_tiny_v1.tflite`) so a later retrain is a new asset and a new APK, never a silent swap.

### 3.2 Path: PyTorch → TFLite, decode inside the graph

1. `tools/swing-lab/export_tflite.py` (new, L2) loads the checkpoint's `ema` weights into `build_exp().get_model()`, sets `model.head.decode_in_inference = True` so the graph outputs the **decoded** `[1, 8400, 8]` tensor `(cx, cy, w, h, obj, cls_shaft, cls_head, cls_hands)` in 640-px units (grid and stride maths stay in the model, not in Kotlin), `eval()`, then converts with **`ai-edge-torch`** (`ai_edge_torch.convert(model, (sample,))`, a `[1, 3, 640, 640]` float sample) — PyTorch → TFLite directly, no ONNX. Fallback if the YOLOX head trips the converter: `tools/export_onnx.py` from the YOLOX repo (opset 11, `--decode_in_inference`) → `onnx2tf` → TFLite. Either way the converter may emit NHWC or keep NCHW; the Kotlin fill reads the input tensor's shape at load and fills accordingly (§4.2), and the golden fixture (§3.5) catches a mismatch.
2. **Precision: fp16 weights, fp32 compute** (`converter` flag `quant` fp16 / `target_spec.supported_types = [float16]`). Size ≈ 10 MB (5.06 M params × 2 B) against ≈ 20 MB fp32. fp16 is numerically a no-op for this model (the lab trains in fp32, weights round to fp16 with < 0.1 % change) and needs no calibration set. **int8** (≈ 5 MB, roughly 2× faster on CPU) is a measured follow-up (L4), not v1: it needs representative frames for calibration (the owner's exported clips qualify) and the small head boxes (≈ 10–18 px at 640) are where int8 usually loses first.
3. Input layout and channel order: the lab feeds **BGR**. The Kotlin side writes B, G, R from `YuvFrame`'s RGB (§4.2) rather than permuting the first conv's weights at export, so the export stays a plain conversion of the trained graph.
4. **Where it lives:** `modules/golf-swing/android/src/main/assets/club_yolox_tiny_v1.tflite`, next to `pose_landmarker_full.task`, committed in git like the pose model (parent R3: "acceptable once, models don't churn"). Loaded once per pass 2 through `context.assets.openFd` → mapped `ByteBuffer` (the LiteRT `Interpreter` takes a `MappedByteBuffer`).
5. **APK budget:** +≈ 10 MB model (fp16) + LiteRT runtime (`com.google.ai.edge.litert:litert`, ≈ 1.5–2 MB arm64 in `preview-arm64`; the universal `preview` profile carries all four ABIs, ≈ 4× that) ≈ **+12 MB on the arm64 APK**. The GPU delegate (`litert-gpu`) would add ≈ 3 MB more and is off in v1 (§4.3). Download-on-first-use is the fallback if the owner objects to the repo size (§9 Q3).

### 3.3 Runtime dependency

`modules/golf-swing/android/build.gradle` gains `implementation "com.google.ai.edge.litert:litert:<latest 1.x on Maven at build time>"` (the current coordinates of the former `org.tensorflow:tensorflow-lite`; the Java API is `com.google.ai.edge.litert.Interpreter` / `InterpreterApi`, XNNPACK on by default) — Apache 2.0. No `litert-support`, no `litert-metadata`: pre- and post-processing are our own Kotlin. Two TFLite copies will exist in the APK (one static inside MediaPipe's JNI, one in LiteRT's `libtensorflowlite_jni.so`); they do not share symbols and do not conflict — ML Kit + MediaPipe apps ship this way routinely. **Native change ⇒ new APK** (CLAUDE.md "Shipping to Android"): `build.gradle`, the Kotlin and the asset all move the fingerprint.

### 3.4 Decode and NMS in Kotlin (`ClubDetector.kt`, pure JVM part)

`ClubDecode.boxes(raw: FloatArray, n = 8400, conf = 0.03, nmsIou = 0.45): List<Box>` with `Box(cls, score, x1, y1, x2, y2)` in 640-px units:
- per row: `x1 = cx − w/2 … y2 = cy + h/2`, `clsConf = max(cls0..2)`, `cls = argmax`, `score = obj × clsConf`, keep if `score ≥ conf` (exactly YOLOX `postprocess`);
- per class, greedy NMS at IoU 0.45 on the kept rows sorted by score (torchvision `batched_nms` semantics: class-wise, not agnostic);
- IoU as in `eval_yolo.iou` (no +1 pixel).

The caller scales `x, y` by `dispW / 640`, `dispH / 640` into display px — the same convention as `entry()` today (`headX / ws` is display px of `track.dispW × dispH`).

### 3.5 Golden test: the lab and the phone agree on the same frame

`export_tflite.py` writes, for one marked frame per clip (impact, the sharpest):
- `fixtures/club/<clip>-<frame>.input.bin`: the exact 640 × 640 × 3 uint8 BGR tensor the lab fed (after `cv2.resize`),
- `…raw.bin`: the exported **TFLite** model's raw `[8400 × 8]` float32 output on that input (run through the Python TFLite interpreter, so the fixture is the TFLite graph, not PyTorch),
- `…boxes.json`: the boxes after the lab's `postprocess` on that same raw tensor (`cls, score, x1..y2` in 640 units),
and a table in the README comparing TFLite to PyTorch on all 16 marked heads (head centre within 2 px at 640, score within 0.02) — that is the export's own acceptance.

Two tests consume them:
1. **JVM unit test** `ClubDetectorTest` (`modules/golf-swing/android/src/test/…`, run with `./gradlew :golf-swing:testDebugUnitTest` after a prebuild, like `ClubheadTest`): `ClubDecode.boxes(raw.bin)` equals `boxes.json` (same count, same classes, coordinates ± 0.5 px, scores ± 1e-3). This proves decode + NMS without a model runtime (LiteRT has no desktop JVM build).
2. **On-device golden** (part of V1, §6): a debug-only path `ClubDetector.selfTest(context)` behind a `BuildConfig.DEBUG` check — it feeds `input.bin` from the module's **test assets** (`src/debug/assets/`, never in the release APK) to the real interpreter and compares with `boxes.json` (IoU ≥ 0.9 per box, score ± 0.05: fp16 + XNNPACK vs Python TFLite fp32). Exposed as `GolfSwing.clubSelfTest()` only in debug builds (`Function` registered when `BuildConfig.DEBUG`), called by hand from the dev variant's JS console. Result logged under the `GolfSwing` tag.

Why not bit-exact end to end: `YuvFrame.toRgb` scales nearest-neighbour and converts BT.601 from YUV, while the lab reads OpenCV's decode and resizes bilinearly. The model is trained with heavy augmentation and is robust to that; the **on-device evaluation on the three clips (§6) is what measures the effect**, and the golden test isolates the port (decode, NMS, layout, channel order) from the frame source.

## 4. Runtime on the phone

### 4.1 Which frames

**The 13 checkpoint frames pass 2 already decodes, nothing more** — plus the moved address frame when `ClubheadOnset` moves it (its short second decode already revisits that frame). Not the ± 2 neighbours (65 frames, 5× the cost, and `chooseFrame` in `editMarks.js` resets the head to Missing on any frame other than the proposal's, so neighbour proposals would be unused today), not a sparse sample of the swing span.

The static rule still works on 13 frames because they are spread from address to finish: a spare club on the ground, a bag, a pole or a line on the mat occupies the same box in all 13 (≥ 50 % → dropped), while the swung clubhead sits in one place only at address and for the three frames around impact (4 of 13 = 31 %, under the 50 % threshold — but close enough that the rule must count **distinct checkpoints, not frames**, and must exempt the `head` class from being counted against itself across `preImpact / impact / postImpact`: those three count as one place). The lab item L1 re-runs `drop_static` restricted to the 13 checkpoint frames of each clip to confirm the two scenery clips still lose their spare club and no true head is dropped; if it does not hold, the fallback is "static = present in ≥ 70 % and also present at address and finish".

### 4.2 Where it runs in `Checkpoints.run()`

1. In the decode handler, for `f ∈ clubFrames` (the 13 + the moved address later): `y.toRgb(640, 640, buf)` into a direct `ByteBuffer` from a small pool, then one pass that writes the float tensor in the model's layout (NHWC `[640, 640, 3]` or NCHW, read from `interpreter.getInputTensor(0).shape()` at load), **B, G, R** order, values 0–255 as floats — kept in a `ConcurrentHashMap<Int, ByteBuffer>` (13 × 4.9 MB fp32 = 64 MB; too much next to the stills in flight, so the pool holds **uint8** BGR at 640 × 640 — 1.2 MB each, 16 MB total — and the float conversion happens on the detector thread per frame into one reusable input tensor buffer). Both decoder threads can call this; the map is concurrent and the uint8 copy is made inside the handler, so the scratch frame is safe.
2. **After the decode loop** (where `onset` is computed today), before the JPEG wait: the detector runs the 13 inputs **sequentially on the calling thread** — the JPEG pool is still finishing, so inference overlaps `jpegWaitMs` instead of adding to it. The moved address frame is appended from the second decode before this step. No new worker thread, no queue: inference needs all frames anyway for the static rule, and sequential is the simplest thing that fits the budget (§4.3).
3. Post-rules on the display-px boxes (pure Kotlin, `ClubRules.kt`, unit-tested):
   - `dropStatic` per §4.1;
   - per frame, anchor = the **pose grip** `CheckpointSpec.hands` in display px (already passed; the detector's `hands` box is a fallback only when `hands == null`, which the JS never sends);
   - `head` boxes farther than `150 × pxPerCm` from the anchor are ignored (`pxPerCm = expectedShaftPx / 105`, computed in `run()` today);
   - head = centre of the most confident surviving `head` box → `source: 'model'`; else the `shaft` box corner farthest from the anchor → `source: 'model-shaft'` (the lab's `head_track(fallback="hands")`); else nothing.
4. The per-frame `shaft[frame]` entry is chosen **in native**, one entry per frame, best source first: `model` → `model-shaft` → today's `edge` at address/impact (unchanged, it costs nothing and covers a frame where the model finds nothing) → `prior`. The raw boxes (after static drop, display px, ≤ 10 per frame) ride along as `boxes` so the lab can re-score the phone's output without the phone.
5. `cancelled()` is polled between frames; a detector failure (model missing, interpreter error) is logged, counted in `timings.clubFailures`, and **never fails pass 2**: the entries fall back to `edge` / `prior` exactly as today (the same policy as the proxies).

### 4.3 Cost

YOLOX-tiny at 640 × 640 is ≈ 6.5 GFLOPs. Expected per frame on the reference mid-range phone (parent §4.1): CPU XNNPACK fp32, 4 threads ≈ 60–120 ms; GPU delegate ≈ 20–40 ms but 0.5–2 s of shader compilation at first use and a 3 MB library. For 13–14 frames: **≈ 1–1.7 s CPU**, overlapping the JPEG wait, so pass 2 grows from ≈ 1.5 s to **≈ 2.5–3 s** on that phone, user-visible between "analysing" and the club sheet (the mark-first flow of D26 waits for pass 2). The §4.1 budget line of the parent plan becomes "pass 2 ≈ 3 s"; the acceptance in V1 is **`timings.clubMs ≤ 2000` on the owner's phone with the fp16 model on CPU**. If it misses: (a) 416 × 416 input (YOLOX-tiny's native size, 2.4× cheaper — but the lab must re-evaluate at 416, L4), (b) int8 (L4), (c) GPU delegate behind the same `delegate` reporting as pass 1. Threads: `Interpreter.Options().setNumThreads(4)`, created once per pass 2 and closed in the `finally` with the pool. `timings` gains `clubMs`, `clubFrames`, `clubFailures`, `clubDelegate: 'cpu'`.

Memory: the model mapped (10 MB, shared pages), the interpreter's arena (≈ 30–60 MB for this graph at fp32 activations), 16 MB of uint8 inputs, one 4.9 MB float input tensor. All freed at the end of pass 2.

### 4.4 Hands: pose grip, not the detector's `hands` box

The lab numbers used the detector's own `hands` box as the anchor for the shaft-corner fallback and the 150 cm rule. On the phone the grip estimate already arrives per checkpoint (`CheckpointSpec.hands`, §4.5 of the parent plan, 3.7 cm median on the lab clips), so it is the anchor: one less class to trust, and it is also the point the shaft line is drawn from in every check (`extendToY(c.hands, c.head, …)`), so a corner chosen relative to it is self-consistent. The cost is that the bar must be re-measured with that anchor — L1 adds `--hands pose` to `eval_yolo.py` (anchor = `auto-d15-dense.json`'s hands at the frame) and the §1 numbers are replaced by that run's before any Kotlin is written. The detector's hands box stays in `boxes` for the lab and as a future hands proposal (out of scope here).

## 5. Contract and JS merge

### 5.1 `apiVersion` 4

`GolfSwingModule.kt`: `API_VERSION = 4 // 4: learned club detector in pass 2 (plan 2026-10-16)`. `ExtractCheckpointsOptions` gains `@Field val clubModel: Boolean = false` — the JS asks for it explicitly, so a binary without the asset or a swing the JS wants heuristics-only for both behave as today. (An older binary ignores the unknown field, as D28's `proxyEvery` proved.)

### 5.2 Pass-2 JSON (additive)

```
shaft: { [frame]: {
  head: [x, y] | null, hidden, conf,
  source: 'model' | 'model-shaft' | 'edge' | 'prior',   // new values: model = head box, model-shaft = shaft-box corner
  boxes?: [ { cls: 'shaft'|'head'|'hands', score, box: [x1, y1, x2, y2] } ],   // display px, after the static drop; model sources only
  angleDeg?, lengthPx?                                     // edge only, as today
} }
timings: { …, clubMs, clubFrames, clubFailures, clubDelegate }
club: { model: 'club_yolox_tiny_v1', input: 640, conf: 0.03, nms: 0.45 } | null   // what ran; stored as pose.pass2.club
```

`conf` for model sources is the detector's `score = obj × cls` (0.03–0.95), **not** the heuristic's 0–1 edge ratio; the two scales meet in `club.js` (§5.3). `hidden` is always `false` for model entries (the model never asserts hidden, §1 non-goals).

### 5.3 JS

- `native.js`: `export const CLUB_MODEL_API_VERSION = 4;` and `clubModelSupport()` beside `proxySupport()`; `REQUIRED_API_VERSION` stays 2 and `PROXY_API_VERSION` 3 — an apiVersion 2/3 binary keeps analysing, marking and scrubbing with today's proposals. The JSDoc of `extractCheckpoints` gains the new fields. `native.test.js` gains the gate cases (3 → unsupported, 4 → supported).
- `runAnalysis.js`: spreads `clubModel: true` into the request when `api.clubModelSupport?.()`; stores `p2.club = r.club ?? null` next to `proxies`, so `pose.pass2.club` says whether a stored swing was analysed with the model (the lab reads it from an export; Results could show it later).
- `club.js`: `resolveClub` keeps "user mark wins", then accepts a candidate when `conf ≥ minConf(source)` with `MODEL_MIN_CONF = 0.03` for `model` / `model-shaft` and `CANDIDATE_MIN_CONF = 0.35` for `edge` (the model's score is already thresholded in native; the JS constant exists so the lab and the app state one number), and **carries `candidate.source` through** instead of hardcoding `'edge'` — so `clubMarks[key].source`, `base.cps[key].source` and `marks.json`'s `head.proposedSource` say `model` / `model-shaft`, which is what the training-data export needs to tell a model proposal from a heuristic one. `SEEDED_CHECKPOINTS` (the dashed prior ring at address and impact) is unchanged. `club.test.js`: model candidate accepted at 0.05, edge still needs 0.35, source carried, prior unchanged.
- `checks.js`: no change — `unplaced` is `source === 'prior'`, so a `model` head is a placed head and the P3/P4/P6/P8/impact rows compute. `analyze.test.js` gets one case: a `model` candidate at `shaftDown` turns `shaft_down_shallow` from `unknown` into a status.
- `editMarks.js`, `labels.js`, `markPass.js`: unchanged; `markStatus` already yields `proposed` for a model head and `primaryAction` stops saying `noHead` by itself.
- `frames.js` header comment and `strings`/i18n: the attribution line (§7).

### 5.4 UI: no change, no design step

The canvas shows exactly what it shows today for address and impact — a proposed clubhead dot with the `proposed` status word and "Looks right · next" — at the other positions too. No new control, copy or layout. The one visible difference is that P6 / P8 may open with a **wrong** proposal where today they open Missing (the lab's 72 cm false head at P6 on one clip); the golfer drags it or taps Hidden as now. If, after the first device round, the owner wants a visual distinction for model proposals (for example a hollow dot or an "estimated" tag at low score), that is a UI change and goes through the three-design step before implementation; it is not in this plan.

## 6. Evaluation gate before shipping

1. **Lab bar re-measured for the phone's rules (L1):** `eval_yolo.py --yolox <ckpt> --hands pose --frames checkpoints` on the three clips → the table replaces §1's numbers. Pass condition for proceeding: all 16 found, median ≤ 5 cm, ≥ 9 within 5 cm, ≥ 11 within 10 cm, no detection on the frames marked hidden except the known P6 case.
2. **Export acceptance (L2):** TFLite vs PyTorch on the 16 heads: centre within 2 px at 640, score within 0.02.
3. **Port (N4):** `ClubDetectorTest` green; the debug `clubSelfTest()` passes on the dev variant (`GOLF_APP_VARIANT=dev GOLF_ANDROID_BUILD_ARCHS=arm64-v8a npx expo prebuild -p android --clean`, `./gradlew :app:assembleRelease`, `adb install --user 0`, never over `com.golfpartner.app`).
4. **Device golden (V1):** import the three lab clips on the owner's phone (two are app exports already; the originals, not WhatsApp copies), analyse, **Export swing** each → `tools/swing-lab/import_export.py` → `eval_yolo.py --from-export out/<clip>/pose.json` (new mode, L3: reads `pass2.shaft[frame].head` and `boxes` from the exported `pose.json` instead of running a model) → the same table as step 1, **from the phone's own boxes**. Pass: the step-1 pass condition, and per checkpoint within 2 cm of the lab on the same frame (nearest-neighbour vs bilinear resize is the expected gap). `timings.clubMs ≤ 2000`, `clubFailures = 0`, `clubDelegate = 'cpu'`, logged in the PR body with the phone model.
5. **APK:** `npx eas-cli build -p android --profile preview-arm64` (the native change: dependency, Kotlin, asset), install, repeat step 4 on that build (release, not debug: XNNPACK threading and R8 can differ), then `GOLF_ANDROID_BUILD_ARCHS=arm64-v8a npx eas-cli fingerprint:compare <hash>` before any OTA — run without a generated `android/` folder (CLAUDE.md Wear OS note). Swings analysed before the APK keep their stored `pass2` (no lazy re-run; `reanalyzeForClub` never calls native); a golfer re-analyses to get model proposals, and confirmed marks are kept because `runAnalysis` reads `marks.json` for the second `analyze()`.
6. **OTA afterwards:** the JS items ship OTA with `--branch preview`; on the older APK runtime the gate keeps `clubModel` off and nothing else differs. The owner's phone is on the master-APK runtime (memory `ota-runtimes-split.md`): the new APK replaces that runtime, so the OTA command targets the new fingerprint from then on.

## 7. Licences and attribution

| Component | Licence | Obligation | Where |
|---|---|---|---|
| YOLOX (code, `yolox_tiny.pth` COCO weights the fine-tune starts from) | Apache 2.0 | notice | `modules/golf-swing/THIRD_PARTY.md` (new) and the in-app line |
| Roboflow Universe `club-head-tracking/golf-club-tracking` v2 (training data) | **CC BY 4.0** | attribution with the work (the shipped weights are a derivative) | the in-app line: `swing.home.attribution` in `src/i18n/locales/{en,es}/swing.js` becomes "Pose detection by MediaPipe (Apache 2.0). Club detector: YOLOX (Apache 2.0), trained on the Golf Club Tracking dataset by club-head-tracking, Roboflow Universe (CC BY 4.0)." / the Spanish equivalent; plus `THIRD_PARTY.md` with the dataset URL and licence URL |
| LiteRT runtime | Apache 2.0 | notice | `THIRD_PARTY.md` |
| MediaPipe Tasks | Apache 2.0 | already credited (parent S9) | unchanged |
| Ultralytics YOLO11m (`models/swingtrace-yolo11m.pt`, github.com/nishsm/golf-club-tracking) | **AGPL-3.0** | **never ships; nothing derived from it ships** | lab only; `eval_yolo.py`'s docstring already says so; the export script refuses any checkpoint not produced by `train_yolox.py` (checks the `names` key and the YOLOX state-dict keys) |

The fine-tuned weights are our own work on CC BY data; no licence file is required for them beyond the attribution. `THIRD_PARTY.md` is linked from the parent plan's R5 row in the same PR (S11).

## 8. Risks

| # | Risk | Position |
|---|---|---|
| R1 | **Converter trouble** (YOLOX's `decode_in_inference` grids, `SiLU`, `Focus` slicing) in `ai-edge-torch`. | The ONNX → `onnx2tf` fallback is a known-good route for YOLOX; the export acceptance (§6.2) is the test either way. Budget one day; escalate L2 to Opus if neither converter gives a model that passes §6.2. |
| R2 | **Speed on CPU** misses 2 s on a mid-range phone. | 416 input / int8 / GPU in that order (§4.3), each a measured lab + device item (L4), none a blocker for the owner's phone round. |
| R3 | **Nearest-neighbour stretch vs bilinear** shifts small heads. | Measured by §6.4; if the gap exceeds 2 cm, `YuvFrame` gets a bilinear `toRgbBilinear` for the 640 path (one function, ~40 lines, JVM-testable) — not written speculatively. |
| R4 | **False heads** (the P6 behind-the-thigh case) now reach the canvas where before the position opened Missing. | Same correction cost as a wrong address/impact proposal today; stored as a `model` label with `corrected: true`, which is exactly the training signal the next retrain needs. Not auto-hidden (§1). |
| R5 | **Static rule on 13 frames** is coarser than on dense spans. | L1 checks it on the two scenery clips before any Kotlin; §4.1 names the fallback rule. |
| R6 | **APK +12 MB** and a 10 MB binary in git. | Precedent: the 9.4 MB pose model. Download-on-first-use is the alternative (Q3) — it adds a network path to a feature whose promise is "nothing leaves the phone", so the plan prefers the asset. |
| R7 | **Two TFLite runtimes** (MediaPipe's static, LiteRT's shared) in one process. | Separate symbol namespaces; common in ML Kit + MediaPipe apps. Verified by the dev build simply loading both (pass 1 then pass 2). |
| R8 | **Run 3 replaces run 2 mid-plan.** | §3.1: the checkpoint is a lab decision recorded in the README; nothing downstream names an epoch. |
| R9 | **Fingerprint**: forgetting that the asset and `build.gradle` move it. | §6.5; `fingerprint:compare` before OTA, as CLAUDE.md requires. |
| R10 | **Left-handers.** The dataset was flipped in training (`train_yolox.py`), the post-rules are side-agnostic (distances to the anchor). | One mirrored clip in the device round if available; otherwise noted as untested. |

## 9. Open questions for the owner

1. **CPU-only first** (fp16, XNNPACK, ≈ 1–1.7 s for 13 frames) with GPU as a measured follow-up — or GPU from the start (+3 MB, shader warm-up)? The plan assumes CPU-only.
2. **Input 640** as trained, or re-evaluate **416** in the lab now (L4 early) since YOLOX-tiny is natively 416 and it is 2.4× cheaper? The plan ships 640 and treats 416 as the first speed lever.
3. **Model in git** (≈ 10 MB fp16, like the pose model) or download on first use? The plan assumes git.
4. **Hands anchor = pose grip** (§4.4), accepting that the bar is re-measured with it, or keep the detector's `hands` box as in the lab? The plan assumes the pose grip.
5. Keep today's `edge` heuristic as the fallback at address/impact (free, already running) or delete `ShaftSearch` to simplify? The plan keeps it.
6. Attribution wording and placement (§7): one line under the existing MediaPipe line on Swing home — fine, or a separate "Licences" row?
7. Should Results show that a swing was analysed with the model (`pose.pass2.club`)? The plan stores it and shows nothing.
8. Run 3: wait for it to finish (≈ 2 more hours at 14 min/epoch) before L1, or start L1 on run 2 epoch 8 and re-run when run 3 lands? The plan does L1 on both when run 3 finishes.

## 10. Build items

Model routing per CLAUDE.md: **Haiku** = mechanical and fully specified; **Sonnet** = feature work against this plan; **Opus** = native contract, cross-cutting, tricky debugging. Review of N4 and of the gate change in S10 stays at the top tier. "Lab" = Python under `tools/swing-lab` in the `swing-track` worktree (no app change, no CI); "App" = this worktree.

| # | Kind | Item | Files | Verification | Model | Depends on |
|---|---|---|---|---|---|---|
| **L1** | Lab | Re-measure the bar under the phone's rules: `eval_yolo.py` gains `--hands pose` (anchor = the grip from `auto-d15-dense.json` at the frame) and `--frames checkpoints` (run and apply `drop_static` on the 13 checkpoint frames only, counting distinct checkpoints, pre/impact/post as one place); run on run 2 ep 8 and run 3's candidates; pick the checkpoint; write `models/club/README.md` (file, SHA-256, table). | `tools/swing-lab/eval_yolo.py`, `tools/swing-lab/models/club/README.md` | §6.1 pass condition printed for the chosen checkpoint; the two scenery clips still drop their spare club under `--frames checkpoints` | Sonnet | run 3 finished (Q8) |
| **L2** | Lab | `export_tflite.py`: checkpoint → TFLite fp16 with decode in the graph (`ai-edge-torch`, `onnx2tf` fallback), the AGPL guard, the golden fixtures (`input.bin`, `raw.bin`, `boxes.json` per clip at impact), the TFLite-vs-PyTorch table on the 16 heads. Copies the model to `modules/golf-swing/android/src/main/assets/club_yolox_tiny_v1.tflite` and the fixtures to the module's test resources. | `tools/swing-lab/export_tflite.py`, `tools/swing-lab/models/club/README.md`, the asset, `modules/golf-swing/android/src/test/resources/club/*` | §6.2 (centre ≤ 2 px, score ≤ 0.02 on all 16) | Sonnet; escalate to Opus on R1 | L1 |
| **L3** | Lab | `eval_yolo.py --from-export <pose.json>`: score the phone's `pass2.shaft[frame]` (`head`, `boxes`) against `truth.json` with the same table; `import_export.py` keeps `pose.json` from the zip. | `tools/swing-lab/eval_yolo.py`, `tools/swing-lab/import_export.py`, `test_import_export.py` | a hand-made `pose.json` with the lab's own boxes reproduces the L1 table | Sonnet | L1 |
| **N4** | App | **Native detector and contract.** `ClubDetector.kt` (LiteRT `Interpreter` on the asset, 4 threads, input layout from the tensor shape, uint8 BGR 640² inputs captured in the decode handler, sequential inference after the decode loop, `selfTest` in debug), `ClubDecode` (decode + class-wise NMS), `ClubRules` (static drop over checkpoints, 150 cm rule, head / shaft-corner choice from the pose grip), wiring in `Checkpoints.run()` (entries with `source: 'model' \| 'model-shaft'`, `boxes`, the moved address, cancel, failure never fails pass 2), `timings.club*`, `club` block, `ExtractCheckpointsOptions.clubModel`, `API_VERSION = 4`, `build.gradle` dependency, debug-only `clubSelfTest` function. Tests: `ClubDetectorTest` (golden decode/NMS from L2's fixtures, static rule, corner rule, 150 cm rule, no-anchor fallback). | `modules/golf-swing/android/build.gradle`, `…/golfswing/{ClubDetector,ClubDecode,ClubRules}.kt`, `Checkpoints.kt`, `GolfSwingModule.kt`, `…/src/test/…/ClubDetectorTest.kt`, `…/src/debug/assets/club/*` | `./gradlew :golf-swing:testDebugUnitTest` green; dev variant: `clubSelfTest()` passes, a pass 2 on a lab clip logs 13–14 model entries and `clubMs`; pass 1 and pass 2 both load (R7) | **Opus** | L2 |
| **S10** | App | **JS gate and merge.** `native.js` (`CLUB_MODEL_API_VERSION = 4`, `clubModelSupport()`, JSDoc), `runAnalysis.js` (`clubModel` in the request, `p2.club`), `club.js` (per-source minimum, source carried through), tests (`native.test.js`, `runAnalysis.test.js`, `club.test.js`, `analyze.test.js` per §5.3), `frames.js` header comment. | `src/swing/{native,runAnalysis,club,frames}.js`, `src/swing/__tests__/{native,runAnalysis,club,analyze}.test.js` | `npm test`, `npm run lint`; with a mocked apiVersion 3 module the request has no `clubModel` and `resolveClub` behaves as today; with 4 a `model` candidate at 0.05 becomes the head and `shaft_down_shallow` gets a status | Sonnet (the gate reviewed by Opus) | N4's contract (can be written against §5.2 in parallel) |
| **S11** | App | **Docs and attribution.** `THIRD_PARTY.md` in the module; the i18n attribution line (en + es, §7); CLAUDE.md swing bullets (apiVersion 4, `CLUB_MODEL_API_VERSION`, the new asset and dependency ⇒ APK, pass-2 cost); parent plan: §3 contract block, §4.1 pass-2 line, §4.3 "v2" note pointing here, R5 row, a D31 line recording the owner's answers to §9. | `modules/golf-swing/THIRD_PARTY.md`, `src/i18n/locales/{en,es}/swing.js`, `CLAUDE.md`, `docs/superpowers/plans/2026-10-11-swing-analyzer.md` | `npm test` (the i18n parity test `stringsEs.test.js` passes); docs match the shipped contract | Haiku | S10 |
| **V1** | App + lab | **Device gate and ship.** Dev-variant round on the three clips → Export swing → L3 → table and timings in the PR body; `preview-arm64` APK; repeat on the release build; `fingerprint:compare`; OTA of the JS items; owner marks two new swings on the canvas to confirm the proposals land where expected. | PR bodies; no code unless the round fails (then back to N4 / R3) | §6.4–6.6 pass; `clubMs ≤ 2000`; `clubFailures = 0` | Sonnet runs it; **Opus** reviews the numbers and any fix | N4, S10, S11 |
| **L4** | Lab (follow-up, not v1) | Speed levers measured, in order: 416 input (re-eval), int8 with the owner's exported frames as calibration, GPU delegate timing on the device. Each is its own lab table; only one that keeps the §6.1 bar becomes a new asset (`_v2`) and a new APK. | `tools/swing-lab/{eval_yolo,export_tflite}.py` | tables in `models/club/README.md` | Sonnet | V1 |

### PR sequence

```
L1 → L2 → N4 ──┐
      └→ L3    ├→ V1 (APK, then OTA) → L4 (later)
S10 → S11 ─────┘
```

L1–L3 are lab commits on the `swing-track` worktree's branch (Python only, no app change, no CI). N4 is one native PR (may exceed 400 lines: three Kotlin files + tests + the 10 MB asset). S10 and S11 are small JS/docs PRs that can land before the APK — the gate keeps them inert on apiVersion 3. V1 produces no code of its own; its numbers go in N4's and the APK's PR bodies. One concern per PR, Conventional Commits, `Closes #N` (this repo's default branch is `master`; PRs target it).
